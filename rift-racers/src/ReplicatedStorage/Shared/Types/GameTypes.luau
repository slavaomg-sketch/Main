--!strict
-- Core cross-cutting types. Config modules export their own definition types; this file holds runtime state types.

export type Loadout = {
	HeroId: string,
	VehicleId: string,
	Cosmetics: { Paint: string?, Trail: string?, Horn: string?, Deco: string? },
}

export type KartState =
	"Idle"
	| "Accelerating"
	| "Braking"
	| "Reversing"
	| "Grounded"
	| "Airborne"
	| "DriftingLeft"
	| "DriftingRight"
	| "Boosting"
	| "HitStun"
	| "Respawning"
	| "Finished"
	| "Spectating"

export type BoostSource =
	"Drift1"
	| "Drift2"
	| "Drift3"
	| "Start"
	| "Trick"
	| "Slipstream"
	| "Item"
	| "Pad"
	| "Overcharge"

export type ActiveBoost = { Source: BoostSource, EndsAt: number, SpeedBonus: number }

export type StatusEffect = { Id: string, EndsAt: number, Params: { [string]: number } }

export type TeamId = number -- 0 = no team

export type BotDifficulty = "Easy" | "Normal" | "Hard"

export type RacerIdentity = {
	Key: string,
	UserId: number,
	DisplayName: string,
	IsBot: boolean,
	BotDifficulty: BotDifficulty?,
	Team: TeamId,
}

export type TrackAssistSettings = {
	Enabled: boolean,
	EdgeGuide: boolean,
	AutoAccelerate: boolean,
	AutoFlip: boolean,
	DriftHint: boolean,
	SoftSteer: boolean,
}

export type PlayerSettings = {
	SteerSensitivity: number,
	InvertCamera: boolean,
	AutoAccelerate: boolean,
	TrackAssist: boolean,
	Vibration: number,
	CameraShake: number,
	SpeedFov: number,
	MusicVolume: number,
	SfxVolume: number,
	MobileLayout: "Left" | "Right",
	MobileControlScale: number,
	MobileControlAlpha: number,
	ReducedMotion: boolean,
	Locale: "en" | "ru",
	TiltSteering: boolean,
}

return nil
