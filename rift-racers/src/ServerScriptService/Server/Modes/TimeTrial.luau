--!strict
-- Solo, no items, no collisions, ghost of your own best run.
local BaseMode = require(script.Parent.BaseMode)
local TimeTrial = setmetatable({}, { __index = BaseMode })
TimeTrial.__index = TimeTrial
function TimeTrial.new()
	return setmetatable(BaseMode.new("TimeTrial"), TimeTrial)
end
function TimeTrial.NextAction(self: any, session: any): "NextRace" | "Lobby"
	return "Lobby"
end
return TimeTrial
