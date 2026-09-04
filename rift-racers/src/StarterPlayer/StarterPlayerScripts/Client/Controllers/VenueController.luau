--!strict
-- Client-side venue presentation: atmosphere/lighting per track, spinning decor & pickups, gate visuals,
-- collision toggles for Time Trial ghosts. Reads TrackDefinitions to avoid per-frame server traffic.
local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local Network = require(Shared.Net.Network)
local ClientState = require(script.Parent.Parent.ClientState)

local VenueController = { Name = "VenueController" }
VenueController.__index = VenueController

local LOBBY_ATMOSPHERE = { SkyColor = Color3.fromRGB(30, 25, 60), FogColor = Color3.fromRGB(40, 30, 80), FogEnd = 1600, Ambient = Color3.fromRGB(90, 80, 140), ClockTime = 21, Brightness = 1.6 }

function VenueController.new()
	return setmetatable({ _conn = nil :: RBXScriptConnection?, _spinners = {} :: { { Part: BasePart, Rate: number, Base: CFrame } }, _spinScanAt = 0, _atmosphere = nil :: any }, VenueController)
end

function VenueController.Init(self: any, _registry: any)
	ClientState.RaceStateChanged:Connect(function(state, view)
		if state == "LoadingTrack" and view and view.VenueId then
			self:ApplyVenue(view.VenueId)
			task.delay(0.5, function()
				-- Wait for replication of the track model then acknowledge.
				local deadline = os.clock() + 15
				while os.clock() < deadline do
					if self:VenueModel(view.SessionId) then
						break
					end
					task.wait(0.25)
				end
				Network.Fire("TrackLoaded", view.VenueId)
			end)
		elseif state == "Lobby" then
			self:ApplyAtmosphere(LOBBY_ATMOSPHERE)
		end
	end)
end

function VenueController.Start(self: any)
	self:ApplyAtmosphere(LOBBY_ATMOSPHERE)
	self._conn = RunService.Heartbeat:Connect(function(dt)
		self:Tick(dt)
	end)
end

function VenueController.VenueModel(self: any, sessionId: string?): Model?
	local rr = workspace:FindFirstChild("RiftRacers")
	local tracks = rr and rr:FindFirstChild("Tracks")
	if not tracks then
		return nil
	end
	for _, folder in tracks:GetChildren() do
		for _, m in folder:GetChildren() do
			if m:IsA("Model") and (sessionId == nil or m:GetAttribute("SessionId") == sessionId) then
				return m :: Model
			end
		end
	end
	return nil
end

function VenueController.ApplyVenue(self: any, venueId: string)
	local def: any = TrackDefinitions.TrackById[venueId] or TrackDefinitions.ArenaById[venueId]
	if def then
		self:ApplyAtmosphere(def.Atmosphere)
	end
end

function VenueController.ApplyAtmosphere(self: any, atm: any)
	self._atmosphere = atm
	Lighting.Ambient = atm.Ambient
	Lighting.OutdoorAmbient = atm.Ambient
	Lighting.ClockTime = atm.ClockTime
	Lighting.Brightness = atm.Brightness
	Lighting.FogColor = atm.FogColor
	Lighting.FogEnd = atm.FogEnd
	Lighting.FogStart = atm.FogEnd * 0.35
	local s: Sky
	local existingSky = Lighting:FindFirstChildOfClass("Sky")
	if existingSky then
		s = (existingSky :: any) :: Sky
	else
		s = Instance.new("Sky")
		s.Parent = Lighting
	end
	s.SkyboxBk = ""
	s.SkyboxDn = ""
	s.SkyboxFt = ""
	s.SkyboxLf = ""
	s.SkyboxRt = ""
	s.SkyboxUp = ""
	s.StarCount = 1500
	s.CelestialBodiesShown = true
	local a: Atmosphere
	local existingAtmo = Lighting:FindFirstChildOfClass("Atmosphere")
	if existingAtmo then
		a = (existingAtmo :: any) :: Atmosphere
	else
		a = Instance.new("Atmosphere")
		a.Parent = Lighting
	end
	a.Color = atm.SkyColor
	a.Decay = atm.FogColor
	a.Density = 0.35
	a.Haze = 1.5
	a.Glare = 0.2
end

-- Spinners: parts with a "Spin" attribute rotate locally (decor blades, pickup cores, projectiles).
function VenueController.Tick(self: any, dt: number)
	local now = os.clock()
	if now - self._spinScanAt > 2 then
		self._spinScanAt = now
		self._spinners = {}
		for _, tag in { "Pickup", "Projectile", "Moving" } do
			for _, p in CollectionService:GetTagged(tag) do
				if p:IsA("BasePart") and p:GetAttribute("Spin") then
					table.insert(self._spinners, { Part = p :: BasePart, Rate = p:GetAttribute("Spin") :: number, Base = (p :: BasePart).CFrame })
				end
			end
		end
	end
	for _, s in self._spinners do
		local p = s.Part
		if p.Parent and p.Anchored and not CollectionService:HasTag(p, "Moving") then
			local bob = if CollectionService:HasTag(p, "Pickup") then math.sin(now * 2) * 0.4 else 0
			p.CFrame = CFrame.new(p.Position.X, s.Base.Position.Y + bob, p.Position.Z) * CFrame.Angles(0, now * s.Rate, 0) * (if p.Shape == Enum.PartType.Cylinder then CFrame.Angles(0, 0, math.rad(90)) else CFrame.new())
		end
	end
end

function VenueController.Destroy(self: any)
	if self._conn then
		self._conn:Disconnect()
	end
end

return VenueController
