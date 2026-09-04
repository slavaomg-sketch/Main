--!strict
-- Combines vehicle physics, hero modifier and speed class into effective stats. Used by client controller,
-- server validation and bots so all three agree on the numbers. Hero influence is bounded (see HeroDefinitions).
local HeroDefinitions = require(script.Parent.Parent.Config.HeroDefinitions)
local VehicleDefinitions = require(script.Parent.Parent.Config.VehicleDefinitions)
local ModeDefinitions = require(script.Parent.Parent.Config.ModeDefinitions)
local GameConfig = require(script.Parent.Parent.Config.GameConfig)

export type EffectiveStats = {
	HeroId: string,
	VehicleId: string,
	TopSpeed: number,
	Acceleration: number,
	SteerRate: number,
	Grip: number,
	DriftControl: number,
	Mass: number,
	OffroadEfficiency: number,
	BoostEfficiency: number,
	AirControl: number,
	Recovery: number,
	Stability: number,
	TrickEfficiency: number,
	Hover: boolean,
	SpeedClassScale: number,
}

local VehicleStats = {}

function VehicleStats.SpeedClassScale(speedClass: string?): number
	local scales: { [string]: number } = ModeDefinitions.CustomRaceLimits.SpeedClassScale :: any
	return scales[speedClass or "Standard"] or 1
end

function VehicleStats.Compute(heroId: string, vehicleId: string, speedClass: string?): EffectiveStats
	local hero = HeroDefinitions.ById[heroId] or HeroDefinitions.ById[HeroDefinitions.DefaultHeroId]
	local vehicle = VehicleDefinitions.ById[vehicleId] or VehicleDefinitions.ById[VehicleDefinitions.DefaultVehicleId]
	local p = vehicle.Physics
	local m = hero.Modifier
	local classScale = VehicleStats.SpeedClassScale(speedClass)
	return {
		HeroId = hero.Id,
		VehicleId = vehicle.Id,
		TopSpeed = p.TopSpeed * classScale,
		Acceleration = p.Acceleration * m.Acceleration * classScale,
		SteerRate = p.SteerRate,
		Grip = p.Grip * m.Stability,
		DriftControl = p.DriftControl,
		Mass = p.Mass * m.Weight,
		OffroadEfficiency = p.OffroadEfficiency,
		BoostEfficiency = p.BoostEfficiency,
		AirControl = p.AirControl,
		Recovery = p.Recovery * m.Recovery,
		Stability = m.Stability,
		TrickEfficiency = m.TrickEfficiency,
		Hover = p.Hover,
		SpeedClassScale = classScale,
	}
end

-- Hard ceiling the server enforces for any racer with these stats (boosts, pads, shards included).
function VehicleStats.AbsoluteSpeedCap(stats: EffectiveStats): number
	return stats.TopSpeed * GameConfig.Physics.BoostSpeedCapFraction * GameConfig.Security.SpeedTolerance
end

-- Global cap across all vehicles for a speed class (used for impossible sector-time detection).
function VehicleStats.GlobalSpeedCap(speedClass: string?): number
	local best = 0
	for _, v in VehicleDefinitions.List do
		best = math.max(best, v.Physics.TopSpeed)
	end
	return best * VehicleStats.SpeedClassScale(speedClass) * GameConfig.Physics.BoostSpeedCapFraction * GameConfig.Security.SpeedTolerance
end

-- Display normalisation to 0..100 for the garage: vehicle display stats nudged by hero modifiers.
function VehicleStats.DisplayStats(heroId: string, vehicleId: string): { [string]: number }
	local hero = HeroDefinitions.ById[heroId] or HeroDefinitions.ById[HeroDefinitions.DefaultHeroId]
	local vehicle = VehicleDefinitions.ById[vehicleId] or VehicleDefinitions.ById[VehicleDefinitions.DefaultVehicleId]
	local d = vehicle.Display
	local m = hero.Modifier
	local function n(v: number, mult: number): number
		return math.clamp(math.floor(v * mult + 0.5), 0, 100)
	end
	return {
		TopSpeed = n(d.TopSpeed, 1),
		Acceleration = n(d.Acceleration, m.Acceleration),
		Handling = n(d.Handling, 1),
		Grip = n(d.Grip, m.Stability),
		DriftControl = n(d.DriftControl, 1),
		Weight = n(d.Weight, m.Weight),
		OffroadEfficiency = n(d.OffroadEfficiency, 1),
		BoostEfficiency = n(d.BoostEfficiency, 1),
		AirControl = n(d.AirControl, m.TrickEfficiency),
		Recovery = n(d.Recovery, m.Recovery),
	}
end

return table.freeze(VehicleStats)
