--!strict
-- Resolves hits server-side: shields, phase, immunity, friendly fire, hit chains, shard drops.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local RaceTypes = require(Shared.Types.RaceTypes)

type RacerRuntime = RaceTypes.RacerRuntime

export type HitResult = {
	Outcome: "Hit" | "Shielded" | "Phased" | "Immune" | "Friendly" | "Finished",
	Level: number,
	ShardsDropped: number,
	ShieldBroken: boolean,
}

local HitSystem = {}

function HitSystem.Resolve(
	target: RacerRuntime,
	attackerTeam: number,
	level: number,
	now: number,
	friendlyFire: boolean,
	blockedByShield: boolean
): HitResult
	local none: HitResult = { Outcome = "Hit", Level = level, ShardsDropped = 0, ShieldBroken = false }
	if target.Progress.FinishedAt ~= nil or target.Progress.Eliminated then
		none.Outcome = "Finished"
		return none
	end
	if attackerTeam ~= 0 and target.Team == attackerTeam and not friendlyFire then
		none.Outcome = "Friendly"
		return none
	end
	if target.Effects.PhaseVeil and target.Effects.PhaseVeil.EndsAt > now then
		none.Outcome = "Phased"
		return none
	end
	if target.HitImmuneUntil > now then
		none.Outcome = "Immune"
		return none
	end
	local shield = target.Effects.AegisBubble
	if shield and shield.EndsAt > now and blockedByShield then
		if level >= 2 then
			shield.Params.StrongAbsorb -= 1
		else
			shield.Params.WeakAbsorb -= 1
		end
		local broken = shield.Params.StrongAbsorb <= 0 or shield.Params.WeakAbsorb <= 0
		if broken then
			target.Effects.AegisBubble = nil
		end
		none.Outcome = "Shielded"
		none.ShieldBroken = broken
		return none
	end
	-- Apply
	local drop = if level >= 2 then GameConfig.Shards.DropOnHeavyHit else GameConfig.Shards.DropOnLightHit
	drop = math.min(drop, target.Shards)
	target.Shards -= drop
	target.HitsTaken += 1
	if level >= 2 then
		target.StrongHitsTaken += 1
	end
	target.LastHitAt = now
	target.HitImmuneUntil = now
		+ GameConfig.Physics.HitStun.ImmunitySeconds
		+ (if level >= 2 then GameConfig.Physics.HitStun.HeavySeconds else GameConfig.Physics.HitStun.LightSeconds)
	target.Boosts = {}
	target.Effects.HitStun = {
		Id = "HitStun",
		EndsAt = now
			+ (if level >= 2 then GameConfig.Physics.HitStun.HeavySeconds else GameConfig.Physics.HitStun.LightSeconds),
		Params = { Level = level },
	}
	return { Outcome = "Hit", Level = level, ShardsDropped = drop, ShieldBroken = false }
end

-- Vehicle-vs-vehicle bump: heavier pushes lighter; result is a pair of impulses, no stun.
function HitSystem.Bump(massA: number, massB: number, relSpeed: number): (number, number)
	local KPM = require(Shared.Systems.KartPhysicsModel)
	return KPM.BumpImpulse(massA, massB, relSpeed), KPM.BumpImpulse(massB, massA, relSpeed)
end

return table.freeze(HitSystem)
