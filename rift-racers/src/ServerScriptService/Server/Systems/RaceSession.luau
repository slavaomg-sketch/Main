--!strict
-- One race/battle session: roster, state machine, voting, grid, countdown, race loop, results and rewards.
-- Physical checks, items and bots are delegated to services that operate on the session.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local GameTypes = require(Shared.Types.GameTypes)
local RaceTypes = require(Shared.Types.RaceTypes)
local Signal = require(Shared.Utility.Signal)
local TableUtil = require(Shared.Utility.TableUtil)
local KartPhysicsModel = require(Shared.Systems.KartPhysicsModel)
local VehicleStats = require(Shared.Systems.VehicleStats)
local RaceStateMachine = require(script.Parent.RaceStateMachine)
local CheckpointSystem = require(script.Parent.CheckpointSystem)
local TrackRuntime = require(script.Parent.TrackRuntime)
local ArenaRuntime = require(script.Parent.ArenaRuntime)
local ProjectileSim = require(script.Parent.ProjectileSim)
local RespawnSystem = require(script.Parent.RespawnSystem)
local GhostRecordingSystem = require(script.Parent.GhostRecordingSystem)

type RacerRuntime = RaceTypes.RacerRuntime
type RaceRules = RaceTypes.RaceRules
type RaceState = RaceTypes.RaceState

export type RacerExtra = {
	Stats: VehicleStats.EffectiveStats,
	Watch: RespawnSystem.Watch,
	Sim: any?, -- KartSim for bots
	BotMemory: any?,
	LastPose: any?,
	LastPoseAt: number,
	LastValidatedAt: number,
	LastValidPos: Vector3?,
	Surface: string,
	Drifting: boolean,
	DriftStartedAt: number,
	DriftTier: number,
	LastTrickAt: number,
	SlipstreamSince: number?,
	LastSlipstreamAt: number,
	StartThrottleAt: number?,
	Ghost: any?,
	CleanRace: boolean,
	Confirmed: boolean,
	Loaded: boolean,
	SpectateTarget: string?,
	Player: any?,
	AirSince: number?,
	KnockoutPassed: number,
	TourPoints: number,
	LapAnnounced: number,
	OverchargePulses: number,
	NextOverchargeAt: number,
	ItemsUsed: number,
	HitsLanded: number,
	Tricks: number,
	DriftBoosts: number,
	MagnetUntil: number,
	PhaseUntil: number,
	ProgressTicks: number,
}

export type SessionFields = {
	Id: string,
	RaceId: string,
	Index: number,
	ModeId: string,
	Mode: any,
	Rules: RaceRules,
	SM: RaceStateMachine.RaceStateMachine,
	Players: { any },
	Racers: { [string]: RacerRuntime },
	Extra: { [string]: RacerExtra },
	Order: { string },
	Track: TrackRuntime.TrackRuntime?,
	Arena: any?,
	Venue: any?,
	VenueId: string?,
	IsArena: boolean,
	Votes: { [string]: string },
	VoteOptions: { string },
	CountdownStartAt: number,
	GoAt: number,
	RaceStartedAt: number,
	FirstFinishAt: number?,
	Results: RaceTypes.RaceResults?,
	Rewards: { [string]: RaceTypes.RewardBreakdown },
	Projectiles: any,
	Pads: { { Id: string, Position: Vector3, Active: boolean, RespawnAt: number } },
	Shards: { { Id: string, Position: Vector3, Active: boolean, RespawnAt: number } },
	Traps: { { Id: number, Position: Vector3, OwnerKey: string, ExpiresAt: number } },
	StormCrownAvailableAt: number,
	RaceIndex: number,
	PlayedTracks: { string },
	TourPoints: { [string]: number },
	Choices: { [string]: string },
	KnockoutStage: number,
	KnockoutGateDists: { number },
	BattleEndsAt: number,
	TeamScores: { [number]: number },
	Shape: CheckpointSystem.TrackShape?,
	Ended: boolean,
	SnapshotAt: number,
	Ticks: number,
	Events: Signal.Signal<string, any>,
}
export type Session = any

local RaceSession = {}
RaceSession.__index = RaceSession

local sessionCounter = 0

local function makeKey(userId: number): string
	return "u" .. tostring(userId)
end
RaceSession.KeyFor = makeKey

function RaceSession.new(env: any, registry: any, modeId: string, players: { any }, rulesOverride: { [string]: any }?, index: number?): any
	sessionCounter += 1
	local modeDef = ModeDefinitions.ById[modeId]
	assert(modeDef, "unknown mode " .. modeId)
	local modeModule = registry:Get("ModeService"):Get(modeId)
	local rules: RaceRules = {
		ModeId = modeId,
		TrackId = "",
		Laps = modeDef.DefaultLaps,
		ItemsEnabled = modeDef.ItemsEnabled,
		CollisionsEnabled = modeDef.CollisionsEnabled,
		AllowedItems = nil,
		BotCount = 0,
		BotDifficulty = GameConfig.Bots.DefaultDifficulty :: any,
		Teams = modeDef.Teams,
		FriendlyFire = false,
		SpeedClass = "Standard",
		Mirror = false,
		AssistMode = false,
		KnockoutStages = modeDef.KnockoutStages or 0,
		DurationSeconds = modeDef.DurationSeconds or 0,
	}
	if rulesOverride then
		for k, v in rulesOverride do
			(rules :: any)[k] = v
		end
	end
	local self: any = setmetatable({
		Id = string.format("session_%d_%d", sessionCounter, math.floor(env.Now() * 1000) % 100000),
		RaceId = "",
		Index = index or sessionCounter,
		ModeId = modeId,
		Mode = modeModule,
		Rules = rules,
		SM = RaceStateMachine.new(env.Now),
		Players = table.clone(players),
		Racers = {},
		Extra = {},
		Order = {},
		Track = nil,
		Arena = nil,
		Venue = nil,
		VenueId = nil,
		IsArena = modeDef.Arena,
		Votes = {},
		VoteOptions = {},
		CountdownStartAt = 0,
		GoAt = 0,
		RaceStartedAt = 0,
		FirstFinishAt = nil,
		Results = nil,
		Rewards = {},
		Projectiles = ProjectileSim.new(),
		Pads = {},
		Shards = {},
		Traps = {},
		StormCrownAvailableAt = 0,
		RaceIndex = 0,
		PlayedTracks = {},
		TourPoints = {},
		Choices = {},
		KnockoutStage = 0,
		KnockoutGateDists = {},
		BattleEndsAt = 0,
		TeamScores = {},
		Shape = nil,
		Ended = false,
		SnapshotAt = 0,
		Ticks = 0,
		Events = Signal.new(),
		_env = env,
		_registry = registry,
		_modeDef = modeDef,
	}, RaceSession)
	return self
end

function RaceSession.Log(self: any, msg: string)
	self._env.Log("Info", "Race", string.format("[%s %s] %s", self.Id, self.SM.State, msg))
end

-- Roster ---------------------------------------------------------------------------------------------------------
function RaceSession.AddRacer(self: any, identity: GameTypes.RacerIdentity, loadout: GameTypes.Loadout, player: any?): RacerRuntime
	local now = self._env.Now()
	local racer: RacerRuntime = {
		Identity = identity,
		Loadout = loadout,
		Progress = CheckpointSystem.NewProgress(now, 0),
		Position = #self.Order + 1,
		Items = { Active = nil, Reserve = nil },
		Shards = 0,
		Boosts = {},
		Effects = {},
		HitImmuneUntil = 0,
		LastHitAt = -100,
		HitsTaken = 0,
		StrongHitsTaken = 0,
		RespawnLockUntil = 0,
		ItemLockUntil = 0,
		LastItemUseAt = -100,
		Cores = self._modeDef.CoreCount or 0,
		Score = 0,
		Team = identity.Team,
		Connected = true,
		State = "Idle",
		StartBoostResult = nil,
	}
	self.Racers[identity.Key] = racer
	table.insert(self.Order, identity.Key)
	self.Extra[identity.Key] = {
		Stats = VehicleStats.Compute(loadout.HeroId, loadout.VehicleId, self.Rules.SpeedClass),
		Watch = RespawnSystem.NewWatch(),
		Sim = nil,
		BotMemory = nil,
		LastPose = nil,
		LastPoseAt = now,
		LastValidatedAt = now,
		LastValidPos = nil,
		Surface = "Asphalt",
		Drifting = false,
		DriftStartedAt = 0,
		DriftTier = 0,
		LastTrickAt = -100,
		SlipstreamSince = nil,
		LastSlipstreamAt = -100,
		StartThrottleAt = nil,
		Ghost = nil,
		CleanRace = true,
		Confirmed = false,
		Loaded = false,
		SpectateTarget = nil,
		Player = player,
		AirSince = nil,
		KnockoutPassed = 0,
		TourPoints = 0,
		LapAnnounced = 0,
		OverchargePulses = 0,
		NextOverchargeAt = 0,
		ItemsUsed = 0,
		HitsLanded = 0,
		Tricks = 0,
		DriftBoosts = 0,
		MagnetUntil = 0,
		PhaseUntil = 0,
		ProgressTicks = 0,
	}
	return racer
end

function RaceSession.RacerFor(self: any, player: any): RacerRuntime?
	return self.Racers[makeKey(player.UserId)]
end

function RaceSession.ExtraFor(self: any, key: string): RacerExtra
	return self.Extra[key]
end

function RaceSession.HumanCount(self: any): number
	local n = 0
	for _, r in self.Racers do
		if not r.Identity.IsBot and r.Connected then
			n += 1
		end
	end
	return n
end

function RaceSession.ActiveCount(self: any): number
	local n = 0
	for _, r in self.Racers do
		if r.Connected and not r.Progress.Eliminated then
			n += 1
		end
	end
	return n
end

function RaceSession.RemovePlayer(self: any, player: any)
	local key = makeKey(player.UserId)
	local racer = self.Racers[key]
	local idx = table.find(self.Players, player)
	if idx then
		table.remove(self.Players, idx)
	end
	if racer then
		racer.Connected = false
		local extra = self.Extra[key]
		if extra then
			extra.Player = nil
		end
		if self.SM:Is("Racing", "FinishWindow") then
			-- Keep the record for results (DNF) but stop simulating.
			self._env.World.DestroyKart(self.Id, key)
		else
			self.Racers[key] = nil
			self.Extra[key] = nil
			local oi = table.find(self.Order, key)
			if oi then
				table.remove(self.Order, oi)
			end
		end
	end
	self.Votes[key] = nil
end

-- Messaging ---------------------------------------------------------------------------------------------------------
function RaceSession.Broadcast(self: any, name: string, ...: any)
	for _, p in self.Players do
		self._env.FireClient(name, p, ...)
	end
end

function RaceSession.SendTo(self: any, key: string, name: string, ...: any)
	local extra = self.Extra[key]
	if extra and extra.Player then
		self._env.FireClient(name, extra.Player, ...)
	end
end

function RaceSession.StateView(self: any): { [string]: any }
	local view = {
		SessionId = self.Id,
		RaceId = self.RaceId,
		ModeId = self.ModeId,
		State = self.SM.State,
		EnteredAt = self.SM.EnteredAt,
		Rules = self.Rules,
		VoteOptions = self.VoteOptions,
		Votes = self.Votes,
		VenueId = self.VenueId,
		Mirror = self.Rules.Mirror,
		CountdownStartAt = self.CountdownStartAt,
		GoAt = self.GoAt,
		RaceIndex = self.RaceIndex,
		RacesPerSession = self._modeDef.RacesPerSession,
		KnockoutStage = self.KnockoutStage,
		BattleEndsAt = self.BattleEndsAt,
		Roster = {},
		TourPoints = self.TourPoints,
	}
	for _, key in self.Order do
		local r = self.Racers[key]
		table.insert(view.Roster, { Key = key, Name = r.Identity.DisplayName, IsBot = r.Identity.IsBot, Team = r.Team, Hero = r.Loadout.HeroId, Vehicle = r.Loadout.VehicleId, Connected = r.Connected })
	end
	return view
end

function RaceSession.PushState(self: any)
	self:Broadcast("RaceState", self.SM.State, self:StateView())
end

function RaceSession.Transition(self: any, to: RaceState): boolean
	local ok = self.SM:Transition(to, self._env.Now())
	if ok then
		self:Log("-> " .. to)
		self:PushState()
		self.Events:Fire("State", to)
	end
	return ok
end

-- Vote ------------------------------------------------------------------------------------------------------------
function RaceSession.BeginVote(self: any)
	local pool: { string } = {}
	if self.IsArena then
		for _, a in TrackDefinitions.Arenas do
			if table.find(a.SupportedModes, self.ModeId) then
				table.insert(pool, a.Id)
			end
		end
	else
		for _, t in TrackDefinitions.Tracks do
			if table.find(t.SupportedModes, self.ModeId) and not table.find(self.PlayedTracks, t.Id) then
				table.insert(pool, t.Id)
			end
		end
		if #pool == 0 then
			for _, t in TrackDefinitions.Tracks do
				table.insert(pool, t.Id)
			end
		end
	end
	local shuffled = TableUtil.Shuffle(pool, self._env.Random)
	self.VoteOptions = {}
	for i = 1, math.min(GameConfig.Race.VoteTrackChoices, #shuffled) do
		table.insert(self.VoteOptions, shuffled[i])
	end
	self.Votes = {}
	self:Transition("TrackVote")
end

function RaceSession.Vote(self: any, player: any, venueId: string): boolean
	if not self.SM:Is("TrackVote") then
		return false
	end
	if table.find(self.VoteOptions, venueId) == nil then
		return false
	end
	self.Votes[makeKey(player.UserId)] = venueId
	self:PushState()
	-- Early resolve when everyone voted.
	local humans = self:HumanCount()
	local count = 0
	for _ in self.Votes do
		count += 1
	end
	if count >= humans and humans > 0 then
		self.SM.EnteredAt = self._env.Now() - GameConfig.Race.VoteSeconds
	end
	return true
end

function RaceSession.ResolveVote(self: any): string
	local tally: { [string]: number } = {}
	for _, v in self.Votes do
		tally[v] = (tally[v] or 0) + 1
	end
	local best, bestN = nil, -1
	for _, opt in self.VoteOptions do
		local n = tally[opt] or 0
		if n > bestN or (n == bestN and self._env.Random:NextNumber() < 0.5) then
			best, bestN = opt, n
		end
	end
	return best or self.VoteOptions[1]
end

-- Venue --------------------------------------------------------------------------------------------------------
function RaceSession.LoadVenue(self: any, venueId: string)
	self.VenueId = venueId
	self.Rules.TrackId = venueId
	self.RaceIndex += 1
	self.RaceId = string.format("%s_r%d_%d", self.Id, self.RaceIndex, self._env.Unix())
	table.insert(self.PlayedTracks, venueId)
	if self.IsArena then
		local def = TrackDefinitions.ArenaById[venueId]
		assert(def, "unknown arena " .. venueId)
		self.Arena = ArenaRuntime.new(def)
		self.Track = nil
		self.Shape = nil
	else
		local def = TrackDefinitions.TrackById[venueId]
		assert(def, "unknown track " .. venueId)
		local rt = TrackRuntime.new(def, self.Rules.Mirror)
		self.Track = rt
		self.Arena = nil
		local cap = TrackRuntime.GlobalSpeedCap(VehicleStats.SpeedClassScale(self.Rules.SpeedClass))
		self.Shape = { Length = rt.Length, CheckpointCount = rt.CheckpointCount, CheckpointDists = rt.CheckpointDists, MinSectorTime = rt:MinSectorTime(cap), Laps = self.Rules.Laps }
		self.KnockoutGateDists = rt:KnockoutGateDists()
	end
	self.Venue = self._env.World.BuildVenue(self.Id, venueId, self.Track or self.Arena, self.IsArena, self.Rules.Mirror)
	for _, key in self.Order do
		self.Extra[key].Loaded = self.Racers[key].Identity.IsBot
		self.Extra[key].Confirmed = self.Racers[key].Identity.IsBot
	end
	self:Transition("LoadingTrack")
end

function RaceSession.UnloadVenue(self: any)
	for _, key in self.Order do
		self._env.World.DestroyKart(self.Id, key)
	end
	if self.Venue then
		self._env.World.DestroyVenue(self.Venue)
		self.Venue = nil
	end
	for _, p in self.Projectiles.List do
		self._env.World.DestroyProjectileVisual(self.Id, p.Id)
	end
	self.Projectiles = ProjectileSim.new()
	self.Pads = {}
	self.Shards = {}
	self.Traps = {}
end

-- Spawn --------------------------------------------------------------------------------------------------------
function RaceSession.ResetRacersForRace(self: any)
	local now = self._env.Now()
	for _, key in self.Order do
		local r = self.Racers[key]
		local e = self.Extra[key]
		r.Progress = CheckpointSystem.NewProgress(now, 0)
		r.Items = { Active = nil, Reserve = nil }
		r.Shards = 0
		r.Boosts = {}
		r.Effects = {}
		r.HitImmuneUntil = 0
		r.HitsTaken = 0
		r.StrongHitsTaken = 0
		r.Cores = self._modeDef.CoreCount or 0
		r.Score = 0
		r.State = "Idle"
		r.StartBoostResult = nil
		e.Stats = VehicleStats.Compute(r.Loadout.HeroId, r.Loadout.VehicleId, self.Rules.SpeedClass)
		e.Watch = RespawnSystem.NewWatch()
		e.Drifting = false
		e.DriftTier = 0
		e.CleanRace = true
		e.StartThrottleAt = nil
		e.KnockoutPassed = 0
		e.LapAnnounced = 0
		e.ItemsUsed = 0
		e.HitsLanded = 0
		e.Tricks = 0
		e.DriftBoosts = 0
		e.ProgressTicks = 0
		e.Ghost = nil
	end
	self.FirstFinishAt = nil
	self.Results = nil
	self.Rewards = {}
	self.KnockoutStage = 0
	self.TeamScores = {}
end

function RaceSession.GridSetup(self: any)
	self:ResetRacersForRace()
	local slots: { CFrame }
	if self.IsArena then
		slots = self.Arena:SpawnSlots(#self.Order)
	else
		-- Grid order: Grand Tour by standings (leader at the back), otherwise shuffled for fairness.
		local order = table.clone(self.Order)
		if self.RaceIndex > 1 and self.ModeId == "GrandTour" then
			table.sort(order, function(a, b)
				return (self.TourPoints[a] or 0) < (self.TourPoints[b] or 0)
			end)
		else
			order = TableUtil.Shuffle(order, self._env.Random)
		end
		self.Order = order
		slots = self.Track:GridSlots(#self.Order)
	end
	for i, key in self.Order do
		local r = self.Racers[key]
		local e = self.Extra[key]
		local cf = slots[i]
		self._env.World.SpawnKart(self.Id, key, r.Loadout.HeroId, r.Loadout.VehicleId, r.Loadout.Cosmetics, cf, e.Player, r.Identity.IsBot)
		if not self.IsArena then
			local loc = self.Track:Locate(cf.Position, self.Track.Length - 30)
			r.Progress.Progress = loc.Progress
			r.Progress.LastSafeProgress = 0
		end
		e.LastValidPos = cf.Position
		self._registry:Get("BotRacerService"):Attach(self, key)
		self:SendTo(key, "KartAssigned", { Key = key, SessionId = self.Id, Stats = e.Stats, Rules = self.Rules }, { HeroId = r.Loadout.HeroId, VehicleId = r.Loadout.VehicleId })
	end
	self._registry:Get("ItemService"):SetupPickups(self)
	self.Mode:OnGrid(self)
	self:Transition("GridSetup")
end

function RaceSession.StartCountdown(self: any)
	local now = self._env.Now()
	self.CountdownStartAt = now + 1.5
	self.GoAt = self.CountdownStartAt + GameConfig.Race.CountdownSeconds
	self:Transition("Countdown")
end

function RaceSession.Go(self: any)
	local now = self._env.Now()
	self.RaceStartedAt = self.GoAt
	self.StormCrownAvailableAt = now
	for _, key in self.Order do
		local r = self.Racers[key]
		local e = self.Extra[key]
		r.Progress.LapStartedAt = self.GoAt
		r.Progress.LastCheckpointAt = self.GoAt
		r.State = "Accelerating"
		-- Start boost resolution from server-recorded throttle press time.
		if e.StartThrottleAt ~= nil then
			self:ResolveStartBoost(key, e.StartThrottleAt :: number)
		end
		if self.ModeId == "TimeTrial" and not r.Identity.IsBot then
			e.Ghost = GhostRecordingSystem.NewRecorder(self.GoAt)
		end
	end
	if self.IsArena then
		self.BattleEndsAt = self.GoAt + self.Rules.DurationSeconds
	end
	self.Mode:OnRaceStart(self, now)
	self:Transition("Racing")
end

function RaceSession.ResolveStartBoost(self: any, key: string, pressedAt: number)
	local r = self.Racers[key]
	local e = self.Extra[key]
	if r.StartBoostResult ~= nil then
		return
	end
	local result = KartPhysicsModel.EvaluateStartBoost(pressedAt - self.GoAt)
	r.StartBoostResult = result
	local params = KartPhysicsModel.StartBoostParams(result :: any)
	if params.BoostSeconds > 0 then
		table.insert(r.Boosts, KartPhysicsModel.MakeBoost("Start", params.BoostSeconds, params.SpeedBonus, e.Stats, self.GoAt))
	end
	if params.StallSeconds > 0 then
		r.Effects.Stall = { Id = "Stall", EndsAt = self.GoAt + params.StallSeconds, Params = {} }
	end
	if e.Sim then
		if params.StallSeconds > 0 then
			e.Sim.StallUntil = self.GoAt + params.StallSeconds
		end
		if params.BoostSeconds > 0 then
			table.insert(e.Sim.Boosts, KartPhysicsModel.MakeBoost("Start", params.BoostSeconds, params.SpeedBonus, e.Stats, self.GoAt))
		end
	end
	self:SendTo(key, "KartEffect", "StartBoost", { Result = result, BoostSeconds = params.BoostSeconds, SpeedBonus = params.SpeedBonus, StallSeconds = params.StallSeconds })
	self.Events:Fire("StartBoost", { Key = key, Result = result })
end

-- Remotes (intents) -----------------------------------------------------------------------------------------------
function RaceSession.OnStartThrottle(self: any, player: any)
	local key = makeKey(player.UserId)
	local e = self.Extra[key]
	if not e then
		return
	end
	local now = self._env.Now()
	if self.SM:Is("Countdown") and e.StartThrottleAt == nil then
		e.StartThrottleAt = now
	elseif self.SM:Is("Racing") and self.Racers[key].StartBoostResult == nil and now - self.GoAt < 1 then
		self:ResolveStartBoost(key, now)
	end
end

function RaceSession.OnLoaded(self: any, player: any, venueId: string)
	local key = makeKey(player.UserId)
	local e = self.Extra[key]
	if e and venueId == self.VenueId then
		e.Loaded = true
	end
end

function RaceSession.OnLoadoutConfirm(self: any, player: any)
	local key = makeKey(player.UserId)
	local e = self.Extra[key]
	if e then
		e.Confirmed = true
	end
end

function RaceSession.AllHumans(self: any, pred: (RacerExtra) -> boolean): boolean
	for _, key in self.Order do
		local r = self.Racers[key]
		if not r.Identity.IsBot and r.Connected and not pred(self.Extra[key]) then
			return false
		end
	end
	return true
end

function RaceSession.OnPostRaceChoice(self: any, player: any, choice: string)
	self.Choices[makeKey(player.UserId)] = choice
end

-- Results & rewards -------------------------------------------------------------------------------------------------
function RaceSession.BuildResults(self: any): RaceTypes.RaceResults
	local results = self.Mode:BuildResults(self)
	self.Results = results
	for _, rec in results.Records do
		local key = rec.Key
		if self.ModeId == "GrandTour" then
			self.TourPoints[key] = (self.TourPoints[key] or 0) + rec.Points
		end
	end
	return results
end

function RaceSession.ApplyRewards(self: any)
	local rewardService = self._registry:Get("RewardService")
	local profileService = self._registry:Get("ProfileService")
	local results: RaceTypes.RaceResults = self.Results
	local isFinalTour = self.ModeId == "GrandTour" and self.RaceIndex >= self._modeDef.RacesPerSession
	local tourRank: { [string]: number } = {}
	if isFinalTour then
		local keys = table.clone(self.Order)
		table.sort(keys, function(a, b)
			return (self.TourPoints[a] or 0) > (self.TourPoints[b] or 0)
		end)
		for i, k in keys do
			tourRank[k] = i
		end
	end
	for _, rec in results.Records do
		local r = self.Racers[rec.Key]
		local e = self.Extra[rec.Key]
		if r.Identity.IsBot then
			continue
		end
		local handle = profileService:GetByUserId(r.Identity.UserId)
		if not handle then
			continue
		end
		local ghost: string? = nil
		if e.Ghost and rec.Finished and rec.TimeSeconds then
			local g = GhostRecordingSystem.Finish(e.Ghost, self.VenueId, r.Loadout.VehicleId, r.Loadout.HeroId, self.Rules.Laps, rec.TimeSeconds :: number, self.Rules.AssistMode)
			ghost = GhostRecordingSystem.Serialize(g)
		end
		local ctx = {
			ModeId = self.ModeId,
			TrackId = self.VenueId,
			Laps = self.Rules.Laps,
			Record = rec,
			Total = #results.Records,
			TourPosition = tourRank[rec.Key],
			TourFinal = isFinalTour,
			KnockoutStages = self.Rules.KnockoutStages,
			IsBattle = self.IsArena,
			BattleWon = results.WinnerKey == rec.Key or (self.Rules.Teams > 0 and results.TeamScores ~= nil and self:TeamWon(rec.Team)),
			Assist = self.Rules.AssistMode,
			VehicleId = r.Loadout.VehicleId,
			HeroId = r.Loadout.HeroId,
			Ghost = ghost,
		}
		local breakdown = rewardService:Apply(handle.Data, self.RaceId, r.Identity.UserId, ctx, e.CleanRace)
		if breakdown then
			local stats = handle.Data.Statistics
			stats.ItemsUsed = (stats.ItemsUsed or 0) + e.ItemsUsed
			stats.HitsLanded = (stats.HitsLanded or 0) + e.HitsLanded
			stats.HitsTaken = (stats.HitsTaken or 0) + r.HitsTaken
			stats.Tricks = (stats.Tricks or 0) + e.Tricks
			stats.DriftBoosts = (stats.DriftBoosts or 0) + e.DriftBoosts
			if e.Tricks >= 3 then
				handle.Data.Achievements.FirstTrickTriple = (handle.Data.Achievements.FirstTrickTriple or 0) + 1
				for _, u in rewardService.EvaluateUnlocks(handle.Data) do
					table.insert(breakdown.Unlocks, u)
				end
			end
			self.Rewards[rec.Key] = breakdown
			if e.Player then
				profileService:MarkDirtyAndSave(e.Player)
			end
		end
	end
	self:Broadcast("Results", results, self.Rewards)
end

function RaceSession.TeamWon(self: any, team: number): boolean
	local results: RaceTypes.RaceResults = self.Results
	if not results or not results.TeamScores then
		return false
	end
	local best, bestTeam = -1, 0
	for t, s in results.TeamScores do
		if s > best then
			best, bestTeam = s, t
		end
	end
	return bestTeam == team
end

-- Snapshot -----------------------------------------------------------------------------------------------------------
function RaceSession.Snapshot(self: any): { [string]: any }
	local racers = {}
	for _, key in self.Order do
		local r = self.Racers[key]
		local p = r.Progress
		table.insert(racers, {
			K = key,
			Pos = r.Position,
			Lap = p.Lap,
			Cp = p.Checkpoint,
			Pr = if self.Track then p.Progress / self.Track.Length else 0,
			Fin = p.FinishedAt ~= nil,
			Elim = p.Eliminated,
			Sh = r.Shards,
			Cores = r.Cores,
			Sc = r.Score,
			St = r.State,
			Conn = r.Connected,
		})
	end
	return {
		T = self._env.Now(),
		State = self.SM.State,
		Racers = racers,
		Projectiles = self.Projectiles:Snapshot(),
		KnockoutStage = self.KnockoutStage,
		BattleEndsAt = self.BattleEndsAt,
		TeamScores = self.TeamScores,
		FirstFinishAt = self.FirstFinishAt,
	}
end

function RaceSession.PersonalView(self: any, key: string): { [string]: any }
	local r = self.Racers[key]
	local e = self.Extra[key]
	local effects = {}
	for id, ef in r.Effects do
		if ef then
			effects[id] = ef.EndsAt
		end
	end
	return {
		Items = r.Items,
		Shards = r.Shards,
		Boosts = r.Boosts,
		Effects = effects,
		DriftTier = e.DriftTier,
		Surface = e.Surface,
		Position = r.Position,
		Lap = r.Progress.Lap,
		WrongWay = r.Progress.Direction < 0 and r.Progress.WrongWaySince ~= nil and (self._env.Now() - (r.Progress.WrongWaySince :: number)) >= GameConfig.Race.WrongWaySeconds,
		Cores = r.Cores,
		Score = r.Score,
	}
end

return RaceSession
