--!strict
-- Music per venue with final-lap pitch-up, pooled 3D SFX with a concurrency cap, engine loop driven by speed.
local SoundService = game:GetService("SoundService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local AudioConfig = require(Shared.Config.AudioConfig)
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local ClientState = require(script.Parent.Parent.ClientState)

local AudioController = { Name = "AudioController" }
AudioController.__index = AudioController

function AudioController.new()
	return setmetatable({ _settings = nil :: any, _kart = nil :: any, _music = nil :: Sound?, _musicKey = "", _engine = nil :: Sound?, _pool = {} :: { Sound }, _active = 0, _group = nil :: SoundGroup?, _musicGroup = nil :: SoundGroup? }, AudioController)
end

local function makeSound(def: AudioConfig.SoundDef, parent: Instance, group: SoundGroup?): Sound
	local s = Instance.new("Sound")
	s.SoundId = def.AssetId
	s.Volume = def.Volume
	s.Looped = def.Looped
	if def.Pitch then
		s.PlaybackSpeed = def.Pitch
	end
	if def.RollOff then
		s.RollOffMaxDistance = def.RollOff
		s.RollOffMinDistance = 8
	end
	s.SoundGroup = group
	s.Parent = parent
	return s
end

function AudioController.Init(self: any, registry: any)
	self._settings = registry:Get("SettingsController")
	self._kart = registry:Get("KartController")
	self._group = Instance.new("SoundGroup")
	self._group.Name = "RiftSfx"
	self._group.Parent = SoundService
	self._musicGroup = Instance.new("SoundGroup")
	self._musicGroup.Name = "RiftMusic"
	self._musicGroup.Parent = SoundService
	self._settings.Changed:Connect(function(s)
		self:ApplyVolumes(s)
	end)
	ClientState.RaceStateChanged:Connect(function(state, view)
		if state == "LoadingTrack" and view then
			self:PlayMusic(view.VenueId)
		elseif state == "Results" then
			self:PlayMusic("Results")
		elseif state == "Lobby" then
			self:PlayMusic("Lobby")
		end
	end)
	ClientState.RaceEvent:Connect(function(name, data)
		if name == "Lap" and data.Lap == (data.Laps or 3) - 1 then
			if self._music then
				self._music.PlaybackSpeed = AudioConfig.Music.FinalLapPitch
			end
		elseif name == "Incoming" then
			self:Play("IncomingWarning")
		elseif name == "Finished" then
			self:Play("Finish")
		elseif name == "Shard" then
			self:Play("ShardPickup")
		elseif name == "Checkpoint" then
			-- silent by design
		end
	end)
	ClientState.KartEffect:Connect(function(name, data)
		if name == "Boost" or name == "StartBoost" then
			self:Play("Boost")
		elseif name == "Hit" then
			self:Play("ItemHit")
		elseif name == "Respawn" then
			self:Play("Respawn")
		elseif name == "Trick" then
			self:Play("Jump")
		end
	end)
	ClientState.ItemState:Connect(function()
		self:Play("ItemPickup")
	end)
	self._kart.Landed:Connect(function()
		self:Play("Land")
	end)
	self._kart.DriftTierChanged:Connect(function(tier)
		if tier > 0 then
			self:Play("DriftTier")
		end
	end)
	ClientState.KartAssigned:Connect(function()
		task.delay(0.6, function()
			self:AttachEngine()
		end)
	end)
end

function AudioController.Start(self: any)
	self:ApplyVolumes(self._settings:Get())
	self:PlayMusic("Lobby")
	task.spawn(function()
		while true do
			self:TickEngine()
			task.wait(0.1)
		end
	end)
end

function AudioController.ApplyVolumes(self: any, s: any)
	if self._group then
		self._group.Volume = s.SfxVolume
	end
	if self._musicGroup then
		self._musicGroup.Volume = s.MusicVolume
	end
end

function AudioController.PlayMusic(self: any, key: string)
	if self._musicKey == key then
		return
	end
	self._musicKey = key
	if self._music then
		self._music:Destroy()
		self._music = nil
	end
	local def = AudioConfig.Music.TrackOverrides[key] or (AudioConfig.Music :: any)[key] or AudioConfig.Music.TrackDefault
	if type(def) ~= "table" then
		def = AudioConfig.Music.TrackDefault
	end
	if def.AssetId == "rbxassetid://0" then
		return -- placeholder: silent until real music is licensed
	end
	self._music = makeSound(def, SoundService, self._musicGroup)
	self._music:Play()
end

function AudioController.Play(self: any, key: string, parent: Instance?)
	local def = (AudioConfig.Sfx :: any)[key] or (AudioConfig.Horns :: any)[key]
	if not def or def.AssetId == "rbxassetid://0" then
		return
	end
	if self._active >= AudioConfig.MaxSimultaneousSfx then
		return
	end
	local s = table.remove(self._pool) or Instance.new("Sound")
	s.SoundId = def.AssetId
	s.Volume = def.Volume
	s.PlaybackSpeed = def.Pitch or 1
	s.SoundGroup = self._group
	s.Parent = parent or (if self._kart.Kart then self._kart.Kart.Chassis else SoundService)
	self._active += 1
	s:Play()
	task.delay(math.max(0.2, s.TimeLength > 0 and s.TimeLength or 2), function()
		self._active -= 1
		s:Stop()
		if #self._pool < AudioConfig.PoolSize then
			table.insert(self._pool, s)
		else
			s:Destroy()
		end
	end)
end

function AudioController.Horn(self: any, heroId: string)
	local hero = HeroDefinitions.ById[heroId]
	if hero then
		self:Play(hero.HornSound)
	end
end

function AudioController.AttachEngine(self: any)
	if self._engine then
		self._engine:Destroy()
	end
	local kart = self._kart.Kart
	if not kart then
		return
	end
	local def = AudioConfig.Sfx.Engine
	if def.AssetId == "rbxassetid://0" then
		return
	end
	self._engine = makeSound(def, kart.Chassis, self._group)
	self._engine:Play()
end

function AudioController.TickEngine(self: any)
	local e = self._engine
	if e and e.Parent then
		local frac = self._kart.SpeedFraction or 0
		e.PlaybackSpeed = 0.7 + frac * 0.9
		e.Volume = AudioConfig.Sfx.Engine.Volume * (0.5 + frac * 0.5)
	end
end

return AudioController
