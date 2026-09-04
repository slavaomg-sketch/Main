--!strict
-- Minimal, allocation-light signal with proper disconnect semantics (works in Roblox and Lune).

export type Connection = { Connected: boolean, Disconnect: (self: Connection) -> () }
export type Signal<T...> = {
	Connect: (self: Signal<T...>, fn: (T...) -> ()) -> Connection,
	Once: (self: Signal<T...>, fn: (T...) -> ()) -> Connection,
	Fire: (self: Signal<T...>, T...) -> (),
	Wait: (self: Signal<T...>) -> T...,
	DisconnectAll: (self: Signal<T...>) -> (),
	Destroy: (self: Signal<T...>) -> (),
}

local Signal = {}
Signal.__index = Signal

type Node = { fn: (...any) -> (), Connected: boolean, Disconnect: (self: any) -> (), _signal: any }

function Signal.new<T...>(): Signal<T...>
	local self = setmetatable({ _handlers = {} :: { Node }, _destroyed = false }, Signal)
	return (self :: any) :: Signal<T...>
end

local function disconnect(node: Node)
	if not node.Connected then
		return
	end
	node.Connected = false
	local sig = node._signal
	local handlers = sig._handlers
	for i = #handlers, 1, -1 do
		if handlers[i] == node then
			table.remove(handlers, i)
			break
		end
	end
end

function Signal.Connect(self: any, fn: (...any) -> ()): Connection
	assert(not self._destroyed, "Signal destroyed")
	local node: Node = { fn = fn, Connected = true, Disconnect = disconnect, _signal = self }
	table.insert(self._handlers, node)
	return node
end

function Signal.Once(self: any, fn: (...any) -> ()): Connection
	local conn: Connection
	conn = Signal.Connect(self, function(...)
		conn:Disconnect()
		fn(...)
	end)
	return conn
end

function Signal.Fire(self: any, ...: any)
	local handlers: { Node } = self._handlers
	if #handlers == 0 then
		return
	end
	local snapshot: { Node } = table.clone(handlers)
	for _, node in snapshot do
		if node.Connected then
			task.spawn(node.fn, ...)
		end
	end
end

function Signal.Wait(self: any): ...any
	local thread = coroutine.running()
	Signal.Once(self, function(...)
		task.spawn(thread, ...)
	end)
	return coroutine.yield()
end

function Signal.DisconnectAll(self: any)
	for _, node in self._handlers do
		node.Connected = false
	end
	table.clear(self._handlers)
end

function Signal.Destroy(self: any)
	Signal.DisconnectAll(self)
	self._destroyed = true
end

return Signal
