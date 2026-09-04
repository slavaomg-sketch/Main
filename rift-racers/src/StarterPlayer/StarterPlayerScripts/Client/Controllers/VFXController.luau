--!strict
-- Pooled particle/trail effects for boosts, drift sparks, hits, shields, pickups and projectiles. Original
-- primitives only (ParticleEmitter with default texture, Trails, Highlights). Respects reduced motion.
local Workspace = game:GetService("Workspace")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ItemDefinitions = require(Shared.Config.ItemDefinitions)
local SurfaceDefinitions = require(Shared.Config.SurfaceDefinitions)
local ClientState = require(script.Parent.Parent.ClientState)

local VFXController = { Name = "VFXController" }
VFXController.__index = VFXController

local TRAIL_COLORS: { [string]: Color3 } = { Trail_Comet = Color3.fromRGB(255, 200, 80), Trail_Prism = Color3.fromRGB(200, 120, 255) }

function VFXController.new()
	return setmetatable({ _kart = nil :: any, _settings = nil :: any, _emitters = {} :: { [string]: ParticleEmitter }, _trails = {} :: { Trail }, _pool = {} :: { Part }, _highlights = {} :: { [string]: Highlight }, _lastSurface = "Asphalt" }, VFXController)
end

local function emitter(parent: Instance, name: string, color: Color3, size: number, rate: number, speed: number, life: number): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Name = name
	e.Color = ColorSequence.new(color)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, size), NumberSequenceKeypoint.new(1, 0) })
	e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(1, 1) })
	e.Rate = 0
	e.Speed = NumberRange.new(speed * 0.7, speed)
	e.Lifetime = NumberRange.new(life * 0.7, life)
	e.SpreadAngle = Vector2.new(25, 25)
	e.LightEmission = 0.8
	e.Enabled = true
	e.Parent = parent
	e:SetAttribute("BaseRate", rate)
	return e
end

function VFXController.Init(self: any, registry: any)
	self._kart = registry:Get("KartController")
	self._settings = registry:Get("SettingsController")
	ClientState.KartAssigned:Connect(function(_info, loadout)
		task.delay(0.5, function()
			self:AttachToKart(loadout)
		end)
	end)
	ClientState.VisualEvent:Connect(function(name, data)
		self:OnVisual(name, data)
	end)
	ClientState.KartEffect:Connect(function(name, data)
		if name == "Boost" then
			self:Burst("Boost", 30)
		elseif name == "Hit" then
			self:Burst("Hit", 40)
		elseif name == "StartBoost" and data.Result == "Perfect" then
			self:Burst("Boost", 50)
		end
	end)
	self._kart.DriftTierChanged:Connect(function(tier)
		local e = self._emitters.Drift
		if e then
			e.Color = ColorSequence.new(if tier >= 3 then Color3.fromRGB(200, 120, 255) elseif tier == 2 then Color3.fromRGB(255, 200, 60) else Color3.fromRGB(80, 220, 255))
		end
	end)
end

function VFXController.AttachToKart(self: any, loadout: any)
	local kart = self._kart.Kart
	if not kart then
		return
	end
	local ch: Part = kart.Chassis
	local exhaust = ch:FindFirstChild("Exhaust") :: Attachment?
	if not exhaust then
		return
	end
	self._emitters = {}
	self._emitters.Boost = emitter(exhaust, "BoostFX", Color3.fromRGB(80, 220, 255), 1.6, 60, 20, 0.5)
	self._emitters.Drift = emitter(exhaust, "DriftFX", Color3.fromRGB(80, 220, 255), 0.7, 40, 8, 0.4)
	self._emitters.Dust = emitter(exhaust, "DustFX", Color3.fromRGB(180, 160, 130), 1.2, 20, 5, 0.8)
	self._emitters.Hit = emitter(exhaust, "HitFX", Color3.fromRGB(255, 120, 60), 1.4, 0, 18, 0.5)
	-- Boost trail cosmetics
	local trailId = loadout and loadout.Cosmetics and loadout.Cosmetics.Trail
	local color = if trailId and TRAIL_COLORS[trailId] then TRAIL_COLORS[trailId] else Color3.fromRGB(80, 220, 255)
	for _, side in { -1, 1 } do
		local a0 = Instance.new("Attachment")
		a0.Position = Vector3.new(side * 1.6, -0.6, 3)
		a0.Parent = ch
		local a1 = Instance.new("Attachment")
		a1.Position = Vector3.new(side * 1.6, 0.2, 3)
		a1.Parent = ch
		local trail = Instance.new("Trail")
		trail.Attachment0 = a0
		trail.Attachment1 = a1
		trail.Color = ColorSequence.new(color)
		trail.Lifetime = 0.35
		trail.LightEmission = 0.8
		trail.Enabled = false
		trail.Parent = ch
		table.insert(self._trails, trail)
	end
	task.spawn(function()
		while ch.Parent do
			self:Tick()
			task.wait(0.1)
		end
	end)
end

function VFXController.Tick(self: any)
	local reduced = self._settings:Get().ReducedMotion
	local k = self._kart
	local state = k.State
	local boostE = self._emitters.Boost
	local driftE = self._emitters.Drift
	local dustE = self._emitters.Dust
	if boostE then
		boostE.Rate = if state == "Boosting" then (if reduced then 25 else 60) else 0
	end
	if driftE then
		driftE.Rate = if (state == "DriftingLeft" or state == "DriftingRight") then (if reduced then 15 else 40) else 0
	end
	if dustE then
		local surf = SurfaceDefinitions[k.Surface]
		local wantsDust = surf and (surf.VFX == "Dust" or surf.VFX == "Frost" or surf.VFX == "Splash") and k.Speed > 15 and k.Grounded
		dustE.Rate = if wantsDust then 20 else 0
		if surf then
			dustE.Color = ColorSequence.new(if surf.VFX == "Frost" then Color3.fromRGB(220, 240, 255) elseif surf.VFX == "Splash" then Color3.fromRGB(120, 170, 220) else Color3.fromRGB(180, 160, 130))
		end
	end
	for _, t in self._trails do
		t.Enabled = state == "Boosting" and not reduced
	end
end

function VFXController.Burst(self: any, name: string, count: number)
	local e = self._emitters[name]
	if e then
		e:Emit(if self._settings:Get().ReducedMotion then count // 2 else count)
	end
end

local function chassisFor(key: string): BasePart?
	for _, inst in CollectionService:GetTagged("KartChassis") do
		if inst:GetAttribute("RacerKey") == key then
			return inst :: BasePart
		end
	end
	return nil
end

function VFXController.Flash(self: any, key: string, color: Color3, seconds: number)
	local ch = chassisFor(key)
	if not ch or not ch.Parent then
		return
	end
	local h = self._highlights[key]
	if not h then
		h = Instance.new("Highlight")
		h.FillTransparency = 0.5
		h.OutlineTransparency = 0.2
		h.Parent = ch.Parent
		self._highlights[key] = h
	end
	local hl = h :: Highlight
	hl.FillColor = color
	hl.OutlineColor = color
	hl.Enabled = true
	task.delay(seconds, function()
		if hl.FillColor == color then
			hl.Enabled = false
		end
	end)
end

function VFXController.OnVisual(self: any, name: string, data: any)
	if name == "Shield" then
		self:Flash(data.Key, Color3.fromRGB(120, 200, 255), data.Seconds or 8)
	elseif name == "Shielded" then
		self:Flash(data.Key, Color3.fromRGB(255, 255, 255), 0.3)
	elseif name == "Hit" then
		self:Flash(data.Key, Color3.fromRGB(255, 90, 60), 0.6)
	elseif name == "Phase" then
		self:Flash(data.Key, Color3.fromRGB(200, 120, 255), data.Seconds or 4)
	elseif name == "DriftBoost" then
		local def = { Color3.fromRGB(80, 220, 255), Color3.fromRGB(255, 200, 60), Color3.fromRGB(200, 120, 255) }
		self:Flash(data.Key, def[data.Tier] or def[1], 0.4)
	elseif name == "Trick" then
		self:Flash(data.Key, Color3.fromRGB(255, 240, 200), 0.4)
	elseif name == "Blink" then
		self:Flash(data.Key, Color3.fromRGB(255, 255, 255), 0.5)
	elseif name == "Wave" or name == "StormCrown" then
		local ch = chassisFor(data.Key)
		if ch then
			local ring = Instance.new("Part")
			ring.Shape = Enum.PartType.Cylinder
			ring.Anchored = true
			ring.CanCollide = false
			ring.CanQuery = false
			ring.Material = Enum.Material.Neon
			ring.Color = if name == "Wave" then (ItemDefinitions.ById[data.Item] and ItemDefinitions.ById[data.Item].Color or Color3.fromRGB(180, 140, 255)) else Color3.fromRGB(255, 90, 60)
			ring.Transparency = 0.4
			ring.Size = Vector3.new(0.4, 2, 2)
			ring.CFrame = CFrame.new(ch.Position) * CFrame.Angles(0, 0, math.rad(90))
			ring.Parent = Workspace
			local radius = (data.Radius or 16) * 2
			task.spawn(function()
				for i = 1, 12 do
					ring.Size = Vector3.new(0.4, radius * i / 12, radius * i / 12)
					ring.Transparency = 0.4 + 0.6 * i / 12
					task.wait(0.03)
				end
				ring:Destroy()
			end)
		end
	end
end

return VFXController
