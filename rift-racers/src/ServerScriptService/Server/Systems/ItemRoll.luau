--!strict
-- Server-only item distribution. Weighted by placement bucket, then adjusted by race context.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ItemDefinitions = require(Shared.Config.ItemDefinitions)
local MathUtil = require(Shared.Utility.MathUtil)
local GameConfig = require(Shared.Config.GameConfig)

export type RollContext = {
	Position: number,
	Total: number,
	DistanceToLeader: number, -- studs (0 for the leader)
	DistanceToNearest: number,
	LapsRemaining: number,
	ActiveStrongEffects: number, -- strong items currently live in the race
	AllowedItems: { string }?,
	StormCrownAvailable: boolean,
	HeldItems: { string },
	Bucket: "Front" | "Mid" | "Back" | "Last",
}

local ItemRoll = {}

function ItemRoll.Weights(ctx: RollContext): { [string]: number }
	local out: { [string]: number } = {}
	for _, def in ItemDefinitions.List do
		if ctx.AllowedItems ~= nil and table.find(ctx.AllowedItems :: { string }, def.Id) == nil then
			continue
		end
		local w = def.Weights[ctx.Bucket]
		if w <= 0 then
			continue
		end
		-- Far behind the leader: catch-up items grow; close to the leader they shrink.
		if def.CatchUp then
			local far = math.clamp(ctx.DistanceToLeader / 400, 0, 1.5)
			w *= 0.4 + far
			if ctx.Total <= 3 then
				w *= 0.5 -- small matches: less swingy
			end
		end
		-- Attack items are less useful with nobody nearby; boosts more useful.
		if (def.Kind == "Projectile" or def.Kind == "Homing") and ctx.DistanceToNearest > 250 then
			w *= 0.5
		end
		if def.Kind == "Boost" and ctx.DistanceToNearest > 250 then
			w *= 1.3
		end
		-- Last lap: prefer decisive but not global chaos.
		if ctx.LapsRemaining <= 1 and def.Kind == "Global" then
			w *= 0.5
		end
		-- Strong item cap
		if def.Strength == "Strong" and ctx.ActiveStrongEffects >= GameConfig.Items.MaxActiveStrongEffects then
			w = 0
		end
		if def.Id == "StormCrown" and not ctx.StormCrownAvailable then
			w = 0
		end
		-- Do not hand duplicates of a strong item already held.
		if def.Strength == "Strong" and table.find(ctx.HeldItems, def.Id) then
			w = 0
		end
		if w > 0 then
			out[def.Id] = w
		end
	end
	return out
end

function ItemRoll.Roll(ctx: RollContext, rng: Random): string?
	local weights = ItemRoll.Weights(ctx)
	local ids = {}
	for id in weights do
		table.insert(ids, id)
	end
	table.sort(ids)
	if #ids == 0 then
		return nil
	end
	return MathUtil.WeightedPick(rng, ids, function(id)
		return weights[id]
	end)
end

return table.freeze(ItemRoll)
