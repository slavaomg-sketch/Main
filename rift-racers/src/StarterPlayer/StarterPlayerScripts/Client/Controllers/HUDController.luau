--!strict
-- Race HUD: position/total, lap, minimap, items (Active/Reserve), shards, speed, drift meter, incoming warning,
-- wrong way, race time / gap, team score, knockout safe line, countdown, start-boost & event toasts, diagnostics.
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")
local Stats = game:GetService("Stats")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ItemDefinitions = require(Shared.Config.ItemDefinitions)
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local Locale = require(Shared.Locale.Locale)
local TimeUtil = require(Shared.Utility.TimeUtil)
local Spline = require(Shared.Utility.Spline)
local Network = require(Shared.Net.Network)
local ClientState = require(script.Parent.Parent.ClientState)
local UIBuilder = require(script.Parent.Parent.UI.UIBuilder)
local Theme = require(script.Parent.Parent.UI.Theme)
local TouchControls = require(script.Parent.Parent.UI.TouchControls)

local HUDController = { Name = "HUDController" }
HUDController.__index = HUDController

function HUDController.new()
	return setmetatable({
		_kart = nil :: any,
		_input = nil :: any,
		_settings = nil :: any,
		_gui = nil :: ScreenGui?,
		_els = {} :: { [string]: any },
		_minimapSpline = nil :: any,
		_minimapDots = {} :: { [string]: Frame },
		_minimapBounds = nil :: any,
		_touch = nil :: any,
		_lastUpdate = 0,
		_toastQueue = {} :: { string },
		_diag = false,
	}, HUDController)
end

function HUDController.Init(self: any, registry: any)
	self._kart = registry:Get("KartController")
	self._input = registry:Get("InputController")
	self._settings = registry:Get("SettingsController")
	ClientState.RaceStateChanged:Connect(function(state, view)
		self:OnRaceState(state, view)
	end)
	ClientState.RaceEvent:Connect(function(name, data)
		self:OnRaceEvent(name, data)
	end)
	ClientState.KartEffect:Connect(function(name, data)
		if name == "StartBoost" then
			local key = if data.Result == "Perfect"
				then "RACE.START_PERFECT"
				elseif data.Result == "Good" then "RACE.START_GOOD"
				elseif data.Result == "Okay" then "RACE.START_OKAY"
				elseif data.Result == "Early" then "RACE.START_EARLY"
				else nil
			if key then
				self:Toast(Locale.T(key))
			end
		elseif name == "Boost" then
			local src = tostring(data.Source)
			if src == "Drift1" then
				self:Toast(Locale.T("RACE.DRIFT_1"))
			elseif src == "Drift2" then
				self:Toast(Locale.T("RACE.DRIFT_2"))
			elseif src == "Drift3" then
				self:Toast(Locale.T("RACE.DRIFT_3"))
			elseif src == "Trick" then
				self:Toast(Locale.T("RACE.TRICK"))
			elseif src == "Slipstream" then
				self:Toast(Locale.T("RACE.SLIPSTREAM"))
			end
		end
	end)
	ClientState.ItemState:Connect(function()
		self:RefreshItems()
	end)
	self._input.ItemPressed:Connect(function(slot)
		if ClientState.InRace() then
			local cam = Workspace.CurrentCamera
			local aim = if cam then cam.CFrame.LookVector else nil
			Network.Fire("UseItem", slot, aim)
		end
	end)
	self._input.DeviceChanged:Connect(function()
		self:RefreshTouch()
	end)
	self._settings.Changed:Connect(function()
		self:RefreshTouch()
		self:RefreshStatic()
	end)
end

function HUDController.Start(self: any)
	self:Build()
	RunService.RenderStepped:Connect(function()
		self:Update()
	end)
end

function HUDController.Build(self: any)
	local gui = UIBuilder.ScreenGui("RaceHUD", Players.LocalPlayer:WaitForChild("PlayerGui"), 10, false)
	self._gui = gui
	local e = self._els
	-- Top-left: position & lap
	local topLeft = UIBuilder.Frame({
		Size = UDim2.new(0, 260, 0, 120),
		Position = UDim2.new(0, 24, 0, 24),
		Transparency = 1,
		Parent = gui,
	})
	e.Position = UIBuilder.Label({
		Text = "1/8",
		Size = UDim2.new(1, 0, 0, 70),
		TextSize = 64,
		Align = Enum.TextXAlignment.Left,
		Parent = topLeft,
		Scaled = true,
	})
	e.Lap = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(1, 0, 0, 34),
		Position = UDim2.new(0, 0, 0, 72),
		TextSize = Theme.TextSize.Header,
		Align = Enum.TextXAlignment.Left,
		Color = Theme.Colors.Accent2,
		Parent = topLeft,
	})
	-- Top-center: time / gap / countdown / toasts
	e.Time = UIBuilder.Label({
		Text = "00:00.000",
		Size = UDim2.new(0, 300, 0, 40),
		Position = UDim2.new(0.5, 0, 0, 20),
		Anchor = Vector2.new(0.5, 0),
		TextSize = Theme.TextSize.Header,
		Parent = gui,
	})
	e.Gap = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(0, 300, 0, 28),
		Position = UDim2.new(0.5, 0, 0, 60),
		Anchor = Vector2.new(0.5, 0),
		TextSize = Theme.TextSize.Small,
		Color = Theme.Colors.TextDim,
		Parent = gui,
	})
	e.Countdown = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(0, 400, 0, 140),
		Position = UDim2.new(0.5, 0, 0.3, 0),
		Anchor = Vector2.new(0.5, 0.5),
		TextSize = Theme.TextSize.Huge,
		Color = Theme.Colors.Accent2,
		Parent = gui,
	})
	e.Toast = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(0, 500, 0, 50),
		Position = UDim2.new(0.5, 0, 0.42, 0),
		Anchor = Vector2.new(0.5, 0.5),
		TextSize = Theme.TextSize.Title,
		Color = Theme.Colors.Warning,
		Parent = gui,
	})
	e.WrongWay = UIBuilder.Label({
		Text = Locale.T("RACE.WRONG_WAY"),
		Size = UDim2.new(0, 400, 0, 60),
		Position = UDim2.new(0.5, 0, 0.2, 0),
		Anchor = Vector2.new(0.5, 0.5),
		TextSize = Theme.TextSize.Title,
		Color = Theme.Colors.Danger,
		Parent = gui,
	})
	e.WrongWay.Visible = false
	e.Incoming = UIBuilder.Label({
		Text = Locale.T("RACE.INCOMING"),
		Size = UDim2.new(0, 300, 0, 40),
		Position = UDim2.new(0.5, 0, 0.52, 0),
		Anchor = Vector2.new(0.5, 0.5),
		TextSize = Theme.TextSize.Header,
		Color = Theme.Colors.Danger,
		Parent = gui,
	})
	e.Incoming.Visible = false
	-- Top-right: team / knockout info
	e.Team = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(0, 300, 0, 34),
		Position = UDim2.new(1, -24, 0, 24),
		Anchor = Vector2.new(1, 0),
		TextSize = Theme.TextSize.Body,
		Align = Enum.TextXAlignment.Right,
		Parent = gui,
	})
	e.Knockout = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(0, 300, 0, 30),
		Position = UDim2.new(1, -24, 0, 58),
		Anchor = Vector2.new(1, 0),
		TextSize = Theme.TextSize.Small,
		Align = Enum.TextXAlignment.Right,
		Color = Theme.Colors.Warning,
		Parent = gui,
	})
	-- Bottom-left: minimap
	local mm = UIBuilder.Frame({
		Size = UDim2.new(0, 220, 0, 220),
		Position = UDim2.new(0, 24, 1, -24),
		Anchor = Vector2.new(0, 1),
		Color = Theme.Colors.Panel,
		Transparency = 0.35,
		Parent = gui,
		Name = "Minimap",
	})
	e.Minimap = mm
	e.MinimapPath = UIBuilder.Frame({ Transparency = 1, Parent = mm, Name = "Path" })
	e.MinimapDots = UIBuilder.Frame({ Transparency = 1, Parent = mm, Name = "Dots", ZIndex = 3 })
	-- Bottom-right: items, shards, speed, drift
	local br = UIBuilder.Frame({
		Size = UDim2.new(0, 320, 0, 200),
		Position = UDim2.new(1, -24, 1, -24),
		Anchor = Vector2.new(1, 1),
		Transparency = 1,
		Parent = gui,
	})
	e.Speed = UIBuilder.Label({
		Text = "0",
		Size = UDim2.new(1, 0, 0, 60),
		Position = UDim2.new(0, 0, 1, 0),
		Anchor = Vector2.new(0, 1),
		TextSize = 54,
		Align = Enum.TextXAlignment.Right,
		Parent = br,
	})
	e.Drift = UIBuilder.Frame({
		Size = UDim2.new(1, 0, 0, 12),
		Position = UDim2.new(0, 0, 1, -66),
		Anchor = Vector2.new(0, 1),
		Color = Theme.Colors.PanelAlt,
		Corner = UDim.new(1, 0),
		Parent = br,
	})
	e.DriftFill = UIBuilder.Frame({
		Size = UDim2.fromScale(0, 1),
		Color = Theme.Colors.Accent2,
		Corner = UDim.new(1, 0),
		Parent = e.Drift,
	})
	e.Shards = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(1, 0, 0, 26),
		Position = UDim2.new(0, 0, 1, -84),
		Anchor = Vector2.new(0, 1),
		TextSize = Theme.TextSize.Small,
		Align = Enum.TextXAlignment.Right,
		Color = Color3.fromRGB(200, 160, 255),
		Parent = br,
	})
	e.ItemActive = UIBuilder.Frame({
		Size = UDim2.new(0, 84, 0, 84),
		Position = UDim2.new(1, 0, 0, 0),
		Anchor = Vector2.new(1, 0),
		Color = Theme.Colors.Panel,
		Stroke = true,
		Parent = br,
		Name = "Active",
	})
	e.ItemActiveLabel = UIBuilder.Label({
		Text = "",
		Size = UDim2.fromScale(1, 1),
		TextSize = Theme.TextSize.Small,
		Parent = e.ItemActive,
		Scaled = true,
	})
	e.ItemReserve = UIBuilder.Frame({
		Size = UDim2.new(0, 60, 0, 60),
		Position = UDim2.new(1, -96, 0, 12),
		Anchor = Vector2.new(1, 0),
		Color = Theme.Colors.Panel,
		Parent = br,
		Name = "Reserve",
	})
	e.ItemReserveLabel = UIBuilder.Label({
		Text = "",
		Size = UDim2.fromScale(1, 1),
		TextSize = 14,
		Parent = e.ItemReserve,
		Scaled = true,
		Color = Theme.Colors.TextDim,
	})
	-- Diagnostics (F3 toggles)
	e.Diag = UIBuilder.Label({
		Text = "",
		Size = UDim2.new(0, 380, 0, 100),
		Position = UDim2.new(0.5, 0, 1, -10),
		Anchor = Vector2.new(0.5, 1),
		TextSize = 14,
		Color = Theme.Colors.TextDim,
		Font = Theme.FontBody,
		Parent = gui,
		Align = Enum.TextXAlignment.Left,
	})
	e.Diag.Visible = false
	game:GetService("UserInputService").InputBegan:Connect(function(io, processed)
		if not processed and io.KeyCode == Enum.KeyCode.F3 then
			self._diag = not self._diag
			e.Diag.Visible = self._diag
		end
	end)
	self:RefreshTouch()
end

function HUDController.RefreshTouch(self: any)
	local wantTouch = self._input:IsTouch()
	if wantTouch and not self._touch then
		self._touch = TouchControls.Build(Players.LocalPlayer:WaitForChild("PlayerGui"), self._input, function(slot)
			self._input.ItemPressed:Fire(slot)
		end, function()
			self._input.RespawnPressed:Fire()
		end)
	elseif not wantTouch and self._touch then
		self._touch.Destroy()
		self._touch = nil
	end
	if self._touch then
		self._touch.Apply(self._settings:Get())
		self._touch.Gui.Enabled = ClientState.InRace() and self._kart.Kart ~= nil
	end
end

function HUDController.RefreshStatic(self: any)
	local e = self._els
	if e.WrongWay then
		e.WrongWay.Text = Locale.T("RACE.WRONG_WAY")
		e.Incoming.Text = Locale.T("RACE.INCOMING")
	end
end

function HUDController.OnRaceState(self: any, state: string, view: any)
	local gui = self._gui
	if not gui then
		return
	end
	local inRace = state == "GridSetup" or state == "Countdown" or state == "Racing" or state == "FinishWindow"
	gui.Enabled = inRace
	if state == "LoadingTrack" and view then
		self:BuildMinimap(view.VenueId, view.Mirror)
	end
	if inRace and view then
		local modeDef = ModeDefinitions.ById[view.ModeId]
		self._els.Team.Visible = modeDef ~= nil and (modeDef.Teams > 0 or (view.Rules and view.Rules.Teams > 0))
	end
	self:RefreshTouch()
	if state == "Lobby" then
		self._els.Countdown.Text = ""
		self._els.Toast.Text = ""
	end
end

function HUDController.OnRaceEvent(self: any, name: string, data: any)
	local e = self._els
	if name == "Lap" then
		if data.Lap == (data.Laps or 3) - 1 then
			self:Toast(Locale.T("RACE.FINAL_LAP"))
		end
	elseif name == "Finished" then
		self:Toast(Locale.T("RACE.FINISH") .. " " .. Locale.Ordinal(data.Position or 0))
	elseif name == "Incoming" then
		e.Incoming.Visible = true
		task.delay(data.Seconds or 1.5, function()
			e.Incoming.Visible = false
		end)
	elseif name == "Eliminated" then
		self:Toast(Locale.T("RACE.ELIMINATED"))
	elseif name == "KnockoutStage" then
		self:Toast(Locale.T("RACE.STAGE", data.Stage, data.Stages))
	elseif name == "MissedCheckpoints" then
		self:Toast(Locale.T("RACE.WRONG_WAY"))
	elseif name == "CoresLost" then
		self:Toast(Locale.T("RACE.RESPAWN"))
	end
end

function HUDController.Toast(self: any, text: string)
	local e = self._els
	e.Toast.Text = text
	e.Toast.TextTransparency = 0
	local id = os.clock()
	e.Toast:SetAttribute("Id", id)
	task.delay(1.6, function()
		if e.Toast:GetAttribute("Id") == id then
			e.Toast.Text = ""
		end
	end)
end

function HUDController.RefreshItems(self: any)
	local e = self._els
	local me = ClientState.Me
	local function name(id: string?): string
		if not id then
			return ""
		end
		local def = ItemDefinitions.ById[id]
		return if def then Locale.T(def.NameKey) else id
	end
	if me and me.Items then
		e.ItemActiveLabel.Text = name(me.Items.Active)
		e.ItemReserveLabel.Text = name(me.Items.Reserve)
		local def = if me.Items.Active then ItemDefinitions.ById[me.Items.Active] else nil
		e.ItemActive.BackgroundColor3 = if def then def.Color:Lerp(Theme.Colors.Panel, 0.5) else Theme.Colors.Panel
	else
		e.ItemActiveLabel.Text = ""
		e.ItemReserveLabel.Text = ""
		e.ItemActive.BackgroundColor3 = Theme.Colors.Panel
	end
end

-- Minimap: project the spline's XZ onto the panel once; dots follow snapshot progress fractions.
function HUDController.BuildMinimap(self: any, venueId: string, mirror: boolean?)
	local e = self._els
	e.MinimapPath:ClearAllChildren()
	e.MinimapDots:ClearAllChildren()
	self._minimapDots = {}
	local def = TrackDefinitions.TrackById[venueId]
	if not def then
		self._minimapSpline = nil
		e.Minimap.Visible = false
		return
	end
	e.Minimap.Visible = true
	local pts = def.Path
	if mirror and def.MirrorSupport then
		local m = {}
		for i, p in pts do
			m[i] = Vector3.new(-p.X, p.Y, p.Z)
		end
		pts = m
	end
	local spline = Spline.new(pts, def.Scale, true, 8)
	self._minimapSpline = spline
	local minX, maxX, minZ, maxZ = math.huge, -math.huge, math.huge, -math.huge
	for _, s in spline.Samples do
		minX = math.min(minX, s.Pos.X)
		maxX = math.max(maxX, s.Pos.X)
		minZ = math.min(minZ, s.Pos.Z)
		maxZ = math.max(maxZ, s.Pos.Z)
	end
	local span = math.max(maxX - minX, maxZ - minZ, 1)
	self._minimapBounds = { MinX = minX, MinZ = minZ, Span = span }
	local detail = def.MinimapDetail
	local prev: Vector2? = nil
	for i = 0, detail do
		local pos = spline:PositionAt(spline.Length * i / detail)
		local p2 = Vector2.new((pos.X - minX) / span, (pos.Z - minZ) / span)
		if prev then
			local a, b = prev :: Vector2, p2
			local mid = (a + b) / 2
			local len = (b - a).Magnitude
			local seg = UIBuilder.Frame({
				Size = UDim2.new(len * 0.9, 0, 0, 4),
				Position = UDim2.fromScale(mid.X * 0.9 + 0.05, mid.Y * 0.9 + 0.05),
				Anchor = Vector2.new(0.5, 0.5),
				Color = Theme.Colors.Accent2,
				Transparency = 0.2,
				Parent = e.MinimapPath,
				Corner = UDim.new(1, 0),
			})
			seg.Rotation = math.deg(math.atan2(b.Y - a.Y, b.X - a.X))
		end
		prev = p2
	end
end

function HUDController.Update(self: any)
	local gui = self._gui
	if not gui or not gui.Enabled then
		return
	end
	local now = os.clock()
	local e = self._els
	local k = self._kart
	-- Fast lane (every frame): speed + drift meter + countdown
	e.Speed.Text = Locale.T("RACE.SPEED", math.floor(k.Speed + 0.5))
	local tiers = GameConfig.Physics.DriftTiers
	local charge = if k.Drifting then math.clamp(k.DriftCharge / tiers[#tiers].Seconds, 0, 1) else 0
	e.DriftFill.Size = UDim2.fromScale(charge, 1)
	e.DriftFill.BackgroundColor3 = if k.DriftTier >= 3
		then Color3.fromRGB(200, 120, 255)
		elseif k.DriftTier == 2 then Theme.Colors.Warning
		else Theme.Colors.Accent2
	local race = ClientState.Race
	local serverNow = Workspace:GetServerTimeNow()
	if race and ClientState.RaceStateName == "Countdown" then
		local remaining = race.GoAt - serverNow
		if remaining > 0 and remaining <= GameConfig.Race.CountdownSeconds then
			e.Countdown.Text = tostring(math.ceil(remaining))
		elseif remaining <= 0 then
			e.Countdown.Text = Locale.T("RACE.GO")
		else
			e.Countdown.Text = ""
		end
	elseif race and ClientState.RaceStateName == "Racing" and serverNow - race.GoAt < 1 then
		e.Countdown.Text = Locale.T("RACE.GO")
	else
		e.Countdown.Text = ""
	end
	if now - self._lastUpdate < 1 / GameConfig.UI.HudUpdateHz then
		return
	end
	self._lastUpdate = now
	local snap = ClientState.Snapshot
	local me = ClientState.Me
	local myKey = ClientState.MyKey()
	if snap and race then
		local total = 0
		local mine: any = nil
		for _, r in snap.Racers do
			if r.Conn then
				total += 1
			end
			if r.K == myKey then
				mine = r
			end
		end
		if mine then
			e.Position.Text = Locale.T("RACE.POSITION", mine.Pos, total)
			if race.Rules and race.Rules.Laps > 0 and race.ModeId ~= "CoreClash" and race.ModeId ~= "ShardRush" then
				e.Lap.Text = Locale.T("RACE.LAP", math.min(mine.Lap + 1, race.Rules.Laps), race.Rules.Laps)
			else
				e.Lap.Text = if race.ModeId == "CoreClash"
					then Locale.T("RACE.CORES", mine.Cores or 0)
					else Locale.T("RACE.SHARDS", mine.Sh or 0)
			end
		end
		-- Time & gap
		if ClientState.RaceStateName == "Racing" or ClientState.RaceStateName == "FinishWindow" then
			if snap.BattleEndsAt and snap.BattleEndsAt > 0 then
				e.Time.Text =
					Locale.T("RACE.TIME_LEFT", TimeUtil.FormatRaceTime(math.max(0, snap.BattleEndsAt - serverNow)))
			else
				e.Time.Text = TimeUtil.FormatRaceTime(math.max(0, serverNow - race.GoAt))
			end
		end
		if race.ModeId == "TimeTrial" then
			local rec = ClientState.Profile
				and ClientState.Profile.TrackRecords
				and ClientState.Profile.TrackRecords[race.VenueId]
			e.Gap.Text = if rec then Locale.T("RACE.GAP", TimeUtil.FormatRaceTime(rec.BestTime)) else ""
		else
			e.Gap.Text = ""
		end
		-- Team score
		if snap.TeamScores and next(snap.TeamScores) then
			local parts = {}
			for team, score in snap.TeamScores do
				local tc = ModeDefinitions.TeamColors[tonumber(team) or 0]
				if tc then
					table.insert(parts, Locale.T("RACE.TEAM_SCORE", Locale.T(tc.NameKey), score))
				end
			end
			table.sort(parts)
			e.Team.Text = table.concat(parts, "   ")
		end
		if snap.SafePosition then
			e.Knockout.Text = Locale.T("RACE.SAFE_POSITION", snap.SafePosition)
		else
			e.Knockout.Text = ""
		end
		-- Minimap dots
		local spline = self._minimapSpline
		local b = self._minimapBounds
		if spline and b then
			for _, r in snap.Racers do
				local dot = self._minimapDots[r.K]
				if not dot then
					dot = UIBuilder.Frame({
						Size = UDim2.new(0, if r.K == myKey then 14 else 9, 0, if r.K == myKey then 14 else 9),
						Anchor = Vector2.new(0.5, 0.5),
						Color = if r.K == myKey then Theme.Colors.Warning else Theme.Colors.Text,
						Corner = UDim.new(1, 0),
						Parent = e.MinimapDots,
						ZIndex = if r.K == myKey then 5 else 4,
					})
					self._minimapDots[r.K] = dot
				end
				local d = dot :: Frame
				local pos = spline:PositionAt(spline.Length * (r.Pr or 0))
				d.Position =
					UDim2.fromScale((pos.X - b.MinX) / b.Span * 0.9 + 0.05, (pos.Z - b.MinZ) / b.Span * 0.9 + 0.05)
				d.Visible = r.Conn and not r.Elim
			end
		end
	end
	if me then
		e.Shards.Text = if (me.Shards or 0) > 0 then Locale.T("RACE.SHARDS", me.Shards) else ""
		e.WrongWay.Visible = me.WrongWay == true
	end
	self:RefreshItems()
	if self._diag then
		local ok, text = pcall(function()
			local recv = Stats.DataReceiveKbps
			local send = Stats.DataSendKbps
			return string.format(
				"ping %.0f ms | recv %.1f KB/s send %.1f KB/s | mem %.0f MB | speed %.0f | surf %s | state %s",
				Players.LocalPlayer:GetNetworkPing() * 1000,
				recv,
				send,
				Stats:GetTotalMemoryUsageMb(),
				k.Speed,
				tostring(k.Surface),
				tostring(k.State)
			)
		end)
		e.Diag.Text = if ok then text else "diag unavailable"
	end
end

return HUDController
