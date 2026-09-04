--!strict
-- Default hooks shared by all modes. Specific modes override what they need.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local RaceTypes = require(Shared.Types.RaceTypes)
local PlacementSystem = require(script.Parent.Parent.Systems.PlacementSystem)

local BaseMode = {}
BaseMode.__index = BaseMode

function BaseMode.new(id: string): any
	return setmetatable({ Id = id, Def = ModeDefinitions.ById[id] }, BaseMode)
end

-- Called after karts are placed on the grid.
function BaseMode.OnGrid(self: any, session: any) end
function BaseMode.OnRaceStart(self: any, session: any, now: number) end
-- Per tick during Racing/FinishWindow.
function BaseMode.OnTick(self: any, session: any, now: number, dt: number) end
function BaseMode.OnRacerFinished(self: any, session: any, key: string, now: number) end
function BaseMode.OnHit(self: any, session: any, attackerKey: string?, targetKey: string, level: number, now: number) end
function BaseMode.OnShardPickup(self: any, session: any, key: string, now: number) end

-- Whether the race should move to Results now.
function BaseMode.IsOver(self: any, session: any, now: number): boolean
	local anyActive = false
	for _, key in session.Order do
		local r = session.Racers[key]
		if r.Connected and r.Progress.FinishedAt == nil and not r.Progress.Eliminated then
			anyActive = true
		end
	end
	return not anyActive
end

-- Ranking for standard races.
function BaseMode.Rank(self: any, session: any): { string }
	local entries = {}
	for _, key in session.Order do
		table.insert(entries, { Key = key, Progress = session.Racers[key].Progress })
	end
	local ranked = PlacementSystem.Rank(entries, session.Shape)
	local out = {}
	for _, e in ranked do
		table.insert(out, e.Key)
	end
	return out
end

function BaseMode.BuildResults(self: any, session: any): RaceTypes.RaceResults
	local ranked = self:Rank(session)
	local records: { RaceTypes.FinishRecord } = {}
	local teamScores: { [number]: number }? = if session.Rules.Teams > 0 then {} else nil
	for i, key in ranked do
		local r = session.Racers[key]
		local p = r.Progress
		local finished = p.FinishedAt ~= nil
		local rec: RaceTypes.FinishRecord = {
			Key = key,
			Position = i,
			TimeSeconds = if finished then (p.FinishedAt :: number) - session.RaceStartedAt else nil,
			BestLap = p.BestLap,
			Finished = finished,
			Team = r.Team,
			Points = ModeDefinitions.GrandTourPoints[i] or 0,
			Shards = r.Shards,
			Eliminated = p.Eliminated,
			StageReached = p.KnockoutStage,
			Score = r.Score,
		}
		table.insert(records, rec)
		if teamScores then
			teamScores[r.Team] = (teamScores[r.Team] or 0) + rec.Points
		end
	end
	return { RaceId = session.RaceId, TrackId = session.VenueId, ModeId = session.ModeId, Records = records, TeamScores = teamScores, WinnerKey = ranked[1] }
end

-- What happens after rewards: "NextRace" (same session continues), "Lobby".
function BaseMode.NextAction(self: any, session: any): "NextRace" | "Lobby"
	if session.RaceIndex < self.Def.RacesPerSession then
		return "NextRace"
	end
	return "Lobby"
end

-- Team assignment (balanced round-robin, parties kept together by caller ordering).
function BaseMode.AssignTeams(self: any, session: any, teams: number)
	if teams <= 0 then
		return
	end
	for i, key in session.Order do
		local team = ((i - 1) % teams) + 1
		session.Racers[key].Team = team
		session.Racers[key].Identity.Team = team
	end
end

return BaseMode
