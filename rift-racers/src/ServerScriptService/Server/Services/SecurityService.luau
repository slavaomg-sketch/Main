--!strict
-- Suspicion scoring, rejection logging, soft corrections and (rare, confident) kicks.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local Signal = require(Shared.Utility.Signal)

local SecurityService = { Name = "SecurityService" }
SecurityService.__index = SecurityService

export type Record = { Score: number, LastDecayAt: number, Incidents: { { At: number, Reason: string, Weight: number, Detail: string? } }, Kicked: boolean, ActionLocks: { [string]: number } }

local WEIGHTS: { [string]: number } = {
	RateLimited = 1,
	SchemaViolation = 4,
	InstanceArgument = 6,
	WrongState = 1,
	PermissionDenied = 3,
	UnknownRemote = 2,
	NoHandler = 0,
	HandlerError = 0,
	SpeedHack = 8,
	Teleport = 10,
	Fly = 8,
	NoClip = 8,
	OffCorridor = 2,
	AngularVelocity = 4,
	ImpossibleSector = 12,
	InvalidFinishCross = 3,
	FakeItem = 10,
	ItemSpam = 3,
	FakeTarget = 6,
	NotYourVehicle = 10,
	RewardTamper = 15,
}

function SecurityService.new()
	return setmetatable({
		_records = {} :: { [number]: Record },
		_env = nil :: any,
		_telemetry = nil :: any,
		Flagged = Signal.new() :: Signal.Signal<any, string, number>,
		Kicked = Signal.new() :: Signal.Signal<any, string>,
		_maidConn = nil :: any,
	}, SecurityService)
end

function SecurityService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._telemetry = registry:Get("TelemetryService")
	self._maidConn = self._env.Dispatcher.Rejected:Connect(function(player, remote: string, rejection)
		self:Flag(player, rejection.Reason, remote .. (if rejection.Detail then " " .. rejection.Detail else ""))
	end)
end

function SecurityService.Start(self: any)
	self._env.Players.PlayerRemoving:Connect(function(player)
		self._records[player.UserId] = nil
		self._env.Dispatcher:ForgetPlayer(player)
	end)
end

function SecurityService.Destroy(self: any)
	if self._maidConn then
		self._maidConn:Disconnect()
	end
end

function SecurityService.RecordFor(self: any, player: any): Record
	local r = self._records[player.UserId]
	if not r then
		r = { Score = 0, LastDecayAt = self._env.Now(), Incidents = {}, Kicked = false, ActionLocks = {} }
		self._records[player.UserId] = r
	end
	return r :: Record
end

local function decay(r: Record, now: number)
	local elapsed = math.max(0, now - r.LastDecayAt)
	r.Score = math.max(0, r.Score - elapsed * GameConfig.Security.SuspicionDecayPerSecond)
	r.LastDecayAt = now
end

function SecurityService.Score(self: any, player: any): number
	local r = self:RecordFor(player)
	decay(r, self._env.Now())
	return r.Score
end

function SecurityService.Flag(self: any, player: any, reason: string, detail: string?, weightOverride: number?)
	if player == nil or type(player) ~= "table" and typeof(player) ~= "Instance" then
		return
	end
	local r = self:RecordFor(player)
	local now = self._env.Now()
	decay(r, now)
	local w = weightOverride or WEIGHTS[reason] or 2
	r.Score += w
	table.insert(r.Incidents, { At = now, Reason = reason, Weight = w, Detail = detail })
	if #r.Incidents > 64 then
		table.remove(r.Incidents, 1)
	end
	self._telemetry:Count("security." .. reason)
	if w >= 4 then
		self._telemetry:Log("Warn", "Security", string.format("%s (%d) %s %s score=%.1f", tostring(player.Name), player.UserId, reason, detail or "", r.Score))
	end
	self.Flagged:Fire(player, reason, r.Score)
	if r.Score >= GameConfig.Security.SuspicionKick and not r.Kicked then
		-- Only kick on repeated, confident, high-weight incidents; never on a single physics deviation.
		local heavy = 0
		for _, inc in r.Incidents do
			if inc.Weight >= 6 and now - inc.At < 120 then
				heavy += 1
			end
		end
		if heavy >= 3 then
			r.Kicked = true
			self.Kicked:Fire(player, reason)
			self._telemetry:Log("Error", "Security", string.format("kicking %s after %d heavy incidents", tostring(player.Name), heavy))
			if type(player.Kick) == "function" then
				pcall(player.Kick, player, "Suspicious activity detected. Please rejoin.")
			end
		end
	end
end

-- Temporarily disables a disputed action (e.g. item use) for a player.
function SecurityService.LockAction(self: any, player: any, action: string, seconds: number)
	local r = self:RecordFor(player)
	r.ActionLocks[action] = self._env.Now() + seconds
end

function SecurityService.IsActionLocked(self: any, player: any, action: string): boolean
	local r = self:RecordFor(player)
	local until_ = r.ActionLocks[action]
	return until_ ~= nil and until_ > self._env.Now()
end

function SecurityService.Incidents(self: any, player: any)
	return table.clone(self:RecordFor(player).Incidents)
end

return SecurityService
