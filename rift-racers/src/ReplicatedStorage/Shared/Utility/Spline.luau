--!strict
-- Catmull-Rom spline with arc-length parameterisation. Used for track roads, progress tracking, bot paths and minimaps.
-- Pure Luau: works in Roblox and in Lune tests (Vector3 comes from the environment).

export type Sample = { Pos: Vector3, Tangent: Vector3, Right: Vector3, Up: Vector3, Dist: number, Index: number }

export type Spline = {
	Length: number,
	Closed: boolean,
	Samples: { Sample },
	SampleAt: (self: Spline, dist: number) -> (Vector3, Vector3, Vector3, Vector3),
	PositionAt: (self: Spline, dist: number) -> Vector3,
	CFrameAt: (self: Spline, dist: number, lateral: number?, height: number?) -> CFrame,
	ClosestProgress: (self: Spline, position: Vector3, hint: number?, window: number?) -> (number, number, number),
	FractionToDistance: (self: Spline, t: number) -> number,
	DistanceToFraction: (self: Spline, dist: number) -> number,
	Wrap: (self: Spline, dist: number) -> number,
	Delta: (self: Spline, from: number, to: number) -> number,
	Curvature: (self: Spline, dist: number) -> number,
}

local Spline = {}
Spline.__index = Spline

local WORLD_UP = Vector3.new(0, 1, 0)

local function catmull(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3
	local t2, t3 = t * t, t * t * t
	return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
end

local function frameFor(tangent: Vector3): (Vector3, Vector3, Vector3)
	local t = if tangent.Magnitude > 1e-6 then tangent.Unit else Vector3.new(0, 0, -1)
	local right = t:Cross(WORLD_UP)
	if right.Magnitude < 1e-4 then
		right = Vector3.new(1, 0, 0)
	else
		right = right.Unit
	end
	local up = right:Cross(t).Unit
	return t, right, up
end

function Spline.new(controlPoints: { Vector3 }, scale: number?, closed: boolean?, samplesPerSegment: number?): Spline
	assert(#controlPoints >= 3, "spline needs at least 3 control points")
	local s = scale or 1
	local isClosed = if closed == nil then true else closed
	local per = samplesPerSegment or 16
	local pts = table.create(#controlPoints)
	for i, p in controlPoints do
		pts[i] = p * s
	end
	local n = #pts
	local segCount = if isClosed then n else n - 1

	local function pt(i: number): Vector3
		if isClosed then
			return pts[((i - 1) % n) + 1]
		end
		return pts[math.clamp(i, 1, n)]
	end

	local samples: { Sample } = {}
	local dist = 0
	local last: Vector3? = nil
	local idx = 0
	for seg = 1, segCount do
		local p0, p1, p2, p3 = pt(seg - 1), pt(seg), pt(seg + 1), pt(seg + 2)
		local steps = per
		local lastStep = if (not isClosed) and seg == segCount then steps else steps - 1
		for k = 0, lastStep do
			local t = k / steps
			local pos = catmull(p0, p1, p2, p3, t)
			local tangent = catmull(p0, p1, p2, p3, math.min(t + 1 / steps, 1)) - catmull(p0, p1, p2, p3, math.max(t - 1 / steps, 0))
			if last then
				dist += (pos - (last :: Vector3)).Magnitude
			end
			local tan, right, up = frameFor(tangent)
			idx += 1
			samples[idx] = { Pos = pos, Tangent = tan, Right = right, Up = up, Dist = dist, Index = idx }
			last = pos
		end
	end
	local total = dist
	if isClosed and last then
		total = dist + ((last :: Vector3) - samples[1].Pos).Magnitude
	end
	local self = setmetatable({ Length = total, Closed = isClosed, Samples = samples, _count = #samples }, Spline)
	return (self :: any) :: Spline
end

function Spline.Wrap(self: any, d: number): number
	if self.Closed then
		return d - math.floor(d / self.Length) * self.Length
	end
	return math.clamp(d, 0, self.Length)
end

-- Signed shortest delta along a closed loop (open splines: plain difference).
function Spline.Delta(self: any, from: number, to: number): number
	if not self.Closed then
		return to - from
	end
	local d = Spline.Wrap(self, to - from)
	if d > self.Length / 2 then
		d -= self.Length
	end
	return d
end

-- Binary search for the sample index whose Dist <= d.
local function findIndex(self: any, d: number): number
	local samples: { Sample } = self.Samples
	local lo, hi = 1, self._count
	while lo < hi do
		local mid = (lo + hi + 1) // 2
		if samples[mid].Dist <= d then
			lo = mid
		else
			hi = mid - 1
		end
	end
	return lo
end

function Spline.SampleAt(self: any, dist: number): (Vector3, Vector3, Vector3, Vector3)
	local d = Spline.Wrap(self, dist)
	local samples: { Sample } = self.Samples
	local i = findIndex(self, d)
	local a = samples[i]
	local b = samples[i + 1]
	local segLen: number
	if b == nil then
		if self.Closed then
			b = samples[1]
			segLen = self.Length - a.Dist
		else
			return a.Pos, a.Tangent, a.Right, a.Up
		end
	else
		segLen = b.Dist - a.Dist
	end
	local t = if segLen > 1e-6 then math.clamp((d - a.Dist) / segLen, 0, 1) else 0
	local pos = a.Pos:Lerp(b.Pos, t)
	local tan, right, up = frameFor(a.Tangent:Lerp(b.Tangent, t))
	return pos, tan, right, up
end

function Spline.PositionAt(self: any, dist: number): Vector3
	local p = Spline.SampleAt(self, dist)
	return p
end

function Spline.CFrameAt(self: any, dist: number, lateral: number?, height: number?): CFrame
	local pos, tan, right, up = Spline.SampleAt(self, dist)
	local p = pos + right * (lateral or 0) + up * (height or 0)
	return CFrame.lookAt(p, p + tan, up)
end

-- Returns (progressDistance, lateralOffset, distanceFromPath). `hint` limits the search to a window of samples
-- around the previous progress so crossings/overlaps resolve to the locally correct segment.
function Spline.ClosestProgress(self: any, position: Vector3, hint: number?, window: number?): (number, number, number)
	local samples: { Sample } = self.Samples
	local count: number = self._count
	local bestI, bestD2 = 1, math.huge
	local startI, endI = 1, count
	if hint ~= nil then
		local hi = findIndex(self, Spline.Wrap(self, hint))
		local w = window or 24
		startI, endI = hi - w, hi + w
	end
	for k = startI, endI do
		local i = k
		if self.Closed then
			i = ((k - 1) % count) + 1
		elseif i < 1 or i > count then
			continue
		end
		local d2 = (samples[i].Pos - position).Magnitude
		if d2 < bestD2 then
			bestD2 = d2
			bestI = i
		end
	end
	-- Refine by projecting onto the segment before/after the best sample.
	local a = samples[bestI]
	local candidates = { bestI - 1, bestI }
	local bestDist, bestLat, bestOff = a.Dist, 0, bestD2
	for _, si in candidates do
		local i0 = si
		if self.Closed then
			i0 = ((si - 1) % count) + 1
		elseif i0 < 1 or i0 >= count then
			continue
		end
		local s0 = samples[i0]
		local s1 = samples[i0 + 1] or samples[1]
		local seg = s1.Pos - s0.Pos
		local segLen = seg.Magnitude
		if segLen < 1e-6 then
			continue
		end
		local t = math.clamp((position - s0.Pos):Dot(seg) / (segLen * segLen), 0, 1)
		local proj = s0.Pos + seg * t
		local off = (position - proj).Magnitude
		if off <= bestOff + 1e-6 then
			bestOff = off
			local segDist = if s1 == samples[1] and self.Closed then self.Length - s0.Dist else s1.Dist - s0.Dist
			bestDist = s0.Dist + segDist * t
			local right = s0.Right:Lerp(s1.Right, t)
			bestLat = (position - proj):Dot(right)
		end
	end
	return Spline.Wrap(self, bestDist), bestLat, bestOff
end

function Spline.FractionToDistance(self: any, t: number): number
	return Spline.Wrap(self, t * self.Length)
end

function Spline.DistanceToFraction(self: any, dist: number): number
	return Spline.Wrap(self, dist) / self.Length
end

-- Approximate curvature (rad per stud) at a distance; used by bots to brake before corners.
function Spline.Curvature(self: any, dist: number): number
	local step = 12
	local _, t0 = Spline.SampleAt(self, dist - step)
	local _, t1 = Spline.SampleAt(self, dist + step)
	local dot = math.clamp(t0:Dot(t1), -1, 1)
	return math.acos(dot) / (2 * step)
end

return Spline
