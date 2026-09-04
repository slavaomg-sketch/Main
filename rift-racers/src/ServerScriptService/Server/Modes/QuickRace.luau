--!strict
local BaseMode = require(script.Parent.BaseMode)
local QuickRace = setmetatable({}, { __index = BaseMode })
QuickRace.__index = QuickRace
function QuickRace.new()
	return setmetatable(BaseMode.new("QuickRace"), QuickRace)
end
return QuickRace
