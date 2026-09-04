--!strict
-- Six original circuits + two battle arenas in a single data format.
-- Geometry is authored as closed Catmull-Rom control loops and built procedurally by Server/Builders/TrackBuilder.
-- Progress positions ("At", "From", "To") are fractions of lap length in [0,1).

export type Difficulty = "Easy" | "EasyMedium" | "Medium" | "MediumHard" | "Hard"

export type SurfaceZone = { From: number, To: number, Surface: string }
export type WidthOverride = { From: number, To: number, Width: number }
export type HazardZone = { Id: string, At: number, To: number?, Kind: "Geyser" | "Press" | "Wind" | "Current" | "Conveyor" | "LavaPool" | "Collapse", Period: number?, Duration: number?, Force: Vector3?, StunLevel: number?, Lateral: number? }
export type JumpDefinition = { Id: string, At: number, GapLength: number, LaunchPitch: number, Trick: boolean }
export type ShortcutDefinition = { Id: string, EntryT: number, ExitT: number, Path: { Vector3 }, Width: number, Surface: string, Difficulty: Difficulty, Gate: { OpenSeconds: number, ClosedSeconds: number }?, RequiresJump: boolean, NameKey: string }
export type ItemSpawnGroup = { At: number, Lateral: { number } }
export type ShardGroup = { At: number, Count: number, Lateral: number, Spacing: number }
export type MovingElement = { Id: string, Kind: "Crane" | "Ring" | "Press" | "Bridge" | "Conveyor" | "Rail" | "Blade", At: number, Lateral: number, Height: number, Period: number, Amplitude: number, Scale: number }
export type DecorItem = { Kind: string, At: number, Lateral: number, Scale: number, Color: Color3?, Height: number? }
export type CameraZone = { From: number, To: number, Distance: number, Height: number, Fov: number }
export type AudioZone = { From: number, To: number, Ambient: string }
export type SpectatorCamera = { At: number, Lateral: number, Height: number }
export type Atmosphere = { SkyColor: Color3, FogColor: Color3, FogEnd: number, Ambient: Color3, ClockTime: number, Brightness: number, GroundColor: Color3, GroundMaterial: Enum.Material, WallColor: Color3, Glow: boolean }

export type TrackDefinition = {
	Id: string,
	NameKey: string,
	DescriptionKey: string,
	Theme: string,
	Difficulty: Difficulty,
	ContentVersion: number,
	Scale: number,
	Path: { Vector3 },
	Width: number,
	WidthOverrides: { WidthOverride },
	CheckpointCount: number,
	GridRows: number,
	GridColumns: number,
	SurfaceZones: { SurfaceZone },
	HazardZones: { HazardZone },
	Jumps: { JumpDefinition },
	Shortcuts: { ShortcutDefinition },
	ItemSpawnGroups: { ItemSpawnGroup },
	ShardGroups: { ShardGroup },
	MovingElements: { MovingElement },
	Decor: { DecorItem },
	Atmosphere: Atmosphere,
	CameraZones: { CameraZone },
	AudioZones: { AudioZone },
	SpectatorCameras: { SpectatorCamera },
	SupportedModes: { string },
	SupportedLapCounts: { number },
	MirrorSupport: boolean,
	MinimapDetail: number,
	KnockoutGates: { number },
	Landmarks: { string },
	UniqueMechanic: string,
}

export type ArenaDefinition = {
	Id: string,
	NameKey: string,
	DescriptionKey: string,
	Theme: string,
	ContentVersion: number,
	Shape: "Bowl" | "Yard",
	Radius: number,
	FloorSurface: string,
	Obstacles: { { Position: Vector3, Size: Vector3, Kind: string, Color: Color3? } },
	ItemPads: { Vector3 },
	ShardSpawns: { Vector3 },
	SpawnPoints: { Vector3 },
	SurfacePatches: { { Position: Vector3, Size: Vector3, Surface: string } },
	Atmosphere: Atmosphere,
	SupportedModes: { string },
}

local V = Vector3.new
local C = Color3.fromRGB

local RACE_MODES = { "QuickRace", "GrandTour", "TimeTrial", "CustomRace", "Knockout", "TeamRace", "Practice" }

local function atm(sky: Color3, fog: Color3, fogEnd: number, ambient: Color3, clock: number, brightness: number, ground: Color3, groundMat: Enum.Material, wall: Color3, glow: boolean): Atmosphere
	return { SkyColor = sky, FogColor = fog, FogEnd = fogEnd, Ambient = ambient, ClockTime = clock, Brightness = brightness, GroundColor = ground, GroundMaterial = groundMat, WallColor = wall, Glow = glow }
end

local Tracks: { TrackDefinition } = {}

-- 8.1 NEON HARBOR CIRCUIT --------------------------------------------------------------------------------------
table.insert(Tracks, {
	Id = "NeonHarborCircuit", NameKey = "TRACK.NEON_HARBOR", DescriptionKey = "TRACK.NEON_HARBOR_DESC", Theme = "Harbor",
	Difficulty = "EasyMedium", ContentVersion = 3, Scale = 2.1,
	Path = {
		V(0, 2, 0), V(0, 2, 210), V(45, 2, 380), V(190, 2, 470), V(360, 2, 480), V(500, 4, 400), V(560, 6, 260),
		V(520, 6, 120), V(600, 8, -20), V(620, 8, -200), V(500, 6, -330), V(320, 4, -360), V(160, 2, -300), V(60, 2, -180), V(0, 2, -80),
	},
	Width = 38,
	WidthOverrides = { { From = 0.0, To = 0.2, Width = 46 } },
	CheckpointCount = 12, GridRows = 6, GridColumns = 2,
	SurfaceZones = { { From = 0.70, To = 0.80, Surface = "Wet" }, { From = 0.335, To = 0.36, Surface = "BoostPad" } },
	HazardZones = {},
	Jumps = { { Id = "HarborRamp", At = 0.36, GapLength = 34, LaunchPitch = 9, Trick = true } },
	Shortcuts = {
		{ Id = "ContainerTerminal", EntryT = 0.60, ExitT = 0.735, Width = 22, Surface = "Asphalt", Difficulty = "Medium", RequiresJump = false, NameKey = "SHORTCUT.CONTAINER_TERMINAL",
			Path = { V(560, 8, -160), V(470, 8, -230), V(430, 8, -190), V(380, 8, -280) } },
	},
	ItemSpawnGroups = { { At = 0.12, Lateral = { -12, -4, 4, 12 } }, { At = 0.45, Lateral = { -12, -4, 4, 12 } }, { At = 0.82, Lateral = { -10, 0, 10 } } },
	ShardGroups = { { At = 0.25, Count = 5, Lateral = 8, Spacing = 9 }, { At = 0.55, Count = 5, Lateral = -8, Spacing = 9 }, { At = 0.9, Count = 4, Lateral = 0, Spacing = 10 } },
	MovingElements = { { Id = "CraneA", Kind = "Crane", At = 0.2, Lateral = 70, Height = 60, Period = 14, Amplitude = 40, Scale = 1 }, { Id = "CraneB", Kind = "Crane", At = 0.52, Lateral = -70, Height = 60, Period = 18, Amplitude = 50, Scale = 1 } },
	Decor = {
		{ Kind = "ContainerStack", At = 0.08, Lateral = 60, Scale = 1, Color = C(220, 80, 60) }, { Kind = "ContainerStack", At = 0.15, Lateral = -60, Scale = 1.2, Color = C(60, 140, 220) },
		{ Kind = "NeonSign", At = 0.3, Lateral = 45, Scale = 1, Color = C(255, 60, 200) }, { Kind = "NeonSign", At = 0.48, Lateral = -45, Scale = 1, Color = C(80, 255, 220) },
		{ Kind = "Lighthouse", At = 0.42, Lateral = 110, Scale = 1.5 }, { Kind = "ContainerStack", At = 0.66, Lateral = 50, Scale = 1, Color = C(240, 200, 60) },
		{ Kind = "Warehouse", At = 0.85, Lateral = 80, Scale = 1 }, { Kind = "NeonSign", At = 0.95, Lateral = 40, Scale = 1, Color = C(255, 200, 40) },
		{ Kind = "WaterPlane", At = 0.5, Lateral = 0, Scale = 1, Height = -12 },
	},
	Atmosphere = atm(C(20, 20, 45), C(30, 25, 60), 1400, C(60, 60, 110), 22, 1.6, C(30, 40, 60), Enum.Material.Water, C(90, 90, 120), true),
	CameraZones = { { From = 0.0, To = 1.0, Distance = 16, Height = 6, Fov = 70 } },
	AudioZones = { { From = 0.0, To = 1.0, Ambient = "Ambient_Harbor" } },
	SpectatorCameras = { { At = 0.0, Lateral = 40, Height = 20 }, { At = 0.36, Lateral = -40, Height = 25 }, { At = 0.7, Lateral = 40, Height = 20 } },
	SupportedModes = RACE_MODES, SupportedLapCounts = { 1, 2, 3, 4, 5 }, MirrorSupport = true, MinimapDetail = 64,
	KnockoutGates = { 0.33, 0.66, 0.999 }, Landmarks = { "Lighthouse", "Cranes", "NeonSigns" }, UniqueMechanic = "WetDockSection",
})

-- 8.2 CLOUDGARDEN RUN ------------------------------------------------------------------------------------------
table.insert(Tracks, {
	Id = "CloudgardenRun", NameKey = "TRACK.CLOUDGARDEN", DescriptionKey = "TRACK.CLOUDGARDEN_DESC", Theme = "Sky",
	Difficulty = "EasyMedium", ContentVersion = 3, Scale = 2.2,
	Path = {
		V(0, 40, 0), V(0, 42, 200), V(80, 48, 340), V(240, 60, 380), V(380, 66, 300), V(420, 58, 150), V(560, 52, 60),
		V(640, 50, -100), V(560, 44, -260), V(380, 40, -320), V(220, 46, -260), V(120, 52, -140), V(30, 46, -70),
	},
	Width = 40,
	WidthOverrides = { { From = 0.28, To = 0.42, Width = 32 } },
	CheckpointCount = 12, GridRows = 6, GridColumns = 2,
	SurfaceZones = { { From = 0.05, To = 0.6, Surface = "Grass" }, { From = 0.62, To = 0.7, Surface = "EnergyLane" }, { From = 0.14, To = 0.16, Surface = "BoostPad" } },
	HazardZones = { { Id = "WindTunnel", At = 0.62, To = 0.7, Kind = "Wind", Force = V(0, 0, 1) * 12 } },
	Jumps = {
		{ Id = "IslandGapA", At = 0.22, GapLength = 60, LaunchPitch = 14, Trick = true },
		{ Id = "IslandGapB", At = 0.5, GapLength = 70, LaunchPitch = 16, Trick = true },
		{ Id = "GardenHop", At = 0.86, GapLength = 30, LaunchPitch = 10, Trick = true },
	},
	Shortcuts = {
		{ Id = "SkyBridge", EntryT = 0.33, ExitT = 0.48, Width = 20, Surface = "EnergyLane", Difficulty = "MediumHard", RequiresJump = true, NameKey = "SHORTCUT.SKY_BRIDGE",
			Path = { V(370, 78, 340), V(450, 96, 240), V(520, 90, 120) } },
	},
	ItemSpawnGroups = { { At = 0.1, Lateral = { -12, -4, 4, 12 } }, { At = 0.42, Lateral = { -10, 0, 10 } }, { At = 0.76, Lateral = { -12, -4, 4, 12 } } },
	ShardGroups = { { At = 0.3, Count = 6, Lateral = 0, Spacing = 8 }, { At = 0.58, Count = 4, Lateral = 10, Spacing = 8 }, { At = 0.93, Count = 5, Lateral = -8, Spacing = 8 } },
	MovingElements = {},
	Decor = {
		{ Kind = "FloatingIsland", At = 0.1, Lateral = 90, Scale = 1.4, Height = -20 }, { Kind = "FloatingIsland", At = 0.4, Lateral = -110, Scale = 1.8, Height = -30 },
		{ Kind = "GardenTree", At = 0.06, Lateral = 32, Scale = 1 }, { Kind = "GardenTree", At = 0.18, Lateral = -30, Scale = 1.3 }, { Kind = "GardenTree", At = 0.56, Lateral = 30, Scale = 1 },
		{ Kind = "Windmill", At = 0.7, Lateral = 60, Scale = 1.5 }, { Kind = "Lantern", At = 0.8, Lateral = 26, Scale = 1, Color = C(255, 220, 120) }, { Kind = "Lantern", At = 0.9, Lateral = -26, Scale = 1, Color = C(255, 220, 120) },
		{ Kind = "CloudPlane", At = 0.5, Lateral = 0, Scale = 1, Height = -60 },
	},
	Atmosphere = atm(C(150, 200, 255), C(200, 225, 255), 2200, C(160, 170, 200), 12, 2.2, C(200, 220, 255), Enum.Material.SmoothPlastic, C(240, 240, 250), false),
	CameraZones = { { From = 0.0, To = 1.0, Distance = 17, Height = 7, Fov = 72 } },
	AudioZones = { { From = 0.0, To = 1.0, Ambient = "Ambient_Sky" } },
	SpectatorCameras = { { At = 0.0, Lateral = 40, Height = 30 }, { At = 0.5, Lateral = 60, Height = 40 } },
	SupportedModes = RACE_MODES, SupportedLapCounts = { 1, 2, 3, 4, 5 }, MirrorSupport = true, MinimapDetail = 64,
	KnockoutGates = { 0.33, 0.66, 0.999 }, Landmarks = { "Windmill", "FloatingIslands" }, UniqueMechanic = "WindTunnelAndIslandGaps",
})

-- 8.3 EMBERGLASS CALDERA ---------------------------------------------------------------------------------------
table.insert(Tracks, {
	Id = "EmberglassCaldera", NameKey = "TRACK.EMBERGLASS", DescriptionKey = "TRACK.EMBERGLASS_DESC", Theme = "Volcano",
	Difficulty = "MediumHard", ContentVersion = 3, Scale = 2.2,
	Path = {
		V(0, 4, 0), V(20, 6, 180), V(120, 14, 320), V(280, 26, 360), V(420, 34, 280), V(440, 40, 120), V(560, 46, 20),
		V(620, 44, -140), V(520, 36, -300), V(340, 26, -380), V(180, 16, -340), V(80, 10, -220), V(10, 6, -90),
	},
	Width = 34,
	WidthOverrides = { { From = 0.45, To = 0.55, Width = 26 } },
	CheckpointCount = 14, GridRows = 6, GridColumns = 2,
	SurfaceZones = { { From = 0.75, To = 0.86, Surface = "EnergyLane" }, { From = 0.3, To = 0.34, Surface = "Hazard" } },
	HazardZones = {
		{ Id = "GeyserA", At = 0.18, Kind = "Geyser", Period = 6, Duration = 1.4, StunLevel = 1, Lateral = -8 },
		{ Id = "GeyserB", At = 0.42, Kind = "Geyser", Period = 7, Duration = 1.4, StunLevel = 1, Lateral = 9 },
		{ Id = "Bridge", At = 0.58, To = 0.62, Kind = "Collapse", Period = 12, Duration = 4 },
		{ Id = "LavaEdge", At = 0.3, To = 0.34, Kind = "LavaPool", StunLevel = 1 },
	},
	Jumps = { { Id = "CalderaLip", At = 0.68, GapLength = 40, LaunchPitch = 12, Trick = true } },
	Shortcuts = {
		{ Id = "MagmaVent", EntryT = 0.36, ExitT = 0.47, Width = 18, Surface = "Asphalt", Difficulty = "Hard", RequiresJump = false, NameKey = "SHORTCUT.MAGMA_VENT",
			Gate = { OpenSeconds = 10, ClosedSeconds = 8 },
			Path = { V(400, 36, 240), V(380, 40, 160), V(430, 42, 90) } },
	},
	ItemSpawnGroups = { { At = 0.09, Lateral = { -10, -3, 3, 10 } }, { At = 0.5, Lateral = { -8, 0, 8 } }, { At = 0.88, Lateral = { -10, -3, 3, 10 } } },
	ShardGroups = { { At = 0.24, Count = 5, Lateral = 6, Spacing = 8 }, { At = 0.64, Count = 5, Lateral = -6, Spacing = 8 }, { At = 0.94, Count = 5, Lateral = 0, Spacing = 8 } },
	MovingElements = { { Id = "BridgeDeck", Kind = "Bridge", At = 0.6, Lateral = 0, Height = 0, Period = 12, Amplitude = 30, Scale = 1 } },
	Decor = {
		{ Kind = "Volcano", At = 0.5, Lateral = -260, Scale = 3, Height = 0 }, { Kind = "ObsidianSpike", At = 0.12, Lateral = 40, Scale = 1.2 }, { Kind = "ObsidianSpike", At = 0.26, Lateral = -44, Scale = 1.6 },
		{ Kind = "ObsidianSpike", At = 0.72, Lateral = 46, Scale = 1.3 }, { Kind = "LavaPlane", At = 0.5, Lateral = 0, Scale = 1, Height = -18 }, { Kind = "EmberVent", At = 0.8, Lateral = -30, Scale = 1, Color = C(255, 140, 40) },
		{ Kind = "TunnelArch", At = 0.78, Lateral = 0, Scale = 1 }, { Kind = "TunnelArch", At = 0.82, Lateral = 0, Scale = 1 },
	},
	Atmosphere = atm(C(60, 20, 20), C(80, 30, 20), 1600, C(120, 60, 50), 19, 1.8, C(40, 20, 20), Enum.Material.CrackedLava, C(50, 40, 45), true),
	CameraZones = { { From = 0.0, To = 1.0, Distance = 16, Height = 6, Fov = 70 }, { From = 0.75, To = 0.86, Distance = 14, Height = 5, Fov = 78 } },
	AudioZones = { { From = 0.0, To = 1.0, Ambient = "Ambient_Lava" } },
	SpectatorCameras = { { At = 0.0, Lateral = 40, Height = 25 }, { At = 0.6, Lateral = -50, Height = 30 } },
	SupportedModes = RACE_MODES, SupportedLapCounts = { 1, 2, 3, 4, 5 }, MirrorSupport = false, MinimapDetail = 72,
	KnockoutGates = { 0.33, 0.66, 0.999 }, Landmarks = { "Volcano", "CollapsingBridge" }, UniqueMechanic = "GatedShortcutAndCollapsingBridge",
})

-- 8.4 FROSTBYTE FOUNDRY ----------------------------------------------------------------------------------------
table.insert(Tracks, {
	Id = "FrostbyteFoundry", NameKey = "TRACK.FROSTBYTE", DescriptionKey = "TRACK.FROSTBYTE_DESC", Theme = "Ice",
	Difficulty = "Hard", ContentVersion = 3, Scale = 2.1,
	Path = {
		V(0, 4, 0), V(-10, 4, 190), V(60, 6, 330), V(220, 8, 380), V(360, 10, 320), V(380, 12, 180), V(480, 14, 60),
		V(600, 12, -60), V(580, 10, -240), V(420, 8, -340), V(240, 6, -330), V(140, 6, -220), V(120, 4, -100), V(40, 4, -60),
	},
	Width = 34,
	WidthOverrides = { { From = 0.5, To = 0.62, Width = 28 } },
	CheckpointCount = 14, GridRows = 6, GridColumns = 2,
	SurfaceZones = {
		{ From = 0.1, To = 0.24, Surface = "Ice" }, { From = 0.38, To = 0.46, Surface = "Ice" }, { From = 0.5, To = 0.66, Surface = "Asphalt" },
		{ From = 0.72, To = 0.8, Surface = "Ice" }, { From = 0.28, To = 0.3, Surface = "BoostPad" },
	},
	HazardZones = {
		{ Id = "PressA", At = 0.33, Kind = "Press", Period = 4, Duration = 0.8, StunLevel = 1, Lateral = -9 },
		{ Id = "PressB", At = 0.55, Kind = "Press", Period = 5, Duration = 0.8, StunLevel = 1, Lateral = 9 },
		{ Id = "ConveyorA", At = 0.84, To = 0.92, Kind = "Conveyor", Force = V(0, 0, 1) * 16 },
	},
	Jumps = { { Id = "FoundryDrop", At = 0.47, GapLength = 28, LaunchPitch = 8, Trick = true } },
	Shortcuts = {
		{ Id = "IceChute", EntryT = 0.12, ExitT = 0.23, Width = 16, Surface = "Ice", Difficulty = "Hard", RequiresJump = false, NameKey = "SHORTCUT.ICE_CHUTE",
			Path = { V(60, 6, 240), V(130, 6, 300), V(200, 8, 330) } },
	},
	ItemSpawnGroups = { { At = 0.06, Lateral = { -10, -3, 3, 10 } }, { At = 0.44, Lateral = { -8, 0, 8 } }, { At = 0.7, Lateral = { -10, -3, 3, 10 } } },
	ShardGroups = { { At = 0.2, Count = 5, Lateral = 0, Spacing = 8 }, { At = 0.6, Count = 5, Lateral = 7, Spacing = 8 }, { At = 0.95, Count = 4, Lateral = -7, Spacing = 8 } },
	MovingElements = {
		{ Id = "PressA", Kind = "Press", At = 0.33, Lateral = -9, Height = 12, Period = 4, Amplitude = 9, Scale = 1 },
		{ Id = "PressB", Kind = "Press", At = 0.55, Lateral = 9, Height = 12, Period = 5, Amplitude = 9, Scale = 1 },
		{ Id = "Belt", Kind = "Conveyor", At = 0.88, Lateral = 0, Height = 0, Period = 2, Amplitude = 1, Scale = 1 },
	},
	Decor = {
		{ Kind = "Smokestack", At = 0.15, Lateral = 60, Scale = 1.5, Color = C(90, 100, 120) }, { Kind = "Smokestack", At = 0.6, Lateral = -60, Scale = 1.8, Color = C(90, 100, 120) },
		{ Kind = "IceSpire", At = 0.3, Lateral = -50, Scale = 1.4 }, { Kind = "IceSpire", At = 0.78, Lateral = 50, Scale = 1.2 }, { Kind = "FurnaceGlow", At = 0.58, Lateral = 30, Scale = 1, Color = C(255, 120, 40) },
		{ Kind = "PipeRun", At = 0.5, Lateral = -40, Scale = 1 }, { Kind = "TunnelArch", At = 0.52, Lateral = 0, Scale = 1 }, { Kind = "TunnelArch", At = 0.64, Lateral = 0, Scale = 1 },
		{ Kind = "SnowPlane", At = 0.5, Lateral = 0, Scale = 1, Height = -6 },
	},
	Atmosphere = atm(C(170, 200, 230), C(190, 210, 235), 1500, C(150, 170, 200), 9, 2.0, C(220, 235, 250), Enum.Material.Snow, C(120, 140, 170), false),
	CameraZones = { { From = 0.0, To = 1.0, Distance = 16, Height = 6, Fov = 70 } },
	AudioZones = { { From = 0.0, To = 1.0, Ambient = "Ambient_Ice" } },
	SpectatorCameras = { { At = 0.0, Lateral = 40, Height = 22 }, { At = 0.33, Lateral = -40, Height = 22 }, { At = 0.84, Lateral = 40, Height = 22 } },
	SupportedModes = RACE_MODES, SupportedLapCounts = { 1, 2, 3, 4, 5 }, MirrorSupport = true, MinimapDetail = 72,
	KnockoutGates = { 0.33, 0.66, 0.999 }, Landmarks = { "Smokestacks", "Presses" }, UniqueMechanic = "IceAndConveyors",
})

-- 8.5 SUNKEN OBSERVATORY ---------------------------------------------------------------------------------------
table.insert(Tracks, {
	Id = "SunkenObservatory", NameKey = "TRACK.SUNKEN_OBSERVATORY", DescriptionKey = "TRACK.SUNKEN_OBSERVATORY_DESC", Theme = "Ocean",
	Difficulty = "Medium", ContentVersion = 3, Scale = 2.2,
	Path = {
		V(0, 4, 0), V(0, 6, 200), V(70, 10, 340), V(230, 14, 400), V(400, 12, 360), V(500, 10, 220), V(470, 8, 80),
		V(560, 6, -60), V(560, 6, -240), V(400, 8, -340), V(220, 8, -330), V(110, 6, -240), V(60, 4, -110),
	},
	Width = 36,
	WidthOverrides = { { From = 0.55, To = 0.65, Width = 30 } },
	CheckpointCount = 13, GridRows = 6, GridColumns = 2,
	SurfaceZones = { { From = 0.2, To = 0.32, Surface = "Wet" }, { From = 0.66, To = 0.72, Surface = "Sand" }, { From = 0.44, To = 0.46, Surface = "BoostPad" } },
	HazardZones = {
		{ Id = "CurrentA", At = 0.24, To = 0.3, Kind = "Current", Force = V(1, 0, 0) * 14 },
		{ Id = "CurrentB", At = 0.68, To = 0.72, Kind = "Current", Force = V(-1, 0, 0) * 14 },
	},
	Jumps = { { Id = "DomeLeap", At = 0.5, GapLength = 32, LaunchPitch = 10, Trick = true } },
	Shortcuts = {
		{ Id = "InnerGallery", EntryT = 0.34, ExitT = 0.47, Width = 18, Surface = "Asphalt", Difficulty = "Medium", RequiresJump = false, NameKey = "SHORTCUT.INNER_GALLERY",
			Path = { V(300, 14, 330), V(340, 16, 260), V(400, 14, 200) } },
	},
	ItemSpawnGroups = { { At = 0.08, Lateral = { -10, -3, 3, 10 } }, { At = 0.4, Lateral = { -8, 0, 8 } }, { At = 0.78, Lateral = { -10, -3, 3, 10 } } },
	ShardGroups = { { At = 0.16, Count = 5, Lateral = 0, Spacing = 8 }, { At = 0.56, Count = 5, Lateral = 8, Spacing = 8 }, { At = 0.9, Count = 5, Lateral = -8, Spacing = 8 } },
	MovingElements = { { Id = "RingA", Kind = "Ring", At = 0.12, Lateral = 0, Height = 14, Period = 9, Amplitude = 1, Scale = 1.2 }, { Id = "RingB", Kind = "Ring", At = 0.6, Lateral = 0, Height = 14, Period = 11, Amplitude = 1, Scale = 1.2 } },
	Decor = {
		{ Kind = "GlassTunnel", At = 0.1, Lateral = 0, Scale = 1 }, { Kind = "GlassTunnel", At = 0.14, Lateral = 0, Scale = 1 }, { Kind = "GlassTunnel", At = 0.58, Lateral = 0, Scale = 1 },
		{ Kind = "Dome", At = 0.42, Lateral = -120, Scale = 2.5 }, { Kind = "Kelp", At = 0.25, Lateral = 40, Scale = 1.2 }, { Kind = "Kelp", At = 0.7, Lateral = -40, Scale = 1.4 },
		{ Kind = "Telescope", At = 0.42, Lateral = -120, Scale = 1.5, Height = 40 }, { Kind = "WaterPlane", At = 0.5, Lateral = 0, Scale = 1, Height = -10 },
	},
	Atmosphere = atm(C(10, 40, 80), C(20, 60, 110), 900, C(40, 90, 140), 13, 1.5, C(30, 60, 90), Enum.Material.Sand, C(60, 120, 160), true),
	CameraZones = { { From = 0.0, To = 1.0, Distance = 16, Height = 6, Fov = 70 } },
	AudioZones = { { From = 0.0, To = 1.0, Ambient = "Ambient_Water" } },
	SpectatorCameras = { { At = 0.0, Lateral = 40, Height = 22 }, { At = 0.42, Lateral = -60, Height = 30 } },
	SupportedModes = RACE_MODES, SupportedLapCounts = { 1, 2, 3, 4, 5 }, MirrorSupport = true, MinimapDetail = 64,
	KnockoutGates = { 0.33, 0.66, 0.999 }, Landmarks = { "Dome", "GlassTunnels" }, UniqueMechanic = "WaterCurrentsAndRotatingRings",
})

-- 8.6 MOONRAIL METRO -------------------------------------------------------------------------------------------
table.insert(Tracks, {
	Id = "MoonrailMetro", NameKey = "TRACK.MOONRAIL", DescriptionKey = "TRACK.MOONRAIL_DESC", Theme = "City",
	Difficulty = "Hard", ContentVersion = 3, Scale = 2.1,
	Path = {
		V(0, 4, 0), V(0, 4, 200), V(60, 10, 340), V(200, 26, 400), V(340, 40, 360), V(420, 48, 220), V(520, 46, 100),
		V(600, 30, -40), V(560, 14, -200), V(440, 8, -320), V(300, 6, -300), V(230, 6, -200), V(150, 4, -240), V(80, 4, -150), V(30, 4, -60),
	},
	Width = 34,
	WidthOverrides = { { From = 0.78, To = 0.98, Width = 26 } },
	CheckpointCount = 14, GridRows = 6, GridColumns = 2,
	SurfaceZones = { { From = 0.26, To = 0.36, Surface = "MagRail" }, { From = 0.58, To = 0.64, Surface = "MagRail" }, { From = 0.5, To = 0.52, Surface = "BoostPad" } },
	HazardZones = {},
	Jumps = { { Id = "RooftopGap", At = 0.4, GapLength = 40, LaunchPitch = 12, Trick = true } },
	Shortcuts = {
		{ Id = "RooftopRun", EntryT = 0.66, ExitT = 0.8, Width = 18, Surface = "Asphalt", Difficulty = "Hard", RequiresJump = true, NameKey = "SHORTCUT.ROOFTOP_RUN",
			Path = { V(500, 40, -260), V(400, 44, -360), V(320, 40, -350) } },
	},
	ItemSpawnGroups = { { At = 0.08, Lateral = { -10, -3, 3, 10 } }, { At = 0.46, Lateral = { -8, 0, 8 } }, { At = 0.74, Lateral = { -10, -3, 3, 10 } } },
	ShardGroups = { { At = 0.18, Count = 5, Lateral = 0, Spacing = 8 }, { At = 0.3, Count = 6, Lateral = 0, Spacing = 8 }, { At = 0.9, Count = 4, Lateral = 6, Spacing = 8 } },
	MovingElements = { { Id = "MonorailTrain", Kind = "Rail", At = 0.3, Lateral = 50, Height = 30, Period = 16, Amplitude = 300, Scale = 1 } },
	Decor = {
		{ Kind = "Skyscraper", At = 0.05, Lateral = 70, Scale = 2 }, { Kind = "Skyscraper", At = 0.12, Lateral = -70, Scale = 2.6 }, { Kind = "Skyscraper", At = 0.5, Lateral = 80, Scale = 3 },
		{ Kind = "Skyscraper", At = 0.7, Lateral = -80, Scale = 2.2 }, { Kind = "Skyscraper", At = 0.88, Lateral = 60, Scale = 1.8 }, { Kind = "Billboard", At = 0.2, Lateral = 40, Scale = 1, Color = C(255, 80, 200) },
		{ Kind = "Billboard", At = 0.44, Lateral = -40, Scale = 1, Color = C(80, 220, 255) }, { Kind = "Billboard", At = 0.94, Lateral = 36, Scale = 1, Color = C(255, 220, 60) },
		{ Kind = "RailPylon", At = 0.28, Lateral = 0, Scale = 1 }, { Kind = "RailPylon", At = 0.33, Lateral = 0, Scale = 1 }, { Kind = "RailPylon", At = 0.6, Lateral = 0, Scale = 1 },
		{ Kind = "MoonDisc", At = 0.5, Lateral = 0, Scale = 1, Height = 400 },
	},
	Atmosphere = atm(C(10, 10, 30), C(15, 15, 40), 1800, C(50, 50, 90), 1, 1.4, C(30, 30, 45), Enum.Material.Concrete, C(70, 70, 100), true),
	CameraZones = { { From = 0.0, To = 1.0, Distance = 16, Height = 6, Fov = 70 }, { From = 0.26, To = 0.36, Distance = 13, Height = 5, Fov = 76 } },
	AudioZones = { { From = 0.0, To = 1.0, Ambient = "Ambient_City" } },
	SpectatorCameras = { { At = 0.0, Lateral = 40, Height = 22 }, { At = 0.3, Lateral = 50, Height = 40 }, { At = 0.85, Lateral = -30, Height = 20 } },
	SupportedModes = RACE_MODES, SupportedLapCounts = { 1, 2, 3, 4, 5 }, MirrorSupport = false, MinimapDetail = 72,
	KnockoutGates = { 0.33, 0.66, 0.999 }, Landmarks = { "Monorail", "Skyscrapers" }, UniqueMechanic = "MagRailSections",
})

local Arenas: { ArenaDefinition } = {
	{
		Id = "PrismBowl", NameKey = "ARENA.PRISM_BOWL", DescriptionKey = "ARENA.PRISM_BOWL_DESC", Theme = "Crystal", ContentVersion = 3, Shape = "Bowl", Radius = 150, FloorSurface = "Asphalt",
		Obstacles = {
			{ Position = V(0, 6, 0), Size = V(24, 12, 24), Kind = "Crystal", Color = C(180, 120, 255) },
			{ Position = V(70, 4, 70), Size = V(14, 8, 14), Kind = "Crystal", Color = C(120, 220, 255) }, { Position = V(-70, 4, 70), Size = V(14, 8, 14), Kind = "Crystal", Color = C(255, 140, 220) },
			{ Position = V(70, 4, -70), Size = V(14, 8, 14), Kind = "Crystal", Color = C(120, 255, 180) }, { Position = V(-70, 4, -70), Size = V(14, 8, 14), Kind = "Crystal", Color = C(255, 220, 120) },
		},
		ItemPads = { V(40, 2, 0), V(-40, 2, 0), V(0, 2, 40), V(0, 2, -40), V(100, 2, 100), V(-100, 2, -100), V(100, 2, -100), V(-100, 2, 100) },
		ShardSpawns = { V(60, 2, 20), V(-60, 2, -20), V(20, 2, -60), V(-20, 2, 60), V(110, 2, 0), V(-110, 2, 0), V(0, 2, 110), V(0, 2, -110), V(80, 2, 40), V(-80, 2, -40) },
		SpawnPoints = { V(120, 3, 0), V(-120, 3, 0), V(0, 3, 120), V(0, 3, -120), V(85, 3, 85), V(-85, 3, -85), V(85, 3, -85), V(-85, 3, 85), V(120, 3, 40), V(-120, 3, -40), V(40, 3, 120), V(-40, 3, -120) },
		SurfacePatches = { { Position = V(0, 0, 100), Size = V(40, 1, 30), Surface = "BoostPad" }, { Position = V(0, 0, -100), Size = V(40, 1, 30), Surface = "BoostPad" } },
		Atmosphere = atm(C(30, 20, 60), C(50, 30, 90), 900, C(110, 80, 160), 20, 1.8, C(60, 40, 100), Enum.Material.Glass, C(140, 100, 220), true),
		SupportedModes = { "CoreClash", "ShardRush" },
	},
	{
		Id = "ScrapworksArena", NameKey = "ARENA.SCRAPWORKS", DescriptionKey = "ARENA.SCRAPWORKS_DESC", Theme = "Scrapyard", ContentVersion = 3, Shape = "Yard", Radius = 160, FloorSurface = "Dirt",
		Obstacles = {
			{ Position = V(0, 5, 60), Size = V(60, 10, 12), Kind = "ScrapWall", Color = C(120, 90, 60) }, { Position = V(0, 5, -60), Size = V(60, 10, 12), Kind = "ScrapWall", Color = C(120, 90, 60) },
			{ Position = V(80, 6, 0), Size = V(16, 12, 40), Kind = "Crusher", Color = C(200, 120, 40) }, { Position = V(-80, 6, 0), Size = V(16, 12, 40), Kind = "Crusher", Color = C(200, 120, 40) },
			{ Position = V(110, 4, 110), Size = V(20, 8, 20), Kind = "TirePile", Color = C(40, 40, 40) }, { Position = V(-110, 4, -110), Size = V(20, 8, 20), Kind = "TirePile", Color = C(40, 40, 40) },
		},
		ItemPads = { V(0, 2, 0), V(50, 2, 30), V(-50, 2, -30), V(120, 2, 0), V(-120, 2, 0), V(0, 2, 120), V(0, 2, -120), V(60, 2, -100) },
		ShardSpawns = { V(30, 2, 0), V(-30, 2, 0), V(0, 2, 30), V(0, 2, -30), V(90, 2, 60), V(-90, 2, -60), V(90, 2, -60), V(-90, 2, 60), V(0, 2, 90), V(0, 2, -90) },
		SpawnPoints = { V(130, 3, 130), V(-130, 3, -130), V(130, 3, -130), V(-130, 3, 130), V(140, 3, 0), V(-140, 3, 0), V(0, 3, 140), V(0, 3, -140), V(60, 3, 140), V(-60, 3, -140), V(140, 3, 60), V(-140, 3, -60) },
		SurfacePatches = { { Position = V(60, 0, 60), Size = V(50, 1, 50), Surface = "Sand" }, { Position = V(-60, 0, -60), Size = V(50, 1, 50), Surface = "Wet" } },
		Atmosphere = atm(C(120, 100, 80), C(150, 130, 100), 1100, C(140, 120, 100), 17, 2.0, C(100, 80, 60), Enum.Material.Ground, C(90, 70, 50), false),
		SupportedModes = { "CoreClash", "ShardRush" },
	},
}

local trackById: { [string]: TrackDefinition } = {}
for _, t in Tracks do
	assert(trackById[t.Id] == nil, "duplicate track id " .. t.Id)
	trackById[t.Id] = table.freeze(t) :: TrackDefinition
end
local arenaById: { [string]: ArenaDefinition } = {}
for _, a in Arenas do
	assert(arenaById[a.Id] == nil, "duplicate arena id " .. a.Id)
	arenaById[a.Id] = table.freeze(a) :: ArenaDefinition
end

return table.freeze({
	Tracks = table.freeze(Tracks),
	TrackById = table.freeze(trackById),
	Arenas = table.freeze(Arenas),
	ArenaById = table.freeze(arenaById),
	PracticeTrackId = "NeonHarborCircuit",
})
