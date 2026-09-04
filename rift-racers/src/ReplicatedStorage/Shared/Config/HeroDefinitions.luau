--!strict
-- Eight original heroes. Heroes only nudge stats (bounded by HeroStatsModifier limits); vehicles carry the bulk.
export type HeroClass = "Light" | "Medium" | "MediumHeavy" | "Heavy"

export type HeroStatsModifier = {
	Weight: number, -- multiplicative, clamped to [0.9, 1.1]
	Acceleration: number,
	Stability: number,
	Recovery: number,
	TrickEfficiency: number,
}

export type HeroUnlockRequirement =
	{ Kind: "Default" }
	| { Kind: "Level", Level: number }
	| { Kind: "Currency", Cost: number }
	| { Kind: "Achievement", Id: string }

export type HeroCosmetics = {
	PrimaryColor: Color3,
	SecondaryColor: Color3,
	AccentColor: Color3,
	HeadShape: "Round" | "Visor" | "Block" | "Dome",
	Accessory: string,
	IdlePose: string,
	SelectAnimation: string,
	Emote: string,
}

export type HeroDefinition = {
	Id: string,
	NameKey: string,
	TaglineKey: string,
	Class: HeroClass,
	Modifier: HeroStatsModifier,
	Unlock: HeroUnlockRequirement,
	Cosmetics: HeroCosmetics,
	SortOrder: number,
	HornSound: string,
}

local MOD_MIN, MOD_MAX = 0.9, 1.1

local function mod(w: number, a: number, s: number, r: number, t: number): HeroStatsModifier
	local function c(v: number): number
		return math.clamp(v, MOD_MIN, MOD_MAX)
	end
	return { Weight = c(w), Acceleration = c(a), Stability = c(s), Recovery = c(r), TrickEfficiency = c(t) }
end

local function cos(
	p: Color3,
	s: Color3,
	a: Color3,
	head: "Round" | "Visor" | "Block" | "Dome",
	accessory: string,
	pose: string,
	anim: string,
	emote: string
): HeroCosmetics
	return {
		PrimaryColor = p,
		SecondaryColor = s,
		AccentColor = a,
		HeadShape = head,
		Accessory = accessory,
		IdlePose = pose,
		SelectAnimation = anim,
		Emote = emote,
	}
end

local HeroDefinitions: { HeroDefinition } = {
	{
		Id = "NovaVale",
		NameKey = "HERO.NOVA_VALE",
		TaglineKey = "HERO.NOVA_VALE_TAG",
		Class = "Medium",
		SortOrder = 1,
		Modifier = mod(1.0, 1.0, 1.0, 1.0, 1.0),
		Unlock = { Kind = "Default" },
		HornSound = "HornCourier",
		Cosmetics = cos(
			Color3.fromRGB(60, 90, 200),
			Color3.fromRGB(240, 240, 250),
			Color3.fromRGB(255, 190, 60),
			"Visor",
			"CourierSatchel",
			"PoseReady",
			"SelectSalute",
			"EmoteWave"
		),
	},
	{
		Id = "BoltFinch",
		NameKey = "HERO.BOLT_FINCH",
		TaglineKey = "HERO.BOLT_FINCH_TAG",
		Class = "Light",
		SortOrder = 2,
		Modifier = mod(0.92, 1.06, 0.95, 1.02, 1.0),
		Unlock = { Kind = "Default" },
		HornSound = "HornSpark",
		Cosmetics = cos(
			Color3.fromRGB(255, 200, 40),
			Color3.fromRGB(50, 50, 60),
			Color3.fromRGB(80, 220, 255),
			"Round",
			"Goggles",
			"PoseTinker",
			"SelectSpin",
			"EmoteCheer"
		),
	},
	{
		Id = "BrambleRook",
		NameKey = "HERO.BRAMBLE_ROOK",
		TaglineKey = "HERO.BRAMBLE_ROOK_TAG",
		Class = "Heavy",
		SortOrder = 3,
		Modifier = mod(1.08, 0.96, 1.08, 0.98, 0.96),
		Unlock = { Kind = "Level", Level = 3 },
		HornSound = "HornWood",
		Cosmetics = cos(
			Color3.fromRGB(70, 120, 50),
			Color3.fromRGB(120, 80, 40),
			Color3.fromRGB(230, 120, 40),
			"Block",
			"ToolBelt",
			"PoseSturdy",
			"SelectFlex",
			"EmoteThumbsUp"
		),
	},
	{
		Id = "MiraTide",
		NameKey = "HERO.MIRA_TIDE",
		TaglineKey = "HERO.MIRA_TIDE_TAG",
		Class = "Medium",
		SortOrder = 4,
		Modifier = mod(0.98, 1.0, 1.03, 1.0, 1.0),
		Unlock = { Kind = "Level", Level = 5 },
		HornSound = "HornSonar",
		Cosmetics = cos(
			Color3.fromRGB(40, 170, 190),
			Color3.fromRGB(230, 250, 255),
			Color3.fromRGB(255, 120, 150),
			"Dome",
			"DiveMask",
			"PoseCalm",
			"SelectBubble",
			"EmoteWave"
		),
	},
	{
		Id = "KitoEmber",
		NameKey = "HERO.KITO_EMBER",
		TaglineKey = "HERO.KITO_EMBER_TAG",
		Class = "MediumHeavy",
		SortOrder = 5,
		Modifier = mod(1.04, 0.98, 1.02, 0.97, 1.0),
		Unlock = { Kind = "Currency", Cost = 1200 },
		HornSound = "HornBlaze",
		Cosmetics = cos(
			Color3.fromRGB(200, 60, 30),
			Color3.fromRGB(40, 30, 30),
			Color3.fromRGB(255, 170, 40),
			"Visor",
			"PilotScarf",
			"PoseLean",
			"SelectIgnite",
			"EmoteCheer"
		),
	},
	{
		Id = "Glint7",
		NameKey = "HERO.GLINT_7",
		TaglineKey = "HERO.GLINT_7_TAG",
		Class = "Light",
		SortOrder = 6,
		Modifier = mod(0.9, 1.03, 0.94, 1.08, 1.02),
		Unlock = { Kind = "Currency", Cost = 1500 },
		HornSound = "HornChirp",
		Cosmetics = cos(
			Color3.fromRGB(220, 220, 230),
			Color3.fromRGB(90, 90, 110),
			Color3.fromRGB(120, 255, 120),
			"Block",
			"Antenna",
			"PoseScan",
			"SelectBoot",
			"EmoteBeep"
		),
	},
	{
		Id = "TundraMoss",
		NameKey = "HERO.TUNDRA_MOSS",
		TaglineKey = "HERO.TUNDRA_MOSS_TAG",
		Class = "Heavy",
		SortOrder = 7,
		Modifier = mod(1.1, 0.94, 1.1, 1.0, 0.95),
		Unlock = { Kind = "Level", Level = 9 },
		HornSound = "HornHorn",
		Cosmetics = cos(
			Color3.fromRGB(120, 170, 190),
			Color3.fromRGB(240, 250, 255),
			Color3.fromRGB(90, 140, 90),
			"Dome",
			"FurHood",
			"PoseGuard",
			"SelectStomp",
			"EmoteThumbsUp"
		),
	},
	{
		Id = "SaffronQuill",
		NameKey = "HERO.SAFFRON_QUILL",
		TaglineKey = "HERO.SAFFRON_QUILL_TAG",
		Class = "Medium",
		SortOrder = 8,
		Modifier = mod(0.97, 1.0, 0.98, 1.02, 1.08),
		Unlock = { Kind = "Achievement", Id = "FirstTrickTriple" },
		HornSound = "HornFlute",
		Cosmetics = cos(
			Color3.fromRGB(240, 150, 40),
			Color3.fromRGB(120, 60, 140),
			Color3.fromRGB(255, 240, 200),
			"Round",
			"FeatherCap",
			"PoseGlide",
			"SelectTwirl",
			"EmoteBow"
		),
	},
}

local byId: { [string]: HeroDefinition } = {}
for _, h in HeroDefinitions do
	assert(byId[h.Id] == nil, "duplicate hero id " .. h.Id)
	byId[h.Id] = table.freeze(h) :: HeroDefinition
end

return table.freeze({
	List = table.freeze(HeroDefinitions),
	ById = table.freeze(byId),
	ModifierMin = MOD_MIN,
	ModifierMax = MOD_MAX,
	DefaultHeroId = "NovaVale",
})
