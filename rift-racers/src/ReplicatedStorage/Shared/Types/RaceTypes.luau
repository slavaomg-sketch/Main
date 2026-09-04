--!strict
local GameTypes = require(script.Parent.GameTypes)

export type RaceState = "WaitingForPlayers" | "LoadingProfiles" | "TrackVote" | "LoadingTrack" | "LoadoutLock" | "GridSetup" | "Countdown" | "Racing" | "FinishWindow" | "Results" | "Rewards" | "Returning"

export type RaceRules = {
	ModeId: string,
	TrackId: string,
	Laps: number,
	ItemsEnabled: boolean,
	CollisionsEnabled: boolean,
	AllowedItems: { string }?,
	BotCount: number,
	BotDifficulty: GameTypes.BotDifficulty,
	Teams: number,
	FriendlyFire: boolean,
	SpeedClass: string,
	Mirror: boolean,
	AssistMode: boolean,
	KnockoutStages: number,
	DurationSeconds: number,
}

export type RacerProgress = {
	Lap: number,
	Checkpoint: number, -- last correctly passed checkpoint index (0 = none this lap)
	Progress: number, -- arc-length position on the path [0, Length)
	SegmentFraction: number,
	DistanceToNext: number,
	Direction: number, -- +1 forward, -1 backward, 0 stationary
	WrongWaySince: number?,
	LastCheckpointAt: number,
	LapStartedAt: number,
	SectorTimes: { number },
	FinishedAt: number?,
	FinishPosition: number?,
	TotalDistance: number,
	LastSafeProgress: number,
	LapTimes: { number },
	BestLap: number?,
	Eliminated: boolean,
	KnockoutStage: number,
}

export type RacerRuntime = {
	Identity: GameTypes.RacerIdentity,
	Loadout: GameTypes.Loadout,
	Progress: RacerProgress,
	Position: number,
	Items: { Active: string?, Reserve: string? },
	Shards: number,
	Boosts: { GameTypes.ActiveBoost },
	Effects: { [string]: GameTypes.StatusEffect? },
	HitImmuneUntil: number,
	LastHitAt: number,
	HitsTaken: number,
	StrongHitsTaken: number,
	RespawnLockUntil: number,
	ItemLockUntil: number,
	LastItemUseAt: number,
	Cores: number,
	Score: number,
	Team: GameTypes.TeamId,
	Connected: boolean,
	State: GameTypes.KartState,
	StartBoostResult: string?,
}

export type FinishRecord = { Key: string, Position: number, TimeSeconds: number?, BestLap: number?, Finished: boolean, Team: number, Points: number, Shards: number, Eliminated: boolean, StageReached: number, Score: number }

export type RaceResults = { RaceId: string, TrackId: string, ModeId: string, Records: { FinishRecord }, TeamScores: { [number]: number }?, WinnerKey: string? }

export type RewardBreakdown = { Currency: number, XP: number, Lines: { { Key: string, Amount: number } }, NewLevel: number?, NewRecord: boolean, Unlocks: { string } }

export type GhostFrame = { T: number, P: Vector3, R: Vector3 } -- compact keyframe (time, position, rotation euler)
export type GhostRecording = { Version: number, TrackId: string, VehicleId: string, HeroId: string, Laps: number, TimeSeconds: number, Assist: boolean, Frames: { GhostFrame }, SampleHz: number }

return nil
