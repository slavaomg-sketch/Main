--!strict
-- Exports the Luau content definitions (single source of truth) to JSON for the web build.
local fs = require("@lune/fs")
local serde = require("@lune/serde")
local RobloxEnv = require("../tests/Lune/RobloxEnv")
RobloxEnv.Reset()

local function conv(v: any, depth: number?): any
	local d = depth or 0
	local t = typeof(v)
	if t == "Vector3" then
		return { v.X, v.Y, v.Z }
	elseif t == "Vector2" then
		return { v.X, v.Y }
	elseif t == "Color3" then
		return string.format("#%02x%02x%02x", math.floor(v.R * 255 + 0.5), math.floor(v.G * 255 + 0.5), math.floor(v.B * 255 + 0.5))
	elseif t == "EnumItem" then
		return v.Name
	elseif t == "table" then
		if d > 8 then
			return nil
		end
		local out = {}
		local isArray = #v > 0
		if next(v) == nil then
			return setmetatable({}, { __jsonarray = true }) -- empty: caller decides (see fixEmpty)
		end
		if isArray then
			for i, x in ipairs(v) do
				out[i] = conv(x, d + 1)
			end
		else
			for k, x in pairs(v) do
				if type(k) == "string" and type(x) ~= "function" then
					out[k] = conv(x, d + 1)
				end
			end
		end
		return out
	elseif t == "function" then
		return nil
	end
	return v
end

local GameConfig = RobloxEnv.Load("Shared/Config/GameConfig")
local Heroes = RobloxEnv.Load("Shared/Config/HeroDefinitions")
local Vehicles = RobloxEnv.Load("Shared/Config/VehicleDefinitions")
local Tracks = RobloxEnv.Load("Shared/Config/TrackDefinitions")
local Items = RobloxEnv.Load("Shared/Config/ItemDefinitions")
local Modes = RobloxEnv.Load("Shared/Config/ModeDefinitions")
local Surfaces = RobloxEnv.Load("Shared/Config/SurfaceDefinitions")
local Rewards = RobloxEnv.Load("Shared/Config/RewardConfig")
local Strings = RobloxEnv.Load("Shared/Locale/Strings")

local out = {
	ProjectName = GameConfig.ProjectName,
	Physics = conv(GameConfig.Physics),
	Shards = conv(GameConfig.Shards),
	Items = conv(GameConfig.Items),
	Race = conv(GameConfig.Race),
	Bots = conv(GameConfig.Bots),
	Heroes = conv(Heroes.List),
	Vehicles = conv(Vehicles.List),
	Tracks = conv(Tracks.Tracks),
	Arenas = conv(Tracks.Arenas),
	ItemDefs = conv(Items.List),
	Modes = conv(Modes.List),
	GrandTourPoints = conv(Modes.GrandTourPoints),
	Surfaces = conv(Surfaces),
	Rewards = { Currency = conv(Rewards.Currency), XP = conv(Rewards.XP), LevelBaseXP = Rewards.LevelBaseXP, LevelExponent = Rewards.LevelExponent, MaxLevel = Rewards.MaxLevel },
	Strings = conv(Strings),
}
if not fs.isDir("web") then
	fs.writeDir("web")
end
local json = serde.encode("json", out, false)
-- Known list-valued keys must be arrays even when empty.
for _, key in { "HazardZones", "Jumps", "Shortcuts", "MovingElements", "Decor", "WidthOverrides", "SurfaceZones", "ItemSpawnGroups", "ShardGroups", "CameraZones", "AudioZones", "SpectatorCameras", "KnockoutGates", "Landmarks", "Obstacles", "ItemPads", "ShardSpawns", "SpawnPoints", "SurfacePatches", "SupportedModes", "SupportedLapCounts", "Lateral", "Path" } do
	json = json:gsub('"' .. key .. '":{}', '"' .. key .. '":[]')
end
fs.writeFile("web/content.json", json)
print("exported web/content.json", #serde.encode("json", out, false), "bytes")
