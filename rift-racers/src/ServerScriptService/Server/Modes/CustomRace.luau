--!strict
-- Private room; every rule is validated server-side in LobbyService before reaching here.
local BaseMode = require(script.Parent.BaseMode)
local CustomRace = setmetatable({}, { __index = BaseMode })
CustomRace.__index = CustomRace
function CustomRace.new()
	return setmetatable(BaseMode.new("CustomRace"), CustomRace)
end
function CustomRace.OnGrid(self: any, session: any)
	if session.Rules.Teams > 0 then
		self:AssignTeams(session, session.Rules.Teams)
	end
end
return CustomRace
