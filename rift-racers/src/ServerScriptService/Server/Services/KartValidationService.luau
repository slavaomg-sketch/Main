--!strict
-- Physical plausibility checks at GameConfig.Security.ValidationHz for human racers: speed, teleport, height,
-- corridor, angular velocity, hit-stun compliance, noclip-through-wall. Soft-corrects, escalates via SecurityService.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local KartPhysicsModel = require(Shared.Systems.KartPhysicsModel)

local KartValidationService = { Name = "KartValidationService" }
KartValidationService.__index = KartValidationService

function KartValidationService.new()
	return setmetatable(
		{ _env = nil :: any, _security = nil :: any, _progress = nil :: any, _telemetry = nil :: any },
		KartValidationService
	)
end

function KartValidationService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._security = registry:Get("SecurityService")
	self._progress = registry:Get("RaceProgressService")
	self._telemetry = registry:Get("TelemetryService")
end

export type Verdict = { Ok: boolean, Reason: string?, Detail: string?, Correct: boolean }

-- Pure check so tests can feed synthetic poses.
function KartValidationService.Check(
	stats: any,
	surface: string,
	boosts: any,
	shards: number,
	now: number,
	prevPos: Vector3?,
	pos: Vector3,
	velocity: Vector3,
	angular: Vector3,
	dt: number,
	hitStun: boolean,
	pathY: number?,
	inCorridor: boolean
): Verdict
	local speed = velocity.Magnitude
	local cap = KartPhysicsModel.ValidationSpeedCap(stats, surface, boosts, shards, now)
	if hitStun then
		cap = math.max(cap * GameConfig.Physics.HitStun.LightSpeedScale * 1.5, 25)
	end
	if speed > cap then
		return { Ok = false, Reason = "SpeedHack", Detail = string.format("%.0f > %.0f", speed, cap), Correct = true }
	end
	if prevPos then
		local jump = (pos - prevPos).Magnitude
		if jump > GameConfig.Security.TeleportDistancePerSecond * math.max(dt, 0.05) + 5 then
			return {
				Ok = false,
				Reason = "Teleport",
				Detail = string.format("%.0f studs in %.2fs", jump, dt),
				Correct = true,
			}
		end
	end
	if pathY ~= nil and pos.Y - pathY > GameConfig.Security.MaxHeightAbovePath then
		return { Ok = false, Reason = "Fly", Detail = string.format("%.0f above path", pos.Y - pathY), Correct = true }
	end
	if angular.Magnitude > GameConfig.Security.MaxAngularVelocity * 1.5 then
		return {
			Ok = false,
			Reason = "AngularVelocity",
			Detail = string.format("%.1f rad/s", angular.Magnitude),
			Correct = false,
		}
	end
	if not inCorridor then
		return { Ok = false, Reason = "OffCorridor", Detail = nil, Correct = false }
	end
	return { Ok = true, Reason = nil, Detail = nil, Correct = false }
end

function KartValidationService.Validate(self: any, session: any, key: string, now: number)
	local r = session.Racers[key]
	local e = session.Extra[key]
	if r.Identity.IsBot or not r.Connected or not e.Player then
		return
	end
	if now - e.LastValidatedAt < 1 / GameConfig.Security.ValidationHz then
		return
	end
	local dt = now - e.LastValidatedAt
	e.LastValidatedAt = now
	local pose = e.LastPose
	if not pose then
		return
	end
	if r.RespawnLockUntil > now then
		e.LastValidPos = pose.CFrame.Position
		return
	end
	local pos = pose.CFrame.Position
	local pathY: number? = nil
	local inCorridor = true
	if not session.IsArena then
		local loc = session.Track:Locate(pos, r.Progress.Progress)
		pathY = session.Track.Spline:PositionAt(loc.Progress).Y
		inCorridor = loc.InCorridor
	else
		inCorridor = session.Arena:InBounds(pos)
	end
	local hazardScale = 1
	local verdict = KartValidationService.Check(
		e.Stats,
		e.Surface,
		r.Boosts,
		r.Shards,
		now,
		e.LastValidPos,
		pos,
		pose.Velocity,
		pose.AngularVelocity,
		dt,
		r.Effects.HitStun ~= nil,
		pathY,
		inCorridor
	)
	local _ = hazardScale
	if verdict.Ok then
		e.LastValidPos = pos
		return
	end
	self._security:Flag(e.Player, verdict.Reason :: string, verdict.Detail)
	self._telemetry:Count("validation." .. (verdict.Reason :: string))
	if verdict.Correct then
		-- Soft correction: back to the last valid position (or safe checkpoint when we have none).
		if e.LastValidPos and verdict.Reason ~= "Fly" then
			self._env.World.SetPose(
				session.Id,
				key,
				CFrame.new(e.LastValidPos :: Vector3) * (pose.CFrame - pose.CFrame.Position),
				Vector3.new()
			)
			r.RespawnLockUntil = now + 0.5
		else
			self._progress:Respawn(session, key, "OffTrack")
		end
	end
end

-- Noclip heuristic: a ray from the previous validated position to the current one must not cross a wall.
function KartValidationService.CheckWallCrossing(self: any, session: any, key: string): boolean
	local e = session.Extra[key]
	if not e.LastValidPos or not e.LastPose then
		return false
	end
	local from = e.LastValidPos :: Vector3
	local to = e.LastPose.CFrame.Position
	if (to - from).Magnitude < 4 then
		return false
	end
	return self._env.World.Raycast(session.Id, from, to - from) ~= nil
end

return KartValidationService
