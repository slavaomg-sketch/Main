--!strict
-- Computes and applies post-race rewards exactly once per (RaceId, UserId). Also handles unlock evaluation.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local RewardConfig = require(Shared.Config.RewardConfig)
local GameConfig = require(Shared.Config.GameConfig)
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local VehicleDefinitions = require(Shared.Config.VehicleDefinitions)
local RaceTypes = require(Shared.Types.RaceTypes)
local ProfileTypes = require(Shared.Types.ProfileTypes)

type Profile = ProfileTypes.Profile
type FinishRecord = RaceTypes.FinishRecord
type RewardBreakdown = RaceTypes.RewardBreakdown

local RewardService = { Name = "RewardService" }
RewardService.__index = RewardService

function RewardService.new()
	return setmetatable({ _env = nil :: any, _telemetry = nil :: any }, RewardService)
end

function RewardService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._telemetry = registry:Get("TelemetryService")
end

export type RewardContext = {
	ModeId: string,
	TrackId: string,
	Laps: number,
	Record: FinishRecord,
	Total: number,
	TourPosition: number?,
	TourFinal: boolean,
	KnockoutStages: number,
	IsBattle: boolean,
	BattleWon: boolean,
	Assist: boolean,
	VehicleId: string,
	HeroId: string,
	Ghost: string?,
}

function RewardService.Compute(profile: Profile, ctx: RewardContext): RewardBreakdown
	local c = RewardConfig.Currency
	local x = RewardConfig.XP
	local lines: { { Key: string, Amount: number } } = {}
	local currency, xp = 0, 0
	local r = ctx.Record
	local function add(key: string, amount: number)
		if amount ~= 0 then
			table.insert(lines, { Key = key, Amount = amount })
			currency += amount
		end
	end
	if ctx.ModeId == "TimeTrial" then
		add("REWARD.FINISH", c.TimeTrialFinish)
		xp += x.Participation
	elseif ctx.IsBattle then
		add("REWARD.BATTLE", if ctx.BattleWon then c.BattleWin else c.BattleParticipation)
		xp += x.Participation + (if ctx.BattleWon then x.Win else 0)
	else
		if r.Finished then
			add("REWARD.FINISH", c.Finish)
			add("REWARD.POSITION", c.PositionBonus[r.Position] or 0)
			if r.Position == 1 then
				xp += x.Win
			end
			xp += (x.PositionBonus[r.Position] or 0)
		end
		if ctx.ModeId == "Knockout" then
			add("REWARD.STAGE", c.KnockoutStageBonus * r.StageReached)
		end
		xp += x.Participation + x.PerLap * ctx.Laps
	end
	if r.Shards > 0 then
		add("REWARD.SHARDS", r.Shards * c.ShardConversion)
	end
	if ctx.TourFinal and ctx.TourPosition then
		add("REWARD.TOUR", c.GrandTourFinalBonus[ctx.TourPosition] or 0)
	end
	local newRecord = false
	if r.Finished and r.TimeSeconds and not ctx.IsBattle then
		local existing = profile.TrackRecords[ctx.TrackId]
		if existing == nil or (r.TimeSeconds :: number) < existing.BestTime then
			newRecord = true
			if existing == nil then
				add("REWARD.RECORD", c.FirstPersonalRecordBonus)
			end
		end
	end
	if ctx.ModeId ~= "TimeTrial" and ctx.ModeId ~= "Practice" then
		-- Clean race: finished without taking a strong hit (tracked via Score < 0 sentinel by RaceService)
	end
	return { Currency = currency, XP = xp, Lines = lines, NewLevel = nil, NewRecord = newRecord, Unlocks = {} }
end

-- Idempotent apply. Returns the breakdown or nil if this race was already processed for this profile.
function RewardService.Apply(
	self: any,
	profile: Profile,
	raceId: string,
	userId: number,
	ctx: RewardContext,
	cleanRace: boolean
): RewardBreakdown?
	local key = raceId .. ":" .. tostring(userId)
	if profile.ProcessedRaceRewards[key] ~= nil then
		self._telemetry:Count("reward.duplicate")
		return nil
	end
	local breakdown = RewardService.Compute(profile, ctx)
	if cleanRace and ctx.Record.Finished and not ctx.IsBattle and ctx.ModeId ~= "TimeTrial" then
		table.insert(breakdown.Lines, { Key = "REWARD.CLEAN", Amount = RewardConfig.Currency.CleanRaceBonus })
		breakdown.Currency += RewardConfig.Currency.CleanRaceBonus
	end
	profile.ProcessedRaceRewards[key] = self._env.Unix()
	profile.Currency += breakdown.Currency
	profile.XP += breakdown.XP
	local newLevel = RewardConfig.LevelForXP(profile.XP)
	if newLevel > profile.Level then
		profile.Level = newLevel
		breakdown.NewLevel = newLevel
	end
	local r = ctx.Record
	local stats = profile.Statistics
	if r.Finished then
		stats.RacesFinished = (stats.RacesFinished or 0) + 1
		if r.Position == 1 then
			stats.Wins = (stats.Wins or 0) + 1
		end
		if r.Position <= 3 then
			stats.Podiums = (stats.Podiums or 0) + 1
		end
	end
	stats.Laps = (stats.Laps or 0) + ctx.Laps
	stats.ShardsCollected = (stats.ShardsCollected or 0) + r.Shards
	if ctx.IsBattle and ctx.BattleWon then
		stats.BattleWins = (stats.BattleWins or 0) + 1
	end
	if breakdown.NewRecord and r.TimeSeconds then
		profile.TrackRecords[ctx.TrackId] = {
			BestTime = r.TimeSeconds :: number,
			BestLap = r.BestLap or (r.TimeSeconds :: number),
			Assist = ctx.Assist,
			VehicleId = ctx.VehicleId,
			HeroId = ctx.HeroId,
			SetAt = self._env.Unix(),
			Ghost = ctx.Ghost,
		}
	end
	if ctx.TourFinal and ctx.TourPosition then
		table.insert(
			profile.GrandTourResults,
			{ At = self._env.Unix(), Position = ctx.TourPosition, Points = r.Points }
		)
		if #profile.GrandTourResults > 50 then
			table.remove(profile.GrandTourResults, 1)
		end
	end
	-- Prune old processed keys (keep last 200) so the profile stays small.
	local count = 0
	for _ in profile.ProcessedRaceRewards do
		count += 1
	end
	if count > 200 then
		local oldestKey, oldestAt = nil, math.huge
		for k, at in profile.ProcessedRaceRewards do
			if at < oldestAt then
				oldestKey, oldestAt = k, at
			end
		end
		if oldestKey then
			profile.ProcessedRaceRewards[oldestKey] = nil
		end
	end
	breakdown.Unlocks = RewardService.EvaluateUnlocks(profile)
	self._telemetry:Count("reward.applied")
	return breakdown
end

-- Level/achievement unlocks are granted automatically; currency unlocks are purchased via ProfileService.
function RewardService.EvaluateUnlocks(profile: Profile): { string }
	local unlocked = {}
	for _, h in HeroDefinitions.List do
		if not profile.UnlockedHeroes[h.Id] then
			local u = h.Unlock
			if
				(u.Kind == "Level" and profile.Level >= u.Level)
				or (u.Kind == "Achievement" and (profile.Achievements[u.Id] or 0) > 0)
			then
				profile.UnlockedHeroes[h.Id] = true
				table.insert(unlocked, h.NameKey)
			end
		end
	end
	for _, v in VehicleDefinitions.List do
		if not profile.UnlockedVehicles[v.Id] then
			local u = v.Unlock
			if
				(u.Kind == "Level" and profile.Level >= u.Level)
				or (u.Kind == "Achievement" and (profile.Achievements[u.Id] or 0) > 0)
			then
				profile.UnlockedVehicles[v.Id] = true
				table.insert(unlocked, v.NameKey)
			end
		end
	end
	return unlocked
end

function RewardService.PositionPoints(position: number): number
	local ModeDefinitions = require(Shared.Config.ModeDefinitions)
	return ModeDefinitions.GrandTourPoints[position] or 0
end

RewardService.ShardCurrency = GameConfig.Shards.CurrencyPerShardAtFinish

return RewardService
