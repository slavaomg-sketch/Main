--!strict
-- Server-authoritative ranking. Order: finished (by finish position) > laps/checkpoints (effective progress)
-- > distance to next checkpoint > earlier checkpoint timestamp.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local RaceTypes = require(Shared.Types.RaceTypes)
local CheckpointSystem = require(script.Parent.CheckpointSystem)

type RacerProgress = RaceTypes.RacerProgress

export type Ranked = { Key: string, Progress: RacerProgress }

local PlacementSystem = {}

function PlacementSystem.Rank(entries: { Ranked }, shape: CheckpointSystem.TrackShape): { Ranked }
	local list = table.clone(entries)
	local eff: { [string]: number } = {}
	for _, e in list do
		eff[e.Key] = CheckpointSystem.EffectiveProgress(e.Progress, shape)
	end
	table.sort(list, function(a, b)
		local pa, pb = a.Progress, b.Progress
		local fa, fb = pa.FinishedAt ~= nil, pb.FinishedAt ~= nil
		if fa ~= fb then
			return fa
		end
		if fa and fb then
			local posA, posB = pa.FinishPosition or math.huge, pb.FinishPosition or math.huge
			if posA ~= posB then
				return posA < posB
			end
			return (pa.FinishedAt :: number) < (pb.FinishedAt :: number)
		end
		if pa.Eliminated ~= pb.Eliminated then
			return not pa.Eliminated
		end
		local ea, eb = eff[a.Key], eff[b.Key]
		if math.abs(ea - eb) > 0.01 then
			return ea > eb
		end
		if pa.DistanceToNext ~= pb.DistanceToNext then
			return pa.DistanceToNext < pb.DistanceToNext
		end
		if pa.LastCheckpointAt ~= pb.LastCheckpointAt then
			return pa.LastCheckpointAt < pb.LastCheckpointAt
		end
		return a.Key < b.Key
	end)
	return list
end

-- Placement bucket used by item distribution.
function PlacementSystem.Bucket(position: number, total: number): "Front" | "Mid" | "Back" | "Last"
	if total <= 1 then
		return "Front"
	end
	if position == total then
		return "Last"
	end
	if position <= math.max(1, math.floor(total * 0.25)) then
		return "Front"
	end
	if position >= math.ceil(total * 0.67) then
		return "Back"
	end
	return "Mid"
end

return table.freeze(PlacementSystem)
