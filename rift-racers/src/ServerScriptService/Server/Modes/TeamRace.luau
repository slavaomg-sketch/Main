--!strict
-- 2-4 teams; sum of member points decides.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local BaseMode = require(script.Parent.BaseMode)
local TeamRace = setmetatable({}, { __index = BaseMode })
TeamRace.__index = TeamRace
function TeamRace.new()
	return setmetatable(BaseMode.new("TeamRace"), TeamRace)
end
function TeamRace.OnGrid(self: any, session: any)
	self:AssignTeams(session, math.max(2, session.Rules.Teams))
	session.Rules.Teams = math.max(2, session.Rules.Teams)
end
function TeamRace.OnTick(self: any, session: any, now: number, dt: number)
	-- Live team score = sum of provisional points by current position.
	local scores: { [number]: number } = {}
	for _, key in session.Order do
		local r = session.Racers[key]
		scores[r.Team] = (scores[r.Team] or 0) + (ModeDefinitions.GrandTourPoints[r.Position] or 0)
	end
	session.TeamScores = scores
end
return TeamRace
