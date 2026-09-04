--!strict
-- Every remote in the game with its direction, argument schema, rate limit and allowed race states.
-- Clients send INTENT only; the server decides everything.
local NetworkTypes = require(script.Parent.Parent.Types.NetworkTypes)
local HeroDefinitions = require(script.Parent.Parent.Config.HeroDefinitions)
local VehicleDefinitions = require(script.Parent.Parent.Config.VehicleDefinitions)
local ItemDefinitions = require(script.Parent.Parent.Config.ItemDefinitions)
local TrackDefinitions = require(script.Parent.Parent.Config.TrackDefinitions)
local ModeDefinitions = require(script.Parent.Parent.Config.ModeDefinitions)
local GameConfig = require(script.Parent.Parent.Config.GameConfig)

type F = NetworkTypes.FieldSchema
type R = NetworkTypes.RemoteDefinition

local function ids<T>(list: { T }, key: string): { string }
	local out = {}
	for _, v in list do
		table.insert(out, (v :: any)[key])
	end
	return out
end

local heroIds = ids(HeroDefinitions.List, "Id")
local vehicleIds = ids(VehicleDefinitions.List, "Id")
local itemIds = ids(ItemDefinitions.List, "Id")
local trackIds = ids(TrackDefinitions.Tracks, "Id")
local arenaIds = ids(TrackDefinitions.Arenas, "Id")
local modeIds = ids(ModeDefinitions.List, "Id")
local allVenueIds = table.clone(trackIds)
for _, a in arenaIds do
	table.insert(allVenueIds, a)
end

local str: F = { Type = "string", MaxLength = GameConfig.Security.MaxStringLength }
local bool: F = { Type = "boolean" }
local num01: F = { Type = "number", Min = 0, Max = 1 }
local smallInt: F = { Type = "integer", Min = 0, Max = 64 }
local anyTable: F = { Type = "any", MaxEntries = GameConfig.Security.MaxTableEntries }

local settingsSchema: F = {
	Type = "table",
	MaxEntries = 32,
	Fields = {
		SteerSensitivity = { Type = "number", Min = 0.3, Max = 2, Optional = true },
		InvertCamera = { Type = "boolean", Optional = true },
		AutoAccelerate = { Type = "boolean", Optional = true },
		TrackAssist = { Type = "boolean", Optional = true },
		Vibration = { Type = "number", Min = 0, Max = 1, Optional = true },
		CameraShake = { Type = "number", Min = 0, Max = 1, Optional = true },
		SpeedFov = { Type = "number", Min = 0, Max = 1, Optional = true },
		MusicVolume = { Type = "number", Min = 0, Max = 1, Optional = true },
		SfxVolume = { Type = "number", Min = 0, Max = 1, Optional = true },
		MobileLayout = { Type = "enum", Values = { "Left", "Right" }, Optional = true },
		MobileControlScale = { Type = "number", Min = 0.6, Max = 1.6, Optional = true },
		MobileControlAlpha = { Type = "number", Min = 0.1, Max = 1, Optional = true },
		ReducedMotion = { Type = "boolean", Optional = true },
		Locale = { Type = "enum", Values = { "en", "ru" }, Optional = true },
		TiltSteering = { Type = "boolean", Optional = true },
	},
}

local customRulesSchema: F = {
	Type = "table",
	MaxEntries = 48,
	Fields = {
		TrackId = { Type = "enum", Values = trackIds, Optional = true },
		Laps = { Type = "integer", Min = 1, Max = 7, Optional = true },
		BotCount = { Type = "integer", Min = 0, Max = 11, Optional = true },
		BotDifficulty = { Type = "enum", Values = { "Easy", "Normal", "Hard" }, Optional = true },
		AllowedItems = { Type = "table", Item = { Type = "enum", Values = itemIds }, MaxEntries = 16, Optional = true },
		Teams = { Type = "integer", Min = 0, Max = 4, Optional = true },
		SpeedClass = { Type = "enum", Values = { "Standard", "Swift", "Rift" }, Optional = true },
		Mirror = { Type = "boolean", Optional = true },
		CollisionsEnabled = { Type = "boolean", Optional = true },
		AssistMode = { Type = "boolean", Optional = true },
		ItemsEnabled = { Type = "boolean", Optional = true },
	},
}

local Definitions: { R } = {
	-- Client -> Server intents
	{ Name = "ClientReady", Direction = "ClientToServer", Args = {}, RateCapacity = 3, RateRefill = 0.2 },
	{
		Name = "SelectLoadout",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = heroIds }, { Type = "enum", Values = vehicleIds } },
		RateCapacity = 10,
		RateRefill = 2,
	},
	{
		Name = "SelectCosmetic",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = { "Paint", "Trail", "Horn", "Deco" } }, str },
		RateCapacity = 10,
		RateRefill = 2,
	},
	{
		Name = "RequestUnlock",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = { "Hero", "Vehicle", "Cosmetic" } }, str, str },
		RateCapacity = 5,
		RateRefill = 0.5,
	},
	{
		Name = "UpdateSettings",
		Direction = "ClientToServer",
		Args = { settingsSchema },
		RateCapacity = 5,
		RateRefill = 1,
	},
	{
		Name = "TutorialProgress",
		Direction = "ClientToServer",
		Args = { { Type = "integer", Min = 0, Max = 16 } },
		RateCapacity = 10,
		RateRefill = 1,
	},
	{
		Name = "PartyAction",
		Direction = "ClientToServer",
		Args = {
			{ Type = "enum", Values = { "Create", "Invite", "Accept", "Decline", "Leave", "Kick" } },
			{ Type = "integer", Min = 0, Max = 2 ^ 48, Optional = true },
		},
		RateCapacity = 10,
		RateRefill = 2,
	},
	{
		Name = "QueueAction",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = { "Join", "Leave" } }, { Type = "enum", Values = modeIds, Optional = true } },
		RateCapacity = 6,
		RateRefill = 1,
	},
	{
		Name = "CustomRoomAction",
		Direction = "ClientToServer",
		Args = {
			{ Type = "enum", Values = { "Create", "Update", "Start", "Close", "Join", "Leave" } },
			customRulesSchema,
			{ Type = "integer", Min = 0, Max = 2 ^ 48, Optional = true },
		},
		RateCapacity = 8,
		RateRefill = 1,
	},
	{
		Name = "StartMode",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = modeIds }, { Type = "enum", Values = allVenueIds, Optional = true } },
		RateCapacity = 4,
		RateRefill = 0.5,
	},
	{
		Name = "VoteTrack",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = allVenueIds } },
		RateCapacity = 6,
		RateRefill = 1,
		RequiredStates = { "TrackVote" },
	},
	{
		Name = "LoadoutConfirm",
		Direction = "ClientToServer",
		Args = {},
		RateCapacity = 4,
		RateRefill = 1,
		RequiredStates = { "LoadoutLock", "GridSetup" },
	},
	{
		Name = "TrackLoaded",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = allVenueIds } },
		RateCapacity = 4,
		RateRefill = 0.5,
	},
	{
		Name = "StartThrottle",
		Direction = "ClientToServer",
		Args = {},
		RateCapacity = 3,
		RateRefill = 0.5,
		RequiredStates = { "Countdown", "Racing" },
	},
	{
		Name = "DriftEvent",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = { "Start", "Release", "Cancel" } }, { Type = "integer", Min = 0, Max = 3 } },
		RateCapacity = 12,
		RateRefill = 4,
		RequiredStates = { "Racing", "FinishWindow" },
	},
	{
		Name = "TrickEvent",
		Direction = "ClientToServer",
		Args = { str },
		RateCapacity = 6,
		RateRefill = 2,
		RequiredStates = { "Racing", "FinishWindow" },
	},
	{
		Name = "UseItem",
		Direction = "ClientToServer",
		Args = {
			{ Type = "enum", Values = { "Active", "Reserve" } },
			{ Type = "vector3", Max = 1.001, Optional = true },
		},
		RateCapacity = 6,
		RateRefill = 3,
		RequiredStates = { "Racing", "FinishWindow" },
	},
	{
		Name = "RequestRespawn",
		Direction = "ClientToServer",
		Args = {},
		RateCapacity = 3,
		RateRefill = 0.5,
		RequiredStates = { "Racing", "FinishWindow", "Countdown" },
	},
	{
		Name = "PostRaceChoice",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = { "NextRace", "ContinueTour", "Lobby" } } },
		RateCapacity = 4,
		RateRefill = 1,
		RequiredStates = { "Results", "Rewards", "Returning" },
	},
	{
		Name = "SpectateAction",
		Direction = "ClientToServer",
		Args = { { Type = "enum", Values = { "Next", "Prev" } } },
		RateCapacity = 6,
		RateRefill = 2,
	},
	{ Name = "ClientTelemetry", Direction = "ClientToServer", Args = { anyTable }, RateCapacity = 2, RateRefill = 0.1 },

	-- Server -> Client events
	{ Name = "ProfileLoaded", Direction = "ServerToClient", Args = { anyTable, str } },
	{ Name = "ProfileUpdated", Direction = "ServerToClient", Args = { anyTable } },
	{ Name = "LobbyState", Direction = "ServerToClient", Args = { anyTable } },
	{ Name = "PartyState", Direction = "ServerToClient", Args = { anyTable } },
	{ Name = "QueueState", Direction = "ServerToClient", Args = { anyTable } },
	{ Name = "RaceState", Direction = "ServerToClient", Args = { str, anyTable } },
	{ Name = "RaceSnapshot", Direction = "ServerToClient", Args = { anyTable } },
	{ Name = "RaceEvent", Direction = "ServerToClient", Args = { str, anyTable } },
	{ Name = "ItemState", Direction = "ServerToClient", Args = { anyTable } },
	{ Name = "KartAssigned", Direction = "ServerToClient", Args = { anyTable, anyTable } },
	{ Name = "KartEffect", Direction = "ServerToClient", Args = { str, anyTable } },
	{ Name = "Results", Direction = "ServerToClient", Args = { anyTable, anyTable } },
	{ Name = "ErrorDialog", Direction = "ServerToClient", Args = { str, anyTable } },
	{ Name = "Tutorial", Direction = "ServerToClient", Args = { smallInt } },
	{ Name = "GhostData", Direction = "ServerToClient", Args = { anyTable } },
	{ Name = "VisualEvent", Direction = "ServerToClient", Args = { str, anyTable } },

	-- Functions (client -> server request/response)
	{ Name = "GetCatalog", Direction = "Function", Args = {}, RateCapacity = 3, RateRefill = 0.5 },
	{
		Name = "GetRecords",
		Direction = "Function",
		Args = { { Type = "enum", Values = trackIds } },
		RateCapacity = 4,
		RateRefill = 1,
	},
}

local byName: { [string]: R } = {}
for _, d in Definitions do
	assert(byName[d.Name] == nil, "duplicate remote " .. d.Name)
	byName[d.Name] = d
end

return table.freeze({ List = table.freeze(Definitions), ByName = table.freeze(byName), Bool = bool, Num01 = num01 })
