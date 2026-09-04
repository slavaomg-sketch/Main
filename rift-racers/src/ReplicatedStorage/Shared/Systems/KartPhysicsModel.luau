--!strict
-- Pure arcade-kart maths shared by the client controller (feel), the server (validation) and bots (planning).
-- No Instances here: everything takes numbers in and returns numbers out so it is unit-testable.
local GameConfig = require(script.Parent.Parent.Config.GameConfig)
local SurfaceDefinitions = require(script.Parent.Parent.Config.SurfaceDefinitions)
local VehicleStats = require(script.Parent.VehicleStats)
local GameTypes = require(script.Parent.Parent.Types.GameTypes)
local MathUtil = require(script.Parent.Parent.Utility.MathUtil)

type EffectiveStats = VehicleStats.EffectiveStats
type ActiveBoost = GameTypes.ActiveBoost

local P = GameConfig.Physics

local KartPhysicsModel = {}

export type StartBoostResult = "Early" | "None" | "Okay" | "Good" | "Perfect"

-- Surface -------------------------------------------------------------------------------------------------------
export type SurfaceMultipliers = { Grip: number, Acceleration: number, TopSpeed: number, Handling: number }

function KartPhysicsModel.SurfaceMultipliers(surfaceId: string, stats: EffectiveStats): SurfaceMultipliers
	local def = SurfaceDefinitions[surfaceId] or SurfaceDefinitions.Asphalt
	local grip, accel, top, handling = def.Grip, def.Acceleration, def.TopSpeed, def.Handling
	if def.OffroadForVehicles then
		-- OffroadEfficiency 1.0 fully cancels the penalty, 0 keeps it.
		local e = math.clamp(stats.OffroadEfficiency, 0, 1)
		grip = MathUtil.Lerp(grip, 1, e)
		accel = MathUtil.Lerp(accel, 1, e)
		top = MathUtil.Lerp(top, 1, e)
		handling = MathUtil.Lerp(handling, 1, e)
	end
	return { Grip = grip, Acceleration = accel, TopSpeed = top, Handling = handling }
end

-- Boosts --------------------------------------------------------------------------------------------------------
function KartPhysicsModel.ActiveBoostBonus(boosts: { ActiveBoost }, now: number): number
	local best = 0
	for _, b in boosts do
		if b.EndsAt > now then
			best = math.max(best, b.SpeedBonus)
		end
	end
	return best
end

function KartPhysicsModel.PruneBoosts(boosts: { ActiveBoost }, now: number)
	for i = #boosts, 1, -1 do
		if boosts[i].EndsAt <= now then
			table.remove(boosts, i)
		end
	end
end

function KartPhysicsModel.ShardBonus(shards: number): number
	return math.min(GameConfig.Shards.MaxSpeedBonus, math.max(0, shards) * GameConfig.Shards.SpeedBonusPerShard)
end

-- Effective top speed right now (client target and server ceiling share this exact formula).
function KartPhysicsModel.EffectiveTopSpeed(
	stats: EffectiveStats,
	surfaceId: string,
	boosts: { ActiveBoost },
	shards: number,
	now: number,
	slowScale: number?
): number
	local surf = KartPhysicsModel.SurfaceMultipliers(surfaceId, stats)
	local bonus = 1 + KartPhysicsModel.ActiveBoostBonus(boosts, now) + KartPhysicsModel.ShardBonus(shards)
	return stats.TopSpeed * surf.TopSpeed * bonus * (slowScale or 1)
end

function KartPhysicsModel.MakeBoost(
	source: GameTypes.BoostSource,
	seconds: number,
	bonus: number,
	stats: EffectiveStats,
	now: number
): ActiveBoost
	return { Source = source, EndsAt = now + seconds * stats.BoostEfficiency, SpeedBonus = bonus }
end

-- Steering -------------------------------------------------------------------------------------------------------
-- Yaw rate (rad/s) for a full steer input at a given speed fraction (0..1 of top speed).
function KartPhysicsModel.SteerRate(
	speedFraction: number,
	stats: EffectiveStats,
	surfaceId: string,
	isDrifting: boolean
): number
	local surf = KartPhysicsModel.SurfaceMultipliers(surfaceId, stats)
	local f = math.clamp(speedFraction, 0, 1.5)
	local blend = MathUtil.InverseLerp(P.SteerSpeedBlendStart, 1, f)
	local rate = MathUtil.Lerp(P.MaxSteerRateLowSpeed, P.MaxSteerRateHighSpeed, blend)
	-- Very slow: no pivoting in place.
	rate *= MathUtil.InverseLerp(0, 0.06, f)
	rate *= stats.SteerRate * surf.Handling
	-- Heavier vehicles rotate less eagerly.
	rate *= math.clamp(100 / stats.Mass, 0.75, 1.15) ^ 0.5
	if isDrifting then
		rate *= P.DriftYawBonus
	end
	return rate
end

-- Drift -----------------------------------------------------------------------------------------------------------
function KartPhysicsModel.CanStartDrift(speedFraction: number, steerInput: number, grounded: boolean): boolean
	return grounded and speedFraction >= P.DriftMinSpeedFraction and math.abs(steerInput) >= P.DriftMinSteer
end

-- Charge rate multiplier per second while drifting; 0 means the drift is too weak to charge.
function KartPhysicsModel.DriftChargeRate(angleFactor: number, speedFraction: number): number
	if angleFactor < P.DriftChargeAngleFactorMin or speedFraction < P.DriftChargeSpeedFactorMin then
		return 0
	end
	return math.clamp(angleFactor, 0.5, 1.25) * math.clamp(speedFraction, 0.6, 1.2)
end

function KartPhysicsModel.DriftTier(chargeSeconds: number): number
	local tier = 0
	for i, t in P.DriftTiers do
		if chargeSeconds >= t.Seconds then
			tier = i
		end
	end
	return tier
end

function KartPhysicsModel.DriftBoostFor(tier: number): { BoostSeconds: number, SpeedBonus: number }?
	local t = P.DriftTiers[tier]
	if t == nil then
		return nil
	end
	return { BoostSeconds = t.BoostSeconds, SpeedBonus = t.SpeedBonus }
end

-- Start boost ----------------------------------------------------------------------------------------------------
-- offset = throttle press time - GO time (seconds). Negative = pressed before GO.
function KartPhysicsModel.EvaluateStartBoost(offset: number): StartBoostResult
	local s = P.StartBoost
	if offset < s.TooEarlyBefore then
		return "None"
	elseif offset < s.OkayBefore then
		return "Early"
	elseif offset < s.GoodBefore then
		return "Okay"
	elseif offset < s.PerfectBefore then
		return "Good"
	elseif offset <= s.PerfectAfter then
		return "Perfect"
	elseif offset <= s.GoodAfter then
		return "Good"
	elseif offset <= s.OkayAfter then
		return "Okay"
	end
	return "None"
end

function KartPhysicsModel.StartBoostParams(
	result: StartBoostResult
): { BoostSeconds: number, SpeedBonus: number, StallSeconds: number }
	local s = P.StartBoost
	if result == "Perfect" then
		return { BoostSeconds = s.Perfect.BoostSeconds, SpeedBonus = s.Perfect.SpeedBonus, StallSeconds = 0 }
	elseif result == "Good" then
		return { BoostSeconds = s.Good.BoostSeconds, SpeedBonus = s.Good.SpeedBonus, StallSeconds = 0 }
	elseif result == "Okay" then
		return { BoostSeconds = s.Okay.BoostSeconds, SpeedBonus = s.Okay.SpeedBonus, StallSeconds = 0 }
	elseif result == "Early" then
		return { BoostSeconds = 0, SpeedBonus = 0, StallSeconds = s.Penalty.StallSeconds }
	end
	return { BoostSeconds = 0, SpeedBonus = 0, StallSeconds = 0 }
end

-- Hit stun --------------------------------------------------------------------------------------------------------
function KartPhysicsModel.HitStunParams(
	level: number,
	stats: EffectiveStats
): { Seconds: number, SpeedScale: number, Spin: boolean }
	local h = P.HitStun
	local rec = math.clamp(stats.Recovery, 0.5, 1.5)
	if level >= 2 then
		return { Seconds = h.HeavySeconds / rec, SpeedScale = h.HeavySpeedScale, Spin = true }
	end
	return { Seconds = h.LightSeconds / rec, SpeedScale = h.LightSpeedScale, Spin = false }
end

-- Collisions -------------------------------------------------------------------------------------------------------
-- Impulse magnitude a gets from bumping b; heavier vehicles push more and get pushed less.
function KartPhysicsModel.BumpImpulse(massA: number, massB: number, relativeSpeed: number): number
	if relativeSpeed < P.Collision.MinBumpSpeed then
		return 0
	end
	local ratio = (massB / massA) ^ P.Collision.WeightExponent
	return P.Collision.BumpImpulse * ratio * math.clamp(relativeSpeed / 40, 0.5, 2)
end

-- Slipstream ------------------------------------------------------------------------------------------------------
function KartPhysicsModel.InSlipstreamCone(followerPos: Vector3, followerForward: Vector3, leaderPos: Vector3): boolean
	local s = P.Slipstream
	local delta = leaderPos - followerPos
	local dist = delta.Magnitude
	if dist < s.MinDistance or dist > s.MaxDistance then
		return false
	end
	local angle = math.deg(MathUtil.AngleBetween(followerForward, delta))
	return angle <= s.ConeDegrees
end

-- Physically plausible speed check used by the server (returns allowed max speed for this racer now).
function KartPhysicsModel.ValidationSpeedCap(
	stats: EffectiveStats,
	surfaceId: string,
	boosts: { ActiveBoost },
	shards: number,
	now: number,
	hazardScale: number?
): number
	local top = KartPhysicsModel.EffectiveTopSpeed(stats, surfaceId, boosts, shards, now, hazardScale)
	-- Downhill and pads can exceed the nominal top; SpeedTolerance covers physics jitter.
	return math.min(
		math.max(top, stats.TopSpeed) * 1.25 * GameConfig.Security.SpeedTolerance,
		VehicleStats.AbsoluteSpeedCap(stats)
	)
end

return table.freeze(KartPhysicsModel)
