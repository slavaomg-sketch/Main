--!strict
-- Eight original vehicles. DisplayStats (0-100) are for UI; Physics holds real tunables used by KartController and validation.
export type VehicleKind = "Kart" | "Buggy" | "Rover" | "Trike" | "Hover" | "Bolide"

export type DisplayStats = {
	TopSpeed: number,
	Acceleration: number,
	Handling: number,
	Grip: number,
	DriftControl: number,
	Weight: number,
	OffroadEfficiency: number,
	BoostEfficiency: number,
	AirControl: number,
	Recovery: number,
}

export type VehiclePhysics = {
	TopSpeed: number, -- studs/s
	Acceleration: number, -- studs/s^2 at standstill
	SteerRate: number, -- multiplier on GameConfig steer rates
	Grip: number, -- lateral grip gain
	DriftControl: number, -- how much steering the player retains while drifting (0..1)
	Mass: number,
	OffroadEfficiency: number, -- 1 = ignores offroad penalty
	BoostEfficiency: number, -- multiplier on boost durations
	AirControl: number,
	Recovery: number, -- multiplier reducing hit stun duration
	Hover: boolean,
}

export type VehicleVisual = {
	Kind: VehicleKind,
	BodySize: Vector3,
	CabinSize: Vector3,
	WheelRadius: number,
	WheelWidth: number,
	WheelCount: number,
	PrimaryColor: Color3,
	SecondaryColor: Color3,
	AccentColor: Color3,
	Material: Enum.Material,
	Silhouette: "Wedge" | "Box" | "Pod" | "Long" | "Wide",
}

export type VehicleDefinition = {
	Id: string,
	NameKey: string,
	DescriptionKey: string,
	Display: DisplayStats,
	Physics: VehiclePhysics,
	Visual: VehicleVisual,
	Unlock: { Kind: "Default" }
		| { Kind: "Level", Level: number }
		| { Kind: "Currency", Cost: number }
		| { Kind: "Achievement", Id: string },
	SortOrder: number,
}

-- Physical envelope: everything must fit in this collision box so combos stay fair.
local COLLISION_BOX = Vector3.new(6, 3, 9)

local function display(
	top: number,
	acc: number,
	han: number,
	grip: number,
	drift: number,
	w: number,
	off: number,
	boost: number,
	air: number,
	rec: number
): DisplayStats
	return {
		TopSpeed = top,
		Acceleration = acc,
		Handling = han,
		Grip = grip,
		DriftControl = drift,
		Weight = w,
		OffroadEfficiency = off,
		BoostEfficiency = boost,
		AirControl = air,
		Recovery = rec,
	}
end

local function physics(
	top: number,
	acc: number,
	steer: number,
	grip: number,
	drift: number,
	mass: number,
	off: number,
	boost: number,
	air: number,
	rec: number,
	hover: boolean?
): VehiclePhysics
	return {
		TopSpeed = top,
		Acceleration = acc,
		SteerRate = steer,
		Grip = grip,
		DriftControl = drift,
		Mass = mass,
		OffroadEfficiency = off,
		BoostEfficiency = boost,
		AirControl = air,
		Recovery = rec,
		Hover = hover or false,
	}
end

local function visual(
	kind: VehicleKind,
	body: Vector3,
	cabin: Vector3,
	wr: number,
	ww: number,
	wc: number,
	p: Color3,
	s: Color3,
	a: Color3,
	mat: Enum.Material,
	sil: "Wedge" | "Box" | "Pod" | "Long" | "Wide"
): VehicleVisual
	return {
		Kind = kind,
		BodySize = body,
		CabinSize = cabin,
		WheelRadius = wr,
		WheelWidth = ww,
		WheelCount = wc,
		PrimaryColor = p,
		SecondaryColor = s,
		AccentColor = a,
		Material = mat,
		Silhouette = sil,
	}
end

local VehicleDefinitions: { VehicleDefinition } = {
	{
		Id = "CometMk1",
		NameKey = "VEHICLE.COMET_MK1",
		DescriptionKey = "VEHICLE.COMET_MK1_DESC",
		SortOrder = 1,
		Unlock = { Kind = "Default" },
		Display = display(62, 62, 64, 62, 60, 55, 50, 60, 55, 60),
		Physics = physics(92, 38, 1.0, 9.0, 0.6, 100, 0.55, 1.0, 1.0, 1.0),
		Visual = visual(
			"Kart",
			Vector3.new(4.4, 1.2, 7.2),
			Vector3.new(2.4, 1.2, 2.2),
			1.05,
			0.9,
			4,
			Color3.fromRGB(40, 110, 230),
			Color3.fromRGB(235, 235, 245),
			Color3.fromRGB(255, 200, 60),
			Enum.Material.SmoothPlastic,
			"Wedge"
		),
	},
	{
		Id = "FinchSpark",
		NameKey = "VEHICLE.FINCH_SPARK",
		DescriptionKey = "VEHICLE.FINCH_SPARK_DESC",
		SortOrder = 2,
		Unlock = { Kind = "Default" },
		Display = display(50, 88, 72, 60, 62, 35, 45, 62, 66, 70),
		Physics = physics(90, 54, 1.12, 9.2, 0.62, 78, 0.5, 1.02, 1.15, 1.12),
		Visual = visual(
			"Trike",
			Vector3.new(3.6, 1.1, 6.4),
			Vector3.new(2.2, 1.1, 2.0),
			0.95,
			0.8,
			3,
			Color3.fromRGB(255, 200, 40),
			Color3.fromRGB(50, 50, 60),
			Color3.fromRGB(80, 220, 255),
			Enum.Material.SmoothPlastic,
			"Pod"
		),
	},
	{
		Id = "IronYak",
		NameKey = "VEHICLE.IRON_YAK",
		DescriptionKey = "VEHICLE.IRON_YAK_DESC",
		SortOrder = 3,
		Unlock = { Kind = "Default" },
		Display = display(66, 44, 48, 74, 45, 92, 66, 52, 40, 48),
		Physics = physics(94, 30, 0.86, 11.0, 0.45, 145, 0.7, 0.92, 0.8, 0.85),
		Visual = visual(
			"Rover",
			Vector3.new(5.4, 1.8, 8.2),
			Vector3.new(3.4, 1.4, 2.8),
			1.35,
			1.2,
			4,
			Color3.fromRGB(90, 80, 70),
			Color3.fromRGB(180, 120, 50),
			Color3.fromRGB(230, 120, 40),
			Enum.Material.Metal,
			"Box"
		),
	},
	{
		Id = "TideSkimmer",
		NameKey = "VEHICLE.TIDE_SKIMMER",
		DescriptionKey = "VEHICLE.TIDE_SKIMMER_DESC",
		SortOrder = 4,
		Unlock = { Kind = "Level", Level = 2 },
		Display = display(58, 60, 80, 82, 55, 50, 48, 58, 58, 62),
		Physics = physics(90, 37, 1.18, 12.5, 0.55, 96, 0.52, 0.98, 1.05, 1.02),
		Visual = visual(
			"Hover",
			Vector3.new(4.6, 1.0, 7.6),
			Vector3.new(2.6, 1.0, 2.4),
			0.8,
			0.7,
			4,
			Color3.fromRGB(40, 170, 190),
			Color3.fromRGB(230, 250, 255),
			Color3.fromRGB(255, 120, 150),
			Enum.Material.Glass,
			"Long"
		),
	},
	{
		Id = "EmberFang",
		NameKey = "VEHICLE.EMBER_FANG",
		DescriptionKey = "VEHICLE.EMBER_FANG_DESC",
		SortOrder = 5,
		Unlock = { Kind = "Level", Level = 4 },
		Display = display(90, 58, 42, 52, 50, 62, 40, 66, 50, 55),
		Physics = physics(97, 34, 0.78, 8.2, 0.5, 108, 0.45, 1.06, 0.95, 0.95),
		Visual = visual(
			"Bolide",
			Vector3.new(4.2, 1.0, 8.4),
			Vector3.new(2.2, 1.0, 2.6),
			1.0,
			0.9,
			4,
			Color3.fromRGB(200, 60, 30),
			Color3.fromRGB(40, 30, 30),
			Color3.fromRGB(255, 170, 40),
			Enum.Material.SmoothPlastic,
			"Long"
		),
	},
	{
		Id = "PrismPod",
		NameKey = "VEHICLE.PRISM_POD",
		DescriptionKey = "VEHICLE.PRISM_POD_DESC",
		SortOrder = 6,
		Unlock = { Kind = "Currency", Cost = 1800 },
		Display = display(60, 64, 70, 56, 92, 42, 44, 62, 62, 72),
		Physics = physics(91, 40, 1.1, 8.8, 0.85, 88, 0.48, 1.02, 1.1, 1.15),
		Visual = visual(
			"Hover",
			Vector3.new(4.0, 1.3, 6.8),
			Vector3.new(2.8, 1.3, 2.8),
			0.85,
			0.8,
			4,
			Color3.fromRGB(220, 220, 230),
			Color3.fromRGB(90, 90, 110),
			Color3.fromRGB(120, 255, 120),
			Enum.Material.Neon,
			"Pod"
		),
	},
	{
		Id = "GlacierMule",
		NameKey = "VEHICLE.GLACIER_MULE",
		DescriptionKey = "VEHICLE.GLACIER_MULE_DESC",
		SortOrder = 7,
		Unlock = { Kind = "Level", Level = 7 },
		Display = display(56, 52, 56, 88, 50, 80, 92, 54, 44, 58),
		Physics = physics(90, 35, 0.94, 13.5, 0.5, 130, 0.95, 0.94, 0.85, 0.98),
		Visual = visual(
			"Buggy",
			Vector3.new(5.0, 1.6, 7.8),
			Vector3.new(3.0, 1.4, 2.6),
			1.3,
			1.2,
			4,
			Color3.fromRGB(120, 170, 190),
			Color3.fromRGB(240, 250, 255),
			Color3.fromRGB(90, 140, 90),
			Enum.Material.Metal,
			"Wide"
		),
	},
	{
		Id = "QuillRunner",
		NameKey = "VEHICLE.QUILL_RUNNER",
		DescriptionKey = "VEHICLE.QUILL_RUNNER_DESC",
		SortOrder = 8,
		Unlock = { Kind = "Currency", Cost = 2200 },
		Display = display(64, 60, 62, 58, 64, 48, 46, 90, 88, 64),
		Physics = physics(93, 37, 1.0, 9.0, 0.66, 94, 0.5, 1.2, 1.35, 1.05),
		Visual = visual(
			"Kart",
			Vector3.new(4.2, 1.1, 7.4),
			Vector3.new(2.4, 1.1, 2.2),
			1.0,
			0.85,
			4,
			Color3.fromRGB(240, 150, 40),
			Color3.fromRGB(120, 60, 140),
			Color3.fromRGB(255, 240, 200),
			Enum.Material.SmoothPlastic,
			"Wedge"
		),
	},
}

local byId: { [string]: VehicleDefinition } = {}
for _, v in VehicleDefinitions do
	assert(byId[v.Id] == nil, "duplicate vehicle id " .. v.Id)
	assert(
		v.Visual.BodySize.X <= COLLISION_BOX.X and v.Visual.BodySize.Z <= COLLISION_BOX.Z,
		"vehicle exceeds collision envelope " .. v.Id
	)
	byId[v.Id] = table.freeze(v) :: VehicleDefinition
end

return table.freeze({
	List = table.freeze(VehicleDefinitions),
	ById = table.freeze(byId),
	CollisionBox = COLLISION_BOX,
	DefaultVehicleId = "CometMk1",
})
