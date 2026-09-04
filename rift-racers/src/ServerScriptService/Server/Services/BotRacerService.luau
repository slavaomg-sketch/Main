--!strict
-- Bot racers: KartSim-driven, BotBrain-planned. Bots never get impossible stats; rubber banding is bounded.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local VehicleDefinitions = require(Shared.Config.VehicleDefinitions)
local ItemDefinitions = require(Shared.Config.ItemDefinitions)
local GameTypes = require(Shared.Types.GameTypes)
local MathUtil = require(Shared.Utility.MathUtil)
local KartSim = require(script.Parent.Parent.Systems.KartSim)
local BotBrain = require(script.Parent.Parent.Systems.BotBrain)

local BotRacerService = { Name = "BotRacerService" }
BotRacerService.__index = BotRacerService

function BotRacerService.new()
	return setmetatable({ _env = nil :: any, _items = nil :: any, _counter = 0 }, BotRacerService)
end

function BotRacerService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._items = registry:Get("ItemService")
end

-- Adds `count` bots to a session roster with random (unlocked-by-default or any) loadouts.
function BotRacerService.Fill(self: any, session: any, count: number, difficulty: GameTypes.BotDifficulty)
	local names = table.clone(GameConfig.Bots.NamePool)
	local rng = self._env.Random
	for _ = 1, count do
		self._counter += 1
		local nameIdx = rng:NextInteger(1, #names)
		local name = table.remove(names, nameIdx) or ("Racer" .. self._counter)
		local hero = HeroDefinitions.List[rng:NextInteger(1, #HeroDefinitions.List)]
		local vehicle = VehicleDefinitions.List[rng:NextInteger(1, #VehicleDefinitions.List)]
		local key = "b" .. self._counter
		local identity: GameTypes.RacerIdentity = { Key = key, UserId = -self._counter, DisplayName = name, IsBot = true, BotDifficulty = difficulty, Team = 0 }
		session:AddRacer(identity, { HeroId = hero.Id, VehicleId = vehicle.Id, Cosmetics = {} }, nil)
	end
end

-- Called at grid setup for every racer; bots get a sim + memory.
function BotRacerService.Attach(self: any, session: any, key: string)
	local r = session.Racers[key]
	if not r.Identity.IsBot then
		return
	end
	local e = session.Extra[key]
	local pose = self._env.World.GetPose(session.Id, key)
	local cf = if pose then pose.CFrame else CFrame.new()
	e.Sim = KartSim.new(e.Stats, cf)
	if session.Track then
		e.Sim.Progress = session.Track:Locate(cf.Position, session.Track.Length - 30).Progress
	end
	e.BotMemory = BotBrain.NewMemory(r.Identity.BotDifficulty or "Normal", self._env.Random:NextInteger(1, 2 ^ 30))
end

local function nearestRivals(session: any, key: string): (number?, number?)
	local r = session.Racers[key]
	if session.IsArena then
		return nil, nil
	end
	local ahead, behind = nil, nil
	local L = session.Shape.Length
	local mine = r.Progress.Lap * L + r.Progress.Progress
	for otherKey, other in session.Racers do
		if otherKey ~= key and other.Connected and other.Progress.FinishedAt == nil then
			local theirs = other.Progress.Lap * L + other.Progress.Progress
			local d = theirs - mine
			if d > 0 and (ahead == nil or d < ahead) then
				ahead = d
			elseif d < 0 and (behind == nil or -d < behind) then
				behind = -d
			end
		end
	end
	return ahead, behind
end

function BotRacerService.TickBot(self: any, session: any, key: string, now: number, dt: number)
	local r = session.Racers[key]
	local e = session.Extra[key]
	local sim = e.Sim
	if not sim or not r.Connected or r.Progress.Eliminated then
		return
	end
	local racing = session.SM:Is("Racing", "FinishWindow") and r.Progress.FinishedAt == nil
	if session.IsArena then
		self:TickArenaBot(session, key, now, dt)
		return
	end
	local input: KartSim.Input = { Steer = 0, Throttle = 0, Brake = 0, Drift = false, Trick = false }
	if racing then
		local ahead, behind = nearestRivals(session, key)
		-- Bounded rubber band relative to the best-placed human.
		local rubber = 1
		local L = session.Shape.Length
		local mine = r.Progress.Lap * L + r.Progress.Progress
		local leader, lastHuman = mine, mine
		for otherKey, other in session.Racers do
			if other.Connected then
				local theirs = other.Progress.Lap * L + other.Progress.Progress
				leader = math.max(leader, theirs)
				if not other.Identity.IsBot then
					lastHuman = math.min(lastHuman, theirs)
				end
			end
		end
		if session:HumanCount() > 0 then
			rubber = BotBrain.RubberBand(leader - mine, lastHuman - mine)
		end
		local obstacles = {}
		for _, p in session.Projectiles.List do
			if p.Alive and p.Kind == "Trap" and p.OwnerKey ~= key then
				table.insert(obstacles, p.Position)
			end
		end
		local itemKind: string? = nil
		if r.Items.Active then
			itemKind = ItemDefinitions.ById[r.Items.Active].Kind
		end
		local obs: BotBrain.Observation = {
			Position = sim.Position,
			Forward = sim:Forward(),
			Speed = sim.Speed,
			TopSpeed = e.Stats.TopSpeed,
			Progress = sim.Progress,
			Grounded = not sim.Airborne,
			HasItem = r.Items.Active ~= nil,
			ItemKind = itemKind,
			RivalAhead = ahead,
			RivalBehind = behind,
			Obstacles = obstacles,
			OnJump = session.Track:JumpAt(sim.Progress) ~= nil,
			Now = now,
			RubberBand = rubber,
		}
		local decision = BotBrain.Think(e.BotMemory, session.Track, obs)
		input = { Steer = decision.Steer, Throttle = decision.Throttle, Brake = decision.Brake, Drift = decision.Drift, Trick = decision.Trick }
		if decision.UseItem and r.Items.Active then
			self._items:Use(session, key, "Active", sim:Forward(), nil)
		end
	elseif session.SM:Is("Countdown") then
		-- Bots time their launch with difficulty-dependent jitter.
		if e.StartThrottleAt == nil then
			local prof = BotBrain.Profile(r.Identity.BotDifficulty or "Normal")
			local jitter = (self._env.Random:NextNumber() * 2 - 1) * prof.ReactionSeconds
			e.StartThrottleAt = session.GoAt + jitter
		end
	elseif r.Progress.FinishedAt ~= nil then
		input.Throttle = 0.3
		input.Steer = 0
		local decision = BotBrain.Think(e.BotMemory, session.Track, {
			Position = sim.Position, Forward = sim:Forward(), Speed = sim.Speed, TopSpeed = e.Stats.TopSpeed, Progress = sim.Progress, Grounded = true,
			HasItem = false, ItemKind = nil, RivalAhead = nil, RivalBehind = nil, Obstacles = {}, OnJump = false, Now = now, RubberBand = 0.6,
		})
		input.Steer = decision.Steer
	end
	-- Mirror server-side effects into the sim.
	sim.Shards = r.Shards
	sim:Step(input, dt, now, session.Track)
	e.Drifting = sim.Drifting
	if sim.LastDriftTier > 0 then
		e.DriftBoosts += 1
		session:Broadcast("VisualEvent", "DriftBoost", { Key = key, Tier = sim.LastDriftTier })
		sim.LastDriftTier = 0
	end
	self._env.World.SetPose(session.Id, key, sim:CFrame(), sim:Velocity())
end

function BotRacerService.TickArenaBot(self: any, session: any, key: string, now: number, dt: number)
	local r = session.Racers[key]
	local e = session.Extra[key]
	local sim = e.Sim
	local racing = session.SM:Is("Racing", "FinishWindow")
	local input: KartSim.Input = { Steer = 0, Throttle = 0, Brake = 0, Drift = false, Trick = false }
	if racing then
		-- Simple arena behaviour: head for the nearest active shard or item pad; fire at the nearest rival.
		local target: Vector3? = nil
		local bestD = math.huge
		for _, s in session.Shards do
			if s.Active then
				local d = (s.Position - sim.Position).Magnitude
				if d < bestD then
					bestD, target = d, s.Position
				end
			end
		end
		if r.Items.Active == nil then
			for _, p in session.Pads do
				if p.Active then
					local d = (p.Position - sim.Position).Magnitude * 0.8
					if d < bestD then
						bestD, target = d, p.Position
					end
				end
			end
		end
		if target == nil then
			target = Vector3.new(0, sim.Position.Y, 0)
		end
		local to = MathUtil.FlatVector((target :: Vector3) - sim.Position)
		local fwd = sim:Forward()
		if to.Magnitude > 1 then
			local right = fwd:Cross(Vector3.new(0, 1, 0))
			input.Steer = math.clamp(math.atan2(to.Unit:Dot(right), to.Unit:Dot(fwd)) / math.rad(30), -1, 1)
		end
		input.Throttle = 0.85
		if r.Items.Active and now - e.LastItemUseAt > 2 then
			local nearest, nd = nil, math.huge
			for otherKey, other in session.Racers do
				if otherKey ~= key and other.Connected then
					local op = session.Extra[otherKey].LastPose
					if op then
						local d = (op.CFrame.Position - sim.Position).Magnitude
						if d < nd then
							nd, nearest = d, op.CFrame.Position
						end
					end
				end
			end
			if nearest and nd < 90 then
				e.LastItemUseAt = now
				self._items:Use(session, key, "Active", (nearest :: Vector3) - sim.Position, nil)
			end
		end
	end
	-- Arena sim: no spline; keep inside bounds by steering toward centre when near the edge.
	sim.Shards = r.Shards
	local fake = session.Arena
	local before = sim.Position
	local _ = before
	sim.Speed = math.min(sim.Speed + (if input.Throttle > 0 then e.Stats.Acceleration * dt else -sim.Speed * dt), e.Stats.TopSpeed * 0.9)
	if now < sim.StunUntil then
		sim.Speed = math.min(sim.Speed, e.Stats.TopSpeed * sim.StunScale)
	end
	sim.Yaw += input.Steer * 2.2 * dt * math.clamp(sim.Speed / 30, 0.2, 1)
	sim.Position += sim:Forward() * sim.Speed * dt
	if not fake:InBounds(sim.Position) or fake:InsideObstacle(sim.Position) then
		sim.Position -= sim:Forward() * sim.Speed * dt
		sim.Yaw += math.pi * 0.5 * dt * 4
		sim.Speed *= 0.5
	end
	sim.Position = Vector3.new(sim.Position.X, 3, sim.Position.Z)
	self._env.World.SetPose(session.Id, key, sim:CFrame(), sim:Velocity())
end

return BotRacerService
