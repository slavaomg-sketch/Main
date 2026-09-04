--!strict
-- Client-side arcade kart physics for the locally owned kart: raycast suspension on four points, drive/grip forces,
-- speed-scaled steering, drift charging (server rewards), tricks, hit stun, respawn and Track Assist.
-- The server remains authoritative for race state, boosts, items, hits, checkpoints and validation.
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local SurfaceDefinitions = require(Shared.Config.SurfaceDefinitions)
local KartPhysicsModel = require(Shared.Systems.KartPhysicsModel)
local VehicleStats = require(Shared.Systems.VehicleStats)
local MathUtil = require(Shared.Utility.MathUtil)
local Signal = require(Shared.Utility.Signal)
local Maid = require(Shared.Utility.Maid)
local Network = require(Shared.Net.Network)
local GameTypes = require(Shared.Types.GameTypes)
local ClientState = require(script.Parent.Parent.ClientState)
local TrackAssist = require(script.Parent.Parent.TrackAssist)

local P = GameConfig.Physics

export type KartView = {
	Chassis: Part,
	Model: Model,
	Forces: { VectorForce },
	Attachments: { Attachment },
	Drive: VectorForce,
	Align: AlignOrientation,
	Wheels: { { Part: BasePart, Weld: Weld, Base: CFrame, Steer: boolean } },
}

local KartController = { Name = "KartController" }
KartController.__index = KartController

function KartController.new()
	return setmetatable({
		_input = nil :: any,
		_settings = nil :: any,
		_maid = Maid.new(),
		Kart = nil :: KartView?,
		Stats = nil :: VehicleStats.EffectiveStats?,
		State = "Idle" :: GameTypes.KartState,
		Speed = 0,
		ForwardSpeed = 0,
		SpeedFraction = 0,
		Grounded = false,
		GroundNormal = Vector3.new(0, 1, 0),
		Surface = "Asphalt",
		Drifting = false,
		DriftDir = 0,
		DriftCharge = 0,
		DriftTier = 0,
		Boosts = {} :: { GameTypes.ActiveBoost },
		Predicted = {} :: { GameTypes.ActiveBoost },
		StunUntil = 0,
		StunScale = 1,
		StallUntil = 0,
		SlowScale = 1,
		SlowUntil = 0,
		Shards = 0,
		AirSince = nil :: number?,
		OnJump = nil :: string?,
		TrickWindowUntil = 0,
		TrickDone = false,
		LastTrickAt = -10,
		WheelSpin = 0,
		GoAt = math.huge,
		Enabled = false,
		Finished = false,
		StateChanged = Signal.new() :: Signal.Signal<GameTypes.KartState>,
		DriftTierChanged = Signal.new() :: Signal.Signal<number>,
		Landed = Signal.new() :: Signal.Signal<number>,
		Boosted = Signal.new() :: Signal.Signal<string>,
		_rayParams = RaycastParams.new(),
		_lastImpulseAt = 0,
		_stepConn = nil :: RBXScriptConnection?,
		_wrongWayTimer = 0,
	}, KartController)
end

function KartController.Init(self: any, registry: any)
	self._input = registry:Get("InputController")
	self._settings = registry:Get("SettingsController")
	self._rayParams.FilterType = Enum.RaycastFilterType.Exclude
	ClientState.KartAssigned:Connect(function(info, loadout)
		self:Attach(info, loadout)
	end)
	ClientState.RaceStateChanged:Connect(function(state, view)
		if state == "Countdown" and view then
			self.GoAt = view.GoAt
			self.Enabled = true
		elseif state == "Racing" or state == "FinishWindow" then
			self.Enabled = true
			if view and view.GoAt then
				self.GoAt = view.GoAt
			end
		elseif state == "GridSetup" then
			self.Enabled = true
			self.GoAt = math.huge
		elseif state == "Lobby" or state == "Results" or state == "Rewards" then
			if state == "Lobby" then
				self:Detach()
			end
		end
	end)
	ClientState.KartEffect:Connect(function(name, data)
		self:OnEffect(name, data)
	end)
	ClientState.SnapshotReceived:Connect(function(snap)
		if snap.Me then
			self.Boosts = snap.Me.Boosts or {}
			self.Shards = snap.Me.Shards or 0
			-- Confirmed boosts replace predictions of the same source.
			for i = #self.Predicted, 1, -1 do
				for _, b in self.Boosts do
					if b.Source == self.Predicted[i].Source then
						table.remove(self.Predicted, i)
						break
					end
				end
			end
		end
	end)
	ClientState.RaceEvent:Connect(function(name)
		if name == "Finished" then
			self.Finished = true
			self:SetState("Finished")
		end
	end)
	self._input.DriftPressed:Connect(function()
		self:OnDriftPressed()
	end)
	self._input.DriftReleased:Connect(function()
		self:OnDriftReleased()
	end)
	self._input.ThrottlePressed:Connect(function()
		if self.Enabled and not self.Finished and Workspace:GetServerTimeNow() < self.GoAt + 1 then
			Network.Fire("StartThrottle")
		end
	end)
	self._input.RespawnPressed:Connect(function()
		if self.Enabled then
			Network.Fire("RequestRespawn")
		end
	end)
end

function KartController.SetState(self: any, s: GameTypes.KartState)
	if self.State ~= s then
		self.State = s
		self.StateChanged:Fire(s)
	end
end

-- Finds the kart model the server spawned for us (by RacerKey attribute) and wires up the physics handles.
function KartController.Attach(self: any, info: any, loadout: any)
	self:Detach()
	self.Stats =
		VehicleStats.Compute(loadout.HeroId, loadout.VehicleId, info.Rules and info.Rules.SpeedClass or "Standard")
	self.Finished = false
	local key = info.Key
	local chassis: Part? = nil
	local deadline = os.clock() + 10
	while os.clock() < deadline and chassis == nil do
		for _, inst in CollectionService:GetTagged("KartChassis") do
			if inst:GetAttribute("RacerKey") == key and inst:GetAttribute("SessionId") == info.SessionId then
				chassis = inst :: Part
				break
			end
		end
		if chassis == nil then
			task.wait(0.1)
		end
	end
	if chassis == nil then
		warn("[KartController] kart not found for " .. tostring(key))
		return
	end
	local ch = chassis :: Part
	local model = (ch.Parent :: any) :: Model
	local forces, attachments = {}, {}
	for i = 1, 4 do
		local att = ch:FindFirstChild("Suspension" .. i)
		local vf = ch:FindFirstChild("SuspensionForce" .. i)
		if att and vf then
			table.insert(attachments, att :: Attachment)
			table.insert(forces, vf :: VectorForce)
		end
	end
	local wheels = {}
	for _, w in model:GetChildren() do
		if w:IsA("BasePart") and string.sub(w.Name, 1, 5) == "Wheel" then
			local weld = w:FindFirstChild("WheelWeld")
			if weld then
				local idx = tonumber(string.sub(w.Name, 6)) or 3
				table.insert(
					wheels,
					{
						Part = w :: BasePart,
						Weld = weld :: Weld,
						Base = (weld :: Weld).C0,
						Steer = idx <= 2 and #attachments == 4 or (idx == 1 and #attachments == 3),
					}
				)
			end
		end
	end
	self.Kart = {
		Chassis = ch,
		Model = model,
		Forces = forces,
		Attachments = attachments,
		Drive = ch:FindFirstChild("DriveForce") :: VectorForce,
		Align = ch:FindFirstChild("Upright") :: AlignOrientation,
		Wheels = wheels,
	}
	self._rayParams.FilterDescendantsInstances = { model }
	local karts = Workspace:FindFirstChild("RiftRacers")
	if karts then
		local list: { Instance } = { model }
		for _, k in CollectionService:GetTagged("KartChassis") do
			if k.Parent then
				table.insert(list, k.Parent :: Instance)
			end
		end
		self._rayParams.FilterDescendantsInstances = list
	end
	self.Boosts = {}
	self.Predicted = {}
	self.Drifting = false
	self.DriftCharge = 0
	self.DriftTier = 0
	self.StunUntil = 0
	self.Enabled = true
	self._input:Bind()
	self._stepConn = RunService.Heartbeat:Connect(function(dt)
		self:Step(dt)
	end)
	self._maid:GiveKey("step", self._stepConn)
	self._maid:GiveKey(
		"impulse",
		ch:GetAttributeChangedSignal("ImpulseAt"):Connect(function()
			local imp = ch:GetAttribute("Impulse")
			if typeof(imp) == "Vector3" then
				ch:ApplyImpulse(imp)
			end
		end)
	)
	self._maid:GiveKey(
		"ancestry",
		model.AncestryChanged:Connect(function(_, parent)
			if parent == nil then
				self:Detach()
			end
		end)
	)
	self:SetState("Idle")
end

function KartController.Detach(self: any)
	self._maid:Destroy()
	self._maid = Maid.new()
	self._input:Unbind()
	self.Kart = nil
	self.Enabled = false
	self.Drifting = false
	self:SetState("Spectating")
end

-- Server effects -----------------------------------------------------------------------------------------------------
function KartController.OnEffect(self: any, name: string, data: any)
	local now = Workspace:GetServerTimeNow()
	if name == "Boost" then
		self.Boosted:Fire(data.Source)
	elseif name == "StartBoost" then
		if data.StallSeconds and data.StallSeconds > 0 then
			self.StallUntil = self.GoAt + data.StallSeconds
		end
		self.Boosted:Fire("Start:" .. tostring(data.Result))
	elseif name == "Hit" then
		self.StunUntil = now + (data.Seconds or 0.7)
		self.StunScale = data.SpeedScale or 0.5
		self.Drifting = false
		self.DriftCharge = 0
		self.Predicted = {}
		self:SetDriftTier(0)
		local kart = self.Kart
		if kart and data.Spin then
			kart.Chassis.AssemblyAngularVelocity = Vector3.new(0, 9, 0)
		end
		self:SetState("HitStun")
	elseif name == "Respawn" then
		local kart = self.Kart
		if kart and typeof(data.CFrame) == "CFrame" then
			local origin = kart.Model.Parent
				and kart.Model.Parent.Parent
				and (kart.Model.Parent.Parent :: Instance):GetAttribute("Origin")
			local cf = data.CFrame
			if typeof(origin) == "Vector3" then
				cf = cf + origin
			end
			kart.Chassis.AssemblyLinearVelocity = Vector3.new()
			kart.Chassis.AssemblyAngularVelocity = Vector3.new()
			kart.Chassis.CFrame = cf
		end
		self.Drifting = false
		self.DriftCharge = 0
		self:SetDriftTier(0)
		self.Predicted = {}
		self:SetState("Respawning")
	elseif name == "Trick" then
		self.TrickDone = true
	end
end

-- Drift ----------------------------------------------------------------------------------------------------------
function KartController.SetDriftTier(self: any, tier: number)
	if tier ~= self.DriftTier then
		self.DriftTier = tier
		self.DriftTierChanged:Fire(tier)
	end
end

function KartController.OnDriftPressed(self: any)
	if not self.Enabled or not self.Kart or self.Finished then
		return
	end
	local now = Workspace:GetServerTimeNow()
	-- Trick: pressing drift in the air shortly after a ramp.
	if
		not self.Grounded
		and self.OnJump
		and now <= self.TrickWindowUntil
		and not self.TrickDone
		and now - self.LastTrickAt > P.Trick.CooldownSeconds
	then
		self.TrickDone = true
		self.LastTrickAt = now
		Network.Fire("TrickEvent", self.OnJump)
		self.Boosted:Fire("TrickInput")
		return
	end
	local steer = self._input:Read().Steer
	if KartPhysicsModel.CanStartDrift(self.SpeedFraction, steer, self.Grounded) and now >= self.StunUntil then
		self.Drifting = true
		self.DriftDir = MathUtil.Sign(steer)
		self.DriftCharge = 0
		self:SetDriftTier(0)
		Network.Fire("DriftEvent", "Start", 0)
		self:SetState(if self.DriftDir < 0 then "DriftingLeft" else "DriftingRight")
	end
end

function KartController.OnDriftReleased(self: any)
	if not self.Drifting then
		return
	end
	local tier = KartPhysicsModel.DriftTier(self.DriftCharge)
	self.Drifting = false
	self.DriftCharge = 0
	Network.Fire("DriftEvent", "Release", tier)
	local b = KartPhysicsModel.DriftBoostFor(tier)
	if b and self.Stats then
		-- Predict locally for responsiveness; the server's confirmation replaces it.
		table.insert(
			self.Predicted,
			KartPhysicsModel.MakeBoost(
				("Drift" .. tier) :: any,
				b.BoostSeconds,
				b.SpeedBonus,
				self.Stats,
				Workspace:GetServerTimeNow()
			)
		)
	end
	self:SetDriftTier(0)
end

-- Physics step -----------------------------------------------------------------------------------------------------
function KartController.Step(self: any, dt: number)
	local kart: KartView? = self.Kart
	local stats: VehicleStats.EffectiveStats? = self.Stats
	if not kart or not stats then
		return
	end
	local ch = kart.Chassis
	if not ch.Parent then
		return
	end
	local now = Workspace:GetServerTimeNow()
	local input = self._input:Read()
	local settings = self._settings:Get()
	local cf = ch.CFrame
	local vel = ch.AssemblyLinearVelocity
	local mass = ch.AssemblyMass
	local look = cf.LookVector
	local right = cf.RightVector
	local up = cf.UpVector

	-- Suspension raycasts
	local hits = 0
	local normalSum = Vector3.new()
	local surfaceCounts: { [string]: number } = {}
	local onJump: string? = nil
	for i, att in kart.Attachments do
		local origin = att.WorldPosition
		local result = Workspace:Raycast(origin, -up * P.RayLength, self._rayParams)
		local force = Vector3.new()
		if result then
			hits += 1
			normalSum += result.Normal
			local compression = math.clamp(P.SuspensionRestLength - result.Distance, -0.5, P.SuspensionRestLength)
			local pointVel = ch:GetVelocityAtPosition(origin)
			local relVel = pointVel:Dot(result.Normal)
			local spring = (P.SuspensionStiffness * compression - P.SuspensionDamping * relVel)
				* (mass / #kart.Attachments)
			force = result.Normal * math.max(0, spring)
			local part = result.Instance
			local surf = part:GetAttribute("Surface")
			if typeof(surf) == "string" then
				surfaceCounts[surf] = (surfaceCounts[surf] or 0) + 1
			elseif CollectionService:HasTag(part, "Road") then
				surfaceCounts.Asphalt = (surfaceCounts.Asphalt or 0) + 1
			else
				surfaceCounts.Dirt = (surfaceCounts.Dirt or 0) + 1
			end
			local jumpId = part:GetAttribute("JumpId")
			if typeof(jumpId) == "string" then
				onJump = jumpId
			end
		end
		kart.Forces[i].Force = force
	end
	local grounded = hits >= 2
	local wasGrounded = self.Grounded
	self.Grounded = grounded
	if grounded then
		self.GroundNormal = normalSum.Unit
		local best, bestN = "Asphalt", 0
		for id, n in surfaceCounts do
			if n > bestN then
				best, bestN = id, n
			end
		end
		self.Surface = best
	end
	-- Jump trigger detection (leaving a ramp): raycast forward-down for a JumpTrigger volume.
	if grounded and onJump then
		self.OnJump = onJump
		self.TrickWindowUntil = now + 1.5
		self.TrickDone = false
	end
	if not grounded then
		self.AirSince = self.AirSince or now
		if self.OnJump then
			self.TrickWindowUntil =
				math.max(self.TrickWindowUntil, (self.AirSince :: number) + P.Trick.WindowSeconds + 0.6)
		end
	else
		if self.AirSince ~= nil and wasGrounded == false then
			local airTime = now - (self.AirSince :: number)
			self.Landed:Fire(airTime)
			if airTime > 0.9 then
				self.OnJump = nil
			end
		end
		self.AirSince = nil
		if self.OnJump and now > self.TrickWindowUntil then
			self.OnJump = nil
		end
	end

	-- Speeds
	local forwardSpeed = vel:Dot(look)
	local lateralSpeed = vel:Dot(right)
	self.ForwardSpeed = forwardSpeed
	self.Speed = vel.Magnitude
	self.SpeedFraction = math.abs(forwardSpeed) / math.max(1, stats.TopSpeed)

	-- Boosts (confirmed + predicted), stun, stall, slow
	KartPhysicsModel.PruneBoosts(self.Predicted, now)
	local all = table.clone(self.Boosts)
	for _, b in self.Predicted do
		table.insert(all, b)
	end
	local stunned = now < self.StunUntil
	local stalled = now < self.StallUntil
	if now > self.SlowUntil then
		self.SlowScale = 1
	end
	local top = KartPhysicsModel.EffectiveTopSpeed(stats, self.Surface, all, self.Shards, now, self.SlowScale)
	if stunned then
		top *= self.StunScale
	end
	local surf = KartPhysicsModel.SurfaceMultipliers(self.Surface, stats)
	local beforeGo = now < self.GoAt
	local canDrive = self.Enabled and not self.Finished and not beforeGo and not stalled

	-- Track Assist
	local assist = settings.TrackAssist
	local steer = input.Steer
	if assist then
		steer = TrackAssist.SoftenSteer(steer, self.SpeedFraction)
	end
	if stunned then
		steer *= 0.2
	end

	-- Drift charge
	if self.Drifting then
		if not grounded or stunned or self.SpeedFraction < P.DriftMinSpeedFraction * 0.7 then
			self:OnDriftReleased()
		else
			local angleFactor = math.abs(steer * 0.5 + self.DriftDir * 0.5)
			self.DriftCharge += KartPhysicsModel.DriftChargeRate(angleFactor, self.SpeedFraction) * dt
			self:SetDriftTier(KartPhysicsModel.DriftTier(self.DriftCharge))
		end
	end

	-- Drive force (world space)
	local driveForce = Vector3.new()
	if grounded then
		local accel = stats.Acceleration * surf.Acceleration
		local fwd = 0
		if not canDrive then
			fwd = -forwardSpeed * 3 -- hold on the grid / during stall
		elseif input.Brake > 0 and forwardSpeed > 1 then
			fwd = -accel * P.BrakeDecel * input.Brake
		elseif input.Brake > 0 then
			local reverseTop = -stats.TopSpeed * P.ReverseSpeedFraction
			fwd = if forwardSpeed > reverseTop then -accel * 0.6 else 0
		elseif input.Throttle > 0 then
			local target = top * input.Throttle
			if forwardSpeed < target then
				local taper = math.clamp(1 - (math.max(0, forwardSpeed) / target) ^ 2, 0.15, 1)
				fwd = accel * taper
			else
				fwd = -(forwardSpeed - target) * 2.5 -- soft ceiling
			end
		else
			fwd = -forwardSpeed * P.CoastDrag
		end
		if self.Drifting then
			fwd -= forwardSpeed * 0.06
		end
		-- Lateral grip (drift keeps only a fraction)
		local gripGain = stats.Grip * surf.Grip
		if self.Drifting then
			gripGain *= P.DriftLateralGripScale
		end
		local lat = -lateralSpeed * gripGain
		local maxLat = stats.Grip * 12
		lat = math.clamp(lat, -maxLat, maxLat)
		-- Project drive along the ground plane.
		local groundLook = (look - self.GroundNormal * look:Dot(self.GroundNormal))
		if groundLook.Magnitude > 1e-3 then
			groundLook = groundLook.Unit
		else
			groundLook = look
		end
		local groundRight = (right - self.GroundNormal * right:Dot(self.GroundNormal))
		if groundRight.Magnitude > 1e-3 then
			groundRight = groundRight.Unit
		else
			groundRight = right
		end
		driveForce = (groundLook * fwd + groundRight * lat) * mass
		-- Assist: gentle push away from the walls when close.
		if assist and canDrive then
			driveForce += TrackAssist.EdgeGuide(ch, self._rayParams, right, mass)
		end
	else
		-- Air: light control only
		driveForce = Vector3.new()
	end
	kart.Drive.Force = driveForce

	-- Steering via angular velocity (positive steer = right = negative Y rotation)
	local ang = ch.AssemblyAngularVelocity
	local rate = KartPhysicsModel.SteerRate(self.SpeedFraction, stats, self.Surface, self.Drifting)
	local yaw = 0
	if canDrive then
		if self.Drifting then
			yaw = -(self.DriftDir * 0.55 + steer * 0.45 * stats.DriftControl) * rate
		else
			yaw = -steer * rate * (if forwardSpeed < -1 then -1 else 1)
		end
		if not grounded then
			yaw *= stats.AirControl * P.AirControlTorque
		end
	end
	if stunned and ang.Y ~= 0 then
		yaw = ang.Y * (1 - 2 * dt) -- let the spin decay
	end
	ch.AssemblyAngularVelocity = Vector3.new(ang.X * 0.9, yaw, ang.Z * 0.9)

	-- Upright alignment follows the ground normal; in the air relax toward world up.
	if grounded then
		kart.Align.PrimaryAxis = self.GroundNormal
	else
		kart.Align.PrimaryAxis = kart.Align.PrimaryAxis:Lerp(Vector3.new(0, 1, 0), 1 - math.exp(-P.UprightAirGain * dt))
	end
	if assist and grounded and up.Y < 0.3 then
		-- Auto flip
		ch.CFrame = CFrame.lookAt(
			cf.Position + Vector3.new(0, 2, 0),
			cf.Position + Vector3.new(0, 2, 0) + Vector3.new(look.X, 0, look.Z)
		)
	end

	-- Wheels visual
	self.WheelSpin += forwardSpeed * dt / 1.0
	for _, w in kart.Wheels do
		local steerAngle = if w.Steer then -steer * math.rad(22) else 0
		w.Weld.C0 = w.Base
			* CFrame.Angles(0, steerAngle, 0)
			* CFrame.Angles(0, 0, 0)
			* CFrame.fromAxisAngle(Vector3.new(1, 0, 0), self.WheelSpin)
	end
	-- Attributes for camera/VFX (local only)
	ch:SetAttribute("Grounded", grounded)

	-- State summary
	if self.Finished then
		self:SetState("Finished")
	elseif stunned then
		self:SetState("HitStun")
	elseif self.Drifting then
		self:SetState(if self.DriftDir < 0 then "DriftingLeft" else "DriftingRight")
	elseif #all > 0 then
		self:SetState("Boosting")
	elseif not grounded then
		self:SetState("Airborne")
	elseif input.Brake > 0 and forwardSpeed > 1 then
		self:SetState("Braking")
	elseif forwardSpeed < -1 then
		self:SetState("Reversing")
	elseif input.Throttle > 0 and canDrive then
		self:SetState("Accelerating")
	else
		self:SetState("Idle")
	end
	local _ = SurfaceDefinitions
end

function KartController.ActiveBoostBonus(self: any): number
	local now = Workspace:GetServerTimeNow()
	local all = table.clone(self.Boosts)
	for _, b in self.Predicted do
		table.insert(all, b)
	end
	return KartPhysicsModel.ActiveBoostBonus(all, now)
end

function KartController.Destroy(self: any)
	self:Detach()
end

return KartController
