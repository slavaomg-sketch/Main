--!strict
-- Typed network wrapper. Server: validated dispatch (schema, rate limit, state gate, permission hook, rejection log).
-- Client: thin fire/listen API. The dispatcher core is pure and unit-tested in Lune; RemoteEvents are only the transport.
local RunService = game:GetService("RunService")

local NetworkSchemas = require(script.Parent.NetworkSchemas)
local NetworkTypes = require(script.Parent.Parent.Types.NetworkTypes)
local Validator = require(script.Parent.Validator)
local RateLimiter = require(script.Parent.RateLimiter)
local Signal = require(script.Parent.Parent.Utility.Signal)
local GameConfig = require(script.Parent.Parent.Config.GameConfig)

type RemoteDefinition = NetworkTypes.RemoteDefinition
type Rejection = NetworkTypes.Rejection

export type Dispatcher = {
	Rejected: Signal.Signal<any, string, Rejection>,
	SetStateProvider: (self: Dispatcher, fn: (player: any) -> string) -> (),
	SetPermissionCheck: (self: Dispatcher, name: string, fn: (player: any, ...any) -> boolean) -> (),
	On: (self: Dispatcher, name: string, handler: (player: any, ...any) -> ...any) -> (),
	Handle: (self: Dispatcher, name: string, player: any, argCount: number, args: { any }) -> (boolean, Rejection?, ...any),
	ForgetPlayer: (self: Dispatcher, player: any) -> (),
}

local Network = {}

local function playerKey(player: any): string
	if typeof(player) == "Instance" then
		return tostring((player :: Player).UserId)
	end
	if type(player) == "table" and player.UserId ~= nil then
		return tostring(player.UserId)
	end
	return tostring(player)
end

-- ---------------------------------------------------------------------------------------------------------------
-- Dispatcher (server-side validation pipeline; transport-agnostic)
-- ---------------------------------------------------------------------------------------------------------------
local Dispatcher = {}
Dispatcher.__index = Dispatcher

function Network.CreateDispatcher(clock: (() -> number)?): Dispatcher
	local self = setmetatable({
		Rejected = Signal.new() :: Signal.Signal<any, string, Rejection>,
		_handlers = {} :: { [string]: (player: any, ...any) -> ...any },
		_limiters = {} :: { [string]: RateLimiter.RateLimiter },
		_permissions = {} :: { [string]: (player: any, ...any) -> boolean },
		_stateProvider = nil :: ((player: any) -> string)?,
		_clock = clock or os.clock,
	}, Dispatcher)
	for _, def in NetworkSchemas.List do
		if def.Direction ~= "ServerToClient" then
			local cap = def.RateCapacity or GameConfig.Security.RemoteRateDefaults.Capacity
			local refill = def.RateRefill or GameConfig.Security.RemoteRateDefaults.RefillPerSecond
			self._limiters[def.Name] = RateLimiter.new(cap, refill, self._clock)
		end
	end
	return (self :: any) :: Dispatcher
end

function Dispatcher.SetStateProvider(self: any, fn: (player: any) -> string)
	self._stateProvider = fn
end

function Dispatcher.SetPermissionCheck(self: any, name: string, fn: (player: any, ...any) -> boolean)
	self._permissions[name] = fn
end

function Dispatcher.On(self: any, name: string, handler: (player: any, ...any) -> ...any)
	assert(NetworkSchemas.ByName[name] ~= nil, "unknown remote " .. name)
	assert(self._handlers[name] == nil, "handler already registered for " .. name)
	self._handlers[name] = handler
end

function Dispatcher.ForgetPlayer(self: any, player: any)
	local prefix = playerKey(player) .. ":"
	for _, limiter in self._limiters do
		limiter:RemovePrefix(prefix)
	end
end

local function reject(self: any, player: any, name: string, reason: string, detail: string?): (boolean, Rejection?)
	local r: Rejection = { Reason = reason, Detail = detail }
	self.Rejected:Fire(player, name, r)
	return false, r
end

function Dispatcher.Handle(self: any, name: string, player: any, argCount: number, args: { any }): (boolean, Rejection?, ...any)
	local def: RemoteDefinition? = NetworkSchemas.ByName[name]
	if def == nil or def.Direction == "ServerToClient" then
		return reject(self, player, name, "UnknownRemote")
	end
	local d = def :: RemoteDefinition
	local limiter: RateLimiter.RateLimiter = self._limiters[name]
	if not limiter:TryConsume(playerKey(player) .. ":" .. name) then
		return reject(self, player, name, "RateLimited")
	end
	for i = 1, argCount do
		if Validator.ContainsInstance(args[i]) then
			return reject(self, player, name, "InstanceArgument", "arg" .. i)
		end
	end
	local ok, err = Validator.CheckArgs(args, argCount, d.Args)
	if not ok then
		return reject(self, player, name, "SchemaViolation", err)
	end
	if d.RequiredStates ~= nil and self._stateProvider ~= nil then
		local state = self._stateProvider(player)
		if table.find(d.RequiredStates :: { string }, state) == nil then
			return reject(self, player, name, "WrongState", state)
		end
	end
	local perm = self._permissions[name]
	if perm ~= nil and not perm(player, table.unpack(args, 1, argCount)) then
		return reject(self, player, name, "PermissionDenied")
	end
	local handler = self._handlers[name]
	if handler == nil then
		return reject(self, player, name, "NoHandler")
	end
	local results = table.pack(pcall(handler, player, table.unpack(args, 1, argCount)))
	if not results[1] then
		warn(string.format("[Network] handler %s errored: %s", name, tostring(results[2])))
		return reject(self, player, name, "HandlerError", tostring(results[2]))
	end
	return true, nil, table.unpack(results, 2, results.n)
end

-- ---------------------------------------------------------------------------------------------------------------
-- Roblox transport
-- ---------------------------------------------------------------------------------------------------------------
local REMOTE_FOLDER_NAME = "Remotes"
local remotesFolder: Folder? = nil
local dispatcher: Dispatcher? = nil
local clientHandlers: { [string]: { (...any) -> () } } = {}

local function getFolder(): Folder
	if remotesFolder then
		return remotesFolder :: Folder
	end
	local parent = script.Parent :: Instance
	if RunService:IsServer() then
		local existing = parent:FindFirstChild(REMOTE_FOLDER_NAME)
		if existing then
			remotesFolder = existing :: Folder
		else
			local f = Instance.new("Folder")
			f.Name = REMOTE_FOLDER_NAME
			f.Parent = parent
			remotesFolder = f :: Folder
		end
	else
		remotesFolder = (parent:WaitForChild(REMOTE_FOLDER_NAME) :: any) :: Folder
	end
	return (remotesFolder :: any) :: Folder
end

local function getRemote(name: string): Instance
	local def = NetworkSchemas.ByName[name]
	assert(def ~= nil, "unknown remote " .. name)
	local folder = getFolder()
	local className = if def.Direction == "Function" then "RemoteFunction" else "RemoteEvent"
	if RunService:IsServer() then
		local existing = folder:FindFirstChild(name)
		if existing then
			return existing
		end
		local r = Instance.new(className)
		r.Name = name
		r.Parent = folder
		return r
	end
	return folder:WaitForChild(name)
end

-- Server API ------------------------------------------------------------------------------------------------------
function Network.Server(): Dispatcher
	assert(RunService:IsServer(), "Network.Server on client")
	if dispatcher then
		return dispatcher :: Dispatcher
	end
	local d = Network.CreateDispatcher(os.clock)
	dispatcher = d
	for _, def in NetworkSchemas.List do
		local remote = getRemote(def.Name)
		if def.Direction == "ClientToServer" then
			(remote :: RemoteEvent).OnServerEvent:Connect(function(player: Player, ...: any)
				local args = table.pack(...)
				d:Handle(def.Name, player, args.n, args)
			end)
		elseif def.Direction == "Function" then
			(remote :: RemoteFunction).OnServerInvoke = function(player: Player, ...: any)
				local args = table.pack(...)
				local results = table.pack(d:Handle(def.Name, player, args.n, args))
				if results[1] then
					return table.unpack(results, 3, results.n)
				end
				return nil
			end
		end
	end
	return d
end

function Network.FireClient(name: string, player: Player, ...: any)
	local def = NetworkSchemas.ByName[name]
	assert(def and def.Direction == "ServerToClient", "not a server->client remote: " .. name)
	if player.Parent == nil then
		return
	end
	(getRemote(name) :: RemoteEvent):FireClient(player, ...)
end

function Network.FireAllClients(name: string, ...: any)
	local def = NetworkSchemas.ByName[name]
	assert(def and def.Direction == "ServerToClient", "not a server->client remote: " .. name)
	;(getRemote(name) :: RemoteEvent):FireAllClients(...)
end

-- Client API ------------------------------------------------------------------------------------------------------
function Network.Fire(name: string, ...: any)
	assert(RunService:IsClient(), "Network.Fire on server")
	local def = NetworkSchemas.ByName[name]
	assert(def and def.Direction == "ClientToServer", "not a client->server remote: " .. name)
	;(getRemote(name) :: RemoteEvent):FireServer(...)
end

function Network.Invoke(name: string, ...: any): ...any
	assert(RunService:IsClient(), "Network.Invoke on server")
	local def = NetworkSchemas.ByName[name]
	assert(def and def.Direction == "Function", "not a function remote: " .. name)
	return (getRemote(name) :: RemoteFunction):InvokeServer(...)
end

function Network.OnClient(name: string, handler: (...any) -> ()): () -> ()
	assert(RunService:IsClient(), "Network.OnClient on server")
	local def = NetworkSchemas.ByName[name]
	assert(def and def.Direction == "ServerToClient", "not a server->client remote: " .. name)
	local list = clientHandlers[name]
	if list == nil then
		list = {}
		clientHandlers[name] = list
		;(getRemote(name) :: RemoteEvent).OnClientEvent:Connect(function(...)
			for _, fn in table.clone(clientHandlers[name]) do
				task.spawn(fn, ...)
			end
		end)
	end
	table.insert(list, handler)
	return function()
		local idx = table.find(clientHandlers[name], handler)
		if idx then
			table.remove(clientHandlers[name], idx)
		end
	end
end

return Network
