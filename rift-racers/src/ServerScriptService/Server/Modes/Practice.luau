--!strict
-- Free driving on the practice loop; never ends by itself, no rewards.
local BaseMode = require(script.Parent.BaseMode)
local Practice = setmetatable({}, { __index = BaseMode })
Practice.__index = Practice
function Practice.new()
	return setmetatable(BaseMode.new("Practice"), Practice)
end
function Practice.IsOver(self: any, session: any, now: number): boolean
	return session:HumanCount() == 0
end
function Practice.NextAction(self: any, session: any): "NextRace" | "Lobby"
	return "Lobby"
end
return Practice
