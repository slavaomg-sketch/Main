--!strict
-- Ordered checkpoint / lap logic. Pure functions over RacerProgress so it is unit-testable and exploit-testable.
-- Rules enforced here: ordered mandatory checkpoints, no backwards lap credit, no teleport jumps, minimum sector time.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local RaceTypes = require(Shared.Types.RaceTypes)
local MathUtil = require(Shared.Utility.MathUtil)
local GameConfig = require(Shared.Config.GameConfig)

type RacerProgress = RaceTypes.RacerProgress

export type CheckpointEvent = {
	Kind: "Checkpoint"
		| "Lap"
		| "Finish"
		| "WrongWay"
		| "Teleport"
		| "ImpossibleSector"
		| "InvalidFinishCross"
		| "Backtrack",
	Index: number?,
	Value: number?,
}

export type TrackShape = {
	Length: number,
	CheckpointCount: number,
	CheckpointDists: { number },
	MinSectorTime: number,
	Laps: number,
}

local CheckpointSystem = {}

function CheckpointSystem.NewProgress(now: number, startProgress: number?): RacerProgress
	local p = startProgress or 0
	return {
		Lap = 0,
		Checkpoint = 0,
		Progress = p,
		SegmentFraction = 0,
		DistanceToNext = 0,
		Direction = 0,
		WrongWaySince = nil,
		LastCheckpointAt = now,
		LapStartedAt = now,
		SectorTimes = {},
		FinishedAt = nil,
		FinishPosition = nil,
		TotalDistance = 0,
		LastSafeProgress = p,
		LapTimes = {},
		BestLap = nil,
		Eliminated = false,
		KnockoutStage = 0,
	}
end

-- Effective progress used for ranking: laps + progress, capped at the next mandatory checkpoint so cutting the
-- course never ranks a racer ahead of where their last valid checkpoint allows.
function CheckpointSystem.EffectiveProgress(p: RacerProgress, shape: TrackShape): number
	local nextIdx = p.Checkpoint + 1
	local cap = shape.CheckpointDists[nextIdx] or shape.Length
	local prog = math.min(p.Progress, cap)
	-- Just after crossing the finish, progress is near 0 with Lap incremented: fine.
	return p.Lap * shape.Length + prog
end

-- Returns which checkpoint indices (1..N) lie strictly between a and b moving forward along the loop.
local function crossedForward(a: number, b: number, dists: { number }, length: number): { number }
	local out = {}
	local d = MathUtil.Wrap(b - a, length)
	for i, cd in dists do
		local rel = MathUtil.Wrap(cd - a, length)
		-- Finish line (dist == length) sits at 0 for wrapping purposes.
		if cd >= length then
			rel = MathUtil.Wrap(0 - a, length)
			if rel == 0 then
				rel = length
			end
		end
		if rel > 0 and rel <= d then
			table.insert(out, i)
		end
	end
	table.sort(out, function(x, y)
		local rx = MathUtil.Wrap((if dists[x] >= length then 0 else dists[x]) - a, length)
		local ry = MathUtil.Wrap((if dists[y] >= length then 0 else dists[y]) - a, length)
		return rx < ry
	end)
	return out
end

function CheckpointSystem.Update(
	p: RacerProgress,
	newProgress: number,
	now: number,
	shape: TrackShape,
	dt: number
): { CheckpointEvent }
	local events: { CheckpointEvent } = {}
	if p.FinishedAt ~= nil then
		p.Progress = newProgress
		return events
	end
	local length = shape.Length
	local delta = MathUtil.LoopDelta(p.Progress, newProgress, length)
	local maxJump = math.max(
		GameConfig.Security.TeleportDistancePerSecond * math.max(dt, 1 / 60),
		length / shape.CheckpointCount * 0.9
	)
	if math.abs(delta) > maxJump then
		table.insert(events, { Kind = "Teleport", Value = delta })
		return events
	end

	if delta > 0.05 then
		p.Direction = 1
		p.WrongWaySince = nil
		local n = shape.CheckpointCount
		for _, idx in crossedForward(p.Progress, newProgress, shape.CheckpointDists, length) do
			if idx == n then
				-- Finish line
				if p.Checkpoint == n - 1 then
					local lapTime = now - p.LapStartedAt
					local sector = now - p.LastCheckpointAt
					if sector < shape.MinSectorTime then
						table.insert(events, { Kind = "ImpossibleSector", Index = idx, Value = sector })
					else
						p.Lap += 1
						p.Checkpoint = 0
						table.insert(p.LapTimes, lapTime)
						p.BestLap = if p.BestLap == nil then lapTime else math.min(p.BestLap :: number, lapTime)
						table.insert(p.SectorTimes, sector)
						p.LapStartedAt = now
						p.LastCheckpointAt = now
						p.LastSafeProgress = 0
						if p.Lap >= shape.Laps then
							p.FinishedAt = now
							table.insert(events, { Kind = "Finish", Value = now })
						else
							table.insert(events, { Kind = "Lap", Index = p.Lap })
						end
					end
				else
					table.insert(events, { Kind = "InvalidFinishCross", Index = p.Checkpoint })
				end
			elseif idx == p.Checkpoint + 1 then
				local sector = now - p.LastCheckpointAt
				if sector < shape.MinSectorTime then
					table.insert(events, { Kind = "ImpossibleSector", Index = idx, Value = sector })
				else
					p.Checkpoint = idx
					p.LastCheckpointAt = now
					p.LastSafeProgress = shape.CheckpointDists[idx]
					table.insert(p.SectorTimes, sector)
					table.insert(events, { Kind = "Checkpoint", Index = idx })
				end
			elseif idx > p.Checkpoint + 1 then
				-- Skipped a mandatory checkpoint: no credit (effective progress stays capped).
			end
		end
		p.TotalDistance += delta
	elseif delta < -0.05 then
		p.Direction = -1
		if p.WrongWaySince == nil then
			p.WrongWaySince = now
		elseif now - (p.WrongWaySince :: number) >= GameConfig.Race.WrongWaySeconds then
			table.insert(events, { Kind = "WrongWay" })
		end
		-- Un-credit checkpoints crossed backwards so they must be re-crossed forwards.
		for _, idx in crossedForward(newProgress, p.Progress, shape.CheckpointDists, length) do
			if idx == shape.CheckpointCount then
				if p.Checkpoint == 0 and p.Lap > 0 then
					p.Lap -= 1
					p.Checkpoint = shape.CheckpointCount - 1
					table.remove(p.LapTimes)
					table.insert(events, { Kind = "Backtrack", Index = idx })
				end
			elseif idx == p.Checkpoint then
				p.Checkpoint -= 1
				table.insert(events, { Kind = "Backtrack", Index = idx })
			end
		end
	else
		p.Direction = 0
	end
	p.Progress = newProgress
	local nextIdx = p.Checkpoint + 1
	local nextDist = shape.CheckpointDists[nextIdx] or length
	if nextDist >= length then
		nextDist = 0
	end
	p.DistanceToNext = MathUtil.Wrap(nextDist - newProgress, length)
	local sectorLen = length / shape.CheckpointCount
	p.SegmentFraction = 1 - math.clamp(p.DistanceToNext / sectorLen, 0, 1)
	return events
end

return table.freeze(CheckpointSystem)
