--!strict
-- Battle: collect shards; hits make you drop some; most shards (or team total) at the buzzer wins.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local RaceTypes = require(Shared.Types.RaceTypes)
local BaseMode = require(script.Parent.BaseMode)

local ShardRush = setmetatable({}, { __index = BaseMode })
ShardRush.__index = ShardRush

function ShardRush.new()
	return setmetatable(BaseMode.new("ShardRush"), ShardRush)
end

function ShardRush.OnGrid(self: any, session: any)
	if session.Rules.Teams > 0 then
		self:AssignTeams(session, session.Rules.Teams)
	end
end

function ShardRush.OnTick(self: any, session: any, now: number, dt: number)
	local scores: { [number]: number } = {}
	for _, key in session.Order do
		local r = session.Racers[key]
		r.Score = r.Shards
		if r.Team > 0 then
			scores[r.Team] = (scores[r.Team] or 0) + r.Shards
		end
	end
	session.TeamScores = scores
end

function ShardRush.IsOver(self: any, session: any, now: number): boolean
	return now >= session.BattleEndsAt
end

function ShardRush.Rank(self: any, session: any): { string }
	local keys: { string } = table.clone(session.Order)
	table.sort(keys, function(a, b)
		local ra, rb = session.Racers[a], session.Racers[b]
		if ra.Shards ~= rb.Shards then
			return ra.Shards > rb.Shards
		end
		return a < b
	end)
	return keys
end

function ShardRush.BuildResults(self: any, session: any): RaceTypes.RaceResults
	local results = BaseMode.BuildResults(self, session)
	for _, rec in results.Records do
		rec.Finished = true
		rec.TimeSeconds = nil
		rec.Score = session.Racers[rec.Key].Shards
	end
	return results
end

return ShardRush
