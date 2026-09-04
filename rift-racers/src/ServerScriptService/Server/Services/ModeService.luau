--!strict
-- Registry of mode rule modules.
local ModeService = { Name = "ModeService" }
ModeService.__index = ModeService

function ModeService.new()
	return setmetatable({ _modes = {} :: { [string]: any } }, ModeService)
end

function ModeService.Init(self: any, registry: any)
	local Modes = (script :: any).Parent.Parent.Modes
	for _, name in { "QuickRace", "GrandTour", "TimeTrial", "CustomRace", "Knockout", "TeamRace", "CoreClash", "ShardRush", "Practice" } do
		local module = require(Modes:FindFirstChild(name)) :: any
		self._modes[name] = module.new()
	end
end

function ModeService.Get(self: any, id: string): any
	local m = self._modes[id]
	assert(m, "unknown mode " .. id)
	return m
end

return ModeService
