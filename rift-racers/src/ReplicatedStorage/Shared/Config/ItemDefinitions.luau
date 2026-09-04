--!strict
-- Twelve original gadgets plus Energy Shards. The server rolls, owns and resolves every item.
export type ItemKind = "Boost" | "Projectile" | "Homing" | "Trap" | "Shield" | "Wave" | "Warp" | "Global" | "Magnet" | "Phase" | "Multi"
export type ItemStrength = "Weak" | "Normal" | "Strong"

export type ItemDefinition = {
	Id: string,
	NameKey: string,
	DescriptionKey: string,
	Kind: ItemKind,
	Strength: ItemStrength,
	Icon: string,
	Color: Color3,
	-- Weighted by placement bucket: Front (1st-2nd), Mid, Back (last third), Last.
	Weights: { Front: number, Mid: number, Back: number, Last: number },
	Params: { [string]: number },
	NeedsAim: boolean,
	BlockedByShield: boolean,
	CatchUp: boolean,
	GlobalCooldown: number?,
	SoundUse: string,
	SoundHit: string,
}

local function item(id: string, kind: ItemKind, strength: ItemStrength, color: Color3, weights: { Front: number, Mid: number, Back: number, Last: number }, params: { [string]: number }, extra: { [string]: any }?): ItemDefinition
	local e: { [string]: any } = extra or {}
	local snake = id:gsub("(%u)", "_%1"):upper():gsub("^_", "")
	return {
		Id = id,
		NameKey = "ITEM." .. snake,
		DescriptionKey = "ITEM." .. snake .. "_DESC",
		Kind = kind,
		Strength = strength,
		Icon = "Icon_" .. id,
		Color = color,
		Weights = weights,
		Params = params,
		NeedsAim = (e.NeedsAim :: boolean?) or false,
		BlockedByShield = if e.BlockedByShield == nil then true else e.BlockedByShield :: boolean,
		CatchUp = (e.CatchUp :: boolean?) or false,
		GlobalCooldown = e.GlobalCooldown :: number?,
		SoundUse = "Item_" .. id .. "_Use",
		SoundHit = "Item_" .. id .. "_Hit",
	}
end

local ItemDefinitions: { ItemDefinition } = {
	item("NitroCell", "Boost", "Weak", Color3.fromRGB(80, 220, 255), { Front = 30, Mid = 24, Back = 16, Last = 8 },
		{ BoostSeconds = 1.1, SpeedBonus = 0.26, OffroadOk = 1 }, { BlockedByShield = false }),
	item("PulseDisc", "Projectile", "Normal", Color3.fromRGB(120, 255, 160), { Front = 22, Mid = 20, Back = 12, Last = 6 },
		{ Speed = 150, LifeSeconds = 3.5, MaxBounces = 1, Radius = 3.2, StunLevel = 1 }, { NeedsAim = true }),
	item("HunterWisp", "Homing", "Strong", Color3.fromRGB(255, 120, 220), { Front = 0, Mid = 14, Back = 20, Last = 16 },
		{ Speed = 120, LifeSeconds = 7, TurnRate = 3.2, Radius = 3.5, StunLevel = 2, WarnSeconds = 1.5 }),
	item("StaticPod", "Trap", "Weak", Color3.fromRGB(255, 240, 90), { Front = 22, Mid = 14, Back = 6, Last = 2 },
		{ LifeSeconds = 25, Radius = 3.0, StunLevel = 1, PlaceBehind = 9 }),
	item("AegisBubble", "Shield", "Normal", Color3.fromRGB(120, 200, 255), { Front = 12, Mid = 14, Back = 12, Last = 8 },
		{ DurationSeconds = 8, StrongAbsorb = 1, WeakAbsorb = 3 }, { BlockedByShield = false }),
	item("GravityDrum", "Wave", "Normal", Color3.fromRGB(180, 140, 255), { Front = 8, Mid = 14, Back = 12, Last = 6 },
		{ Radius = 16, PushImpulse = 45, SlowSeconds = 0.6, SlowScale = 0.8 }, { BlockedByShield = false }),
	item("BlinkGate", "Warp", "Strong", Color3.fromRGB(255, 255, 255), { Front = 0, Mid = 0, Back = 6, Last = 14 },
		{ WarpDistance = 140, MaxPlacementGain = 2 }, { CatchUp = true, BlockedByShield = false }),
	item("StormCrown", "Global", "Strong", Color3.fromRGB(255, 90, 60), { Front = 0, Mid = 0, Back = 4, Last = 12 },
		{ WarnSeconds = 2.5, TargetsTop = 3, SlowSeconds = 1.6, SlowScale = 0.6, StunLevel = 1 }, { CatchUp = true, GlobalCooldown = 45 }),
	item("MagnetCoil", "Magnet", "Weak", Color3.fromRGB(255, 160, 60), { Front = 10, Mid = 12, Back = 10, Last = 6 },
		{ DurationSeconds = 10, PullRadius = 22, SlipstreamBonus = 0.05 }, { BlockedByShield = false }),
	item("ShockwaveHorn", "Wave", "Weak", Color3.fromRGB(255, 220, 120), { Front = 12, Mid = 10, Back = 6, Last = 2 },
		{ Radius = 12, PushImpulse = 25, ClearsProjectiles = 1 }, { BlockedByShield = false }),
	item("PhaseVeil", "Phase", "Normal", Color3.fromRGB(200, 120, 255), { Front = 4, Mid = 10, Back = 10, Last = 6 },
		{ DurationSeconds = 4 }, { BlockedByShield = false }),
	item("OverchargePack", "Multi", "Strong", Color3.fromRGB(80, 255, 200), { Front = 0, Mid = 2, Back = 12, Last = 18 },
		{ Pulses = 3, PulseSeconds = 0.7, SpeedBonus = 0.22, GapSeconds = 0.5 }, { CatchUp = true, BlockedByShield = false }),
}

local byId: { [string]: ItemDefinition } = {}
for _, it in ItemDefinitions do
	assert(byId[it.Id] == nil, "duplicate item id " .. it.Id)
	byId[it.Id] = table.freeze(it) :: ItemDefinition
end

return table.freeze({
	List = table.freeze(ItemDefinitions),
	ById = table.freeze(byId),
	ShardId = "EnergyShard",
})
