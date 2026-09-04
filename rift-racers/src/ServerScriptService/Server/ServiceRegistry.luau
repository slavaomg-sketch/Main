--!strict
-- Explicit service lifecycle (Init -> Start -> Destroy) with dependency access by name. No globals.
export type Service = {
	Name: string,
	Init: ((self: any, registry: ServiceRegistry) -> ())?,
	Start: ((self: any) -> ())?,
	Destroy: ((self: any) -> ())?,
}
export type ServiceRegistry = {
	Add: (self: ServiceRegistry, service: Service) -> (),
	Get: (self: ServiceRegistry, name: string) -> any,
	InitAll: (self: ServiceRegistry) -> (),
	StartAll: (self: ServiceRegistry) -> (),
	DestroyAll: (self: ServiceRegistry) -> (),
	Set: (self: ServiceRegistry, name: string, value: any) -> (),
}

local ServiceRegistry = {}
ServiceRegistry.__index = ServiceRegistry

function ServiceRegistry.new(): ServiceRegistry
	return (
		setmetatable({ _order = {} :: { Service }, _byName = {} :: { [string]: any } }, ServiceRegistry) :: any
	) :: ServiceRegistry
end

function ServiceRegistry.Add(self: any, service: Service)
	assert(self._byName[service.Name] == nil, "duplicate service " .. service.Name)
	self._byName[service.Name] = service
	table.insert(self._order, service)
end

function ServiceRegistry.Set(self: any, name: string, value: any)
	self._byName[name] = value
end

function ServiceRegistry.Get(self: any, name: string): any
	local s = self._byName[name]
	assert(s ~= nil, "unknown service " .. name)
	return s
end

function ServiceRegistry.InitAll(self: any)
	for _, s in self._order do
		if s.Init then
			s:Init(self)
		end
	end
end

function ServiceRegistry.StartAll(self: any)
	for _, s in self._order do
		if s.Start then
			s:Start()
		end
	end
end

function ServiceRegistry.DestroyAll(self: any)
	for i = #self._order, 1, -1 do
		local s = self._order[i]
		if s.Destroy then
			pcall(s.Destroy, s)
		end
	end
end

return ServiceRegistry
