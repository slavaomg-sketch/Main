--!strict
-- Every sound/music asset id lives here. Placeholder ids are Roblox-provided library sounds (free to use inside Roblox)
-- and must be swapped for original/licensed assets before public release. See docs/ASSET_MANIFEST.md.
export type SoundDef = { AssetId: string, Volume: number, Looped: boolean, Pitch: number?, RollOff: number?, Is3D: boolean }

local function s(assetId: string, volume: number, looped: boolean?, is3d: boolean?, pitch: number?): SoundDef
	return { AssetId = assetId, Volume = volume, Looped = looped or false, Pitch = pitch, RollOff = if is3d then 80 else nil, Is3D = is3d or false }
end

local PLACEHOLDER = "rbxassetid://0" -- silent until replaced; AudioController tolerates missing ids gracefully

local AudioConfig = {
	MaxSimultaneousSfx = 24,
	PoolSize = 32,
	Music = {
		Lobby = s(PLACEHOLDER, 0.35, true),
		Results = s(PLACEHOLDER, 0.4, true),
		TrackDefault = s(PLACEHOLDER, 0.35, true),
		FinalLapPitch = 1.06,
		TrackOverrides = {
			NeonHarborCircuit = s(PLACEHOLDER, 0.35, true),
			CloudgardenRun = s(PLACEHOLDER, 0.35, true),
			EmberglassCaldera = s(PLACEHOLDER, 0.35, true),
			FrostbyteFoundry = s(PLACEHOLDER, 0.35, true),
			SunkenObservatory = s(PLACEHOLDER, 0.35, true),
			MoonrailMetro = s(PLACEHOLDER, 0.35, true),
		},
	},
	Sfx = {
		Engine = s(PLACEHOLDER, 0.5, true, true),
		Boost = s(PLACEHOLDER, 0.7, false, true),
		DriftLoop = s(PLACEHOLDER, 0.5, true, true),
		DriftTier = s(PLACEHOLDER, 0.6, false, true),
		Collision = s(PLACEHOLDER, 0.6, false, true),
		Jump = s(PLACEHOLDER, 0.5, false, true),
		Land = s(PLACEHOLDER, 0.5, false, true),
		ItemPickup = s(PLACEHOLDER, 0.6),
		ItemUse = s(PLACEHOLDER, 0.6, false, true),
		ItemHit = s(PLACEHOLDER, 0.7, false, true),
		IncomingWarning = s(PLACEHOLDER, 0.7),
		CountdownTick = s(PLACEHOLDER, 0.8),
		CountdownGo = s(PLACEHOLDER, 0.9),
		Finish = s(PLACEHOLDER, 0.8),
		UIClick = s(PLACEHOLDER, 0.5),
		UIHover = s(PLACEHOLDER, 0.3),
		ShardPickup = s(PLACEHOLDER, 0.5),
		Respawn = s(PLACEHOLDER, 0.6),
		WrongWay = s(PLACEHOLDER, 0.5),
		Ambient_Harbor = s(PLACEHOLDER, 0.3, true),
		Ambient_Sky = s(PLACEHOLDER, 0.3, true),
		Ambient_Lava = s(PLACEHOLDER, 0.3, true),
		Ambient_Ice = s(PLACEHOLDER, 0.3, true),
		Ambient_Water = s(PLACEHOLDER, 0.3, true),
		Ambient_City = s(PLACEHOLDER, 0.3, true),
	},
	Horns = {
		HornCourier = s(PLACEHOLDER, 0.6, false, true),
		HornSpark = s(PLACEHOLDER, 0.6, false, true),
		HornWood = s(PLACEHOLDER, 0.6, false, true),
		HornSonar = s(PLACEHOLDER, 0.6, false, true),
		HornBlaze = s(PLACEHOLDER, 0.6, false, true),
		HornChirp = s(PLACEHOLDER, 0.6, false, true),
		HornHorn = s(PLACEHOLDER, 0.6, false, true),
		HornFlute = s(PLACEHOLDER, 0.6, false, true),
		Horn_Whistle = s(PLACEHOLDER, 0.6, false, true),
	},
}

return table.freeze(AudioConfig)
