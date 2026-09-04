--!strict
-- Same lifecycle shape as the server registry: Init -> Start, dependency lookup by name, ordered Destroy.
export type Controller = {
	Name: string,
	Init: ((self: any, registry: ClientRegistry) -> ())?,
	Start: ((self: any) -> ())?,
	Destroy: ((self: any) -> ())?,
}
export type ClientRegistry = {
	Add: (self: ClientRegistry, c: Controller) -> (),
	Get: (self: ClientRegistry, name: string) -> any,
	InitAll: (self: ClientRegistry) -> (),
	StartAll: (self: ClientRegistry) -> (),
	DestroyAll: (self: ClientRegistry) -> (),
}

local ClientRegistry = {}
ClientRegistry.__index = ClientRegistry

function ClientRegistry.new(): ClientRegistry
	return (
		setmetatable({ _order = {} :: { Controller }, _byName = {} :: { [string]: any } }, ClientRegistry) :: any
	) :: ClientRegistry
end

function ClientRegistry.Add(self: any, c: Controller)
	assert(self._byName[c.Name] == nil, "duplicate controller " .. c.Name)
	self._byName[c.Name] = c
	table.insert(self._order, c)
end

function ClientRegistry.Get(self: any, name: string): any
	local c = self._byName[name]
	assert(c ~= nil, "unknown controller " .. name)
	return c
end

function ClientRegistry.InitAll(self: any)
	for _, c in self._order do
		if c.Init then
			c:Init(self)
		end
	end
end

function ClientRegistry.StartAll(self: any)
	for _, c in self._order do
		if c.Start then
			task.spawn(c.Start, c)
		end
	end
end

function ClientRegistry.DestroyAll(self: any)
	for i = #self._order, 1, -1 do
		local c = self._order[i]
		if c.Destroy then
			pcall(c.Destroy, c)
		end
	end
end

return ClientRegistry
