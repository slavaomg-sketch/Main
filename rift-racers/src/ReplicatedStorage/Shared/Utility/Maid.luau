--!strict
-- Tracks connections, instances, threads and callbacks so every system can clean up deterministically.
export type Task =
	RBXScriptConnection
	| Instance
	| thread
	| (() -> ())
	| { Destroy: (any) -> () }
	| { Disconnect: (any) -> () }
export type Maid = {
	Give: (self: Maid, task: any) -> any,
	GiveKey: (self: Maid, key: string, task: any) -> (),
	Clean: (self: Maid, key: string) -> (),
	Destroy: (self: Maid) -> (),
}

local Maid = {}
Maid.__index = Maid

function Maid.new(): Maid
	return (setmetatable({ _tasks = {} :: { [any]: any }, _n = 0 }, Maid) :: any) :: Maid
end

local function cleanTask(t: any)
	local tt = typeof(t)
	if tt == "function" then
		t()
	elseif tt == "RBXScriptConnection" then
		t:Disconnect()
	elseif tt == "Instance" then
		t:Destroy()
	elseif tt == "thread" then
		pcall(task.cancel, t)
	elseif tt == "table" then
		if type(t.Destroy) == "function" then
			t:Destroy()
		elseif type(t.Disconnect) == "function" then
			t:Disconnect()
		end
	end
end

function Maid.Give(self: any, t: any): any
	if t == nil then
		return nil
	end
	self._n += 1
	self._tasks[self._n] = t
	return t
end

function Maid.GiveKey(self: any, key: string, t: any)
	local old = self._tasks[key]
	if old ~= nil then
		cleanTask(old)
	end
	self._tasks[key] = t
end

function Maid.Clean(self: any, key: string)
	local old = self._tasks[key]
	if old ~= nil then
		self._tasks[key] = nil
		cleanTask(old)
	end
end

function Maid.Destroy(self: any)
	local tasks = self._tasks
	self._tasks = {}
	for _, t in tasks do
		cleanTask(t)
	end
end

return Maid
