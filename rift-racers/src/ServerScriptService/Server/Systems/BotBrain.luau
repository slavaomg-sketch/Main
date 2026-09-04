--!strict
-- Pure steering/throttle planner for bots. Given the track runtime and the bot's pose it returns inputs identical
-- in shape to a human player's, so bots obey the same physics and the same server validation.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local GameTypes = require(Shared.Types.GameTypes)
local MathUtil = require(Shared.Utility.MathUtil)
local TrackRuntime = require(script.Parent.TrackRuntime)

export type DifficultyProfile = {
	ReactionSeconds: number,
	LookAhead: number, -- studs
	LineNoise: number, -- lateral wobble amplitude (studs)
	MistakeChance: number, -- per second
	DriftSkill: number, -- 0..1 chance to drift on suitable corners
	ItemSkill: number, -- 0..1 chance to use an item at a good moment
	CornerBrake: number, -- how much curvature slows the bot
	ShortcutChance: number,
	SpeedScale: number, -- <= 1 (bots are never faster than humans could be)
}

local Profiles: { [string]: DifficultyProfile } = {
	Easy = { ReactionSeconds = 0.45, LookAhead = 34, LineNoise = 5, MistakeChance = 0.08, DriftSkill = 0.15, ItemSkill = 0.4, CornerBrake = 1.3, ShortcutChance = 0.05, SpeedScale = 0.86 },
	Normal = { ReactionSeconds = 0.25, LookAhead = 44, LineNoise = 2.5, MistakeChance = 0.03, DriftSkill = 0.5, ItemSkill = 0.65, CornerBrake = 1.0, ShortcutChance = 0.3, SpeedScale = 0.95 },
	Hard = { ReactionSeconds = 0.12, LookAhead = 56, LineNoise = 1, MistakeChance = 0.008, DriftSkill = 0.85, ItemSkill = 0.85, CornerBrake = 0.8, ShortcutChance = 0.6, SpeedScale = 1.0 },
}

export type BotInput = { Steer: number, Throttle: number, Brake: number, Drift: boolean, UseItem: boolean, Trick: boolean, TargetLateral: number }

export type BotMemory = {
	Difficulty: GameTypes.BotDifficulty,
	Seed: number,
	Rng: Random,
	LineOffset: number,
	NextLineChange: number,
	MistakeUntil: number,
	MistakeSteer: number,
	PreferredShortcut: string?,
	DriftingSince: number?,
	LastItemAt: number,
	LastDecisionAt: number,
	LastInput: BotInput,
}

local BotBrain = {}

function BotBrain.Profile(difficulty: GameTypes.BotDifficulty): DifficultyProfile
	return Profiles[difficulty] or Profiles.Normal
end

function BotBrain.NewMemory(difficulty: GameTypes.BotDifficulty, seed: number): BotMemory
	local rng = Random.new(seed)
	return {
		Difficulty = difficulty,
		Seed = seed,
		Rng = rng,
		LineOffset = 0,
		NextLineChange = 0,
		MistakeUntil = 0,
		MistakeSteer = 0,
		PreferredShortcut = nil,
		DriftingSince = nil,
		LastItemAt = -100,
		LastDecisionAt = -100,
		LastInput = { Steer = 0, Throttle = 1, Brake = 0, Drift = false, UseItem = false, Trick = false, TargetLateral = 0 },
	}
end

export type Observation = {
	Position: Vector3,
	Forward: Vector3,
	Speed: number,
	TopSpeed: number,
	Progress: number,
	Grounded: boolean,
	HasItem: boolean,
	ItemKind: string?,
	RivalAhead: number?, -- studs to nearest rival ahead
	RivalBehind: number?,
	Obstacles: { Vector3 }, -- nearby static hazards/traps to avoid
	OnJump: boolean,
	Now: number,
	RubberBand: number, -- bot-only speed scale from RaceService (bounded)
}

-- Chooses one of several racing lines (lateral offsets) periodically; Hard bots hug the inside of corners.
local function chooseLine(mem: BotMemory, track: TrackRuntime.TrackRuntime, progress: number, prof: DifficultyProfile, now: number)
	if now < mem.NextLineChange then
		return
	end
	mem.NextLineChange = now + mem.Rng:NextNumber(2, 5)
	local width = track:WidthAt(progress)
	local lines = { -width * 0.3, 0, width * 0.3 }
	local pick = lines[mem.Rng:NextInteger(1, #lines)]
	mem.LineOffset = pick + (mem.Rng:NextNumber() * 2 - 1) * prof.LineNoise
	-- Decide on shortcuts when approaching one.
	mem.PreferredShortcut = nil
	for _, sc in track.Shortcuts do
		local ahead = track.Spline:Delta(progress, sc.EntryDist)
		if ahead > 0 and ahead < 200 and sc.GateOpen and mem.Rng:NextNumber() < prof.ShortcutChance then
			mem.PreferredShortcut = sc.Def.Id
		end
	end
end

function BotBrain.Think(mem: BotMemory, track: TrackRuntime.TrackRuntime, obs: Observation): BotInput
	local prof = BotBrain.Profile(mem.Difficulty)
	local now = obs.Now
	-- Reaction time: reuse previous decision until the reaction window elapsed.
	if now - mem.LastDecisionAt < prof.ReactionSeconds then
		return mem.LastInput
	end
	mem.LastDecisionAt = now
	chooseLine(mem, track, obs.Progress, prof, now)

	-- Target point ahead on the main spline (or shortcut spline if committed).
	local lookAhead = prof.LookAhead * math.clamp(obs.Speed / math.max(1, obs.TopSpeed), 0.5, 1.3)
	local targetPos: Vector3
	local targetLateral = mem.LineOffset
	local usingShortcut = false
	if mem.PreferredShortcut then
		for _, sc in track.Shortcuts do
			if sc.Def.Id == mem.PreferredShortcut then
				local scProg, scLat, scOff = sc.Spline:ClosestProgress(obs.Position, nil)
				local aheadOnMain = track.Spline:Delta(obs.Progress, sc.EntryDist)
				if scOff < sc.Def.Width and scProg < sc.Spline.Length - 5 then
					targetPos = sc.Spline:PositionAt(scProg + lookAhead)
					usingShortcut = true
					targetLateral = 0
				elseif aheadOnMain > 0 and aheadOnMain < lookAhead * 1.5 then
					targetPos = sc.Spline:PositionAt(math.min(sc.Spline.Length, 12 + lookAhead * 0.5))
					usingShortcut = true
				elseif aheadOnMain < -20 then
					mem.PreferredShortcut = nil
				end
				local _ = scLat
			end
		end
	end
	if not usingShortcut then
		local cf = track.Spline:CFrameAt(obs.Progress + lookAhead, targetLateral, 0)
		targetPos = cf.Position
	end

	-- Obstacle avoidance: shift target laterally away from the closest obstacle in front.
	for _, ob in obs.Obstacles do
		local rel = ob - obs.Position
		if rel.Magnitude < 30 and rel:Dot(obs.Forward) > 0 then
			local right = obs.Forward:Cross(Vector3.new(0, 1, 0))
			local side = MathUtil.Sign(rel:Dot(right))
			if side == 0 then
				side = 1
			end
			targetPos -= right * side * 8
		end
	end

	local toTarget = MathUtil.FlatVector(targetPos - obs.Position)
	local forwardFlat = MathUtil.FlatVector(obs.Forward)
	local steer = 0
	if toTarget.Magnitude > 1e-3 and forwardFlat.Magnitude > 1e-3 then
		local right = forwardFlat:Cross(Vector3.new(0, 1, 0)).Unit
		local angle = math.atan2(toTarget.Unit:Dot(right), toTarget.Unit:Dot(forwardFlat.Unit))
		steer = math.clamp(angle / math.rad(35), -1, 1)
	end

	-- Mistakes: brief steering wobble.
	if now < mem.MistakeUntil then
		steer = math.clamp(steer + mem.MistakeSteer, -1, 1)
	elseif mem.Rng:NextNumber() < prof.MistakeChance * prof.ReactionSeconds then
		mem.MistakeUntil = now + 0.35
		mem.MistakeSteer = (mem.Rng:NextNumber() * 2 - 1) * 0.6
	end

	-- Throttle / brake from upcoming curvature.
	local curvature = track.Spline:Curvature(obs.Progress + lookAhead * 0.8)
	local desiredSpeedFraction = math.clamp(1 - curvature * 28 * prof.CornerBrake, 0.45, 1) * prof.SpeedScale * obs.RubberBand
	local speedFraction = obs.Speed / math.max(1, obs.TopSpeed)
	local throttle = if speedFraction < desiredSpeedFraction then 1 else 0.2
	local brake = if speedFraction > desiredSpeedFraction + 0.18 then 1 else 0

	-- Drift on sustained corners when skilled.
	local drift = false
	if obs.Grounded and math.abs(steer) > 0.45 and speedFraction > GameConfig.Physics.DriftMinSpeedFraction then
		if mem.DriftingSince ~= nil then
			drift = true
			if now - (mem.DriftingSince :: number) > 3.2 or math.abs(steer) < 0.25 then
				drift = false
				mem.DriftingSince = nil
			end
		elseif mem.Rng:NextNumber() < prof.DriftSkill then
			drift = true
			mem.DriftingSince = now
		end
	elseif mem.DriftingSince ~= nil and math.abs(steer) < 0.2 then
		mem.DriftingSince = nil
	end

	-- Items: use boosts on straights, attacks when a rival is close ahead, shields when threatened.
	local useItem = false
	if obs.HasItem and now - mem.LastItemAt > 1.5 and mem.Rng:NextNumber() < prof.ItemSkill then
		local kind = obs.ItemKind
		if kind == "Boost" or kind == "Multi" or kind == "Warp" then
			useItem = curvature < 0.01
		elseif kind == "Projectile" or kind == "Homing" then
			useItem = obs.RivalAhead ~= nil and (obs.RivalAhead :: number) < 120
		elseif kind == "Trap" then
			useItem = obs.RivalBehind ~= nil and (obs.RivalBehind :: number) < 60
		elseif kind == "Shield" or kind == "Phase" then
			useItem = obs.RivalBehind ~= nil and (obs.RivalBehind :: number) < 40
		else
			useItem = obs.RivalAhead ~= nil and (obs.RivalAhead :: number) < 30 or obs.RivalBehind ~= nil and (obs.RivalBehind :: number) < 20
		end
		if useItem then
			mem.LastItemAt = now
		end
	end

	local trick = obs.OnJump and not obs.Grounded and mem.Rng:NextNumber() < prof.DriftSkill

	local input: BotInput = { Steer = steer, Throttle = throttle, Brake = brake, Drift = drift, UseItem = useItem, Trick = trick, TargetLateral = targetLateral }
	mem.LastInput = input
	return input
end

-- Bounded rubber band: only bots, only within GameConfig.Bots.RubberBand.
function BotBrain.RubberBand(distanceToLeader: number, distanceToLastHuman: number): number
	local rb = GameConfig.Bots.RubberBand
	local behind = math.clamp(distanceToLeader / rb.DistanceRange, 0, 1)
	local ahead = math.clamp(-distanceToLastHuman / rb.DistanceRange, 0, 1)
	local scale = 1 + (rb.MaxSpeedScaleBehind - 1) * behind - (1 - rb.MinSpeedScaleAhead) * ahead
	return math.clamp(scale, rb.MinSpeedScaleAhead, rb.MaxSpeedScaleBehind)
end

BotBrain.Profiles = Profiles

return table.freeze(BotBrain)
