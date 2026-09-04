--!strict
-- Knockout Circuit: at each gate the last N racers are eliminated; survivors keep racing without a loading screen.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local BaseMode = require(script.Parent.BaseMode)

local Knockout = setmetatable({}, { __index = BaseMode })
Knockout.__index = Knockout

function Knockout.new()
	return setmetatable(BaseMode.new("Knockout"), Knockout)
end

-- How many racers are cut at a stage for a given active count.
function Knockout.EliminationCount(active: number, stagesLeft: number): number
	if active <= 2 then
		return 0
	end
	local n = math.max(1, math.floor(active * ModeDefinitions.KnockoutEliminationFraction + 0.5))
	-- Never cut below 2 survivors, and leave at least one for the finale.
	return math.min(n, active - math.max(2, stagesLeft))
end

function Knockout.OnRaceStart(self: any, session: any, now: number)
	session.KnockoutStage = 0
	for _, key in session.Order do
		session.Racers[key].Progress.KnockoutStage = 0
	end
end

-- Gates are progress thresholds on the last lap-equivalent distance; the stage count comes from the rules.
function Knockout.OnTick(self: any, session: any, now: number, dt: number)
	local stages = session.Rules.KnockoutStages
	if stages <= 0 or session.KnockoutStage >= stages then
		return
	end
	-- Stage k gate = end of lap k (laps == stages + 1 by design in ModeDefinitions: DefaultLaps 4 -> 3 gates).
	local gateLap = session.KnockoutStage + 1
	local reached = 0
	local active = 0
	for _, key in session.Order do
		local r = session.Racers[key]
		if r.Connected and not r.Progress.Eliminated then
			active += 1
			if r.Progress.Lap >= gateLap then
				reached += 1
			end
		end
	end
	local stagesLeft = stages - session.KnockoutStage
	local cut = Knockout.EliminationCount(active, stagesLeft)
	if cut <= 0 then
		session.KnockoutStage += 1
		return
	end
	-- Resolve the stage once enough racers have passed the gate to leave exactly `cut` behind.
	if reached >= active - cut then
		local ranked = self:Rank(session)
		local survivors = 0
		for _, key in ranked do
			local r = session.Racers[key]
			if r.Connected and not r.Progress.Eliminated then
				survivors += 1
				if survivors > active - cut then
					r.Progress.Eliminated = true
					r.Progress.KnockoutStage = session.KnockoutStage
					r.State = "Spectating"
					session:SendTo(key, "RaceEvent", "Eliminated", { Stage = session.KnockoutStage + 1 })
				else
					r.Progress.KnockoutStage = session.KnockoutStage + 1
				end
			end
		end
		session.KnockoutStage += 1
		session:Broadcast("RaceEvent", "KnockoutStage", { Stage = session.KnockoutStage, Stages = stages, Cut = cut })
	end
end

-- Broadcast the current safe position so players can see the cut line.
function Knockout.SafePosition(session: any): number
	local active = 0
	for _, key in session.Order do
		local r = session.Racers[key]
		if r.Connected and not r.Progress.Eliminated then
			active += 1
		end
	end
	local stagesLeft = session.Rules.KnockoutStages - session.KnockoutStage
	return active - Knockout.EliminationCount(active, stagesLeft)
end

return Knockout
