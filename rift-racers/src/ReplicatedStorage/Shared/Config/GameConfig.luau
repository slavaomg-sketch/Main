--!strict
-- Central, immutable game configuration. Every tunable lives here or in a sibling *Definitions module.
-- The project name is stored ONLY here so it can be rebranded in one place.

local GameConfig = {
	ProjectName = "RIFT RACERS",
	ProjectShortName = "RiftRacers",
	ContentVersion = 3,

	-- Race sizing. 12 is the validated default; 16/24 are load-test experiments (see docs/PERFORMANCE_REPORT.md).
	MaxRacers = 12,
	LoadTestRacerCounts = { 16, 24 },
	MinRealPlayers = 2,
	TargetMatchSize = 8,
	MaxPartySize = 4,

	Matchmaking = {
		TicketTTLSeconds = 90,
		BotFillAfterSeconds = 25,
		QueuePollSeconds = 2,
		LocalMode = true, -- single-place vertical slice: no TeleportService round-trip
		ReservedServerTeleportRetries = 3,
	},

	Race = {
		DefaultLaps = 3,
		MinLaps = 1,
		MaxLaps = 7,
		VoteSeconds = 15,
		VoteTrackChoices = 3,
		LoadoutLockSeconds = 8,
		CountdownSeconds = 3,
		FinishWindowSeconds = 30,
		ResultsSeconds = 12,
		LoadingTimeoutSeconds = 20,
		MinSectorTimeFactor = 0.55, -- sector time below (ideal * factor) is impossible
		TrackCorridorWidthMultiplier = 2.5, -- allowed lateral distance from the path = width * this
		OffTrackRespawnSeconds = 3,
		WrongWaySeconds = 2.5,
		StuckSpeedThreshold = 2,
		StuckSeconds = 5,
		RespawnInvulnerabilitySeconds = 2,
		RespawnItemLockoutSeconds = 1.5,
		FallHeight = -60,
		MaxCheckpointSkip = 0, -- checkpoints are all mandatory in ordered sequence
	},

	Physics = {
		-- Per-corner spring: stiffness * compression * (mass / 4). Equilibrium compression ≈ 0.8 of 2.4 studs at g = 196.2.
		SuspensionRestLength = 2.4,
		SuspensionStiffness = 240,
		SuspensionDamping = 18,
		RayLength = 3.6,
		BaseMass = 100,
		Gravity = 196.2,
		AirControlTorque = 0.6,
		UprightAirGain = 2.5,
		MaxSteerRateLowSpeed = 3.4, -- rad/s at very low speed
		MaxSteerRateHighSpeed = 1.6, -- rad/s at top speed
		SteerSpeedBlendStart = 0.15, -- fraction of top speed where steering starts to stiffen
		ReverseSpeedFraction = 0.35,
		CoastDrag = 0.9,
		BrakeDecel = 1.6, -- multiplier of acceleration
		DriftMinSpeedFraction = 0.45,
		DriftMinSteer = 0.35,
		DriftYawBonus = 1.35,
		DriftLateralGripScale = 0.35,
		DriftTiers = {
			{ Seconds = 1.0, BoostSeconds = 0.55, SpeedBonus = 0.18 },
			{ Seconds = 2.2, BoostSeconds = 0.9, SpeedBonus = 0.24 },
			{ Seconds = 3.6, BoostSeconds = 1.3, SpeedBonus = 0.32 },
		},
		DriftChargeAngleFactorMin = 0.5,
		DriftChargeSpeedFactorMin = 0.6,
		BoostSpeedCapFraction = 1.4, -- absolute cap for server validation (top speed * this)
		StartBoost = {
			-- offsets are seconds relative to the GO timestamp (negative = pressed early)
			TooEarlyBefore = -0.75,
			OkayBefore = -0.4,
			GoodBefore = -0.18,
			PerfectBefore = -0.06,
			PerfectAfter = 0.12,
			GoodAfter = 0.3,
			OkayAfter = 0.5,
			Penalty = { StallSeconds = 0.9 },
			Okay = { BoostSeconds = 0.4, SpeedBonus = 0.1 },
			Good = { BoostSeconds = 0.7, SpeedBonus = 0.18 },
			Perfect = { BoostSeconds = 1.0, SpeedBonus = 0.28 },
		},
		Trick = {
			WindowSeconds = 0.45,
			BoostSeconds = 0.6,
			SpeedBonus = 0.16,
			MinAirSeconds = 0.25,
			CooldownSeconds = 1.5,
		},
		Slipstream = {
			ConeDegrees = 20,
			MaxDistance = 28,
			MinDistance = 4,
			ChargeSeconds = 1.2,
			BoostSeconds = 0.8,
			SpeedBonus = 0.14,
			CooldownSeconds = 2.5,
		},
		HitStun = {
			LightSeconds = 0.7,
			HeavySeconds = 1.3,
			SpinTurns = 1,
			LightSpeedScale = 0.55,
			HeavySpeedScale = 0.25,
			ImmunitySeconds = 1.5,
			MaxChainHits = 1,
		},
		Collision = {
			BumpImpulse = 12,
			WeightExponent = 0.6,
			MinBumpSpeed = 8,
		},
	},

	Shards = {
		MaxHeld = 10,
		SpeedBonusPerShard = 0.006,
		MaxSpeedBonus = 0.06,
		DropOnHeavyHit = 3,
		DropOnLightHit = 1,
		CurrencyPerShardAtFinish = 2,
		PickupRadius = 6,
		RespawnSeconds = 8,
	},

	Items = {
		SlotCount = 2, -- Active + Reserve
		WhenBothSlotsFull = "Skip", -- "Skip" | "ReplaceReserve"
		PickupRadius = 7,
		PadRespawnSeconds = 6,
		UseCooldownSeconds = 0.35,
		StormCrownGlobalCooldownSeconds = 45,
		MaxActiveStrongEffects = 2,
		MaxProjectilesPerPlayer = 3,
	},

	Bots = {
		FillEnabledByDefault = true,
		DefaultDifficulty = "Normal",
		NamePool = {
			"Vex",
			"Orbit",
			"Juniper",
			"Kestrel",
			"Halo",
			"Pixel",
			"Marlow",
			"Cinder",
			"Wren",
			"Zephyr",
			"Tallow",
			"Ripple",
			"Brisk",
			"Sable",
			"Lumen",
			"Quartz",
			"Nimbus",
			"Cobalt",
			"Fable",
			"Tinder",
			"Sprocket",
			"Meadow",
			"Flint",
			"Aurora",
		},
		-- Rubber-banding is bots-only and bounded here.
		RubberBand = { MaxSpeedScaleBehind = 1.06, MinSpeedScaleAhead = 0.94, DistanceRange = 220 },
	},

	Security = {
		SuspicionKick = 60,
		SuspicionDecayPerSecond = 0.5,
		ValidationHz = 5,
		SpeedTolerance = 1.12,
		TeleportDistancePerSecond = 260, -- studs/s beyond which a jump is impossible
		MaxHeightAbovePath = 90,
		MaxAngularVelocity = 14,
		RemoteRateDefaults = { Capacity = 20, RefillPerSecond = 10 },
		MaxTableEntries = 64,
		MaxStringLength = 128,
	},

	Profile = {
		DataStoreName = "RiftRacersProfiles",
		TestScope = "test",
		AutosaveSeconds = 60,
		SessionLockTimeoutSeconds = 120,
		MaxRetries = 5,
		RetryBaseSeconds = 1,
	},

	Camera = {
		Distance = 16,
		Height = 6,
		DistanceSpeedExtra = 5,
		FovBase = 70,
		FovSpeedExtra = 14,
		DriftYawDegrees = 9,
		Smoothing = 8,
		LandingDip = 0.8,
		ReverseDistance = 18,
	},

	UI = {
		DesignResolution = Vector2.new(1920, 1080),
		MinScale = 0.55,
		MaxScale = 1.25,
		HudUpdateHz = 15,
		MinimapUpdateHz = 10,
	},
}

table.freeze(GameConfig.Physics.DriftTiers)
return table.freeze(GameConfig)
