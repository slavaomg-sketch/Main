--!strict
-- Post-race economy. No paid stat boosts exist anywhere in this project.
local RewardConfig = {
	Currency = {
		Finish = 60,
		PositionBonus = table.freeze({ 120, 90, 70, 55, 45, 38, 32, 26, 20, 16, 12, 10 }),
		CleanRaceBonus = 35, -- finished without being hit by a strong item
		FirstPersonalRecordBonus = 40,
		GrandTourFinalBonus = table.freeze({ 300, 200, 140, 100, 80, 60, 50, 40, 30, 20, 10, 10 }),
		KnockoutStageBonus = 25,
		BattleWin = 110,
		BattleParticipation = 40,
		TimeTrialFinish = 30,
		ShardConversion = 2,
		DailyFirstRaceBonus = 50,
	},
	XP = {
		Participation = 40,
		PerLap = 8,
		PositionBonus = table.freeze({ 60, 45, 35, 28, 22, 18, 15, 12, 10, 8, 6, 5 }),
		Win = 40,
	},
	-- Level N requires LevelCurve(N) total XP.
	LevelBaseXP = 200,
	LevelExponent = 1.35,
	MaxLevel = 60,
	-- Cosmetic shop (currency only; no stats). Ids must be unique across categories.
	Cosmetics = table.freeze({
		{ Id = "Paint_SolarFlare", Category = "Paint", Cost = 400, NameKey = "COSMETIC.PAINT_SOLAR_FLARE" },
		{ Id = "Paint_DeepRift", Category = "Paint", Cost = 400, NameKey = "COSMETIC.PAINT_DEEP_RIFT" },
		{ Id = "Paint_MossGlow", Category = "Paint", Cost = 600, NameKey = "COSMETIC.PAINT_MOSS_GLOW" },
		{ Id = "Trail_Comet", Category = "Trail", Cost = 500, NameKey = "COSMETIC.TRAIL_COMET" },
		{ Id = "Trail_Prism", Category = "Trail", Cost = 700, NameKey = "COSMETIC.TRAIL_PRISM" },
		{ Id = "Emote_Bow", Category = "Emote", Cost = 250, NameKey = "COSMETIC.EMOTE_BOW" },
		{ Id = "Horn_Whistle", Category = "Horn", Cost = 250, NameKey = "COSMETIC.HORN_WHISTLE" },
		{ Id = "Deco_RiftPennant", Category = "Deco", Cost = 300, NameKey = "COSMETIC.DECO_RIFT_PENNANT" },
	}),
}

function RewardConfig.LevelCurve(level: number): number
	if level <= 1 then
		return 0
	end
	return math.floor(RewardConfig.LevelBaseXP * ((level - 1) ^ RewardConfig.LevelExponent))
end

function RewardConfig.LevelForXP(xp: number): number
	local level = 1
	while level < RewardConfig.MaxLevel and xp >= RewardConfig.LevelCurve(level + 1) do
		level += 1
	end
	return level
end

return table.freeze(RewardConfig)
