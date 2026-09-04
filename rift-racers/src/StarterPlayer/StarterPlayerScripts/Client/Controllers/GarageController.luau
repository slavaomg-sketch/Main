--!strict
-- Garage: hero and vehicle selection with 0-100 stat bars, unlock purchases (currency only), cosmetics,
-- and a camera orbit around the selected hero's lobby pedestal.
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local VehicleDefinitions = require(Shared.Config.VehicleDefinitions)
local RewardConfig = require(Shared.Config.RewardConfig)
local VehicleStats = require(Shared.Systems.VehicleStats)
local Locale = require(Shared.Locale.Locale)
local Network = require(Shared.Net.Network)
local ClientState = require(script.Parent.Parent.ClientState)
local UIBuilder = require(script.Parent.Parent.UI.UIBuilder)
local Theme = require(script.Parent.Parent.UI.Theme)

local GarageController = { Name = "GarageController" }
GarageController.__index = GarageController

function GarageController.new()
	return setmetatable({ _camera = nil :: any, _audio = nil :: any, _menu = nil :: any, Tab = "Hero" :: string, SelectedHero = "NovaVale", SelectedVehicle = "CometMk1", _screen = nil :: any, _refresh = nil :: (() -> ())? }, GarageController)
end

function GarageController.Init(self: any, registry: any)
	self._camera = registry:Get("CameraController")
	self._audio = registry:Get("AudioController")
	ClientState.ProfileChanged:Connect(function(view)
		if view then
			self.SelectedHero = view.SelectedHero
			self.SelectedVehicle = view.SelectedVehicle
		end
	end)
end

local STAT_KEYS = { "TopSpeed", "Acceleration", "Handling", "Grip", "DriftControl", "Weight", "OffroadEfficiency", "BoostEfficiency", "AirControl", "Recovery" }

local function unlockText(unlock: any, unlocked: boolean): string
	if unlocked then
		return ""
	end
	if unlock.Kind == "Level" then
		return Locale.T("UI.UNLOCK_LEVEL", unlock.Level)
	elseif unlock.Kind == "Currency" then
		return Locale.T("UI.UNLOCK_COST", unlock.Cost)
	elseif unlock.Kind == "Achievement" then
		return Locale.T("UI.UNLOCK_ACHIEVEMENT", Locale.T("ACHIEVEMENT." .. unlock.Id))
	end
	return Locale.T("UI.LOCKED")
end

function GarageController.PedestalFor(self: any, heroId: string): CFrame?
	local rr = Workspace:FindFirstChild("RiftRacers")
	local lobby = rr and rr:FindFirstChild("Lobby")
	local peds = lobby and lobby:FindFirstChild("HeroPedestals")
	local ped = peds and peds:FindFirstChild("Pedestal_" .. heroId)
	if ped and ped:IsA("BasePart") then
		return (ped :: BasePart).CFrame
	end
	return nil
end

function GarageController.Build(self: any, menu: any)
	self._menu = menu
	local s = menu:NewScreen("Garage", 20, false)
	self._screen = s
	local root = UIBuilder.Frame({ Size = UDim2.new(0, 520, 1, -60), Position = UDim2.new(1, -30, 0, 30), Anchor = Vector2.new(1, 0), Color = Theme.Colors.Panel, Stroke = true, Parent = s.Root })
	UIBuilder.Padding(root, 18)
	local title = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 44), TextSize = Theme.TextSize.Header, Parent = root })
	local tabs = UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 44), Position = UDim2.new(0, 0, 0, 50), Transparency = 1, Parent = root })
	UIBuilder.List(tabs, Enum.FillDirection.Horizontal, 8)
	local tabButtons: { [string]: TextButton } = {}
	for i, tab in { "Hero", "Vehicle", "Cosmetic" } do
		tabButtons[tab] = UIBuilder.Button({ Text = "", Size = UDim2.new(0.32, 0, 1, 0), Parent = tabs, LayoutOrder = i, Color = Theme.Colors.PanelAlt, OnClick = function()
			self.Tab = tab
			self:Refresh()
		end })
	end
	local grid = UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 250), Position = UDim2.new(0, 0, 0, 104), Transparency = 1, Parent = root })
	UIBuilder.Grid(grid, UDim2.new(0, 112, 0, 56), 8)
	local info = UIBuilder.Frame({ Size = UDim2.new(1, 0, 1, -430), Position = UDim2.new(0, 0, 0, 364), Color = Theme.Colors.PanelAlt, Parent = root })
	UIBuilder.Padding(info, 12)
	local nameL = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 30), TextSize = Theme.TextSize.Header, Align = Enum.TextXAlignment.Left, Parent = info })
	local descL = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 40), Position = UDim2.new(0, 0, 0, 32), TextSize = Theme.TextSize.Small, Align = Enum.TextXAlignment.Left, Color = Theme.Colors.TextDim, Parent = info, Font = Theme.FontBody })
	local stats = UIBuilder.Frame({ Size = UDim2.new(1, 0, 1, -130), Position = UDim2.new(0, 0, 0, 76), Transparency = 1, Parent = info })
	UIBuilder.List(stats, Enum.FillDirection.Vertical, 2, Enum.HorizontalAlignment.Left)
	local action = UIBuilder.Button({ Text = "", Size = UDim2.new(1, 0, 0, 48), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Parent = info, Color = Theme.Colors.Success })
	local back = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 200, 0, 50), Position = UDim2.new(0, 30, 1, -30), Anchor = Vector2.new(0, 1), Parent = s.Root, Color = Theme.Colors.PanelAlt, OnClick = function()
		if ClientState.RaceStateName == "LoadoutLock" then
			menu:Show("MatchLoading")
		else
			menu:Show("MainLobby")
		end
	end })
	local cards: { GuiObject } = {}
	local focus: string? = nil
	local statRows: { GuiObject } = {}
	self._refresh = function()
		local p = ClientState.Profile
		title.Text = Locale.T("UI.GARAGE")
		tabButtons.Hero.Text = Locale.T("UI.HERO")
		tabButtons.Vehicle.Text = Locale.T("UI.VEHICLE")
		tabButtons.Cosmetic.Text = Locale.T("UI.STATS")
		back.Text = Locale.T("UI.BACK")
		for _, c in cards do
			c:Destroy()
		end
		cards = {}
		for _, r in statRows do
			r:Destroy()
		end
		statRows = {}
		local firstCard: GuiObject? = nil
		if self.Tab == "Hero" then
			for i, h in HeroDefinitions.List do
				local unlocked = p and p.UnlockedHeroes[h.Id] == true
				local b = UIBuilder.Button({ Text = Locale.T(h.NameKey), Size = UDim2.new(0, 112, 0, 56), Parent = grid, LayoutOrder = h.SortOrder, Color = if not unlocked then Theme.Colors.Locked elseif h.Id == self.SelectedHero then Theme.Colors.Accent2 else h.Cosmetics.PrimaryColor:Lerp(Theme.Colors.PanelAlt, 0.4), TextSize = 16, OnClick = function()
					focus = h.Id
					self._camera:SetGaragePivot(self:PedestalFor(h.Id))
					self._audio:Horn(h.Id)
					self:Refresh()
				end })
				table.insert(cards, b)
				firstCard = firstCard or b
				local _ = i
			end
			local id = focus or self.SelectedHero
			local h = HeroDefinitions.ById[id] or HeroDefinitions.ById[HeroDefinitions.DefaultHeroId]
			local unlocked = p and p.UnlockedHeroes[h.Id] == true
			nameL.Text = Locale.T(h.NameKey)
			descL.Text = Locale.T(h.TaglineKey) .. "\n" .. unlockText(h.Unlock, unlocked)
			local display = VehicleStats.DisplayStats(h.Id, self.SelectedVehicle)
			for i, key in STAT_KEYS do
				local row = UIBuilder.StatBar(stats, key, display[key], i)
				table.insert(statRows, row)
			end
			if unlocked then
				action.Text = if h.Id == self.SelectedHero then Locale.T("UI.EQUIPPED") else Locale.T("UI.EQUIP")
				action.BackgroundColor3 = Theme.Colors.Success
			else
				action.Text = if h.Unlock.Kind == "Currency" then Locale.T("UI.BUY") else Locale.T("UI.LOCKED")
				action.BackgroundColor3 = if h.Unlock.Kind == "Currency" then Theme.Colors.Warning else Theme.Colors.Locked
			end
			self._camera:SetGaragePivot(self:PedestalFor(h.Id))
		elseif self.Tab == "Vehicle" then
			for _, v in VehicleDefinitions.List do
				local unlocked = p and p.UnlockedVehicles[v.Id] == true
				local b = UIBuilder.Button({ Text = Locale.T(v.NameKey), Size = UDim2.new(0, 112, 0, 56), Parent = grid, LayoutOrder = v.SortOrder, Color = if not unlocked then Theme.Colors.Locked elseif v.Id == self.SelectedVehicle then Theme.Colors.Accent2 else v.Visual.PrimaryColor:Lerp(Theme.Colors.PanelAlt, 0.4), TextSize = 16, OnClick = function()
					focus = v.Id
					self:Refresh()
				end })
				table.insert(cards, b)
				firstCard = firstCard or b
			end
			local id = focus or self.SelectedVehicle
			local v = VehicleDefinitions.ById[id] or VehicleDefinitions.ById[VehicleDefinitions.DefaultVehicleId]
			local unlocked = p and p.UnlockedVehicles[v.Id] == true
			nameL.Text = Locale.T(v.NameKey)
			descL.Text = Locale.T(v.DescriptionKey) .. "\n" .. unlockText(v.Unlock, unlocked)
			local display = VehicleStats.DisplayStats(self.SelectedHero, v.Id)
			for i, key in STAT_KEYS do
				local row = UIBuilder.StatBar(stats, key, display[key], i)
				table.insert(statRows, row)
			end
			if unlocked then
				action.Text = if v.Id == self.SelectedVehicle then Locale.T("UI.EQUIPPED") else Locale.T("UI.EQUIP")
				action.BackgroundColor3 = Theme.Colors.Success
			else
				action.Text = if v.Unlock.Kind == "Currency" then Locale.T("UI.BUY") else Locale.T("UI.LOCKED")
				action.BackgroundColor3 = if v.Unlock.Kind == "Currency" then Theme.Colors.Warning else Theme.Colors.Locked
			end
		else
			for i, c in RewardConfig.Cosmetics do
				local unlocked = p and p.UnlockedCosmetics[c.Id] == true
				local equipped = p and p.SelectedCosmetics and p.SelectedCosmetics[c.Category] == c.Id
				local b = UIBuilder.Button({ Text = Locale.T(c.NameKey), Size = UDim2.new(0, 112, 0, 56), Parent = grid, LayoutOrder = i, Color = if equipped then Theme.Colors.Accent2 elseif unlocked then Theme.Colors.Accent else Theme.Colors.Locked, TextSize = 13, OnClick = function()
					focus = c.Id
					self:Refresh()
				end })
				table.insert(cards, b)
				firstCard = firstCard or b
			end
			local c: any = nil
			for _, x in RewardConfig.Cosmetics do
				if x.Id == focus then
					c = x
				end
			end
			if c then
				local unlocked = p and p.UnlockedCosmetics[c.Id] == true
				nameL.Text = Locale.T(c.NameKey)
				descL.Text = if unlocked then "" else Locale.T("UI.UNLOCK_COST", c.Cost)
				action.Text = if unlocked then Locale.T("UI.EQUIP") else Locale.T("UI.BUY")
				action.BackgroundColor3 = if unlocked then Theme.Colors.Success else Theme.Colors.Warning
			else
				nameL.Text = Locale.T("UI.STATS")
				descL.Text = ""
				action.Text = ""
			end
		end
		s.First = firstCard
		for tab, b in tabButtons do
			b.BackgroundColor3 = if tab == self.Tab then Theme.Colors.Accent else Theme.Colors.PanelAlt
		end
	end
	action.Activated:Connect(function()
		local p = ClientState.Profile
		if not p then
			return
		end
		if self.Tab == "Hero" then
			local id = focus or self.SelectedHero
			local h = HeroDefinitions.ById[id]
			if p.UnlockedHeroes[id] then
				self.SelectedHero = id
				Network.Fire("SelectLoadout", id, self.SelectedVehicle)
			elseif h and h.Unlock.Kind == "Currency" then
				Network.Fire("RequestUnlock", "Hero", id, "hero_" .. id .. "_" .. tostring(os.time()))
			end
		elseif self.Tab == "Vehicle" then
			local id = focus or self.SelectedVehicle
			local v = VehicleDefinitions.ById[id]
			if p.UnlockedVehicles[id] then
				self.SelectedVehicle = id
				Network.Fire("SelectLoadout", self.SelectedHero, id)
			elseif v and v.Unlock.Kind == "Currency" then
				Network.Fire("RequestUnlock", "Vehicle", id, "vehicle_" .. id .. "_" .. tostring(os.time()))
			end
		elseif focus then
			local c: any = nil
			for _, x in RewardConfig.Cosmetics do
				if x.Id == focus then
					c = x
				end
			end
			if c then
				if p.UnlockedCosmetics[c.Id] then
					Network.Fire("SelectCosmetic", c.Category, c.Id)
				else
					Network.Fire("RequestUnlock", "Cosmetic", c.Id, "cos_" .. c.Id .. "_" .. tostring(os.time()))
				end
			end
		end
		task.delay(0.3, function()
			self:Refresh()
		end)
	end)
	s.Refresh = function()
		self:Refresh()
	end
	local _ = Players
end

function GarageController.Refresh(self: any)
	if self._refresh then
		self._refresh()
	end
end

return GarageController
