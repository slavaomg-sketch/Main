--!strict
-- Virtual Roblox DataModel backed by the Rojo source tree so real game modules run unmodified in Lune.
-- `require(script.Parent.Foo)` resolves through fake Instances whose children mirror the file system.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local taskLib = require("@lune/task")
local roblox = require("@lune/roblox") :: any
local RandomShim = require("./RandomShim")

local RobloxEnv = {}

export type FakeInstance = any

local SRC_ROOT = "src"
local clockOffset = 0

-- ----------------------------------------------------------------------------------------------------------------
-- Fake instance tree
-- ----------------------------------------------------------------------------------------------------------------
local Node = {}

local function newNode(name: string, className: string, parent: any?, path: string?): FakeInstance
	local node = {
		Name = name,
		ClassName = className,
		Parent = parent,
		_children = {} :: { [string]: any },
		_childList = {} :: { any },
		_path = path,
		_attributes = {} :: { [string]: any },
	}
	setmetatable(node, Node)
	if parent then
		parent._children[name] = node
		table.insert(parent._childList, node)
	end
	return node
end

Node.__index = function(self: any, key: string): any
	local m = rawget(Node, key)
	if m ~= nil then
		return m
	end
	local child = rawget(self, "_children")[key]
	if child ~= nil then
		return child
	end
	error(string.format("%s is not a valid member of %s \"%s\"", key, rawget(self, "ClassName"), rawget(self, "Name")), 2)
end

Node.__tostring = function(self: any): string
	return rawget(self, "Name")
end

function Node.FindFirstChild(self: any, name: string, recursive: boolean?): any
	local c = self._children[name]
	if c ~= nil then
		return c
	end
	if recursive then
		for _, child in self._childList do
			local found = child:FindFirstChild(name, true)
			if found then
				return found
			end
		end
	end
	return nil
end

function Node.WaitForChild(self: any, name: string): any
	local c = self._children[name]
	if c == nil then
		error("WaitForChild would hang in Lune: " .. tostring(self) .. "." .. name)
	end
	return c
end

function Node.GetChildren(self: any): { any }
	return table.clone(self._childList)
end

function Node.GetDescendants(self: any): { any }
	local out = {}
	for _, c in self._childList do
		table.insert(out, c)
		for _, d in c:GetDescendants() do
			table.insert(out, d)
		end
	end
	return out
end

function Node.IsA(self: any, className: string): boolean
	if self.ClassName == className then
		return true
	end
	if className == "Instance" then
		return true
	end
	if className == "LuaSourceContainer" and (self.ClassName == "ModuleScript" or self.ClassName == "Script" or self.ClassName == "LocalScript") then
		return true
	end
	return false
end

function Node.GetAttribute(self: any, name: string): any
	return self._attributes[name]
end

function Node.SetAttribute(self: any, name: string, value: any)
	self._attributes[name] = value
end

function Node.GetService(self: any, name: string): any
	local svc = self._children[name]
	if svc == nil then
		svc = RobloxEnv.MakeService(name, self)
	end
	return svc
end

function Node.GetFullName(self: any): string
	if self.Parent and self.Parent.ClassName ~= "DataModel" then
		return self.Parent:GetFullName() .. "." .. self.Name
	end
	return self.Name
end

function Node.Destroy(self: any)
	if self.Parent then
		self.Parent._children[self.Name] = nil
		local idx = table.find(self.Parent._childList, self)
		if idx then
			table.remove(self.Parent._childList, idx)
		end
		self.Parent = nil
	end
end

-- Populate a folder node from disk. `init.luau` promotes a directory to a ModuleScript.
local function populate(node: any, dir: string)
	for _, entry in fs.readDir(dir) do
		local full = dir .. "/" .. entry
		if fs.isDir(full) then
			local className = "Folder"
			local initPath: string? = nil
			if fs.isFile(full .. "/init.luau") then
				className = "ModuleScript"
				initPath = full .. "/init.luau"
			end
			local child = newNode(entry, className, node, initPath)
			populate(child, full)
		elseif entry:match("%.luau$") and entry ~= "init.luau" then
			local base = entry:gsub("%.luau$", "")
			local className = "ModuleScript"
			if base:match("%.server$") then
				className = "Script"
				base = base:gsub("%.server$", "")
			elseif base:match("%.client$") then
				className = "LocalScript"
				base = base:gsub("%.client$", "")
			end
			newNode(base, className, node, full)
		end
	end
end

-- ----------------------------------------------------------------------------------------------------------------
-- Fake services & signals
-- ----------------------------------------------------------------------------------------------------------------
local function fakeSignal()
	local handlers = {}
	local sig = {}
	function sig:Connect(fn)
		table.insert(handlers, fn)
		local conn = { Connected = true }
		function conn:Disconnect()
			self.Connected = false
			local i = table.find(handlers, fn)
			if i then
				table.remove(handlers, i)
			end
		end
		return conn
	end
	function sig:Fire(...)
		for _, fn in table.clone(handlers) do
			taskLib.spawn(fn, ...)
		end
	end
	function sig:Wait()
		local th = coroutine.running()
		local conn
		conn = sig:Connect(function(...)
			conn:Disconnect()
			taskLib.spawn(th, ...)
		end)
		return coroutine.yield()
	end
	return sig
end
RobloxEnv.FakeSignal = fakeSignal

local isServer = true

function RobloxEnv.SetIsServer(v: boolean)
	isServer = v
end

function RobloxEnv.MakeService(name: string, game: any): any
	local svc = newNode(name, name, game)
	if name == "RunService" then
		svc.IsServer = function()
			return isServer
		end
		svc.IsClient = function()
			return not isServer
		end
		svc.IsStudio = function()
			return true
		end
		svc.IsRunning = function()
			return true
		end
		svc.Heartbeat = fakeSignal()
		svc.RenderStepped = fakeSignal()
		svc.Stepped = fakeSignal()
		svc.PreSimulation = fakeSignal()
		svc.PostSimulation = fakeSignal()
	elseif name == "Players" then
		svc.PlayerAdded = fakeSignal()
		svc.PlayerRemoving = fakeSignal()
		svc.GetPlayers = function()
			return {}
		end
		svc.MaxPlayers = 12
	elseif name == "Workspace" then
		svc.GetServerTimeNow = function()
			return os.clock() + clockOffset
		end
		svc.CurrentCamera = nil
	elseif name == "CollectionService" then
		local tags: { [any]: { [string]: boolean } } = {}
		svc.AddTag = function(_, inst, tag)
			tags[inst] = tags[inst] or {}
			tags[inst][tag] = true
		end
		svc.HasTag = function(_, inst, tag)
			return tags[inst] ~= nil and tags[inst][tag] == true
		end
		svc.GetTagged = function(_, tag)
			local out = {}
			for inst, t in tags do
				if t[tag] then
					table.insert(out, inst)
				end
			end
			return out
		end
		svc.GetTags = function(_, inst)
			local out = {}
			for tag in tags[inst] or {} do
				table.insert(out, tag)
			end
			return out
		end
	elseif name == "HttpService" then
		local counter = 0
		svc.GenerateGUID = function(_, wrap)
			counter += 1
			local g = string.format("%08x-%04x-%04x-%04x-%012x", os.clock() * 1e6 % 0xFFFFFFFF, counter % 0xFFFF, 0x4000, 0x8000, counter)
			return if wrap == false then g else "{" .. g .. "}"
		end
		svc.JSONEncode = function(_, t)
			return (require("@lune/serde") :: any).encode("json", t)
		end
		svc.JSONDecode = function(_, s)
			return (require("@lune/serde") :: any).decode("json", s)
		end
	elseif name == "DataStoreService" or name == "MemoryStoreService" or name == "TeleportService" or name == "MessagingService" then
		-- Real access is injected by tests through service adapters; bare calls error loudly.
		setmetatable(svc, { __index = function(_, k)
			error("Fake " .. name .. " has no member " .. tostring(k) .. " (inject an adapter in tests)")
		end })
	end
	return svc
end

-- ----------------------------------------------------------------------------------------------------------------
-- Module loading
-- ----------------------------------------------------------------------------------------------------------------
local moduleCache: { [string]: any } = {}
local loading: { [string]: boolean } = {}
local game: any = nil
local workspaceNode: any = nil

local function makeEnvironment(scriptNode: any): { [string]: any }
	local env: { [string]: any } = {
		game = game,
		workspace = workspaceNode,
		script = scriptNode,
		task = taskLib,
		Vector3 = roblox.Vector3,
		Vector2 = roblox.Vector2,
		CFrame = roblox.CFrame,
		Color3 = roblox.Color3,
		UDim = roblox.UDim,
		UDim2 = roblox.UDim2,
		Enum = roblox.Enum,
		NumberRange = roblox.NumberRange,
		NumberSequence = roblox.NumberSequence,
		NumberSequenceKeypoint = roblox.NumberSequenceKeypoint,
		ColorSequence = roblox.ColorSequence,
		ColorSequenceKeypoint = roblox.ColorSequenceKeypoint,
		Rect = roblox.Rect,
		Ray = roblox.Ray,
		BrickColor = roblox.BrickColor,
		TweenInfo = roblox.TweenInfo,
		Font = roblox.Font,
		PhysicalProperties = roblox.PhysicalProperties,
		Instance = roblox.Instance,
		Random = RandomShim,
		tick = function()
			return os.clock()
		end,
		time = function()
			return os.clock()
		end,
		elapsedTime = function()
			return os.clock()
		end,
		warn = warn,
		settings = function()
			return {}
		end,
		require = nil,
	}
	env.require = function(target: any): any
		if type(target) == "string" then
			return require(target)
		end
		return RobloxEnv.Require(target)
	end
	return env
end

function RobloxEnv.Require(node: any): any
	assert(type(node) == "table" and rawget(node, "_path"), "require target is not a ModuleScript: " .. tostring(node))
	local path: string = node._path
	if moduleCache[path] ~= nil then
		return moduleCache[path]
	end
	if loading[path] then
		error("cyclic require detected at " .. path)
	end
	loading[path] = true
	local source = fs.readFile(path)
	local chunk = luau.load(source, { debugName = node:GetFullName(), environment = makeEnvironment(node), injectGlobals = true })
	local result = chunk()
	loading[path] = nil
	if result == nil then
		result = true
	end
	moduleCache[path] = result
	return result
end

function RobloxEnv.Reset()
	table.clear(moduleCache)
	game = newNode("game", "DataModel", nil, nil)
	workspaceNode = RobloxEnv.MakeService("Workspace", game)
	local rs = newNode("ReplicatedStorage", "ReplicatedStorage", game)
	populate(newNode("Shared", "Folder", rs), SRC_ROOT .. "/ReplicatedStorage/Shared")
	local sss = newNode("ServerScriptService", "ServerScriptService", game)
	populate(newNode("Server", "Folder", sss), SRC_ROOT .. "/ServerScriptService/Server")
	local ss = newNode("ServerStorage", "ServerStorage", game)
	populate(newNode("Content", "Folder", ss), SRC_ROOT .. "/ServerStorage/Content")
	local sp = newNode("StarterPlayer", "StarterPlayer", game)
	local sps = newNode("StarterPlayerScripts", "StarterPlayerScripts", sp)
	populate(newNode("Client", "Folder", sps), SRC_ROOT .. "/StarterPlayer/StarterPlayerScripts/Client")
	local rr = newNode("RiftRacers", "Folder", workspaceNode)
	for _, n in { "Tracks", "Vehicles", "Projectiles", "Lobby" } do
		newNode(n, "Folder", rr)
	end
	return game
end

function RobloxEnv.Game(): any
	if game == nil then
		RobloxEnv.Reset()
	end
	return game
end

-- Resolve "Shared/Config/GameConfig" style paths to modules.
function RobloxEnv.Load(path: string): any
	local g = RobloxEnv.Game()
	local node: any
	local parts = string.split(path, "/")
	local rootName = parts[1]
	if rootName == "Shared" then
		node = g.ReplicatedStorage.Shared
	elseif rootName == "Server" then
		node = g.ServerScriptService.Server
	elseif rootName == "Client" then
		node = g.StarterPlayer.StarterPlayerScripts.Client
	elseif rootName == "Content" then
		node = g.ServerStorage.Content
	else
		error("unknown root " .. rootName)
	end
	for i = 2, #parts do
		node = node:FindFirstChild(parts[i]) or error("missing module " .. path .. " at " .. parts[i])
	end
	return RobloxEnv.Require(node)
end

function RobloxEnv.NewNode(name: string, className: string, parent: any?): any
	return newNode(name, className, parent)
end

function RobloxEnv.AdvanceClock(seconds: number)
	clockOffset += seconds
end

function RobloxEnv.Roblox(): any
	return roblox
end

return RobloxEnv
