--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ProfileTypes = require(Shared.Types.ProfileTypes)
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local VehicleDefinitions = require(Shared.Config.VehicleDefinitions)
local TableUtil = require(Shared.Utility.TableUtil)

local ProfileTemplate = {}

ProfileTemplate.SchemaVersion = 3

function ProfileTemplate.New(now: number): ProfileTypes.Profile
	local heroes: { [string]: boolean } = {}
	for _, h in HeroDefinitions.List do
		if h.Unlock.Kind == "Default" then
			heroes[h.Id] = true
		end
	end
	local vehicles: { [string]: boolean } = {}
	for _, v in VehicleDefinitions.List do
		if v.Unlock.Kind == "Default" then
			vehicles[v.Id] = true
		end
	end
	return {
		SchemaVersion = ProfileTemplate.SchemaVersion,
		Currency = 0,
		XP = 0,
		Level = 1,
		UnlockedHeroes = heroes,
		UnlockedVehicles = vehicles,
		UnlockedCosmetics = {},
		SelectedHero = HeroDefinitions.DefaultHeroId,
		SelectedVehicle = VehicleDefinitions.DefaultVehicleId,
		SelectedCosmetics = {},
		TrackRecords = {},
		GrandTourResults = {},
		Statistics = {
			RacesFinished = 0,
			Wins = 0,
			Podiums = 0,
			Laps = 0,
			ItemsUsed = 0,
			HitsLanded = 0,
			HitsTaken = 0,
			Tricks = 0,
			DriftBoosts = 0,
			ShardsCollected = 0,
			Knockouts = 0,
			BattleWins = 0,
		},
		Settings = {
			SteerSensitivity = 1,
			InvertCamera = false,
			AutoAccelerate = false,
			TrackAssist = true,
			Vibration = 0.7,
			CameraShake = 0.6,
			SpeedFov = 0.7,
			MusicVolume = 0.6,
			SfxVolume = 0.8,
			MobileLayout = "Right",
			MobileControlScale = 1,
			MobileControlAlpha = 0.6,
			ReducedMotion = false,
			Locale = "en",
			TiltSteering = false,
		},
		TutorialState = { Completed = false, Step = 0 },
		Achievements = {},
		ProcessedRaceRewards = {},
		ProcessedPurchaseIds = {},
		ModerationFlags = {},
		FirstSeenAt = now,
		LastSeenAt = now,
	}
end

function ProfileTemplate.Reconcile(data: { [string]: any }, now: number): ProfileTypes.Profile
	return TableUtil.Reconcile(data, ProfileTemplate.New(now) :: any) :: any
end

return ProfileTemplate
