--!strict
-- Battle: three cores each; a hit removes a core; out of cores -> recovery mode; points for hits decide.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local RaceTypes = require(Shared.Types.RaceTypes)
local BaseMode = require(script.Parent.BaseMode)

local CoreClash = setmetatable({}, { __index = BaseMode })
CoreClash.__index = CoreClash

function CoreClash.new()
	local self = setmetatable(BaseMode.new("CoreClash"), CoreClash)
	self.RecoverySeconds = 6
	return self
end

function CoreClash.OnRaceStart(self: any, session: any, now: number)
	for _, key in session.Order do
		session.Racers[key].Cores = self.Def.CoreCount or 3
	end
end

function CoreClash.OnHit(self: any, session: any, attackerKey: string?, targetKey: string, level: number, now: number)
	local target = session.Racers[targetKey]
	if target.Cores <= 0 then
		return
	end
	target.Cores -= 1
	if attackerKey and attackerKey ~= targetKey then
		local attacker = session.Racers[attackerKey]
		attacker.Score += if level >= 2 then 2 else 1
		if target.Cores == 0 then
			attacker.Score += 3
		end
	end
	if target.Cores == 0 then
		-- Recovery: lock items and grant immunity; cores restore after RecoverySeconds.
		target.Effects.Recovery = { Id = "Recovery", EndsAt = now + self.RecoverySeconds, Params = {} }
		target.HitImmuneUntil = now + self.RecoverySeconds
		target.ItemLockUntil = now + self.RecoverySeconds
		session:SendTo(targetKey, "RaceEvent", "CoresLost", { Recover = self.RecoverySeconds })
	end
end

function CoreClash.OnTick(self: any, session: any, now: number, dt: number)
	for _, key in session.Order do
		local r = session.Racers[key]
		if r.Cores == 0 and (r.Effects.Recovery == nil or r.Effects.Recovery.EndsAt <= now) then
			r.Cores = self.Def.CoreCount or 3
			r.Effects.Recovery = nil
		end
	end
end

function CoreClash.IsOver(self: any, session: any, now: number): boolean
	return now >= session.BattleEndsAt or session:ActiveCount() <= 0
end

function CoreClash.Rank(self: any, session: any): { string }
	local keys: { string } = table.clone(session.Order)
	table.sort(keys, function(a, b)
		local ra, rb = session.Racers[a], session.Racers[b]
		if ra.Score ~= rb.Score then
			return ra.Score > rb.Score
		end
		if ra.Cores ~= rb.Cores then
			return ra.Cores > rb.Cores
		end
		return a < b
	end)
	return keys
end

function CoreClash.BuildResults(self: any, session: any): RaceTypes.RaceResults
	local results = BaseMode.BuildResults(self, session)
	for _, rec in results.Records do
		rec.Finished = true
		rec.TimeSeconds = nil
	end
	return results
end

return CoreClash
