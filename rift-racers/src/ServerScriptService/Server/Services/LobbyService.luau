--!strict
-- Lobby: queue intents, private rooms (validated rules), solo modes, teleport flow, lobby state broadcast.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local ItemDefinitions = require(Shared.Config.ItemDefinitions)

export type Room = { Id: string, OwnerId: number, Members: { number }, Rules: { [string]: any }, CreatedAt: number }

local LobbyService = { Name = "LobbyService" }
LobbyService.__index = LobbyService

function LobbyService.new()
	return setmetatable({
		_env = nil :: any,
		_registry = nil :: any,
		_race = nil :: any,
		_mm = nil :: any,
		_party = nil :: any,
		_profile = nil :: any,
		_security = nil :: any,
		_telemetry = nil :: any,
		_rooms = {} :: { [string]: Room },
		_roomByUser = {} :: { [number]: string },
		_nextRoom = 0,
	}, LobbyService)
end

function LobbyService.Init(self: any, registry: any)
	self._registry = registry
	self._env = registry:Get("Env")
	self._race = registry:Get("RaceService")
	self._mm = registry:Get("MatchmakingService")
	self._party = registry:Get("PartyService")
	self._profile = registry:Get("ProfileService")
	self._security = registry:Get("SecurityService")
	self._telemetry = registry:Get("TelemetryService")
	local d = self._env.Dispatcher
	d:On("ClientReady", function(player)
		self:PushLobbyState(player)
	end)
	d:On("QueueAction", function(player, action: string, modeId: string?)
		if action == "Join" and modeId then
			if self._race:SessionOf(player) then
				return
			end
			local ok, reason = self._mm:Join(player.UserId, modeId)
			if not ok then
				self._env.FireClient("ErrorDialog", player, "ERROR.QUEUE_FAILED", { Reason = reason })
			end
		else
			self._mm:Leave(player.UserId)
			self._env.FireClient("QueueState", player, { InQueue = false })
		end
	end)
	d:On("StartMode", function(player, modeId: string, venueId: string?)
		self:StartSolo(player, modeId, venueId)
	end)
	d:On("CustomRoomAction", function(player, action: string, rules: { [string]: any }?, targetId: number?)
		self:RoomAction(player, action, rules or {}, targetId)
	end)
end

function LobbyService.Start(self: any)
	self._mm.MatchFormed:Connect(function(match)
		self:OnMatchFormed(match)
	end)
	self._env.Players.PlayerAdded:Connect(function(player)
		self:OnPlayerJoined(player)
	end)
	self._env.Players.PlayerRemoving:Connect(function(player)
		self:LeaveRoom(player.UserId)
	end)
	self._race.SessionEnded:Connect(function(session)
		for _, key in session.Order do
			local e = session.Extra[key]
			if e.Player then
				self:PushLobbyState(e.Player)
			end
		end
	end)
end

function LobbyService.PushLobbyState(self: any, player: any)
	self._env.FireClient("LobbyState", player, {
		Online = #self._env.Players.GetPlayers(),
		Modes = ModeDefinitions.List,
		PracticeTrack = TrackDefinitions.PracticeTrackId,
		LocalMode = self._env.Teleport.LocalMode,
		ProjectName = GameConfig.ProjectName,
		Room = self:RoomView(player.UserId),
	})
end

-- On a race server, players arrive with teleport data; verify before honouring it.
function LobbyService.OnPlayerJoined(self: any, player: any)
	local data = self._env.Teleport:ReadTeleportData(player)
	if data and type(data) == "table" and data.ModeId and type(data.Token) == "string" then
		local ok = self:VerifyTeleportToken(data)
		if not ok then
			self._security:Flag(player, "PermissionDenied", "bad teleport token", 4)
			return
		end
		self._pendingArrivals = self._pendingArrivals or {}
		local pending = self._pendingArrivals[data.Token]
		if not pending then
			pending = { ModeId = data.ModeId, Expected = data.UserIds or {}, Arrived = {}, BotCount = data.BotCount or 0, CreatedAt = self._env.Now() }
			self._pendingArrivals[data.Token] = pending
		end
		table.insert(pending.Arrived, player)
		if #pending.Arrived >= #pending.Expected or self._env.Now() - pending.CreatedAt > 20 then
			self._pendingArrivals[data.Token] = nil
			self._race:StartSession(pending.ModeId, pending.Arrived, nil, { BotCount = pending.BotCount })
		end
	end
end

function LobbyService.VerifyTeleportToken(self: any, data: any): boolean
	-- Tokens are minted by the lobby server and stored in the shared MemoryQueue under "tp:<token>".
	local ok, entries = pcall(function()
		return self._env.MemoryQueue:Read(128)
	end)
	if not ok then
		return false
	end
	for _, e in entries do
		if e.Key == "tp:" .. data.Token then
			return true
		end
	end
	return false
end

function LobbyService.OnMatchFormed(self: any, match: any)
	local players = {}
	for _, uid in match.UserIds do
		local pl = self._env.Players.GetPlayerByUserId(uid)
		if pl then
			table.insert(players, pl)
		end
	end
	if #players == 0 then
		return
	end
	if self._env.Teleport.LocalMode then
		self._race:StartSession(match.ModeId, players, nil, { BotCount = match.BotCount })
		return
	end
	local token = string.format("%s_%d_%d", self._env.SessionId, self._env.Unix(), self._env.Random:NextInteger(1, 1e9))
	pcall(function()
		self._env.MemoryQueue:Add("tp:" .. token, { ModeId = match.ModeId, UserIds = match.UserIds }, 120)
	end)
	local ok, err = self._env.Teleport:ReserveAndTeleport(players, { ModeId = match.ModeId, UserIds = match.UserIds, BotCount = match.BotCount, Token = token })
	if not ok then
		self._telemetry:Log("Warn", "Lobby", "teleport failed: " .. tostring(err))
		for _, pl in players do
			self._env.FireClient("ErrorDialog", pl, "ERROR.TELEPORT_FAILED", {})
			self._mm:Join(pl.UserId, match.ModeId)
		end
	end
end

-- Time Trial / Practice start immediately in this place.
function LobbyService.StartSolo(self: any, player: any, modeId: string, venueId: string?)
	local def = ModeDefinitions.ById[modeId]
	if not def or def.Public then
		return
	end
	if self._race:SessionOf(player) then
		return
	end
	if modeId == "CustomRace" then
		return -- rooms start through CustomRoomAction
	end
	self._mm:Leave(player.UserId)
	local venue = venueId
	if modeId == "Practice" then
		venue = TrackDefinitions.PracticeTrackId
	end
	if venue and not TrackDefinitions.TrackById[venue] then
		venue = nil
	end
	local rules = if modeId == "Practice" then { Laps = 99 } else nil
	self._race:StartSession(modeId, { player }, rules, { Venue = venue })
end

-- Private rooms ----------------------------------------------------------------------------------------------------
function LobbyService.SanitizeRules(input: { [string]: any }): ({ [string]: any }, boolean)
	local limits = ModeDefinitions.CustomRaceLimits
	local out: { [string]: any } = {}
	local changed = false
	if input.TrackId ~= nil then
		if TrackDefinitions.TrackById[input.TrackId] then
			out.TrackId = input.TrackId
		else
			changed = true
		end
	end
	if input.Laps ~= nil then
		local laps = math.floor(tonumber(input.Laps) or 3)
		if laps < limits.MinLaps or laps > limits.MaxLaps then
			changed = true
		end
		out.Laps = math.clamp(laps, limits.MinLaps, limits.MaxLaps)
	end
	if input.BotCount ~= nil then
		local n = math.floor(tonumber(input.BotCount) or 0)
		if n < 0 or n > limits.MaxBots then
			changed = true
		end
		out.BotCount = math.clamp(n, 0, limits.MaxBots)
	end
	if input.BotDifficulty ~= nil then
		if table.find({ "Easy", "Normal", "Hard" }, input.BotDifficulty) then
			out.BotDifficulty = input.BotDifficulty
		else
			changed = true
		end
	end
	if input.AllowedItems ~= nil and type(input.AllowedItems) == "table" then
		local list = {}
		for _, id in ipairs(input.AllowedItems) do
			if ItemDefinitions.ById[id] then
				table.insert(list, id)
			else
				changed = true
			end
		end
		out.AllowedItems = list
	end
	if input.Teams ~= nil then
		local t = math.floor(tonumber(input.Teams) or 0)
		if t < 0 or t > 4 or t == 1 then
			changed = true
		end
		out.Teams = if t >= 2 and t <= 4 then t else 0
	end
	if input.SpeedClass ~= nil then
		if table.find(limits.SpeedClasses, input.SpeedClass) then
			out.SpeedClass = input.SpeedClass
		else
			changed = true
		end
	end
	for _, b in { "Mirror", "CollisionsEnabled", "AssistMode", "ItemsEnabled" } do
		if input[b] ~= nil then
			if type(input[b]) == "boolean" then
				out[b] = input[b]
			else
				changed = true
			end
		end
	end
	if out.Mirror and out.TrackId and not TrackDefinitions.TrackById[out.TrackId].MirrorSupport then
		out.Mirror = false
		changed = true
	end
	return out, changed
end

function LobbyService.RoomView(self: any, userId: number): any?
	local id = self._roomByUser[userId]
	local room = if id then self._rooms[id] else nil
	if not room then
		return nil
	end
	local members = {}
	for _, uid in room.Members do
		local pl = self._env.Players.GetPlayerByUserId(uid)
		table.insert(members, { UserId = uid, Name = if pl then pl.DisplayName else tostring(uid) })
	end
	return { Id = room.Id, OwnerId = room.OwnerId, Members = members, Rules = room.Rules }
end

function LobbyService.BroadcastRoom(self: any, room: Room)
	for _, uid in room.Members do
		local pl = self._env.Players.GetPlayerByUserId(uid)
		if pl then
			self:PushLobbyState(pl)
		end
	end
end

function LobbyService.LeaveRoom(self: any, userId: number)
	local id = self._roomByUser[userId]
	local room = if id then self._rooms[id] else nil
	if not room then
		return
	end
	local idx = table.find(room.Members, userId)
	if idx then
		table.remove(room.Members, idx)
	end
	self._roomByUser[userId] = nil
	if #room.Members == 0 then
		self._rooms[room.Id] = nil
		return
	end
	if room.OwnerId == userId then
		room.OwnerId = room.Members[1]
	end
	self:BroadcastRoom(room)
end

function LobbyService.RoomAction(self: any, player: any, action: string, rules: { [string]: any }, targetId: number?)
	local uid = player.UserId
	if action == "Create" then
		if self._roomByUser[uid] then
			self:LeaveRoom(uid)
		end
		self._mm:Leave(uid)
		self._nextRoom += 1
		local clean, changed = LobbyService.SanitizeRules(rules)
		local room: Room = { Id = "room_" .. self._nextRoom, OwnerId = uid, Members = { uid }, Rules = clean, CreatedAt = self._env.Now() }
		-- Party members join automatically.
		for _, m in self._party:Members(uid) do
			if m ~= uid then
				table.insert(room.Members, m)
				self._roomByUser[m] = room.Id
			end
		end
		self._rooms[room.Id] = room
		self._roomByUser[uid] = room.Id
		if changed then
			self._env.FireClient("ErrorDialog", player, "ERROR.INVALID_SETTINGS", {})
		end
		self:BroadcastRoom(room)
	elseif action == "Update" then
		local room = self._rooms[self._roomByUser[uid] or ""]
		if not room or room.OwnerId ~= uid then
			self._security:Flag(player, "PermissionDenied", "room update by non-owner")
			return
		end
		local clean, changed = LobbyService.SanitizeRules(rules)
		for k, v in clean do
			room.Rules[k] = v
		end
		if changed then
			self._env.FireClient("ErrorDialog", player, "ERROR.INVALID_SETTINGS", {})
		end
		self:BroadcastRoom(room)
	elseif action == "Join" and targetId then
		local ownerRoomId = self._roomByUser[targetId]
		local room = if ownerRoomId then self._rooms[ownerRoomId] else nil
		if not room or #room.Members >= GameConfig.MaxRacers then
			return
		end
		self:LeaveRoom(uid)
		table.insert(room.Members, uid)
		self._roomByUser[uid] = room.Id
		self:BroadcastRoom(room)
	elseif action == "Leave" or action == "Close" then
		local room = self._rooms[self._roomByUser[uid] or ""]
		if action == "Close" and room and room.OwnerId == uid then
			for _, m in table.clone(room.Members) do
				self:LeaveRoom(m)
			end
			self._rooms[room.Id] = nil
		else
			self:LeaveRoom(uid)
		end
		self:PushLobbyState(player)
	elseif action == "Start" then
		local room = self._rooms[self._roomByUser[uid] or ""]
		if not room or room.OwnerId ~= uid then
			self._security:Flag(player, "PermissionDenied", "room start by non-owner")
			return
		end
		local players = {}
		for _, m in room.Members do
			local pl = self._env.Players.GetPlayerByUserId(m)
			if pl and not self._race:SessionOf(pl) then
				table.insert(players, pl)
			end
		end
		if #players == 0 then
			return
		end
		local r = room.Rules
		local override: { [string]: any } = {
			Laps = r.Laps or 3,
			BotCount = r.BotCount or 0,
			BotDifficulty = r.BotDifficulty or "Normal",
			AllowedItems = r.AllowedItems,
			Teams = r.Teams or 0,
			SpeedClass = r.SpeedClass or "Standard",
			Mirror = r.Mirror or false,
			CollisionsEnabled = if r.CollisionsEnabled == nil then true else r.CollisionsEnabled,
			AssistMode = r.AssistMode or false,
			ItemsEnabled = if r.ItemsEnabled == nil then true else r.ItemsEnabled,
		}
		local venue = r.TrackId or TrackDefinitions.Tracks[self._env.Random:NextInteger(1, #TrackDefinitions.Tracks)].Id
		override.TrackId = venue
		self._race:StartSession("CustomRace", players, override, { Venue = venue, BotCount = override.BotCount, BotDifficulty = override.BotDifficulty })
		for _, m in table.clone(room.Members) do
			self:LeaveRoom(m)
		end
		self._rooms[room.Id] = nil
	end
end

return LobbyService
