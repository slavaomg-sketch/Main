--!strict
-- All non-race screens: Loading, Main Lobby, Mode Select, Party, Queue, Track Vote, Match Loading, Loadout Lock,
-- Pause, Results, Grand Tour Standings, Time Trial Records, Settings, Error Dialog, Data Warning, Private Room.
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local Locale = require(Shared.Locale.Locale)
local TimeUtil = require(Shared.Utility.TimeUtil)
local Network = require(Shared.Net.Network)
local ClientState = require(script.Parent.Parent.ClientState)
local UIBuilder = require(script.Parent.Parent.UI.UIBuilder)
local Theme = require(script.Parent.Parent.UI.Theme)

local MenuController = { Name = "MenuController" }
MenuController.__index = MenuController

type Screen = { Gui: ScreenGui, Root: Frame, Refresh: (() -> ())?, First: GuiObject? }

function MenuController.new()
	return setmetatable({
		_settings = nil :: any,
		_input = nil :: any,
		_garage = nil :: any,
		_camera = nil :: any,
		_audio = nil :: any,
		_screens = {} :: { [string]: Screen },
		Current = "Loading" :: string,
		_stack = {} :: { string },
		_roomRules = {} :: { [string]: any },
		_errorQueue = {} :: { { Key: string, Data: any } },
	}, MenuController)
end

function MenuController.Init(self: any, registry: any)
	self._settings = registry:Get("SettingsController")
	self._input = registry:Get("InputController")
	self._garage = registry:Get("GarageController")
	self._camera = registry:Get("CameraController")
	self._audio = registry:Get("AudioController")
	ClientState.ProfileChanged:Connect(function()
		if self.Current == "Loading" then
			self:Show("MainLobby")
		end
		self:RefreshCurrent()
	end)
	ClientState.LobbyChanged:Connect(function()
		self:RefreshCurrent()
	end)
	ClientState.PartyChanged:Connect(function(view)
		if view.Invite then
			self:ShowInvite(view.Invite)
		end
		self:RefreshCurrent()
	end)
	ClientState.QueueChanged:Connect(function(q)
		if q.InQueue then
			self:Show("Queue")
		elseif self.Current == "Queue" then
			self:Show("MainLobby")
		end
		self:RefreshCurrent()
	end)
	ClientState.RaceStateChanged:Connect(function(state, view)
		self:OnRaceState(state, view)
	end)
	ClientState.ResultsReceived:Connect(function(results, rewards)
		self:Show("Results")
	end)
	ClientState.ErrorDialog:Connect(function(key, data)
		self:ShowError(key, data)
	end)
	self._input.MenuPressed:Connect(function()
		if ClientState.InRace() then
			if self.Current == "Pause" then
				self:Hide()
			else
				self:Show("Pause")
			end
		end
	end)
	self._settings.Changed:Connect(function()
		self:RefreshCurrent()
	end)
end

function MenuController.Start(self: any)
	self:BuildAll()
	self:Show("Loading")
	Network.Fire("ClientReady")
end

-- Screen plumbing ---------------------------------------------------------------------------------------------------
function MenuController.NewScreen(self: any, name: string, order: number?, dim: boolean?): Screen
	local gui = UIBuilder.ScreenGui("Screen_" .. name, Players.LocalPlayer:WaitForChild("PlayerGui"), order or 20, true)
	local root = UIBuilder.Frame({ Transparency = if dim == false then 1 else 0.35, Color = Theme.Colors.Background, Parent = gui, Name = "Root", Corner = UDim.new(0, 0) })
	local screen: Screen = { Gui = gui, Root = root, Refresh = nil, First = nil }
	self._screens[name] = screen
	return screen
end

function MenuController.Show(self: any, name: string)
	local s = self._screens[name]
	if not s then
		return
	end
	for n, sc in self._screens do
		if n ~= name and n ~= "Error" and n ~= "Invite" then
			sc.Gui.Enabled = false
		end
	end
	self.Current = name
	if s.Refresh then
		s.Refresh()
	end
	s.Gui.Enabled = true
	if self._input.Device == "Gamepad" and s.First then
		UIBuilder.Select(s.First)
	end
	if name ~= "Garage" then
		self._camera:SetGaragePivot(nil)
	end
end

function MenuController.Hide(self: any)
	local s = self._screens[self.Current]
	if s then
		s.Gui.Enabled = false
	end
	self.Current = "None"
end

function MenuController.RefreshCurrent(self: any)
	local s = self._screens[self.Current]
	if s and s.Refresh and s.Gui.Enabled then
		s.Refresh()
	end
end

local function panel(parent: Instance, title: string, size: UDim2?): (Frame, Frame)
	local p = UIBuilder.Frame({ Size = size or UDim2.new(0, 900, 0, 620), Position = UDim2.fromScale(0.5, 0.5), Anchor = Vector2.new(0.5, 0.5), Color = Theme.Colors.Panel, Stroke = true, Parent = parent })
	local sc = Instance.new("UISizeConstraint")
	sc.MaxSize = Vector2.new(1400, 900)
	sc.Parent = p
	UIBuilder.Padding(p, 24)
	UIBuilder.Label({ Text = title, Size = UDim2.new(1, 0, 0, 52), TextSize = Theme.TextSize.Title, Parent = p, Name = "Title" })
	local body = UIBuilder.Frame({ Size = UDim2.new(1, 0, 1, -64), Position = UDim2.new(0, 0, 0, 64), Transparency = 1, Parent = p, Name = "Body" })
	return p, body
end

-- Loading ------------------------------------------------------------------------------------------------------------
function MenuController.BuildAll(self: any)
	do
		local s = self:NewScreen("Loading", 50, true)
		UIBuilder.Label({ Text = GameConfig.ProjectName, Size = UDim2.new(1, 0, 0, 100), Position = UDim2.fromScale(0.5, 0.4), Anchor = Vector2.new(0.5, 0.5), TextSize = 80, Color = Theme.Colors.Accent2, Parent = s.Root })
		local l = UIBuilder.Label({ Text = Locale.T("UI.LOADING"), Size = UDim2.new(1, 0, 0, 40), Position = UDim2.fromScale(0.5, 0.55), Anchor = Vector2.new(0.5, 0.5), Parent = s.Root })
		s.Refresh = function()
			l.Text = Locale.T("UI.LOADING")
		end
	end
	self:BuildMainLobby()
	self:BuildModeSelect()
	self:BuildParty()
	self:BuildQueue()
	self:BuildVote()
	self:BuildMatchLoading()
	self:BuildPause()
	self:BuildResults()
	self:BuildSettings()
	self:BuildRecords()
	self:BuildRoom()
	self:BuildError()
	self:BuildInvite()
	self._garage:Build(self)
end

function MenuController.BuildMainLobby(self: any)
	local s = self:NewScreen("MainLobby", 20, false)
	local left = UIBuilder.Frame({ Size = UDim2.new(0, 360, 1, -80), Position = UDim2.new(0, 40, 0, 40), Transparency = 1, Parent = s.Root })
	UIBuilder.List(left, Enum.FillDirection.Vertical, 12, Enum.HorizontalAlignment.Left)
	local title = UIBuilder.Label({ Text = GameConfig.ProjectName, Size = UDim2.new(1, 0, 0, 70), TextSize = 60, Color = Theme.Colors.Accent2, Align = Enum.TextXAlignment.Left, Parent = left, LayoutOrder = 0 })
	local tagline = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 50), TextSize = Theme.TextSize.Small, Color = Theme.Colors.TextDim, Align = Enum.TextXAlignment.Left, Parent = left, LayoutOrder = 1, Font = Theme.FontBody })
	local buttons: { [string]: TextButton } = {}
	local order = 2
	local function add(key: string, cb: () -> (), color: Color3?)
		local b = UIBuilder.Button({ Text = Locale.T(key), Size = UDim2.new(1, 0, 0, 58), Parent = left, LayoutOrder = order, OnClick = cb, Color = color })
		buttons[key] = b
		order += 1
		return b
	end
	s.First = add("UI.QUICK_PLAY", function()
		Network.Fire("QueueAction", "Join", "QuickRace")
	end, Theme.Colors.Accent2)
	add("UI.MODES", function()
		self:Show("ModeSelect")
	end)
	add("UI.GARAGE", function()
		self:Show("Garage")
	end)
	add("UI.PARTY", function()
		self:Show("Party")
	end)
	add("UI.PRIVATE_RACE", function()
		self:Show("Room")
	end)
	add("UI.PRACTICE", function()
		Network.Fire("StartMode", "Practice")
	end)
	add("UI.TUTORIAL", function()
		self:Hide()
		Network.Fire("StartMode", "Practice")
		task.delay(1, function()
			ClientState.TutorialStep:Fire(1)
		end)
	end)
	add("UI.SETTINGS", function()
		self:Show("Settings")
	end)
	local profileBox = UIBuilder.Frame({ Size = UDim2.new(0, 340, 0, 120), Position = UDim2.new(1, -40, 0, 40), Anchor = Vector2.new(1, 0), Color = Theme.Colors.Panel, Stroke = true, Parent = s.Root })
	UIBuilder.Padding(profileBox, 14)
	local nameL = UIBuilder.Label({ Text = Players.LocalPlayer.DisplayName, Size = UDim2.new(1, 0, 0, 34), TextSize = Theme.TextSize.Header, Align = Enum.TextXAlignment.Left, Parent = profileBox })
	local levelL = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 26), Position = UDim2.new(0, 0, 0, 36), TextSize = Theme.TextSize.Small, Align = Enum.TextXAlignment.Left, Color = Theme.Colors.TextDim, Parent = profileBox })
	local curL = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 26), Position = UDim2.new(0, 0, 0, 62), TextSize = Theme.TextSize.Small, Align = Enum.TextXAlignment.Left, Color = Theme.Colors.Accent2, Parent = profileBox })
	local warn = UIBuilder.Label({ Text = "", Size = UDim2.new(0, 520, 0, 40), Position = UDim2.new(1, -40, 0, 170), Anchor = Vector2.new(1, 0), TextSize = Theme.TextSize.Small, Color = Theme.Colors.Warning, Parent = s.Root, Font = Theme.FontBody })
	local online = UIBuilder.Label({ Text = "", Size = UDim2.new(0, 400, 0, 30), Position = UDim2.new(1, -40, 1, -40), Anchor = Vector2.new(1, 1), TextSize = Theme.TextSize.Small, Color = Theme.Colors.TextDim, Align = Enum.TextXAlignment.Right, Parent = s.Root })
	local hint = UIBuilder.Label({ Text = "", Size = UDim2.new(0, 700, 0, 30), Position = UDim2.new(0, 40, 1, -40), Anchor = Vector2.new(0, 1), TextSize = 15, Color = Theme.Colors.TextDim, Align = Enum.TextXAlignment.Left, Parent = s.Root, Font = Theme.FontBody })
	s.Refresh = function()
		title.Text = GameConfig.ProjectName
		tagline.Text = Locale.T("UI.TAGLINE")
		for key, b in buttons do
			b.Text = Locale.T(key)
		end
		local p = ClientState.Profile
		if p then
			levelL.Text = Locale.T("UI.LEVEL", p.Level) .. "  ·  " .. Locale.FormatNumber(p.XP) .. " / " .. Locale.FormatNumber(p.NextLevelXP) .. " XP"
			curL.Text = Locale.FormatNumber(p.Currency) .. " " .. Locale.T("UI.CURRENCY")
			warn.Text = if p.Temporary then Locale.T("UI.PROFILE_TEMP") else ""
		end
		nameL.Text = Players.LocalPlayer.DisplayName
		local lobby = ClientState.Lobby
		online.Text = if lobby then Locale.T("UI.WAITING_PLAYERS", lobby.Online, GameConfig.MaxRacers) else ""
		hint.Text = if self._input.Device == "Keyboard" then Locale.T("UI.KEYBOARD_HINT") else ""
	end
end

function MenuController.BuildModeSelect(self: any)
	local s = self:NewScreen("ModeSelect", 20, true)
	local p, body = panel(s.Root, Locale.T("UI.MODES"))
	local grid = UIBuilder.Frame({ Size = UDim2.new(1, 0, 1, -70), Transparency = 1, Parent = body })
	UIBuilder.Grid(grid, UDim2.new(0, 400, 0, 96), 14)
	local cards: { { Button: TextButton, Def: any } } = {}
	local first: TextButton? = nil
	for _, def in ModeDefinitions.List do
		if def.Id == "Practice" then
			continue
		end
		local b = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 400, 0, 96), Parent = grid, LayoutOrder = def.SortOrder, Color = Theme.Colors.PanelAlt })
		b.TextScaled = false
		b.TextXAlignment = Enum.TextXAlignment.Left
		b.TextYAlignment = Enum.TextYAlignment.Top
		b.Activated:Connect(function()
			if def.Public then
				Network.Fire("QueueAction", "Join", def.Id)
			elseif def.Id == "CustomRace" then
				self:Show("Room")
			elseif def.Id == "TimeTrial" then
				self:Show("Records")
			else
				Network.Fire("StartMode", def.Id)
			end
		end)
		table.insert(cards, { Button = b, Def = def })
		first = first or b
	end
	s.First = first
	local back = UIBuilder.Button({ Text = Locale.T("UI.BACK"), Size = UDim2.new(0, 200, 0, 50), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Parent = body, Color = Theme.Colors.PanelAlt, OnClick = function()
		self:Show("MainLobby")
	end })
	s.Refresh = function()
		(p:FindFirstChild("Title") :: TextLabel).Text = Locale.T("UI.MODES")
		back.Text = Locale.T("UI.BACK")
		for _, c in cards do
			c.Button.Text = string.format("<b>%s</b>\n<font size='16' color='#B4B2D2'>%s</font>", Locale.T(c.Def.NameKey), Locale.T(c.Def.DescriptionKey))
			c.Button.RichText = true
		end
	end
end

function MenuController.BuildParty(self: any)
	local s = self:NewScreen("Party", 20, true)
	local p, body = panel(s.Root, Locale.T("UI.PARTY"), UDim2.new(0, 700, 0, 560))
	local list = UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 260), Transparency = 1, Parent = body })
	UIBuilder.List(list, Enum.FillDirection.Vertical, 6, Enum.HorizontalAlignment.Left)
	local members = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 30), Align = Enum.TextXAlignment.Left, Parent = list, LayoutOrder = 0 })
	local inviteRow = UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 300), Position = UDim2.new(0, 0, 0, 270), Transparency = 1, Parent = body })
	UIBuilder.List(inviteRow, Enum.FillDirection.Vertical, 6, Enum.HorizontalAlignment.Left)
	local playersLabel = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 26), Align = Enum.TextXAlignment.Left, Color = Theme.Colors.TextDim, TextSize = Theme.TextSize.Small, Parent = inviteRow, LayoutOrder = 0 })
	local invites: { TextButton } = {}
	local leave = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 220, 0, 50), Position = UDim2.new(1, 0, 1, 0), Anchor = Vector2.new(1, 1), Parent = body, Color = Theme.Colors.Danger, OnClick = function()
		Network.Fire("PartyAction", "Leave")
	end })
	local back = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 200, 0, 50), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Parent = body, Color = Theme.Colors.PanelAlt, OnClick = function()
		self:Show("MainLobby")
	end })
	s.First = back
	s.Refresh = function()
		(p:FindFirstChild("Title") :: TextLabel).Text = Locale.T("UI.PARTY")
		back.Text = Locale.T("UI.BACK")
		leave.Text = Locale.T("UI.PARTY_LEAVE")
		local party = ClientState.Party
		local names = {}
		local count = 0
		if party and party.Members then
			for _, m in party.Members do
				table.insert(names, m.Name .. (if m.UserId == party.LeaderId then " ★" else ""))
				count += 1
			end
		end
		members.Text = Locale.T("UI.PARTY_MEMBERS", count, GameConfig.MaxPartySize) .. "\n" .. table.concat(names, ", ")
		playersLabel.Text = Locale.T("UI.PARTY_INVITE") .. ":"
		for _, b in invites do
			b:Destroy()
		end
		invites = {}
		local i = 1
		for _, pl in Players:GetPlayers() do
			if pl ~= Players.LocalPlayer then
				local b = UIBuilder.Button({ Text = pl.DisplayName, Size = UDim2.new(0, 300, 0, 40), Parent = inviteRow, LayoutOrder = i, Color = Theme.Colors.PanelAlt, OnClick = function()
					Network.Fire("PartyAction", "Create")
					Network.Fire("PartyAction", "Invite", pl.UserId)
				end })
				table.insert(invites, b)
				i += 1
			end
		end
	end
end

function MenuController.BuildQueue(self: any)
	local s = self:NewScreen("Queue", 20, true)
	local p, body = panel(s.Root, "", UDim2.new(0, 600, 0, 320))
	local status = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 60), TextSize = Theme.TextSize.Header, Parent = body })
	local counts = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 40), Position = UDim2.new(0, 0, 0, 70), TextSize = Theme.TextSize.Small, Color = Theme.Colors.TextDim, Parent = body })
	local leave = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 260, 0, 54), Position = UDim2.new(0.5, 0, 1, 0), Anchor = Vector2.new(0.5, 1), Parent = body, Color = Theme.Colors.Danger, OnClick = function()
		Network.Fire("QueueAction", "Leave")
	end })
	s.First = leave
	task.spawn(function()
		while true do
			task.wait(1)
			if s.Gui.Enabled and s.Refresh then
				s.Refresh()
			end
		end
	end)
	s.Refresh = function()
		local q = ClientState.Queue
		local def = q and q.ModeId and ModeDefinitions.ById[q.ModeId]
		;(p:FindFirstChild("Title") :: TextLabel).Text = if def then Locale.T(def.NameKey) else Locale.T("UI.QUICK_PLAY")
		local waited = if q and q.Since then math.max(0, Workspace:GetServerTimeNow() - q.Since) else 0
		status.Text = Locale.T("UI.IN_QUEUE", TimeUtil.FormatRaceTime(waited):sub(1, 5))
		local n = if q and q.Counts and q.ModeId then (q.Counts[q.ModeId] or 0) else 0
		counts.Text = Locale.T("UI.WAITING_PLAYERS", n, GameConfig.TargetMatchSize)
		leave.Text = Locale.T("UI.LEAVE_QUEUE")
	end
end

function MenuController.BuildVote(self: any)
	local s = self:NewScreen("Vote", 20, true)
	local p, body = panel(s.Root, Locale.T("UI.VOTE"), UDim2.new(0, 1000, 0, 480))
	local row = UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 300), Transparency = 1, Parent = body })
	UIBuilder.List(row, Enum.FillDirection.Horizontal, 16, Enum.HorizontalAlignment.Center)
	local timer = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 40), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), TextSize = Theme.TextSize.Header, Color = Theme.Colors.Accent2, Parent = body })
	local cards: { TextButton } = {}
	task.spawn(function()
		while true do
			task.wait(0.5)
			if s.Gui.Enabled and ClientState.Race then
				local remaining = math.max(0, GameConfig.Race.VoteSeconds - (Workspace:GetServerTimeNow() - ClientState.Race.EnteredAt))
				timer.Text = string.format("%d", math.ceil(remaining))
			end
		end
	end)
	s.Refresh = function()
		(p:FindFirstChild("Title") :: TextLabel).Text = Locale.T("UI.VOTE")
		for _, c in cards do
			c:Destroy()
		end
		cards = {}
		local race = ClientState.Race
		if not race then
			return
		end
		local tally: { [string]: number } = {}
		for _, v in race.Votes or {} do
			tally[v] = (tally[v] or 0) + 1
		end
		for i, id in race.VoteOptions or {} do
			local def: any = TrackDefinitions.TrackById[id] or TrackDefinitions.ArenaById[id]
			local b = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 300, 0, 280), Parent = row, LayoutOrder = i, Color = def and def.Atmosphere and def.Atmosphere.SkyColor:Lerp(Theme.Colors.PanelAlt, 0.5) or Theme.Colors.PanelAlt, OnClick = function()
				Network.Fire("VoteTrack", id)
			end })
			b.TextScaled = false
			b.RichText = true
			b.TextYAlignment = Enum.TextYAlignment.Bottom
			b.Text = string.format("<b>%s</b>\n<font size='16' color='#B4B2D2'>%s</font>\n<font color='#80DCFF'>%s</font>", Locale.T(def and def.NameKey or id), Locale.T(def and def.DescriptionKey or ""), Locale.T("UI.VOTES", tally[id] or 0))
			table.insert(cards, b)
			if i == 1 then
				s.First = b
			end
		end
	end
end

function MenuController.BuildMatchLoading(self: any)
	local s = self:NewScreen("MatchLoading", 20, true)
	local p, body = panel(s.Root, "", UDim2.new(0, 700, 0, 360))
	local sub = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 60), TextSize = Theme.TextSize.Header, Parent = body })
	local roster = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 120), Position = UDim2.new(0, 0, 0, 70), TextSize = Theme.TextSize.Small, Color = Theme.Colors.TextDim, Parent = body, Font = Theme.FontBody })
	local confirm = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 300, 0, 54), Position = UDim2.new(0.5, 0, 1, 0), Anchor = Vector2.new(0.5, 1), Parent = body, Color = Theme.Colors.Success, OnClick = function()
		Network.Fire("LoadoutConfirm")
		self:Hide()
	end })
	local garage = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 220, 0, 46), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Parent = body, Color = Theme.Colors.PanelAlt, OnClick = function()
		self:Show("Garage")
	end })
	s.First = confirm
	s.Refresh = function()
		local race = ClientState.Race
		local def: any = race and (TrackDefinitions.TrackById[race.VenueId] or TrackDefinitions.ArenaById[race.VenueId])
		;(p:FindFirstChild("Title") :: TextLabel).Text = if def then Locale.T(def.NameKey) else Locale.T("UI.LOADING")
		sub.Text = if ClientState.RaceStateName == "LoadoutLock" then Locale.T("UI.LOADOUT_LOCK") else Locale.T("UI.LOADING")
		local names = {}
		if race and race.Roster then
			for _, r in race.Roster do
				table.insert(names, r.Name .. (if r.IsBot then " (bot)" else ""))
			end
		end
		roster.Text = table.concat(names, "  ·  ")
		confirm.Text = Locale.T("UI.CONFIRM")
		confirm.Visible = ClientState.RaceStateName == "LoadoutLock"
		garage.Text = Locale.T("UI.GARAGE")
		garage.Visible = ClientState.RaceStateName == "LoadoutLock"
	end
end

function MenuController.BuildPause(self: any)
	local s = self:NewScreen("Pause", 30, true)
	local p, body = panel(s.Root, Locale.T("UI.MENU"), UDim2.new(0, 460, 0, 380))
	UIBuilder.List(body, Enum.FillDirection.Vertical, 12)
	local resume = UIBuilder.Button({ Text = "", Size = UDim2.new(1, 0, 0, 56), Parent = body, LayoutOrder = 1, OnClick = function()
		self:Hide()
	end })
	local settings = UIBuilder.Button({ Text = "", Size = UDim2.new(1, 0, 0, 56), Parent = body, LayoutOrder = 2, Color = Theme.Colors.PanelAlt, OnClick = function()
		self:Show("Settings")
	end })
	local quit = UIBuilder.Button({ Text = "", Size = UDim2.new(1, 0, 0, 56), Parent = body, LayoutOrder = 3, Color = Theme.Colors.Danger, OnClick = function()
		Network.Fire("PostRaceChoice", "Lobby")
		Network.Fire("QueueAction", "Leave")
		self:Hide()
	end })
	s.First = resume
	s.Refresh = function()
		(p:FindFirstChild("Title") :: TextLabel).Text = Locale.T("UI.MENU")
		resume.Text = Locale.T("UI.RESUME")
		settings.Text = Locale.T("UI.SETTINGS")
		quit.Text = Locale.T("UI.QUIT_TO_LOBBY")
	end
end

function MenuController.BuildResults(self: any)
	local s = self:NewScreen("Results", 25, true)
	local p, body = panel(s.Root, Locale.T("UI.RESULTS"), UDim2.new(0, 1000, 0, 660))
	local table_ = UIBuilder.Frame({ Size = UDim2.new(0.6, -10, 1, -70), Transparency = 1, Parent = body })
	UIBuilder.List(table_, Enum.FillDirection.Vertical, 4, Enum.HorizontalAlignment.Left)
	local rewards = UIBuilder.Frame({ Size = UDim2.new(0.4, -10, 1, -70), Position = UDim2.new(0.6, 10, 0, 0), Color = Theme.Colors.PanelAlt, Parent = body })
	UIBuilder.Padding(rewards, 12)
	UIBuilder.List(rewards, Enum.FillDirection.Vertical, 4, Enum.HorizontalAlignment.Left)
	local rows: { GuiObject } = {}
	local btnRow = UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 56), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Transparency = 1, Parent = body })
	UIBuilder.List(btnRow, Enum.FillDirection.Horizontal, 12, Enum.HorizontalAlignment.Right)
	local nextBtn = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 280, 0, 54), Parent = btnRow, LayoutOrder = 2, Color = Theme.Colors.Success, OnClick = function()
		Network.Fire("PostRaceChoice", if ClientState.Race and ClientState.Race.ModeId == "GrandTour" then "ContinueTour" else "NextRace")
		self:Show("MatchLoading")
	end })
	local lobbyBtn = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 240, 0, 54), Parent = btnRow, LayoutOrder = 1, Color = Theme.Colors.PanelAlt, OnClick = function()
		Network.Fire("PostRaceChoice", "Lobby")
	end })
	s.First = nextBtn
	s.Refresh = function()
		for _, r in rows do
			r:Destroy()
		end
		rows = {}
		local results = ClientState.Results
		local race = ClientState.Race
		local isTour = race and race.ModeId == "GrandTour"
		;(p:FindFirstChild("Title") :: TextLabel).Text = if isTour then Locale.T("UI.STANDINGS") else Locale.T("UI.RESULTS")
		nextBtn.Text = if isTour then Locale.T("UI.CONTINUE_TOUR") else Locale.T("UI.NEXT_RACE")
		lobbyBtn.Text = Locale.T("UI.QUIT_TO_LOBBY")
		nextBtn.Visible = race ~= nil and race.RaceIndex < (race.RacesPerSession or 1) or (race ~= nil and race.ModeId == "QuickRace")
		if not results then
			return
		end
		local nameByKey: { [string]: string } = {}
		if race and race.Roster then
			for _, r in race.Roster do
				nameByKey[r.Key] = r.Name
			end
		end
		local myKey = ClientState.MyKey()
		for i, rec in results.Records do
			local isMe = rec.Key == myKey
			local timeText = if rec.TimeSeconds then TimeUtil.FormatRaceTime(rec.TimeSeconds) elseif rec.Eliminated then Locale.T("RACE.ELIMINATED") elseif results.ModeId == "CoreClash" or results.ModeId == "ShardRush" then tostring(rec.Score) else Locale.T("RACE.DNF")
			local pointsText = if isTour then string.format("  +%d  (%d)", rec.Points, (race.TourPoints or {})[rec.Key] or 0) else ""
			local teamColor = ModeDefinitions.TeamColors[rec.Team] and ModeDefinitions.TeamColors[rec.Team].Color or nil
			local row = UIBuilder.Label({ Text = string.format("%s  %s  %s%s", Locale.Ordinal(i), nameByKey[rec.Key] or rec.Key, timeText, pointsText), Size = UDim2.new(1, 0, 0, 30), Align = Enum.TextXAlignment.Left, Color = if isMe then Theme.Colors.Accent2 else (teamColor or Theme.Colors.Text), Parent = table_, LayoutOrder = i, TextSize = Theme.TextSize.Body })
			table.insert(rows, row)
		end
		if results.TeamScores then
			for team, score in results.TeamScores do
				local tc = ModeDefinitions.TeamColors[tonumber(team) or 0]
				if tc then
					local row = UIBuilder.Label({ Text = Locale.T("RACE.TEAM_SCORE", Locale.T(tc.NameKey), score), Size = UDim2.new(1, 0, 0, 28), Align = Enum.TextXAlignment.Left, Color = tc.Color, Parent = table_, LayoutOrder = 100 + (tonumber(team) or 0) })
					table.insert(rows, row)
				end
			end
		end
		local mine = ClientState.Rewards and myKey and ClientState.Rewards[myKey]
		if mine then
			local order = 1
			for _, line in mine.Lines do
				local row = UIBuilder.Label({ Text = string.format("%s  <font color='#80DCFF'>+%d</font>", Locale.T(line.Key), line.Amount), Size = UDim2.new(1, 0, 0, 26), Align = Enum.TextXAlignment.Left, Parent = rewards, LayoutOrder = order, TextSize = Theme.TextSize.Small })
				table.insert(rows, row)
				order += 1
			end
			local xp = UIBuilder.Label({ Text = string.format("%s  <font color='#80DCFF'>+%d</font>", Locale.T("REWARD.XP"), mine.XP), Size = UDim2.new(1, 0, 0, 26), Align = Enum.TextXAlignment.Left, Parent = rewards, LayoutOrder = order, TextSize = Theme.TextSize.Small })
			table.insert(rows, xp)
			if mine.NewLevel then
				table.insert(rows, UIBuilder.Label({ Text = Locale.T("REWARD.LEVEL_UP", mine.NewLevel), Size = UDim2.new(1, 0, 0, 30), Align = Enum.TextXAlignment.Left, Parent = rewards, LayoutOrder = order + 1, Color = Theme.Colors.Success }))
			end
			for i, u in mine.Unlocks or {} do
				table.insert(rows, UIBuilder.Label({ Text = Locale.T("REWARD.UNLOCK", Locale.T(u)), Size = UDim2.new(1, 0, 0, 26), Align = Enum.TextXAlignment.Left, Parent = rewards, LayoutOrder = order + 1 + i, Color = Theme.Colors.Warning, TextSize = Theme.TextSize.Small }))
			end
			if mine.NewRecord then
				table.insert(rows, UIBuilder.Label({ Text = Locale.T("REWARD.RECORD"), Size = UDim2.new(1, 0, 0, 26), Align = Enum.TextXAlignment.Left, Parent = rewards, LayoutOrder = order + 20, Color = Theme.Colors.Success, TextSize = Theme.TextSize.Small }))
			end
		end
	end
end

function MenuController.BuildSettings(self: any)
	local s = self:NewScreen("Settings", 40, true)
	local p, body = panel(s.Root, Locale.T("UI.SETTINGS"), UDim2.new(0, 760, 0, 720))
	local scroll = Instance.new("ScrollingFrame")
	scroll.Size = UDim2.new(1, 0, 1, -70)
	scroll.BackgroundTransparency = 1
	scroll.BorderSizePixel = 0
	scroll.ScrollBarThickness = 8
	scroll.CanvasSize = UDim2.new(0, 0, 0, 1100)
	scroll.Parent = body
	UIBuilder.List(scroll, Enum.FillDirection.Vertical, 6, Enum.HorizontalAlignment.Left)
	local back = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 200, 0, 50), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Parent = body, Color = Theme.Colors.PanelAlt, OnClick = function()
		if ClientState.InRace() then
			self:Show("Pause")
		else
			self:Show("MainLobby")
		end
	end })
	s.First = back
	local built = false
	s.Refresh = function()
		(p:FindFirstChild("Title") :: TextLabel).Text = Locale.T("UI.SETTINGS")
		back.Text = Locale.T("UI.BACK")
		if built then
			return
		end
		built = true
		local st = self._settings
		local v = st:Get()
		local order = 0
		local function toggle(key: string, label: string)
			order += 1
			UIBuilder.Toggle(scroll, Locale.T(label), (v :: any)[key], order, function(val)
				st:Set(key, val)
			end)
		end
		local function slider(key: string, label: string, min: number, max: number)
			order += 1
			UIBuilder.Slider(scroll, Locale.T(label), (v :: any)[key], min, max, order, function(val)
				st:Set(key, val)
			end)
		end
		order += 1
		UIBuilder.Toggle(scroll, Locale.T("SETTINGS.LANGUAGE") .. " (RU)", v.Locale == "ru", order, function(val)
			st:Set("Locale", if val then "ru" else "en")
			self:RebuildTexts()
		end)
		slider("SteerSensitivity", "SETTINGS.STEER_SENSITIVITY", 0.3, 2)
		toggle("InvertCamera", "SETTINGS.INVERT_CAMERA")
		toggle("AutoAccelerate", "SETTINGS.AUTO_ACCELERATE")
		toggle("TrackAssist", "SETTINGS.TRACK_ASSIST")
		slider("Vibration", "SETTINGS.VIBRATION", 0, 1)
		slider("CameraShake", "SETTINGS.CAMERA_SHAKE", 0, 1)
		slider("SpeedFov", "SETTINGS.SPEED_FOV", 0, 1)
		slider("MusicVolume", "SETTINGS.MUSIC_VOLUME", 0, 1)
		slider("SfxVolume", "SETTINGS.SFX_VOLUME", 0, 1)
		order += 1
		UIBuilder.Toggle(scroll, Locale.T("SETTINGS.MOBILE_LAYOUT") .. " (L)", v.MobileLayout == "Left", order, function(val)
			st:Set("MobileLayout", if val then "Left" else "Right")
		end)
		slider("MobileControlScale", "SETTINGS.CONTROL_SIZE", 0.6, 1.6)
		slider("MobileControlAlpha", "SETTINGS.CONTROL_ALPHA", 0.1, 1)
		toggle("ReducedMotion", "SETTINGS.REDUCED_MOTION")
		toggle("TiltSteering", "SETTINGS.TILT")
	end
end

function MenuController.RebuildTexts(self: any)
	for _, sc in self._screens do
		if sc.Refresh and sc.Gui.Enabled then
			sc.Refresh()
		end
	end
end

function MenuController.BuildRecords(self: any)
	local s = self:NewScreen("Records", 20, true)
	local p, body = panel(s.Root, Locale.T("UI.RECORDS"), UDim2.new(0, 860, 0, 600))
	local list = UIBuilder.Frame({ Size = UDim2.new(1, 0, 1, -70), Transparency = 1, Parent = body })
	UIBuilder.List(list, Enum.FillDirection.Vertical, 8, Enum.HorizontalAlignment.Left)
	local rows: { GuiObject } = {}
	local back = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 200, 0, 50), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Parent = body, Color = Theme.Colors.PanelAlt, OnClick = function()
		self:Show("ModeSelect")
	end })
	s.Refresh = function()
		(p:FindFirstChild("Title") :: TextLabel).Text = Locale.T("UI.RECORDS")
		back.Text = Locale.T("UI.BACK")
		for _, r in rows do
			r:Destroy()
		end
		rows = {}
		local records = ClientState.Profile and ClientState.Profile.TrackRecords or {}
		for i, t in TrackDefinitions.Tracks do
			local rec = records[t.Id]
			local text = string.format("%s   <font color='#80DCFF'>%s</font>%s", Locale.T(t.NameKey), if rec then TimeUtil.FormatRaceTime(rec.BestTime) else "--:--.---", if rec and rec.Assist then "  (assist)" else "")
			local b = UIBuilder.Button({ Text = "", Size = UDim2.new(1, 0, 0, 50), Parent = list, LayoutOrder = i, Color = Theme.Colors.PanelAlt, OnClick = function()
				Network.Fire("StartMode", "TimeTrial", t.Id)
				self:Show("MatchLoading")
			end })
			b.RichText = true
			b.TextScaled = false
			b.TextXAlignment = Enum.TextXAlignment.Left
			b.Text = text
			table.insert(rows, b)
			if i == 1 then
				s.First = b
			end
		end
	end
end

function MenuController.BuildRoom(self: any)
	local s = self:NewScreen("Room", 20, true)
	local p, body = panel(s.Root, Locale.T("UI.PRIVATE_RACE"), UDim2.new(0, 900, 0, 680))
	local left = UIBuilder.Frame({ Size = UDim2.new(0.55, -8, 1, -70), Transparency = 1, Parent = body })
	UIBuilder.List(left, Enum.FillDirection.Vertical, 6, Enum.HorizontalAlignment.Left)
	local right = UIBuilder.Frame({ Size = UDim2.new(0.45, -8, 1, -70), Position = UDim2.new(0.55, 8, 0, 0), Color = Theme.Colors.PanelAlt, Parent = body })
	UIBuilder.Padding(right, 12)
	local membersL = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 1, 0), Align = Enum.TextXAlignment.Left, TextSize = Theme.TextSize.Small, Parent = right, Font = Theme.FontBody })
	membersL.TextYAlignment = Enum.TextYAlignment.Top
	local rules = self._roomRules
	rules.Laps = rules.Laps or 3
	rules.BotCount = rules.BotCount or 4
	rules.BotDifficulty = rules.BotDifficulty or "Normal"
	rules.Teams = rules.Teams or 0
	rules.SpeedClass = rules.SpeedClass or "Standard"
	rules.TrackId = rules.TrackId or TrackDefinitions.Tracks[1].Id
	rules.ItemsEnabled = true
	rules.CollisionsEnabled = true
	rules.Mirror = false
	rules.AssistMode = false
	local function send()
		Network.Fire("CustomRoomAction", "Update", rules)
	end
	local controls: { GuiObject } = {}
	local function cycle(label: string, key: string, values: { any }, order: number, display: ((any) -> string)?)
		local b = UIBuilder.Button({ Text = "", Size = UDim2.new(1, 0, 0, 44), Parent = left, LayoutOrder = order, Color = Theme.Colors.PanelAlt })
		local function refresh()
			local v = rules[key]
			b.Text = string.format("%s: %s", Locale.T(label), if display then display(v) else tostring(v))
		end
		b.Activated:Connect(function()
			local idx = table.find(values, rules[key]) or 0
			rules[key] = values[(idx % #values) + 1]
			refresh()
			send()
		end)
		refresh()
		table.insert(controls, b)
		return b
	end
	local trackIds = {}
	for _, t in TrackDefinitions.Tracks do
		table.insert(trackIds, t.Id)
	end
	s.First = cycle("UI.VEHICLE", "TrackId", trackIds, 1, function(v)
		return Locale.T(TrackDefinitions.TrackById[v].NameKey)
	end)
	cycle("UI.LAPS", "Laps", { 1, 2, 3, 4, 5, 6, 7 }, 2)
	cycle("UI.BOTS", "BotCount", { 0, 2, 4, 6, 8, 11 }, 3)
	cycle("UI.DIFFICULTY", "BotDifficulty", { "Easy", "Normal", "Hard" }, 4)
	cycle("UI.TEAMS", "Teams", { 0, 2, 3, 4 }, 5)
	cycle("UI.SPEED_CLASS", "SpeedClass", ModeDefinitions.CustomRaceLimits.SpeedClasses, 6)
	cycle("UI.ITEMS", "ItemsEnabled", { true, false }, 7, function(v)
		return Locale.T(if v then "UI.ON" else "UI.OFF")
	end)
	cycle("UI.COLLISIONS", "CollisionsEnabled", { true, false }, 8, function(v)
		return Locale.T(if v then "UI.ON" else "UI.OFF")
	end)
	cycle("UI.MIRROR", "Mirror", { false, true }, 9, function(v)
		return Locale.T(if v then "UI.ON" else "UI.OFF")
	end)
	cycle("UI.ASSIST", "AssistMode", { false, true }, 10, function(v)
		return Locale.T(if v then "UI.ON" else "UI.OFF")
	end)
	local btnRow = UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 56), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Transparency = 1, Parent = body })
	UIBuilder.List(btnRow, Enum.FillDirection.Horizontal, 12, Enum.HorizontalAlignment.Right)
	local back = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 180, 0, 50), Parent = btnRow, LayoutOrder = 1, Color = Theme.Colors.PanelAlt, OnClick = function()
		Network.Fire("CustomRoomAction", "Leave", {})
		self:Show("MainLobby")
	end })
	local create = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 220, 0, 50), Parent = btnRow, LayoutOrder = 2, OnClick = function()
		Network.Fire("CustomRoomAction", "Create", rules)
	end })
	local start = UIBuilder.Button({ Text = "", Size = UDim2.new(0, 220, 0, 50), Parent = btnRow, LayoutOrder = 3, Color = Theme.Colors.Success, OnClick = function()
		Network.Fire("CustomRoomAction", "Start", rules)
	end })
	s.Refresh = function()
		(p:FindFirstChild("Title") :: TextLabel).Text = Locale.T("UI.PRIVATE_RACE")
		back.Text = Locale.T("UI.BACK")
		create.Text = Locale.T("UI.CREATE_ROOM")
		start.Text = Locale.T("UI.START_RACE")
		local lobby = ClientState.Lobby
		local room = lobby and lobby.Room
		local names = {}
		if room then
			for _, m in room.Members do
				table.insert(names, m.Name .. (if m.UserId == room.OwnerId then " ★" else ""))
			end
			if room.Rules then
				for k, v in room.Rules do
					rules[k] = v
				end
			end
		end
		membersL.Text = (if room then Locale.T("UI.PARTY_MEMBERS", #names, GameConfig.MaxRacers) .. "\n" .. table.concat(names, "\n") else "")
		start.Visible = room ~= nil and room.OwnerId == Players.LocalPlayer.UserId
		create.Visible = room == nil
		for _, c in controls do
			if c:IsA("TextButton") then
				-- re-render texts through the stored closure by toggling twice is wasteful; texts include values already
			end
		end
	end
end

function MenuController.BuildError(self: any)
	local s = self:NewScreen("Error", 60, true)
	local p, body = panel(s.Root, "", UDim2.new(0, 640, 0, 300))
	local msg = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 120), TextSize = Theme.TextSize.Body, Parent = body, Font = Theme.FontBody })
	local ok = UIBuilder.Button({ Text = "OK", Size = UDim2.new(0, 220, 0, 52), Position = UDim2.new(0.5, 0, 1, 0), Anchor = Vector2.new(0.5, 1), Parent = body, OnClick = function()
		s.Gui.Enabled = false
		table.remove(self._errorQueue, 1)
		if #self._errorQueue > 0 then
			self:ShowError(self._errorQueue[1].Key, self._errorQueue[1].Data, true)
		end
	end })
	s.Refresh = function()
		local e = self._errorQueue[1]
		if e then
			(p:FindFirstChild("Title") :: TextLabel).Text = if e.Data and e.Data.Temporary then "⚠" else "!"
			msg.Text = Locale.T(e.Key)
		end
	end
	s.First = ok
end

function MenuController.ShowError(self: any, key: string, data: any, fromQueue: boolean?)
	if not fromQueue then
		table.insert(self._errorQueue, { Key = key, Data = data })
		if #self._errorQueue > 1 then
			return
		end
	end
	local s = self._screens.Error
	if s.Refresh then
		s.Refresh()
	end
	s.Gui.Enabled = true
end

function MenuController.BuildInvite(self: any)
	local s = self:NewScreen("Invite", 55, false)
	local box = UIBuilder.Frame({ Size = UDim2.new(0, 420, 0, 120), Position = UDim2.new(0.5, 0, 0, 30), Anchor = Vector2.new(0.5, 0), Color = Theme.Colors.Panel, Stroke = true, Parent = s.Root })
	UIBuilder.Padding(box, 12)
	local text = UIBuilder.Label({ Text = "", Size = UDim2.new(1, 0, 0, 40), Parent = box })
	local accept = UIBuilder.Button({ Text = "✓", Size = UDim2.new(0.45, 0, 0, 44), Position = UDim2.new(0, 0, 1, 0), Anchor = Vector2.new(0, 1), Parent = box, Color = Theme.Colors.Success })
	local decline = UIBuilder.Button({ Text = "✕", Size = UDim2.new(0.45, 0, 0, 44), Position = UDim2.new(1, 0, 1, 0), Anchor = Vector2.new(1, 1), Parent = box, Color = Theme.Colors.Danger })
	local current: any = nil
	accept.Activated:Connect(function()
		if current then
			Network.Fire("PartyAction", "Accept", current.FromId)
		end
		s.Gui.Enabled = false
	end)
	decline.Activated:Connect(function()
		if current then
			Network.Fire("PartyAction", "Decline", current.FromId)
		end
		s.Gui.Enabled = false
	end)
	self._showInvite = function(invite: any)
		current = invite
		text.Text = Locale.T("UI.PARTY_INVITE") .. ": " .. tostring(invite.From)
		s.Gui.Enabled = true
		task.delay(20, function()
			if current == invite then
				s.Gui.Enabled = false
			end
		end)
	end
end

function MenuController.ShowInvite(self: any, invite: any)
	if self._showInvite then
		self._showInvite(invite)
	end
end

function MenuController.OnRaceState(self: any, state: string, view: any)
	if state == "TrackVote" then
		self:Show("Vote")
	elseif state == "LoadingTrack" or state == "LoadoutLock" then
		self:Show("MatchLoading")
	elseif state == "GridSetup" or state == "Countdown" or state == "Racing" or state == "FinishWindow" then
		if self.Current ~= "Pause" and self.Current ~= "Settings" then
			self:Hide()
		end
	elseif state == "Results" or state == "Rewards" then
		-- Results screen opens when the Results payload arrives.
	elseif state == "Lobby" then
		self:Show("MainLobby")
	elseif state == "LoadingProfiles" then
		self:Show("MatchLoading")
	end
end

return MenuController
