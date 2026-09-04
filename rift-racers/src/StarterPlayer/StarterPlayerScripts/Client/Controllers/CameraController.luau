--!strict
-- Chase camera with speed-adaptive distance/FOV, drift lean, landing dip, look-back, wall avoidance, spectator,
-- results orbit and a lobby orbit. Respects reduced motion and shake settings.
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")
local Players = game:GetService("Players")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local MathUtil = require(Shared.Utility.MathUtil)
local ClientState = require(script.Parent.Parent.ClientState)

local C = GameConfig.Camera

local CameraController = { Name = "CameraController" }
CameraController.__index = CameraController

function CameraController.new()
	return setmetatable({
		_kart = nil :: any,
		_input = nil :: any,
		_settings = nil :: any,
		Mode = "Lobby" :: "Lobby" | "Chase" | "Spectate" | "Results" | "Garage",
		_target = nil :: BasePart?,
		_pos = Vector3.new(),
		_fov = C.FovBase,
		_shake = 0,
		_dip = 0,
		_yawOffset = 0,
		_orbit = 0,
		_conn = nil :: RBXScriptConnection?,
		_rayParams = RaycastParams.new(),
		_garagePivot = nil :: CFrame?,
	}, CameraController)
end

function CameraController.Init(self: any, registry: any)
	self._kart = registry:Get("KartController")
	self._input = registry:Get("InputController")
	self._settings = registry:Get("SettingsController")
	self._rayParams.FilterType = Enum.RaycastFilterType.Exclude
	self._kart.Landed:Connect(function(airTime)
		self._dip = math.min(1, airTime) * C.LandingDip
	end)
	ClientState.KartEffect:Connect(function(name, data)
		if name == "Hit" then
			self._shake = if data.Level and data.Level >= 2 then 1 else 0.5
		end
	end)
	ClientState.RaceStateChanged:Connect(function(state)
		if state == "GridSetup" or state == "Countdown" or state == "Racing" or state == "FinishWindow" then
			self.Mode = "Chase"
		elseif state == "Results" or state == "Rewards" then
			self.Mode = "Results"
		elseif state == "Lobby" then
			self.Mode = "Lobby"
		end
	end)
	ClientState.RaceEvent:Connect(function(name, data)
		if name == "Spectate" or name == "Eliminated" then
			self.Mode = "Spectate"
		end
	end)
end

function CameraController.Start(self: any)
	local cam = Workspace.CurrentCamera
	if cam then
		cam.CameraType = Enum.CameraType.Scriptable
	end
	self._conn = RunService.RenderStepped:Connect(function(dt)
		self:Update(dt)
	end)
end

function CameraController.SetGaragePivot(self: any, cf: CFrame?)
	self._garagePivot = cf
	self.Mode = if cf then "Garage" else "Lobby"
end

local function lobbyPivot(): CFrame
	local rr = Workspace:FindFirstChild("RiftRacers")
	local lobby = rr and rr:FindFirstChild("Lobby")
	local spawn = lobby and lobby:FindFirstChild("LobbySpawn")
	if spawn and spawn:IsA("BasePart") then
		return (spawn :: BasePart).CFrame
	end
	return CFrame.new(0, 10, -540)
end

function CameraController.SpectateTarget(self: any): BasePart?
	local key = Players.LocalPlayer:GetAttribute("SpectateKey")
	local session = Players.LocalPlayer:GetAttribute("SpectateSession")
	if typeof(key) ~= "string" then
		-- Default to the leader from the snapshot
		local snap = ClientState.Snapshot
		if snap then
			for _, r in snap.Racers do
				if r.Pos == 1 then
					key = r.K
					session = ClientState.Race and ClientState.Race.SessionId
				end
			end
		end
	end
	if typeof(key) ~= "string" then
		return nil
	end
	for _, inst in CollectionService:GetTagged("KartChassis") do
		if inst:GetAttribute("RacerKey") == key and (session == nil or inst:GetAttribute("SessionId") == session) then
			return inst :: BasePart
		end
	end
	return nil
end

function CameraController.Update(self: any, dt: number)
	local cam = Workspace.CurrentCamera
	if not cam then
		return
	end
	local settings = self._settings:Get()
	local reduced = settings.ReducedMotion
	local smoothing = if reduced then C.Smoothing * 0.6 else C.Smoothing
	local target: BasePart? = nil
	if self.Mode == "Chase" then
		target = if self._kart.Kart then self._kart.Kart.Chassis else nil
		if not target then
			target = self:SpectateTarget()
		end
	elseif self.Mode == "Spectate" or self.Mode == "Results" then
		target = self:SpectateTarget() or (if self._kart.Kart then self._kart.Kart.Chassis else nil)
	end
	if self.Mode == "Garage" and self._garagePivot then
		self._orbit += dt * 0.25
		local pivot = self._garagePivot :: CFrame
		local pos = pivot.Position + Vector3.new(math.sin(self._orbit) * 16, 6, math.cos(self._orbit) * 16)
		cam.CFrame = cam.CFrame:Lerp(CFrame.lookAt(pos, pivot.Position + Vector3.new(0, 2, 0)), 1 - math.exp(-smoothing * dt))
		cam.FieldOfView = MathUtil.Damp(cam.FieldOfView, 60, 4, dt)
		return
	end
	if target == nil then
		-- Lobby orbit around the rift ring
		self._orbit += dt * (if reduced then 0.05 else 0.12)
		local pivot = lobbyPivot()
		local pos = pivot.Position + Vector3.new(math.sin(self._orbit) * 60, 24, math.cos(self._orbit) * 60)
		cam.CFrame = cam.CFrame:Lerp(CFrame.lookAt(pos, pivot.Position + Vector3.new(0, 14, -80)), 1 - math.exp(-2 * dt))
		cam.FieldOfView = MathUtil.Damp(cam.FieldOfView, 60, 4, dt)
		return
	end
	local t = target :: BasePart
	local vel = t.AssemblyLinearVelocity
	local look = t.CFrame.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	if flat.Magnitude < 1e-3 then
		flat = Vector3.new(0, 0, -1)
	end
	flat = flat.Unit
	local speedFrac = math.clamp(vel.Magnitude / 100, 0, 1.3)
	local lookBack = self.Mode == "Chase" and self._input.Frame.LookBack
	local dist = if lookBack then C.ReverseDistance else C.Distance + C.DistanceSpeedExtra * speedFrac
	local height = C.Height
	-- Drift lean: rotate the chase direction toward the drift.
	local driftYaw = 0
	if self.Mode == "Chase" and self._kart.Drifting then
		driftYaw = math.rad(C.DriftYawDegrees) * self._kart.DriftDir * (if reduced then 0.4 else 1)
	end
	self._yawOffset = MathUtil.Damp(self._yawOffset, driftYaw, 6, dt)
	local dir = CFrame.fromAxisAngle(Vector3.new(0, 1, 0), -self._yawOffset):VectorToWorldSpace(flat)
	if lookBack then
		dir = -dir
	end
	if self.Mode == "Results" then
		self._orbit += dt * 0.5
		dir = Vector3.new(math.sin(self._orbit), 0, math.cos(self._orbit))
		dist = 18
		height = 7
	end
	local desired = t.Position - dir * dist + Vector3.new(0, height, 0)
	-- Wall avoidance: keep the camera out of geometry between kart and desired position.
	local from = t.Position + Vector3.new(0, 2, 0)
	self._rayParams.FilterDescendantsInstances = { t.Parent :: Instance }
	local hit = Workspace:Raycast(from, desired - from, self._rayParams)
	if hit and hit.Instance:HasTag("Wall") == false then
		desired = hit.Position + hit.Normal * 1.5
	elseif hit then
		desired = hit.Position + hit.Normal * 1.0
	end
	self._pos = MathUtil.DampVector(self._pos, desired, smoothing, dt)
	-- Dip & shake
	self._dip = MathUtil.Damp(self._dip, 0, 6, dt)
	local shakeAmt = settings.CameraShake * (if reduced then 0.3 else 1)
	self._shake = MathUtil.Damp(self._shake, 0, 5, dt)
	local shakeOffset = Vector3.new(math.noise(os.clock() * 25, 0) * self._shake, math.noise(0, os.clock() * 25) * self._shake, 0) * shakeAmt
	local focus = t.Position + flat * 8 + Vector3.new(0, 2 - self._dip * 2, 0)
	cam.CFrame = CFrame.lookAt(self._pos + shakeOffset - Vector3.new(0, self._dip, 0), focus)
	local fovTarget = C.FovBase + C.FovSpeedExtra * speedFrac * settings.SpeedFov * (if reduced then 0.4 else 1)
	if self._kart.ActiveBoostBonus and self.Mode == "Chase" then
		fovTarget += self._kart:ActiveBoostBonus() * 30 * settings.SpeedFov
	end
	cam.FieldOfView = MathUtil.Damp(cam.FieldOfView, fovTarget, 5, dt)
end

function CameraController.Destroy(self: any)
	if self._conn then
		self._conn:Disconnect()
	end
end

return CameraController
