--!strict
-- Parties of up to MaxPartySize. A party is an indivisible matchmaking ticket.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local Signal = require(Shared.Utility.Signal)

export type Party = { Id: string, LeaderId: number, Members: { number }, Invites: { [number]: number }, CreatedAt: number }

local PartyService = { Name = "PartyService" }
PartyService.__index = PartyService

function PartyService.new()
	return setmetatable({
		_env = nil :: any,
		_security = nil :: any,
		_parties = {} :: { [string]: Party },
		_byUser = {} :: { [number]: string },
		_nextId = 0,
		PartyChanged = Signal.new() :: Signal.Signal<Party>,
	}, PartyService)
end

function PartyService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._security = registry:Get("SecurityService")
	self._env.Dispatcher:On("PartyAction", function(player, action: string, targetUserId: number?)
		self:Handle(player, action, targetUserId)
	end)
end

function PartyService.Start(self: any)
	self._env.Players.PlayerRemoving:Connect(function(player)
		self:Leave(player.UserId)
	end)
end

function PartyService.GetParty(self: any, userId: number): Party?
	local id = self._byUser[userId]
	return if id then self._parties[id] else nil
end

-- Every player is conceptually in a party; solo players get an implicit one when queueing.
function PartyService.GetOrCreate(self: any, userId: number): Party
	local p = self:GetParty(userId)
	if p then
		return p
	end
	self._nextId += 1
	local party: Party = { Id = "party_" .. self._nextId, LeaderId = userId, Members = { userId }, Invites = {}, CreatedAt = self._env.Now() }
	self._parties[party.Id] = party
	self._byUser[userId] = party.Id
	self:Broadcast(party)
	return party
end

function PartyService.Broadcast(self: any, party: Party)
	local view = { Id = party.Id, LeaderId = party.LeaderId, Members = {}, Max = GameConfig.MaxPartySize }
	for _, uid in party.Members do
		local pl = self._env.Players.GetPlayerByUserId(uid)
		table.insert(view.Members, { UserId = uid, Name = if pl then pl.DisplayName else tostring(uid) })
	end
	for _, uid in party.Members do
		local pl = self._env.Players.GetPlayerByUserId(uid)
		if pl then
			self._env.FireClient("PartyState", pl, view)
		end
	end
	self.PartyChanged:Fire(party)
end

function PartyService.Handle(self: any, player: any, action: string, targetUserId: number?)
	local uid = player.UserId
	if action == "Create" then
		self:GetOrCreate(uid)
	elseif action == "Invite" and targetUserId then
		local party = self:GetOrCreate(uid)
		if party.LeaderId ~= uid then
			return
		end
		if #party.Members >= GameConfig.MaxPartySize then
			self._env.FireClient("ErrorDialog", player, "ERROR.PARTY_FULL", {})
			return
		end
		local target = self._env.Players.GetPlayerByUserId(targetUserId)
		if not target or targetUserId == uid then
			return
		end
		party.Invites[targetUserId] = self._env.Now()
		self._env.FireClient("PartyState", target, { Invite = { PartyId = party.Id, From = player.DisplayName, FromId = uid } })
	elseif action == "Accept" and targetUserId then
		local leaderParty = self:GetParty(targetUserId)
		if not leaderParty or leaderParty.Invites[uid] == nil then
			self._security:Flag(player, "PermissionDenied", "no invite")
			return
		end
		if #leaderParty.Members >= GameConfig.MaxPartySize then
			self._env.FireClient("ErrorDialog", player, "ERROR.PARTY_FULL", {})
			return
		end
		self:Leave(uid)
		leaderParty.Invites[uid] = nil
		table.insert(leaderParty.Members, uid)
		self._byUser[uid] = leaderParty.Id
		self:Broadcast(leaderParty)
	elseif action == "Decline" and targetUserId then
		local leaderParty = self:GetParty(targetUserId)
		if leaderParty then
			leaderParty.Invites[uid] = nil
		end
	elseif action == "Leave" then
		self:Leave(uid)
	elseif action == "Kick" and targetUserId then
		local party = self:GetParty(uid)
		if party and party.LeaderId == uid and targetUserId ~= uid then
			self:Leave(targetUserId)
		end
	end
end

function PartyService.Leave(self: any, userId: number)
	local party = self:GetParty(userId)
	if not party then
		return
	end
	local idx = table.find(party.Members, userId)
	if idx then
		table.remove(party.Members, idx)
	end
	self._byUser[userId] = nil
	if #party.Members == 0 then
		self._parties[party.Id] = nil
		return
	end
	if party.LeaderId == userId then
		party.LeaderId = party.Members[1]
	end
	self:Broadcast(party)
	local pl = self._env.Players.GetPlayerByUserId(userId)
	if pl then
		self._env.FireClient("PartyState", pl, { Id = nil, Members = {}, Max = GameConfig.MaxPartySize })
	end
end

function PartyService.Members(self: any, userId: number): { number }
	local p = self:GetParty(userId)
	return if p then table.clone(p.Members) else { userId }
end

return PartyService
