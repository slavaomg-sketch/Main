--!strict
-- Accessibility & preferences: locale, reduced motion, sensitivities, volumes, mobile layout. Persisted via server.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Locale = require(Shared.Locale.Locale)
local Signal = require(Shared.Utility.Signal)
local Network = require(Shared.Net.Network)
local GameTypes = require(Shared.Types.GameTypes)
local ClientState = require(script.Parent.Parent.ClientState)

local SettingsController = { Name = "SettingsController" }
SettingsController.__index = SettingsController

local DEFAULTS: GameTypes.PlayerSettings = {
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
}

function SettingsController.new()
	return setmetatable({ Settings = table.clone(DEFAULTS) :: GameTypes.PlayerSettings, Changed = Signal.new() :: Signal.Signal<GameTypes.PlayerSettings>, _pending = {} :: { [string]: any }, _flushThread = nil :: thread? }, SettingsController)
end

function SettingsController.Init(self: any, _registry: any)
	ClientState.ProfileChanged:Connect(function(view)
		if view and view.Settings then
			for k, v in view.Settings do
				(self.Settings :: any)[k] = v
			end
			Locale.Set(self.Settings.Locale)
			self.Changed:Fire(self.Settings)
		end
	end)
	-- Default locale from the player's Roblox locale until the profile arrives.
	local ok, localeId = pcall(function()
		return game:GetService("LocalizationService").RobloxLocaleId
	end)
	if ok and typeof(localeId) == "string" and string.sub(localeId, 1, 2) == "ru" then
		self.Settings.Locale = "ru"
		Locale.Set("ru")
	end
end

function SettingsController.Get(self: any): GameTypes.PlayerSettings
	return self.Settings
end

function SettingsController.Set(self: any, key: string, value: any)
	(self.Settings :: any)[key] = value
	self._pending[key] = value
	if key == "Locale" then
		Locale.Set(value)
	end
	self.Changed:Fire(self.Settings)
	if self._flushThread == nil then
		self._flushThread = task.delay(1, function()
			self._flushThread = nil
			local batch = self._pending
			self._pending = {}
			Network.Fire("UpdateSettings", batch)
		end)
	end
end

function SettingsController.ReducedMotion(self: any): boolean
	return self.Settings.ReducedMotion
end

return SettingsController
