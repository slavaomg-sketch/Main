--!strict
-- Original Track Assist: softer steering, edge guidance away from walls, auto-flip. Never drives for the player,
-- never raises top speed, never affects other players.
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local MathUtil = require(Shared.Utility.MathUtil)

local TrackAssist = {}

-- Reduces steering authority slightly at high speed so novices don't over-rotate.
function TrackAssist.SoftenSteer(steer: number, speedFraction: number): number
	local soften = MathUtil.Lerp(1, 0.8, math.clamp(speedFraction, 0, 1))
	return steer * soften
end

-- Sideways raycasts: if a wall is within ~4 studs, push gently away (bounded force).
function TrackAssist.EdgeGuide(chassis: BasePart, params: RaycastParams, right: Vector3, mass: number): Vector3
	local origin = chassis.Position
	local push = Vector3.new()
	local dist = 5
	local r = Workspace:Raycast(origin, right * dist, params)
	if r and r.Instance:HasTag("Wall") then
		push -= right * (1 - r.Distance / dist)
	end
	local l = Workspace:Raycast(origin, -right * dist, params)
	if l and l.Instance:HasTag("Wall") then
		push += right * (1 - l.Distance / dist)
	end
	return push * mass * 6
end

-- Recommended line hint for the tutorial/HUD: lateral offset of the ideal line at a progress (inside of corners).
function TrackAssist.IdealLateral(spline: any, progress: number, width: number): number
	local c0 = spline:Curvature(progress + 30)
	local _, t0, right0 = spline:SampleAt(progress)
	local _, t1 = spline:SampleAt(progress + 40)
	local turn = right0:Dot(t1 - t0)
	if math.abs(c0) < 0.004 then
		return 0
	end
	return MathUtil.Sign(turn) * width * 0.25
end

return TrackAssist
