--!strict
-- Queue tickets (one per party, indivisible) with TTL; idempotent by ticket id; local in-memory queue for the
-- single-place vertical slice and a MemoryStore-backed queue for cross-server matching. Bot fill after a wait.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local Signal = require(Shared.Utility.Signal)

export type Ticket = {
	Id: string,
	ModeId: string,
	UserIds: { number },
	CreatedAt: number,
	ExpiresAt: number,
	ServerId: string,
}
export type Match = { ModeId: string, Tickets: { Ticket }, UserIds: { number }, BotCount: number }

local MatchmakingService = { Name = "MatchmakingService" }
MatchmakingService.__index = MatchmakingService

function MatchmakingService.new()
	return setmetatable({
		_env = nil :: any,
		_party = nil :: any,
		_telemetry = nil :: any,
		_tickets = {} :: { [string]: Ticket },
		_byUser = {} :: { [number]: string },
		_pollThread = nil :: thread?,
		_running = false,
		MatchFormed = Signal.new() :: Signal.Signal<Match>,
		QueueChanged = Signal.new() :: Signal.Signal<>,
	}, MatchmakingService)
end

function MatchmakingService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._party = registry:Get("PartyService")
	self._telemetry = registry:Get("TelemetryService")
end

function MatchmakingService.Start(self: any)
	self._running = true
	self._env.Players.PlayerRemoving:Connect(function(player)
		self:Leave(player.UserId)
	end)
	self._pollThread = task.spawn(function()
		while self._running do
			task.wait(GameConfig.Matchmaking.QueuePollSeconds)
			local ok, err = pcall(function()
				self:Poll()
			end)
			if not ok then
				self._telemetry:Log("Warn", "Matchmaking", tostring(err))
			end
		end
	end)
end

function MatchmakingService.Destroy(self: any)
	self._running = false
	if self._pollThread then
		pcall(task.cancel, self._pollThread)
	end
end

function MatchmakingService.TicketOf(self: any, userId: number): Ticket?
	local id = self._byUser[userId]
	return if id then self._tickets[id] else nil
end

-- Join: the whole party enters as one ticket. Idempotent for a user already queued in the same mode.
function MatchmakingService.Join(self: any, userId: number, modeId: string): (boolean, string?)
	local modeDef = ModeDefinitions.ById[modeId]
	if not modeDef or not modeDef.Public then
		return false, "ModeNotPublic"
	end
	local party = self._party:GetParty(userId)
	local leaderId = if party then party.LeaderId else userId
	if leaderId ~= userId then
		return false, "NotPartyLeader"
	end
	local members = self._party:Members(userId)
	if #members > modeDef.MaxPlayers then
		return false, "PartyTooLarge"
	end
	local existing = self:TicketOf(userId)
	if existing then
		if existing.ModeId == modeId then
			return true, nil
		end
		self:Leave(userId)
	end
	local now = self._env.Now()
	local ticket: Ticket = {
		Id = string.format("t_%s_%d_%d", self._env.SessionId, userId, math.floor(now * 1000)),
		ModeId = modeId,
		UserIds = members,
		CreatedAt = now,
		ExpiresAt = now + GameConfig.Matchmaking.TicketTTLSeconds,
		ServerId = self._env.SessionId,
	}
	self._tickets[ticket.Id] = ticket
	for _, uid in members do
		self._byUser[uid] = ticket.Id
	end
	if not self._env.Teleport.LocalMode then
		self._env.MemoryQueue:Add(ticket.Id, ticket, GameConfig.Matchmaking.TicketTTLSeconds)
	end
	self._telemetry:Count("mm.join")
	self:Broadcast()
	return true, nil
end

function MatchmakingService.Leave(self: any, userId: number)
	local ticket = self:TicketOf(userId)
	if not ticket then
		return
	end
	self:RemoveTicket(ticket)
	self:Broadcast()
end

function MatchmakingService.RemoveTicket(self: any, ticket: Ticket)
	self._tickets[ticket.Id] = nil
	for _, uid in ticket.UserIds do
		if self._byUser[uid] == ticket.Id then
			self._byUser[uid] = nil
		end
	end
	if not self._env.Teleport.LocalMode then
		pcall(function()
			self._env.MemoryQueue:Remove(ticket.Id)
		end)
	end
end

function MatchmakingService.Broadcast(self: any)
	local counts: { [string]: number } = {}
	for _, t in self._tickets do
		counts[t.ModeId] = (counts[t.ModeId] or 0) + #t.UserIds
	end
	for _, t in self._tickets do
		for _, uid in t.UserIds do
			local pl = self._env.Players.GetPlayerByUserId(uid)
			if pl then
				self._env.FireClient(
					"QueueState",
					pl,
					{
						InQueue = true,
						ModeId = t.ModeId,
						Since = t.CreatedAt,
						Counts = counts,
						BotFillAt = t.CreatedAt + GameConfig.Matchmaking.BotFillAfterSeconds,
					}
				)
			end
		end
	end
	self.QueueChanged:Fire()
end

-- Pure matching: greedy oldest-first packing of indivisible tickets. Returns matches and leftover tickets.
function MatchmakingService.FormMatches(tickets: { Ticket }, now: number, botFillAfter: number): { Match }
	local byMode: { [string]: { Ticket } } = {}
	for _, t in tickets do
		if t.ExpiresAt > now then
			byMode[t.ModeId] = byMode[t.ModeId] or {}
			table.insert(byMode[t.ModeId], t)
		end
	end
	local matches: { Match } = {}
	for modeId, list in byMode do
		local def = ModeDefinitions.ById[modeId]
		table.sort(list, function(a, b)
			return a.CreatedAt < b.CreatedAt
		end)
		local remaining = list
		while #remaining > 0 do
			local group: { Ticket } = {}
			local size = 0
			local rest = {}
			for _, t in remaining do
				if size + #t.UserIds <= GameConfig.MaxRacers and size + #t.UserIds <= def.MaxPlayers then
					table.insert(group, t)
					size += #t.UserIds
				else
					table.insert(rest, t)
				end
			end
			if #group == 0 then
				break
			end
			local oldestWait = now - group[1].CreatedAt
			local target = math.min(GameConfig.TargetMatchSize, def.MaxPlayers)
			local enoughHumans = size >= math.max(GameConfig.MinRealPlayers, def.MinPlayers)
			if size >= target or (enoughHumans and oldestWait >= botFillAfter) then
				local users = {}
				for _, t in group do
					for _, u in t.UserIds do
						table.insert(users, u)
					end
				end
				local bots = 0
				if size < target and GameConfig.Bots.FillEnabledByDefault and def.BotsAllowed then
					bots = math.min(target, GameConfig.MaxRacers) - size
				end
				table.insert(matches, { ModeId = modeId, Tickets = group, UserIds = users, BotCount = bots })
				remaining = rest
			else
				break
			end
		end
	end
	return matches
end

function MatchmakingService.Poll(self: any)
	local now = self._env.Now()
	-- Expire tickets
	for _, t in self._tickets do
		if t.ExpiresAt <= now then
			self:RemoveTicket(t)
			for _, uid in t.UserIds do
				local pl = self._env.Players.GetPlayerByUserId(uid)
				if pl then
					self._env.FireClient("QueueState", pl, { InQueue = false, Expired = true })
				end
			end
		end
	end
	local all: { Ticket } = {}
	for _, t in self._tickets do
		table.insert(all, t)
	end
	if not self._env.Teleport.LocalMode then
		-- Merge cross-server tickets (this server acts as a matcher for anything it can see).
		for _, entry in self._env.MemoryQueue:Read(64) do
			local t = entry.Value
			if type(t) == "table" and t.Id and not self._tickets[t.Id] then
				table.insert(all, t)
			end
		end
	end
	for _, match in MatchmakingService.FormMatches(all, now, GameConfig.Matchmaking.BotFillAfterSeconds) do
		for _, t in match.Tickets do
			self:RemoveTicket(t)
		end
		self._telemetry:Count("mm.match")
		self.MatchFormed:Fire(match)
	end
	self:Broadcast()
end

return MatchmakingService
