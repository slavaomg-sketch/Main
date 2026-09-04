--!strict
-- Manages race sessions: creation, per-tick state machine driving, remote routing, results/rewards, next race.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local GameTypes = require(Shared.Types.GameTypes)
local Signal = require(Shared.Utility.Signal)
local RaceSession = require(script.Parent.Parent.Systems.RaceSession)
local Knockout = require(script.Parent.Parent.Modes.Knockout)

local RaceService = { Name = "RaceService" }
RaceService.__index = RaceService

local TICK_HZ = 20
local SNAPSHOT_HZ = 10

function RaceService.new()
	return setmetatable({
		_env = nil :: any,
		_registry = nil :: any,
		_sessions = {} :: { [string]: any },
		_byPlayer = {} :: { [number]: string },
		_accum = 0,
		_heartbeat = nil :: any,
		SessionEnded = Signal.new() :: Signal.Signal<any, string>,
		SessionStarted = Signal.new() :: Signal.Signal<any>,
	}, RaceService)
end

function RaceService.Init(self: any, registry: any)
	self._registry = registry
	self._env = registry:Get("Env")
	local d = self._env.Dispatcher
	d:SetStateProvider(function(player)
		local s = self:SessionOf(player)
		return if s then s.SM.State else "Lobby"
	end)
	d:On("VoteTrack", function(player, venueId: string)
		local s = self:SessionOf(player)
		if s then
			s:Vote(player, venueId)
		end
	end)
	d:On("LoadoutConfirm", function(player)
		local s = self:SessionOf(player)
		if s then
			s:OnLoadoutConfirm(player)
		end
	end)
	d:On("TrackLoaded", function(player, venueId: string)
		local s = self:SessionOf(player)
		if s then
			s:OnLoaded(player, venueId)
		end
	end)
	d:On("StartThrottle", function(player)
		local s = self:SessionOf(player)
		if s then
			s:OnStartThrottle(player)
		end
	end)
	d:On("DriftEvent", function(player, action: string, tier: number)
		local s = self:SessionOf(player)
		if s then
			registry:Get("RaceProgressService"):OnDriftEvent(s, player, action, tier)
		end
	end)
	d:On("TrickEvent", function(player, jumpId: string)
		local s = self:SessionOf(player)
		if s then
			registry:Get("RaceProgressService"):OnTrickEvent(s, player, jumpId)
		end
	end)
	d:On("UseItem", function(player, slot: string, aim: Vector3?)
		local s = self:SessionOf(player)
		if s then
			registry:Get("ItemService"):OnUseItem(s, player, slot, aim)
		end
	end)
	d:On("RequestRespawn", function(player)
		local s = self:SessionOf(player)
		if s then
			local key = RaceSession.KeyFor(player.UserId)
			if s.Racers[key] and s.Racers[key].RespawnLockUntil < self._env.Now() then
				registry:Get("RaceProgressService"):Respawn(s, key, "Requested")
			end
		end
	end)
	d:On("PostRaceChoice", function(player, choice: string)
		local s = self:SessionOf(player)
		if s then
			s:OnPostRaceChoice(player, choice)
		end
	end)
	d:On("SpectateAction", function(player, dir: string)
		local s = self:SessionOf(player)
		if s then
			self:CycleSpectate(s, player, dir)
		end
	end)
end

function RaceService.Start(self: any)
	self._heartbeat = self._env.Heartbeat:Connect(function(dt: number)
		self:Step(dt)
	end)
	self._env.Players.PlayerRemoving:Connect(function(player)
		self:OnPlayerRemoving(player)
	end)
end

function RaceService.Destroy(self: any)
	if self._heartbeat then
		self._heartbeat:Disconnect()
	end
	for _, s in self._sessions do
		self:EndSession(s, "Shutdown")
	end
end

function RaceService.SessionOf(self: any, player: any): any?
	local id = self._byPlayer[player.UserId]
	return if id then self._sessions[id] else nil
end

function RaceService.Sessions(self: any): { any }
	local out = {}
	for _, s in self._sessions do
		table.insert(out, s)
	end
	return out
end

-- Creates a session for players (already validated as available) with mode and rule overrides.
function RaceService.StartSession(self: any, modeId: string, players: { any }, rulesOverride: { [string]: any }?, options: { Venue: string?, BotCount: number?, BotDifficulty: string?, ForceStart: boolean? }?): any
	local opts: { Venue: string?, BotCount: number?, BotDifficulty: string?, ForceStart: boolean? } = options or {}
	local profileService = self._registry:Get("ProfileService")
	local session = RaceSession.new(self._env, self._registry, modeId, players, rulesOverride, nil)
	for _, player: any in players do
		if self._byPlayer[player.UserId] then
			local old = self._sessions[self._byPlayer[player.UserId]]
			if old then
				old:RemovePlayer(player)
			end
		end
		self._byPlayer[player.UserId] = session.Id
		local handle = profileService:GetByUserId(player.UserId)
		local loadout: GameTypes.Loadout = if handle then { HeroId = handle.Data.SelectedHero, VehicleId = handle.Data.SelectedVehicle, Cosmetics = handle.Data.SelectedCosmetics } else { HeroId = "NovaVale", VehicleId = "CometMk1", Cosmetics = {} }
		if handle and handle.Data.Settings.TrackAssist and session.Rules.AssistMode == false and modeId ~= "TimeTrial" then
			-- Assist is per-player; the rule only matters for Time Trial record flags.
		end
		local identity: GameTypes.RacerIdentity = { Key = RaceSession.KeyFor(player.UserId), UserId = player.UserId, DisplayName = player.DisplayName, IsBot = false, BotDifficulty = nil, Team = 0 }
		session:AddRacer(identity, loadout, player)
	end
	local modeDef = ModeDefinitions.ById[modeId]
	local botCount = opts.BotCount or session.Rules.BotCount
	if modeDef.BotsAllowed and botCount > 0 then
		botCount = math.min(botCount, GameConfig.MaxRacers - #players)
		session.Rules.BotCount = botCount
		self._registry:Get("BotRacerService"):Fill(session, botCount, (opts.BotDifficulty or session.Rules.BotDifficulty) :: any)
	end
	self._sessions[session.Id] = session
	session:Transition("LoadingProfiles")
	if opts.Venue then
		session.VoteOptions = { opts.Venue }
		session.Votes = {}
		session:LoadVenue(opts.Venue)
	elseif modeDef.Vote then
		session:BeginVote()
	else
		local pool = if modeDef.Arena then TrackDefinitions.Arenas else TrackDefinitions.Tracks
		local pick = pool[self._env.Random:NextInteger(1, #pool)]
		session:LoadVenue(pick.Id)
	end
	self.SessionStarted:Fire(session)
	return session
end

function RaceService.EndSession(self: any, session: any, reason: string)
	if session.Ended then
		return
	end
	session.Ended = true
	session:Log("ended: " .. reason)
	session:UnloadVenue()
	for _, key in session.Order do
		local e = session.Extra[key]
		if e.Player then
			self._byPlayer[e.Player.UserId] = nil
			self._env.World.SetSpectatorTarget(e.Player, session.Id, nil)
		end
	end
	self._sessions[session.Id] = nil
	if session.SM.State ~= "Returning" then
		session.SM.State = "Returning"
	end
	session:PushState()
	self.SessionEnded:Fire(session, reason)
	session.Events:Destroy()
end

function RaceService.OnPlayerRemoving(self: any, player: any)
	local s = self:SessionOf(player)
	if s then
		s:RemovePlayer(player)
		self._byPlayer[player.UserId] = nil
		if s:HumanCount() == 0 then
			self:EndSession(s, "NoHumans")
		end
	end
end

function RaceService.CycleSpectate(self: any, session: any, player: any, dir: string)
	local key = RaceSession.KeyFor(player.UserId)
	local e = session.Extra[key]
	if not e then
		return
	end
	local candidates = {}
	for _, k in session.Order do
		local r = session.Racers[k]
		if k ~= key and r.Connected and not r.Progress.Eliminated then
			table.insert(candidates, k)
		end
	end
	if #candidates == 0 then
		return
	end
	local idx = table.find(candidates, e.SpectateTarget) or 0
	idx = if dir == "Prev" then idx - 1 else idx + 1
	idx = ((idx - 1) % #candidates) + 1
	e.SpectateTarget = candidates[idx]
	self._env.World.SetSpectatorTarget(player, session.Id, e.SpectateTarget)
	self._env.FireClient("RaceEvent", player, "Spectate", { Key = e.SpectateTarget })
end

-- Fixed-rate tick for every session.
function RaceService.Step(self: any, dt: number)
	self._accum += dt
	local step = 1 / TICK_HZ
	if self._accum < step then
		return
	end
	local tickDt = self._accum
	self._accum = 0
	local now = self._env.Now()
	for _, session in self:Sessions() do
		local ok, err = pcall(function()
			self:TickSession(session, now, tickDt)
		end)
		if not ok then
			self._env.Log("Error", "Race", string.format("[%s] tick error: %s", session.Id, tostring(err)))
		end
	end
end

function RaceService.TickSession(self: any, session: any, now: number, dt: number)
	if session.Ended then
		return
	end
	session.Ticks += 1
	local sm = session.SM
	local elapsed = sm:Elapsed(now)
	local state = sm.State
	local R = GameConfig.Race
	if state == "LoadingProfiles" then
		-- Handled synchronously in StartSession.
	elseif state == "TrackVote" then
		if elapsed >= R.VoteSeconds then
			session:LoadVenue(session:ResolveVote())
		end
	elseif state == "LoadingTrack" then
		if session.Venue then
			self._env.World.UpdateVenue(session.Venue, now)
		end
		if session:AllHumans(function(e)
			return e.Loaded
		end) or elapsed >= R.LoadingTimeoutSeconds then
			session:Transition("LoadoutLock")
		end
	elseif state == "LoadoutLock" then
		if session:AllHumans(function(e)
			return e.Confirmed
		end) or elapsed >= R.LoadoutLockSeconds then
			session:GridSetup()
		end
	elseif state == "GridSetup" then
		self:TickRacers(session, now, dt, false)
		if elapsed >= 1.0 then
			session:StartCountdown()
		end
	elseif state == "Countdown" then
		self:TickRacers(session, now, dt, false)
		if now >= session.GoAt then
			session:Go()
		end
	elseif state == "Racing" or state == "FinishWindow" then
		self:TickRacers(session, now, dt, true)
		self:TickGates(session, now)
		session.Mode:OnTick(session, now, dt)
		self._registry:Get("ItemService"):TickPickups(session, now)
		self._registry:Get("ItemService"):TickEffects(session, now, dt)
		if state == "Racing" and session.FirstFinishAt ~= nil and not session.IsArena then
			session:Transition("FinishWindow")
		elseif state == "FinishWindow" and now - (session.FirstFinishAt :: number) >= R.FinishWindowSeconds then
			self:FinishRace(session, now)
		end
		if session.Mode:IsOver(session, now) then
			self:FinishRace(session, now)
		elseif session:HumanCount() == 0 and session.ModeId ~= "Practice" then
			self:EndSession(session, "NoHumans")
		end
	elseif state == "Results" then
		if elapsed >= 0.5 then
			session:Transition("Rewards")
			session:ApplyRewards()
		end
	elseif state == "Rewards" then
		local next_ = session.Mode:NextAction(session)
		local choices = 0
		local wantsLobby = 0
		for _, key in session.Order do
			local c = session.Choices[key]
			if c then
				choices += 1
				if c == "Lobby" then
					wantsLobby += 1
				end
			end
		end
		local humans = session:HumanCount()
		if elapsed >= R.ResultsSeconds or (humans > 0 and choices >= humans) then
			-- Players who chose Lobby leave the session; the rest continue when the mode allows.
			for _, key in table.clone(session.Order) do
				local e = session.Extra[key]
				if e.Player and session.Choices[key] == "Lobby" then
					self:LeaveSession(session, e.Player)
				end
			end
			session.Choices = {}
			if next_ == "NextRace" and session:HumanCount() > 0 then
				session:UnloadVenue()
				if session.Rules.TrackId ~= "" and session.ModeId == "CustomRace" then
					session:Transition("LoadingTrack")
					session:LoadVenue(session.Rules.TrackId)
				else
					session:BeginVote()
				end
			else
				self:EndSession(session, "Complete")
			end
		end
		local _ = wantsLobby
	elseif state == "Returning" then
		self:EndSession(session, "Returning")
	end
	-- Snapshots to clients.
	if now - session.SnapshotAt >= 1 / SNAPSHOT_HZ and session.SM:Is("GridSetup", "Countdown", "Racing", "FinishWindow") then
		session.SnapshotAt = now
		local snap = session:Snapshot()
		if session.ModeId == "Knockout" then
			snap.SafePosition = Knockout.SafePosition(session)
		end
		for _, key in session.Order do
			local e = session.Extra[key]
			if e.Player then
				snap.Me = session:PersonalView(key)
				self._env.FireClient("RaceSnapshot", e.Player, snap)
			end
		end
	end
end

function RaceService.TickRacers(self: any, session: any, now: number, dt: number, racing: boolean)
	local progress = self._registry:Get("RaceProgressService")
	local validation = self._registry:Get("KartValidationService")
	local bots = self._registry:Get("BotRacerService")
	for _, key in session.Order do
		local r = session.Racers[key]
		if r.Identity.IsBot then
			bots:TickBot(session, key, now, dt)
		end
		local wasAir = session.Extra[key].AirSince ~= nil
		progress:TickRacer(session, key, now, dt)
		if wasAir and session.Extra[key].AirSince == nil then
			progress:OnLanded(session, key, now)
		end
		if racing and not r.Identity.IsBot then
			validation:Validate(session, key, now)
		end
	end
	if session.Shape or session.IsArena then
		progress:Rank(session)
	end
end

-- Timed gates on shortcuts (e.g. Magma Vent) and collapsing bridges.
function RaceService.TickGates(self: any, session: any, now: number)
	if session.IsArena then
		return
	end
	for _, sc in session.Track.Shortcuts do
		local gate = sc.Def.Gate
		if gate then
			local cycle = gate.OpenSeconds + gate.ClosedSeconds
			local open = (now % cycle) < gate.OpenSeconds
			if open ~= sc.GateOpen then
				session.Track:SetGate(sc.Def.Id, open)
				self._env.World.SetGate(session.Venue, sc.Def.Id, open)
				session:Broadcast("VisualEvent", "Gate", { Id = sc.Def.Id, Open = open })
			end
		end
	end
	self._env.World.UpdateVenue(session.Venue, now)
end

function RaceService.FinishRace(self: any, session: any, now: number)
	if not session.SM:Is("Racing", "FinishWindow") then
		return
	end
	-- Anyone still racing is DNF (or, in battle, simply scored).
	session:BuildResults()
	session:Transition("Results")
	session:Broadcast("Results", session.Results, {})
end

function RaceService.LeaveSession(self: any, session: any, player: any)
	session:RemovePlayer(player)
	self._byPlayer[player.UserId] = nil
	self._env.World.SetSpectatorTarget(player, session.Id, nil)
	self._env.FireClient("RaceState", player, "Returning", { SessionId = session.Id })
	if session:HumanCount() == 0 then
		self:EndSession(session, "NoHumans")
	end
end

return RaceService
