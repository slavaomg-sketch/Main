--!strict
export type ModeId = "QuickRace" | "GrandTour" | "TimeTrial" | "CustomRace" | "Knockout" | "TeamRace" | "CoreClash" | "ShardRush" | "Practice"

export type ModeDefinition = {
	Id: ModeId,
	NameKey: string,
	DescriptionKey: string,
	IsRace: boolean,
	IsBattle: boolean,
	ItemsEnabled: boolean,
	CollisionsEnabled: boolean,
	BotsAllowed: boolean,
	MinPlayers: number,
	MaxPlayers: number,
	DefaultLaps: number,
	RacesPerSession: number,
	Teams: number,
	Public: boolean,
	Vote: boolean,
	Arena: boolean,
	KnockoutStages: number?,
	DurationSeconds: number?,
	CoreCount: number?,
	SortOrder: number,
}

local function mode(t: ModeDefinition): ModeDefinition
	return table.freeze(t) :: ModeDefinition
end

local List: { ModeDefinition } = {
	mode({ Id = "QuickRace", NameKey = "MODE.QUICK_RACE", DescriptionKey = "MODE.QUICK_RACE_DESC", IsRace = true, IsBattle = false, ItemsEnabled = true, CollisionsEnabled = true, BotsAllowed = true, MinPlayers = 2, MaxPlayers = 12, DefaultLaps = 3, RacesPerSession = 1, Teams = 0, Public = true, Vote = true, Arena = false, SortOrder = 1 }),
	mode({ Id = "GrandTour", NameKey = "MODE.GRAND_TOUR", DescriptionKey = "MODE.GRAND_TOUR_DESC", IsRace = true, IsBattle = false, ItemsEnabled = true, CollisionsEnabled = true, BotsAllowed = true, MinPlayers = 2, MaxPlayers = 12, DefaultLaps = 3, RacesPerSession = 4, Teams = 0, Public = true, Vote = true, Arena = false, SortOrder = 2 }),
	mode({ Id = "TimeTrial", NameKey = "MODE.TIME_TRIAL", DescriptionKey = "MODE.TIME_TRIAL_DESC", IsRace = true, IsBattle = false, ItemsEnabled = false, CollisionsEnabled = false, BotsAllowed = false, MinPlayers = 1, MaxPlayers = 1, DefaultLaps = 3, RacesPerSession = 1, Teams = 0, Public = false, Vote = false, Arena = false, SortOrder = 3 }),
	mode({ Id = "CustomRace", NameKey = "MODE.CUSTOM_RACE", DescriptionKey = "MODE.CUSTOM_RACE_DESC", IsRace = true, IsBattle = false, ItemsEnabled = true, CollisionsEnabled = true, BotsAllowed = true, MinPlayers = 1, MaxPlayers = 12, DefaultLaps = 3, RacesPerSession = 1, Teams = 0, Public = false, Vote = false, Arena = false, SortOrder = 4 }),
	mode({ Id = "Knockout", NameKey = "MODE.KNOCKOUT", DescriptionKey = "MODE.KNOCKOUT_DESC", IsRace = true, IsBattle = false, ItemsEnabled = true, CollisionsEnabled = true, BotsAllowed = true, MinPlayers = 4, MaxPlayers = 12, DefaultLaps = 4, RacesPerSession = 1, Teams = 0, Public = true, Vote = true, Arena = false, KnockoutStages = 3, SortOrder = 5 }),
	mode({ Id = "TeamRace", NameKey = "MODE.TEAM_RACE", DescriptionKey = "MODE.TEAM_RACE_DESC", IsRace = true, IsBattle = false, ItemsEnabled = true, CollisionsEnabled = true, BotsAllowed = true, MinPlayers = 4, MaxPlayers = 12, DefaultLaps = 3, RacesPerSession = 1, Teams = 2, Public = true, Vote = true, Arena = false, SortOrder = 6 }),
	mode({ Id = "CoreClash", NameKey = "MODE.CORE_CLASH", DescriptionKey = "MODE.CORE_CLASH_DESC", IsRace = false, IsBattle = true, ItemsEnabled = true, CollisionsEnabled = true, BotsAllowed = true, MinPlayers = 2, MaxPlayers = 12, DefaultLaps = 0, RacesPerSession = 1, Teams = 0, Public = true, Vote = true, Arena = true, DurationSeconds = 180, CoreCount = 3, SortOrder = 7 }),
	mode({ Id = "ShardRush", NameKey = "MODE.SHARD_RUSH", DescriptionKey = "MODE.SHARD_RUSH_DESC", IsRace = false, IsBattle = true, ItemsEnabled = true, CollisionsEnabled = true, BotsAllowed = true, MinPlayers = 2, MaxPlayers = 12, DefaultLaps = 0, RacesPerSession = 1, Teams = 2, Public = true, Vote = true, Arena = true, DurationSeconds = 150, SortOrder = 8 }),
	mode({ Id = "Practice", NameKey = "MODE.PRACTICE", DescriptionKey = "MODE.PRACTICE_DESC", IsRace = true, IsBattle = false, ItemsEnabled = false, CollisionsEnabled = false, BotsAllowed = false, MinPlayers = 1, MaxPlayers = 12, DefaultLaps = 99, RacesPerSession = 1, Teams = 0, Public = false, Vote = false, Arena = false, SortOrder = 9 }),
}

local byId: { [string]: ModeDefinition } = {}
for _, m in List do
	byId[m.Id] = m
end

-- Grand Tour points by finishing position (1st..12th). Beyond 12 -> 0.
local GrandTourPoints = table.freeze({ 15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 1 })

-- Team colours picked for deuteranopia/protanopia/tritanopia separability (blue/orange/purple-ish/yellow).
local TeamColors = table.freeze({
	table.freeze({ Id = "Azure", Color = Color3.fromRGB(0, 114, 178), NameKey = "TEAM.AZURE" }),
	table.freeze({ Id = "Amber", Color = Color3.fromRGB(230, 159, 0), NameKey = "TEAM.AMBER" }),
	table.freeze({ Id = "Orchid", Color = Color3.fromRGB(204, 121, 167), NameKey = "TEAM.ORCHID" }),
	table.freeze({ Id = "Mint", Color = Color3.fromRGB(0, 158, 115), NameKey = "TEAM.MINT" }),
})

return table.freeze({
	List = table.freeze(List),
	ById = table.freeze(byId),
	GrandTourPoints = GrandTourPoints,
	TeamColors = TeamColors,
	KnockoutEliminationFraction = 0.25, -- last quarter (min 1) eliminated per stage
	CustomRaceLimits = table.freeze({ MinLaps = 1, MaxLaps = 7, MaxBots = 11, SpeedClasses = table.freeze({ "Standard", "Swift", "Rift" }), SpeedClassScale = table.freeze({ Standard = 1.0, Swift = 1.12, Rift = 1.25 }) }),
})
