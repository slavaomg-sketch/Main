--!strict
-- Lightweight kinematic kart simulation used for server-driven bots and headless integration tests.
-- It shares KartPhysicsModel with the client controller so bots obey the same speed/steer/drift rules.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local GameTypes = require(Shared.Types.GameTypes)
local KartPhysicsModel = require(Shared.Systems.KartPhysicsModel)
local VehicleStats = require(Shared.Systems.VehicleStats)
local MathUtil = require(Shared.Utility.MathUtil)
local TrackRuntime = require(script.Parent.TrackRuntime)

export type Input = { Steer: number, Throttle: number, Brake: number, Drift: boolean, Trick: boolean }

export type KartSim = {
	Position: Vector3,
	Yaw: number,
	Speed: number,
	Stats: VehicleStats.EffectiveStats,
	Boosts: { GameTypes.ActiveBoost },
	Shards: number,
	Drifting: boolean,
	DriftDir: number,
	DriftCharge: number,
	StunUntil: number,
	StunScale: number,
	StallUntil: number,
	Surface: string,
	Progress: number,
	Airborne: boolean,
	AirUntil: number,
	SlowScale: number,
	SlowUntil: number,
	LastDriftTier: number,
	Step: (self: KartSim, input: Input, dt: number, now: number, track: TrackRuntime.TrackRuntime) -> (),
	CFrame: (self: KartSim) -> CFrame,
	Forward: (self: KartSim) -> Vector3,
	Velocity: (self: KartSim) -> Vector3,
	Teleport: (self: KartSim, cframe: CFrame) -> (),
}

local KartSim = {}
KartSim.__index = KartSim

function KartSim.new(stats: VehicleStats.EffectiveStats, cframe: CFrame): KartSim
	local look = cframe.LookVector
	local self = setmetatable({
		Position = cframe.Position,
		Yaw = math.atan2(-look.X, -look.Z),
		Speed = 0,
		Stats = stats,
		Boosts = {},
		Shards = 0,
		Drifting = false,
		DriftDir = 0,
		DriftCharge = 0,
		StunUntil = -1,
		StunScale = 1,
		StallUntil = -1,
		Surface = "Asphalt",
		Progress = 0,
		Airborne = false,
		AirUntil = -1,
		SlowScale = 1,
		SlowUntil = -1,
		LastDriftTier = 0,
	}, KartSim)
	return (self :: any) :: KartSim
end

function KartSim.Forward(self: any): Vector3
	return Vector3.new(-math.sin(self.Yaw), 0, -math.cos(self.Yaw))
end

function KartSim.CFrame(self: any): CFrame
	return CFrame.new(self.Position) * CFrame.Angles(0, self.Yaw, 0)
end

function KartSim.Velocity(self: any): Vector3
	return KartSim.Forward(self) * self.Speed
end

function KartSim.Teleport(self: any, cframe: CFrame)
	self.Position = cframe.Position
	local look = cframe.LookVector
	self.Yaw = math.atan2(-look.X, -look.Z)
	self.Speed = 0
	self.Drifting = false
	self.DriftCharge = 0
	self.Boosts = {}
end

function KartSim.Step(self: any, input: Input, dt: number, now: number, track: TrackRuntime.TrackRuntime)
	local stats: VehicleStats.EffectiveStats = self.Stats
	KartPhysicsModel.PruneBoosts(self.Boosts, now)
	if now > self.SlowUntil then
		self.SlowScale = 1
	end
	local stunned = now < self.StunUntil
	local stalled = now < self.StallUntil
	local surf = KartPhysicsModel.SurfaceMultipliers(self.Surface, stats)
	local top = KartPhysicsModel.EffectiveTopSpeed(stats, self.Surface, self.Boosts, self.Shards, now, self.SlowScale)
	if stunned then
		top *= self.StunScale
	end
	local speedFrac = math.abs(self.Speed) / math.max(1, stats.TopSpeed)
	local grounded = not self.Airborne

	-- Steering
	local steer = math.clamp(input.Steer, -1, 1)
	if stunned then
		steer = 0
	end
	local rate = KartPhysicsModel.SteerRate(speedFrac, stats, self.Surface, self.Drifting)
	if not grounded then
		rate *= stats.AirControl * GameConfig.Physics.AirControlTorque
	end
	-- Positive steer = turn right. Rotation about +Y turns the heading left, hence the sign flip.
	local yawDelta = steer * rate * dt * (if self.Speed < 0 then -1 else 1)
	if self.Drifting then
		-- Drift keeps a bias in the drift direction and lets the player modulate the angle.
		yawDelta = (self.DriftDir * 0.55 + steer * 0.45 * stats.DriftControl) * rate * dt
	end
	self.Yaw -= yawDelta

	-- Drift state
	if grounded and not stunned then
		if not self.Drifting and input.Drift and KartPhysicsModel.CanStartDrift(speedFrac, steer, true) then
			self.Drifting = true
			self.DriftDir = MathUtil.Sign(steer)
			self.DriftCharge = 0
		elseif self.Drifting then
			if not input.Drift or speedFrac < GameConfig.Physics.DriftMinSpeedFraction * 0.8 then
				local tier = KartPhysicsModel.DriftTier(self.DriftCharge)
				self.LastDriftTier = tier
				local b = KartPhysicsModel.DriftBoostFor(tier)
				if b then
					table.insert(
						self.Boosts,
						KartPhysicsModel.MakeBoost(("Drift" .. tier) :: any, b.BoostSeconds, b.SpeedBonus, stats, now)
					)
				end
				self.Drifting = false
				self.DriftCharge = 0
			else
				local angleFactor = math.abs(steer * 0.5 + self.DriftDir * 0.5)
				self.DriftCharge += KartPhysicsModel.DriftChargeRate(angleFactor, speedFrac) * dt
			end
		end
	elseif self.Drifting then
		self.Drifting = false
		self.DriftCharge = 0
	end

	-- Longitudinal
	local accel = stats.Acceleration * surf.Acceleration
	if stalled then
		self.Speed = MathUtil.MoveToward(self.Speed, 0, accel * dt)
	elseif input.Brake > 0 and self.Speed > 1 then
		self.Speed = MathUtil.MoveToward(self.Speed, 0, accel * GameConfig.Physics.BrakeDecel * input.Brake * dt)
	elseif input.Brake > 0 then
		self.Speed =
			MathUtil.MoveToward(self.Speed, -stats.TopSpeed * GameConfig.Physics.ReverseSpeedFraction, accel * 0.6 * dt)
	elseif input.Throttle > 0 then
		local target = top * math.clamp(input.Throttle, 0, 1)
		if self.Speed < target then
			-- Acceleration tapers as we approach top speed.
			local taper = math.clamp(1 - (self.Speed / target) ^ 2, 0.15, 1)
			self.Speed = math.min(target, self.Speed + accel * taper * dt)
		else
			self.Speed = MathUtil.MoveToward(self.Speed, target, accel * 0.5 * dt)
		end
	else
		self.Speed = MathUtil.MoveToward(self.Speed, 0, self.Speed * GameConfig.Physics.CoastDrag * dt + 2 * dt)
	end
	if self.Drifting then
		self.Speed *= (1 - 0.06 * dt)
	end
	if not grounded then
		self.Speed = MathUtil.MoveToward(self.Speed, self.Speed, 0)
	end

	-- Integrate along heading; on drift the kart slides a bit outward.
	local forward = KartSim.Forward(self)
	local move = forward * self.Speed * dt
	if self.Drifting then
		local right = Vector3.new(-forward.Z, 0, forward.X)
		move += right * -self.DriftDir * self.Speed * 0.25 * dt
	end
	self.Position += move

	-- Track constraints: height from spline, lateral wall clamp, surface lookup, jumps.
	local loc = track:Locate(self.Position, self.Progress)
	self.Progress = loc.Progress
	self.Surface = loc.Surface
	local roadCf = track.Spline:CFrameAt(loc.Progress, 0, 0)
	local halfWidth = loc.Width * 0.5 - 2
	if not loc.OnShortcut and math.abs(loc.Lateral) > halfWidth then
		local clamped = math.clamp(loc.Lateral, -halfWidth, halfWidth)
		local right = roadCf.RightVector
		self.Position = roadCf.Position + right * clamped + Vector3.new(0, self.Position.Y - roadCf.Position.Y, 0)
		self.Speed *= 0.92 -- wall scrub
		self.Drifting = false
	end
	local jump = track:JumpAt(loc.Progress)
	if jump and grounded and self.Speed > 20 and not self.Airborne then
		self.Airborne = true
		self.AirUntil = now + math.clamp(jump.GapLength / math.max(20, self.Speed), 0.4, 1.6)
	end
	if self.Airborne and now >= self.AirUntil then
		self.Airborne = false
		if input.Trick and jump then
			local t = GameConfig.Physics.Trick
			table.insert(
				self.Boosts,
				KartPhysicsModel.MakeBoost("Trick", t.BoostSeconds * stats.TrickEfficiency, t.SpeedBonus, stats, now)
			)
		end
	end
	local targetY = roadCf.Position.Y + 2.5 + (if self.Airborne then 6 else 0)
	self.Position = Vector3.new(self.Position.X, MathUtil.Damp(self.Position.Y, targetY, 12, dt), self.Position.Z)
end

return KartSim
