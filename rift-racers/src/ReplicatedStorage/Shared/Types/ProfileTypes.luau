--!strict
local GameTypes = require(script.Parent.GameTypes)

export type TrackRecord = { BestTime: number, BestLap: number, Assist: boolean, VehicleId: string, HeroId: string, SetAt: number, Ghost: string? }

export type Profile = {
	SchemaVersion: number,
	Currency: number,
	XP: number,
	Level: number,
	UnlockedHeroes: { [string]: boolean },
	UnlockedVehicles: { [string]: boolean },
	UnlockedCosmetics: { [string]: boolean },
	SelectedHero: string,
	SelectedVehicle: string,
	SelectedCosmetics: { Paint: string?, Trail: string?, Horn: string?, Deco: string? },
	TrackRecords: { [string]: TrackRecord },
	GrandTourResults: { { At: number, Position: number, Points: number } },
	Statistics: { [string]: number },
	Settings: GameTypes.PlayerSettings,
	TutorialState: { Completed: boolean, Step: number },
	Achievements: { [string]: number },
	ProcessedRaceRewards: { [string]: number }, -- key RaceId:UserId -> timestamp
	ProcessedPurchaseIds: { [string]: number },
	ModerationFlags: { [string]: number },
	FirstSeenAt: number,
	LastSeenAt: number,
}

export type ProfileStatus = "Loaded" | "Loading" | "Failed" | "Temporary" | "Released"

export type ProfileHandle = { UserId: number, Data: Profile, Status: ProfileStatus, Dirty: boolean, LoadedAt: number, SessionId: string }

return nil
