--!strict
-- Builds the real Env for a Roblox server: DataStore/MemoryStore/Teleport adapters with Studio-safe fallbacks.
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local DataStoreService = game:GetService("DataStoreService")
local MemoryStoreService = game:GetService("MemoryStoreService")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local Network = require(Shared.Net.Network)
local ProfileStore = require(script.Parent.Systems.ProfileStore)
local RobloxWorld = require(script.Parent.RobloxWorld)

local RobloxEnvFactory = {}

local function dataStoreBackend(): any
	local ok, store = pcall(function()
		local scope = if RunService:IsStudio() then GameConfig.Profile.TestScope else nil
		return DataStoreService:GetDataStore(GameConfig.Profile.DataStoreName, scope)
	end)
	if not ok then
		warn("[Env] DataStore unavailable, using in-memory profiles: " .. tostring(store))
		return ProfileStore.MemoryBackend()
	end
	-- Probe API access once (Studio without "Enable Studio Access to API Services" throws).
	local probeOk = pcall(function()
		(store :: any):GetAsync("__probe")
	end)
	if not probeOk then
		warn("[Env] DataStore API access disabled in this session; using in-memory profiles (nothing is persisted).")
		return ProfileStore.MemoryBackend()
	end
	local backend: any = {}
	function backend:UpdateAsync(key: string, transform: (any) -> any?)
		return (store :: any):UpdateAsync(key, transform)
	end
	function backend:GetAsync(key: string)
		return (store :: any):GetAsync(key)
	end
	return backend
end

local function memoryQueue(): any
	local ok, map = pcall(function()
		return MemoryStoreService:GetSortedMap("RiftRacersQueue")
	end)
	local q: any = {}
	if ok then
		function q:Add(key: string, value: any, ttl: number): boolean
			local s = pcall(function()
				(map :: any):SetAsync(key, value, ttl)
			end)
			return s
		end
		function q:Read(max: number)
			local s, items = pcall(function()
				return (map :: any):GetRangeAsync(Enum.SortDirection.Ascending, max)
			end)
			local out = {}
			if s then
				for _, it in items do
					table.insert(out, { Key = it.key, Value = it.value })
				end
			end
			return out
		end
		function q:Remove(key: string)
			pcall(function()
				(map :: any):RemoveAsync(key)
			end)
		end
	else
		local mem: { [string]: any } = {}
		function q:Add(key: string, value: any)
			mem[key] = value
			return true
		end
		function q:Read()
			local out = {}
			for k, v in mem do
				table.insert(out, { Key = k, Value = v })
			end
			return out
		end
		function q:Remove(key: string)
			mem[key] = nil
		end
	end
	return q
end

local function teleportAdapter(localMode: boolean): any
	local t: any = { LocalMode = localMode }
	function t:ReserveAndTeleport(players: { Player }, data: any): (boolean, string?)
		if localMode then
			return true, nil
		end
		local placeId = game.PlaceId
		local lastErr: string? = nil
		for attempt = 1, GameConfig.Matchmaking.ReservedServerTeleportRetries do
			local ok, err = pcall(function()
				local code = TeleportService:ReserveServer(placeId)
				local options = Instance.new("TeleportOptions")
				options.ReservedServerAccessCode = code
				options:SetTeleportData(data)
				TeleportService:TeleportAsync(placeId, players, options)
			end)
			if ok then
				return true, nil
			end
			lastErr = tostring(err)
			task.wait(2 ^ attempt)
		end
		return false, lastErr
	end
	function t:ReadTeleportData(player: Player): any?
		local ok, data = pcall(function()
			local join = player:GetJoinData()
			return join and join.TeleportData
		end)
		return if ok then data else nil
	end
	return t
end

function RobloxEnvFactory.Build(): any
	local dispatcher = Network.Server()
	local sessionId = HttpService:GenerateGUID(false)
	local localMode = GameConfig.Matchmaking.LocalMode or RunService:IsStudio()
	local env: any = {
		Now = function()
			return Workspace:GetServerTimeNow()
		end,
		Unix = os.time,
		IsStudio = RunService:IsStudio(),
		Dispatcher = dispatcher,
		FireClient = Network.FireClient,
		FireAll = Network.FireAllClients,
		Players = {
			PlayerAdded = Players.PlayerAdded,
			PlayerRemoving = Players.PlayerRemoving,
			GetPlayers = function()
				return Players:GetPlayers()
			end,
			GetPlayerByUserId = function(id: number)
				return Players:GetPlayerByUserId(id)
			end,
		},
		ProfileBackend = dataStoreBackend(),
		MemoryQueue = memoryQueue(),
		Teleport = teleportAdapter(localMode),
		Heartbeat = RunService.Heartbeat,
		BindToClose = function(fn: () -> ())
			game:BindToClose(fn)
		end,
		SessionId = sessionId,
		Sleep = function(seconds: number)
			task.wait(seconds)
		end,
		Random = Random.new(),
		Log = function(level: string, tag: string, message: string)
			local line = string.format("[%s][%s] %s", GameConfig.ProjectShortName, tag, message)
			if level == "Error" then
				warn("ERROR " .. line)
			elseif level == "Warn" then
				warn(line)
			else
				print(line)
			end
		end,
		World = RobloxWorld,
	}
	return env
end

return RobloxEnvFactory
