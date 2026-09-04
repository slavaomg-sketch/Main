--!strict
local MathUtil = {}

function MathUtil.IsFinite(n: any): boolean
	return type(n) == "number" and n == n and n ~= math.huge and n ~= -math.huge
end

function MathUtil.IsFiniteVector(v: any): boolean
	return typeof(v) == "Vector3" and MathUtil.IsFinite(v.X) and MathUtil.IsFinite(v.Y) and MathUtil.IsFinite(v.Z)
end

function MathUtil.Lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

function MathUtil.InverseLerp(a: number, b: number, v: number): number
	if a == b then
		return 0
	end
	return math.clamp((v - a) / (b - a), 0, 1)
end

function MathUtil.Remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number
	return MathUtil.Lerp(outMin, outMax, MathUtil.InverseLerp(inMin, inMax, v))
end

-- Frame-rate independent exponential smoothing.
function MathUtil.Damp(current: number, target: number, smoothing: number, dt: number): number
	return MathUtil.Lerp(current, target, 1 - math.exp(-smoothing * dt))
end

function MathUtil.DampVector(current: Vector3, target: Vector3, smoothing: number, dt: number): Vector3
	return current:Lerp(target, 1 - math.exp(-smoothing * dt))
end

function MathUtil.Sign(n: number): number
	if n > 0 then
		return 1
	elseif n < 0 then
		return -1
	end
	return 0
end

function MathUtil.MoveToward(current: number, target: number, maxDelta: number): number
	if math.abs(target - current) <= maxDelta then
		return target
	end
	return current + MathUtil.Sign(target - current) * maxDelta
end

-- Wraps a value into [0, length).
function MathUtil.Wrap(v: number, length: number): number
	if length <= 0 then
		return 0
	end
	return v - math.floor(v / length) * length
end

-- Shortest signed distance from a to b on a loop of the given length, in (-length/2, length/2].
function MathUtil.LoopDelta(a: number, b: number, length: number): number
	local d = MathUtil.Wrap(b - a, length)
	if d > length / 2 then
		d -= length
	end
	return d
end

function MathUtil.AngleBetween(a: Vector3, b: Vector3): number
	local ma, mb = a.Magnitude, b.Magnitude
	if ma < 1e-6 or mb < 1e-6 then
		return 0
	end
	return math.acos(math.clamp(a:Dot(b) / (ma * mb), -1, 1))
end

function MathUtil.FlatVector(v: Vector3): Vector3
	return Vector3.new(v.X, 0, v.Z)
end

function MathUtil.Round(n: number, decimals: number?): number
	local m = 10 ^ (decimals or 0)
	return math.floor(n * m + 0.5) / m
end

-- Deterministic seeded RNG helper for tests (Random is available in both Roblox and Lune).
function MathUtil.WeightedPick<T>(rng: Random, entries: { T }, weightOf: (T) -> number): T?
	local total = 0
	for _, e in entries do
		total += math.max(0, weightOf(e))
	end
	if total <= 0 then
		return nil
	end
	local roll = rng:NextNumber() * total
	local acc = 0
	for _, e in entries do
		acc += math.max(0, weightOf(e))
		if roll <= acc then
			return e
		end
	end
	return entries[#entries]
end

return table.freeze(MathUtil)
