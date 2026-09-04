--!strict
-- Loads/saves profiles with session locking, handles garage intents (loadout, cosmetics, unlocks, settings).
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local VehicleDefinitions = require(Shared.Config.VehicleDefinitions)
local RewardConfig = require(Shared.Config.RewardConfig)
local ProfileTypes = require(Shared.Types.ProfileTypes)
local Signal = require(Shared.Utility.Signal)
local ProfileStore = require(script.Parent.Parent.Systems.ProfileStore)

type Profile = ProfileTypes.Profile
type ProfileHandle = ProfileTypes.ProfileHandle

local ProfileService = { Name = "ProfileService" }
ProfileService.__index = ProfileService

function ProfileService.new()
	return setmetatable({
		_env = nil :: any,
		_store = nil :: any,
		_telemetry = nil :: any,
		_security = nil :: any,
		_loading = {} :: { [number]: boolean },
		_autosaveThread = nil :: thread?,
		ProfileLoaded = Signal.new() :: Signal.Signal<any, ProfileHandle>,
		ProfileReleased = Signal.new() :: Signal.Signal<any>,
		_running = false,
	}, ProfileService)
end

function ProfileService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._telemetry = registry:Get("TelemetryService")
	self._security = registry:Get("SecurityService")
	self._store = ProfileStore.new(self._env.ProfileBackend, self._env.SessionId, self._env.Unix, task.wait)
	local d = self._env.Dispatcher
	d:On("SelectLoadout", function(player, heroId: string, vehicleId: string)
		self:SelectLoadout(player, heroId, vehicleId)
	end)
	d:On("SelectCosmetic", function(player, category: string, id: string)
		self:SelectCosmetic(player, category, id)
	end)
	d:On("RequestUnlock", function(player, kind: string, id: string, purchaseId: string)
		self:RequestUnlock(player, kind, id, purchaseId)
	end)
	d:On("UpdateSettings", function(player, settings: { [string]: any })
		self:UpdateSettings(player, settings)
	end)
	d:On("TutorialProgress", function(player, step: number)
		local h = self:Get(player)
		if h then
			h.Data.TutorialState.Step = math.max(h.Data.TutorialState.Step, step)
			if step >= 6 then
				h.Data.TutorialState.Completed = true
			end
			h.Dirty = true
		end
	end)
	d:On("GetCatalog", function(player)
		return self:Catalog(player)
	end)
	d:On("GetRecords", function(player, trackId: string)
		local h = self:Get(player)
		if not h then
			return nil
		end
		return h.Data.TrackRecords[trackId]
	end)
end

function ProfileService.Start(self: any)
	self._running = true
	self._env.Players.PlayerAdded:Connect(function(player)
		self:OnPlayerAdded(player)
	end)
	self._env.Players.PlayerRemoving:Connect(function(player)
		self:OnPlayerRemoving(player)
	end)
	for _, p in self._env.Players.GetPlayers() do
		task.spawn(function()
			self:OnPlayerAdded(p)
		end)
	end
	self._autosaveThread = task.spawn(function()
		while self._running do
			task.wait(GameConfig.Profile.AutosaveSeconds)
			self:SaveAll()
		end
	end)
	self._env.BindToClose(function()
		self._running = false
		self:ReleaseAll()
	end)
end

function ProfileService.Destroy(self: any)
	self._running = false
	if self._autosaveThread then
		pcall(task.cancel, self._autosaveThread)
	end
end

function ProfileService.OnPlayerAdded(self: any, player: any)
	if self._loading[player.UserId] then
		return
	end
	self._loading[player.UserId] = true
	local result = self._store:Load(player.UserId)
	self._loading[player.UserId] = nil
	if player.Parent == nil and typeof(player) == "Instance" then
		-- Left while loading: release immediately.
		if result.Ok and result.Handle then
			self._store:Release(result.Handle)
		end
		return
	end
	local handle: ProfileHandle
	if result.Ok and result.Handle then
		handle = result.Handle
		self._telemetry:Count("profile.loaded")
		if result.Migrated and #result.Migrated > 0 then
			self._telemetry:Log("Info", "Profile", string.format("migrated %d to v%d", player.UserId, handle.Data.SchemaVersion))
		end
	else
		handle = self._store:Temporary(player.UserId)
		self._telemetry:Count("profile.failed")
		self._telemetry:Log("Warn", "Profile", string.format("load failed for %d: %s", player.UserId, tostring(result.Reason)))
		self._env.FireClient("ErrorDialog", player, "ERROR.PROFILE_LOAD_FAILED", { Temporary = true })
	end
	self:Push(player, handle)
	self.ProfileLoaded:Fire(player, handle)
end

function ProfileService.OnPlayerRemoving(self: any, player: any)
	local handle = self._store:Get(player.UserId)
	if handle then
		self._store:Release(handle)
		self.ProfileReleased:Fire(player)
	end
end

function ProfileService.Get(self: any, player: any): ProfileHandle?
	return self._store:Get(player.UserId)
end

function ProfileService.GetByUserId(self: any, userId: number): ProfileHandle?
	return self._store:Get(userId)
end

function ProfileService.IsTemporary(self: any, player: any): boolean
	local h = self:Get(player)
	return h == nil or h.Status == "Temporary"
end

function ProfileService.SaveAll(self: any)
	for _, h in self._store:Loaded() do
		if h.Status == "Loaded" and h.Dirty then
			if not self._store:Save(h) then
				self._telemetry:Count("profile.saveFailed")
			end
		end
	end
end

function ProfileService.ReleaseAll(self: any)
	for _, h in self._store:Loaded() do
		self._store:Release(h)
	end
end

function ProfileService.Save(self: any, player: any): boolean
	local h = self:Get(player)
	if not h then
		return false
	end
	return self._store:Save(h)
end

-- Client-facing view (never the raw table with processed keys).
function ProfileService.View(self: any, handle: ProfileHandle): { [string]: any }
	local d = handle.Data
	return {
		Currency = d.Currency,
		XP = d.XP,
		Level = d.Level,
		NextLevelXP = RewardConfig.LevelCurve(math.min(RewardConfig.MaxLevel, d.Level + 1)),
		UnlockedHeroes = d.UnlockedHeroes,
		UnlockedVehicles = d.UnlockedVehicles,
		UnlockedCosmetics = d.UnlockedCosmetics,
		SelectedHero = d.SelectedHero,
		SelectedVehicle = d.SelectedVehicle,
		SelectedCosmetics = d.SelectedCosmetics,
		TrackRecords = d.TrackRecords,
		Statistics = d.Statistics,
		Settings = d.Settings,
		TutorialState = d.TutorialState,
		Achievements = d.Achievements,
		Temporary = handle.Status == "Temporary",
	}
end

function ProfileService.Push(self: any, player: any, handle: ProfileHandle?)
	local h = handle or self:Get(player)
	if not h then
		return
	end
	self._env.FireClient("ProfileLoaded", player, self:View(h), h.Status)
end

function ProfileService.PushUpdate(self: any, player: any)
	local h = self:Get(player)
	if h then
		self._env.FireClient("ProfileUpdated", player, self:View(h))
	end
end

function ProfileService.SelectLoadout(self: any, player: any, heroId: string, vehicleId: string): boolean
	local h = self:Get(player)
	if not h then
		return false
	end
	local d = h.Data
	if not d.UnlockedHeroes[heroId] or not d.UnlockedVehicles[vehicleId] then
		self._security:Flag(player, "PermissionDenied", "loadout not unlocked")
		return false
	end
	d.SelectedHero = heroId
	d.SelectedVehicle = vehicleId
	h.Dirty = true
	self:PushUpdate(player)
	return true
end

function ProfileService.SelectCosmetic(self: any, player: any, category: string, id: string): boolean
	local h = self:Get(player)
	if not h then
		return false
	end
	local d = h.Data
	if id == "" then
		(d.SelectedCosmetics :: any)[category] = nil
	else
		if not d.UnlockedCosmetics[id] then
			self._security:Flag(player, "PermissionDenied", "cosmetic not unlocked")
			return false
		end
		local valid = false
		for _, c in RewardConfig.Cosmetics do
			if c.Id == id and c.Category == category then
				valid = true
			end
		end
		if not valid then
			return false
		end
		(d.SelectedCosmetics :: any)[category] = id
	end
	h.Dirty = true
	self:PushUpdate(player)
	return true
end

-- Currency unlocks; idempotent per purchaseId. Never grants stats. Temporary profiles cannot buy.
function ProfileService.RequestUnlock(self: any, player: any, kind: string, id: string, purchaseId: string): boolean
	local h = self:Get(player)
	if not h then
		return false
	end
	if h.Status == "Temporary" then
		self._env.FireClient("ErrorDialog", player, "ERROR.PURCHASE_DISABLED", {})
		return false
	end
	local d = h.Data
	if purchaseId ~= "" and d.ProcessedPurchaseIds[purchaseId] ~= nil then
		self._telemetry:Count("purchase.duplicate")
		return true
	end
	local cost: number? = nil
	local set: { [string]: boolean }? = nil
	if kind == "Hero" then
		local def = HeroDefinitions.ById[id]
		if def and def.Unlock.Kind == "Currency" then
			cost = def.Unlock.Cost
			set = d.UnlockedHeroes
		end
	elseif kind == "Vehicle" then
		local def = VehicleDefinitions.ById[id]
		if def and def.Unlock.Kind == "Currency" then
			cost = def.Unlock.Cost
			set = d.UnlockedVehicles
		end
	elseif kind == "Cosmetic" then
		for _, c in RewardConfig.Cosmetics do
			if c.Id == id then
				cost = c.Cost
				set = d.UnlockedCosmetics
			end
		end
	end
	if cost == nil or set == nil then
		self._security:Flag(player, "PermissionDenied", "invalid unlock " .. kind .. ":" .. id)
		return false
	end
	local s = set :: { [string]: boolean }
	if s[id] then
		return true
	end
	if d.Currency < (cost :: number) then
		self._env.FireClient("ErrorDialog", player, "ERROR.NOT_ENOUGH_CURRENCY", {})
		return false
	end
	d.Currency -= cost :: number
	s[id] = true
	if purchaseId ~= "" then
		d.ProcessedPurchaseIds[purchaseId] = self._env.Unix()
	end
	h.Dirty = true
	self._telemetry:Count("purchase.ok")
	self:PushUpdate(player)
	return true
end

function ProfileService.UpdateSettings(self: any, player: any, settings: { [string]: any })
	local h = self:Get(player)
	if not h then
		return
	end
	for k, v in settings do
		if (h.Data.Settings :: any)[k] ~= nil then
			(h.Data.Settings :: any)[k] = v
		end
	end
	h.Dirty = true
end

function ProfileService.Catalog(self: any, player: any): { [string]: any }
	local h = self:Get(player)
	return {
		Heroes = HeroDefinitions.List,
		Vehicles = VehicleDefinitions.List,
		Cosmetics = RewardConfig.Cosmetics,
		Profile = if h then self:View(h) else nil,
	}
end

-- Called by RaceService when the profile must be persisted right after rewards.
function ProfileService.MarkDirtyAndSave(self: any, player: any)
	local h = self:Get(player)
	if h then
		h.Dirty = true
		if h.Status == "Loaded" then
			task.spawn(function()
				self._store:Save(h)
			end)
		end
		self:PushUpdate(player)
	end
end

return ProfileService
