--!strict
-- Per-tick progress: locate karts, run checkpoint logic, rank, detect wrong way/respawn, slipstream, drift/trick
-- validation, ghost sampling. Runs for players (from replicated poses) and bots (from KartSim) alike.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local KartPhysicsModel = require(Shared.Systems.KartPhysicsModel)
local MathUtil = require(Shared.Utility.MathUtil)
local CheckpointSystem = require(script.Parent.Parent.Systems.CheckpointSystem)
local PlacementSystem = require(script.Parent.Parent.Systems.PlacementSystem)
local RespawnSystem = require(script.Parent.Parent.Systems.RespawnSystem)
local GhostRecordingSystem = require(script.Parent.Parent.Systems.GhostRecordingSystem)

local RaceProgressService = { Name = "RaceProgressService" }
RaceProgressService.__index = RaceProgressService

function RaceProgressService.new()
	return setmetatable({ _env = nil :: any, _security = nil :: any, _telemetry = nil :: any }, RaceProgressService)
end

function RaceProgressService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._security = registry:Get("SecurityService")
	self._telemetry = registry:Get("TelemetryService")
end

-- Returns the racer to the last safe point and applies post-respawn protections.
function RaceProgressService.Respawn(self: any, session: any, key: string, reason: string)
	local r = session.Racers[key]
	local e = session.Extra[key]
	local now = self._env.Now()
	local cf: CFrame
	local progress = r.Progress.Progress
	if session.IsArena then
		local pose = self._env.World.GetPose(session.Id, key)
		cf = session.Arena:SafeRespawn(if pose then pose.CFrame.Position else Vector3.new())
	else
		local d
		cf, d = session.Track:SafeRespawn(r.Progress.LastSafeProgress)
		progress = d
	end
	self._env.World.SetPose(session.Id, key, cf, Vector3.new())
	if e.Sim then
		e.Sim:Teleport(cf)
		e.Sim.Progress = progress
	end
	r.Progress.Progress = progress
	r.Progress.WrongWaySince = nil
	r.Progress.Direction = 0
	r.Boosts = {}
	r.HitImmuneUntil = math.max(r.HitImmuneUntil, now + GameConfig.Race.RespawnInvulnerabilitySeconds)
	r.ItemLockUntil = math.max(r.ItemLockUntil, now + GameConfig.Race.RespawnItemLockoutSeconds)
	r.RespawnLockUntil = now + GameConfig.Race.RespawnInvulnerabilitySeconds
	r.State = "Respawning"
	e.LastValidPos = cf.Position
	e.Drifting = false
	RespawnSystem.MarkRespawned(e.Watch, now)
	session:SendTo(
		key,
		"KartEffect",
		"Respawn",
		{ Reason = reason, CFrame = cf, Lock = GameConfig.Race.RespawnInvulnerabilitySeconds }
	)
	self._telemetry:Count("race.respawn." .. reason)
end

function RaceProgressService.TickRacer(self: any, session: any, key: string, now: number, dt: number)
	local r = session.Racers[key]
	local e = session.Extra[key]
	if not r.Connected or r.Progress.Eliminated then
		return
	end
	local pose = self._env.World.GetPose(session.Id, key)
	if not pose then
		return
	end
	e.LastPose = pose
	e.LastPoseAt = now
	KartPhysicsModel.PruneBoosts(r.Boosts, now)
	for id, ef in r.Effects do
		if ef and ef.EndsAt <= now then
			r.Effects[id] = nil
		end
	end
	local pos = pose.CFrame.Position
	local speed = pose.Velocity.Magnitude
	local racing = session.SM:Is("Racing", "FinishWindow")

	if session.IsArena then
		e.Surface = session.Arena:SurfaceAt(pos)
		local reason = RespawnSystem.Evaluate(
			e.Watch,
			{
				Y = pos.Y,
				Speed = speed,
				UpDot = pose.CFrame.UpVector.Y,
				InCorridor = session.Arena:InBounds(pos),
				WrongWay = false,
				Racing = racing,
			},
			now
		)
		if reason then
			self:Respawn(session, key, reason)
		end
		return
	end

	local track = session.Track
	local loc = track:Locate(pos, r.Progress.Progress)
	e.Surface = loc.Surface
	local events: { CheckpointSystem.CheckpointEvent } = {}
	if racing and r.Progress.FinishedAt == nil then
		events = CheckpointSystem.Update(r.Progress, loc.Progress, now, session.Shape, dt)
		e.ProgressTicks += 1
	else
		r.Progress.Progress = loc.Progress
	end
	for _, ev in events do
		if ev.Kind == "Checkpoint" then
			session:SendTo(key, "RaceEvent", "Checkpoint", { Index = ev.Index })
		elseif ev.Kind == "Lap" then
			session:SendTo(
				key,
				"RaceEvent",
				"Lap",
				{ Lap = ev.Index, Laps = session.Rules.Laps, LapTime = r.Progress.LapTimes[#r.Progress.LapTimes] }
			)
			session.Events:Fire("Lap", { Key = key, Lap = ev.Index })
		elseif ev.Kind == "Finish" then
			self:OnFinish(session, key, now)
		elseif ev.Kind == "Teleport" then
			if not r.Identity.IsBot and e.Player and r.RespawnLockUntil < now then
				self._security:Flag(e.Player, "Teleport", string.format("delta %.0f", ev.Value or 0))
				self:Respawn(session, key, "OffTrack")
			end
		elseif ev.Kind == "ImpossibleSector" then
			if e.Player then
				self._security:Flag(
					e.Player,
					"ImpossibleSector",
					string.format("cp %d in %.2fs", ev.Index or 0, ev.Value or 0)
				)
			end
		elseif ev.Kind == "InvalidFinishCross" then
			session:SendTo(key, "RaceEvent", "MissedCheckpoints", { Checkpoint = ev.Index })
		end
	end

	-- Corridor / fall / stuck / flipped / wrong way handling.
	local wrongWay = r.Progress.Direction < 0
		and r.Progress.WrongWaySince ~= nil
		and now - (r.Progress.WrongWaySince :: number) >= GameConfig.Race.WrongWaySeconds
	local reason = RespawnSystem.Evaluate(
		e.Watch,
		{
			Y = pos.Y,
			Speed = speed,
			UpDot = pose.CFrame.UpVector.Y,
			InCorridor = loc.InCorridor,
			WrongWay = wrongWay,
			Racing = racing and r.Progress.FinishedAt == nil,
		},
		now
	)
	if reason then
		self:Respawn(session, key, reason)
		return
	end
	if loc.InCorridor then
		e.LastValidPos = pos
	end

	-- Airborne bookkeeping for tricks.
	if not pose.Grounded then
		e.AirSince = e.AirSince or now
	else
		e.AirSince = nil
	end

	-- Slipstream: behind a rival within cone for ChargeSeconds -> boost (server-validated).
	if
		racing
		and r.Progress.FinishedAt == nil
		and now - e.LastSlipstreamAt > GameConfig.Physics.Slipstream.CooldownSeconds
	then
		local inCone = false
		for otherKey, other in session.Racers do
			if otherKey ~= key and other.Connected then
				local op = session.Extra[otherKey].LastPose
				if op and KartPhysicsModel.InSlipstreamCone(pos, pose.CFrame.LookVector, op.CFrame.Position) then
					local wall = self._env.World.Raycast(session.Id, pos, op.CFrame.Position - pos)
					if wall == nil then
						inCone = true
						break
					end
				end
			end
		end
		if inCone then
			e.SlipstreamSince = e.SlipstreamSince or now
			local charge = GameConfig.Physics.Slipstream.ChargeSeconds
			if e.MagnetUntil > now then
				charge *= 0.8
			end
			if now - (e.SlipstreamSince :: number) >= charge then
				local s = GameConfig.Physics.Slipstream
				local bonus = s.SpeedBonus + (if e.MagnetUntil > now then 0.05 else 0)
				table.insert(r.Boosts, KartPhysicsModel.MakeBoost("Slipstream", s.BoostSeconds, bonus, e.Stats, now))
				e.LastSlipstreamAt = now
				e.SlipstreamSince = nil
				if e.Sim then
					table.insert(
						e.Sim.Boosts,
						KartPhysicsModel.MakeBoost("Slipstream", s.BoostSeconds, bonus, e.Stats, now)
					)
				end
				session:SendTo(
					key,
					"KartEffect",
					"Boost",
					{ Source = "Slipstream", Seconds = s.BoostSeconds, Bonus = bonus }
				)
			end
		else
			e.SlipstreamSince = nil
		end
	end

	-- Ghost sampling (Time Trial).
	if e.Ghost and racing and r.Progress.FinishedAt == nil then
		GhostRecordingSystem.Sample(e.Ghost, now, pose.CFrame)
	end

	-- Kart state summary for replication.
	local state = r.State
	if r.Progress.FinishedAt ~= nil then
		state = "Finished"
	elseif r.Effects.HitStun then
		state = "HitStun"
	elseif r.RespawnLockUntil > now then
		state = "Respawning"
	elseif #r.Boosts > 0 then
		state = "Boosting"
	elseif e.Drifting then
		state = if e.DriftTier >= 0 and (e.LastPose and e.LastPose.AngularVelocity.Y > 0)
			then "DriftingLeft"
			else "DriftingRight"
	elseif not pose.Grounded then
		state = "Airborne"
	elseif speed > 3 then
		state = "Accelerating"
	else
		state = "Idle"
	end
	r.State = state
end

function RaceProgressService.OnFinish(self: any, session: any, key: string, now: number)
	local r = session.Racers[key]
	local finishedCount = 0
	for _, other in session.Racers do
		if other.Progress.FinishedAt ~= nil then
			finishedCount += 1
		end
	end
	r.Progress.FinishPosition = finishedCount -- this racer is already counted
	r.State = "Finished"
	if session.FirstFinishAt == nil then
		session.FirstFinishAt = now
	end
	session:SendTo(
		key,
		"RaceEvent",
		"Finished",
		{ Position = r.Progress.FinishPosition, Time = now - session.RaceStartedAt }
	)
	session:Broadcast("RaceEvent", "RacerFinished", { Key = key, Position = r.Progress.FinishPosition })
	session.Mode:OnRacerFinished(session, key, now)
	session.Events:Fire("Finish", { Key = key, Position = r.Progress.FinishPosition })
	self._telemetry:Count("race.finish")
end

-- Rank everyone and write Position.
function RaceProgressService.Rank(self: any, session: any)
	local ranked = session.Mode:Rank(session)
	for i, key in ranked do
		session.Racers[key].Position = i
	end
	return ranked
end

-- Drift intents from the client are validated against server-observed motion, then rewarded server-side.
function RaceProgressService.OnDriftEvent(self: any, session: any, player: any, action: string, claimedTier: number)
	local key = session.KeyFor(player.UserId)
	local r = session.Racers[key]
	local e = session.Extra[key]
	if not r or not e or r.Progress.FinishedAt ~= nil then
		return
	end
	local now = self._env.Now()
	local pose = e.LastPose
	if action == "Start" then
		if
			pose
			and pose.Grounded
			and pose.Velocity.Magnitude / e.Stats.TopSpeed >= GameConfig.Physics.DriftMinSpeedFraction * 0.8
			and not r.Effects.HitStun
		then
			e.Drifting = true
			e.DriftStartedAt = now
			e.DriftTier = 0
		end
	elseif action == "Cancel" then
		e.Drifting = false
		e.DriftTier = 0
	elseif action == "Release" then
		if not e.Drifting then
			return
		end
		local held = now - e.DriftStartedAt
		-- Server tier from held time, capped by the client's claim (client can never claim more than it held).
		local serverTier = KartPhysicsModel.DriftTier(held * 1.05)
		local tier = math.min(serverTier, claimedTier)
		if claimedTier > serverTier + 1 and e.Player then
			self._security:Flag(
				e.Player,
				"SchemaViolation",
				string.format("drift tier claim %d held %.2fs", claimedTier, held),
				2
			)
		end
		e.Drifting = false
		e.DriftTier = 0
		local b = KartPhysicsModel.DriftBoostFor(tier)
		if b and pose and pose.Velocity.Magnitude > 8 then
			table.insert(
				r.Boosts,
				KartPhysicsModel.MakeBoost(("Drift" .. tier) :: any, b.BoostSeconds, b.SpeedBonus, e.Stats, now)
			)
			e.DriftBoosts += 1
			session:SendTo(
				key,
				"KartEffect",
				"Boost",
				{
					Source = "Drift" .. tier,
					Seconds = b.BoostSeconds * e.Stats.BoostEfficiency,
					Bonus = b.SpeedBonus,
					Tier = tier,
				}
			)
			session:Broadcast("VisualEvent", "DriftBoost", { Key = key, Tier = tier })
		end
	end
end

function RaceProgressService.OnTrickEvent(self: any, session: any, player: any, jumpId: string)
	local key = session.KeyFor(player.UserId)
	local r = session.Racers[key]
	local e = session.Extra[key]
	if not r or not e or session.IsArena or r.Progress.FinishedAt ~= nil then
		return
	end
	local now = self._env.Now()
	local t = GameConfig.Physics.Trick
	if now - e.LastTrickAt < t.CooldownSeconds then
		return
	end
	local jump = session.Track:JumpAt(r.Progress.Progress)
	if not jump or jump.Id ~= jumpId or not jump.Trick then
		if e.Player then
			self._security:Flag(e.Player, "WrongState", "trick outside jump", 1)
		end
		return
	end
	if e.AirSince == nil or now - (e.AirSince :: number) < t.MinAirSeconds then
		return
	end
	e.LastTrickAt = now
	e.Tricks += 1
	-- Boost is applied when the kart lands; keep it pending as a short-fuse effect.
	r.Effects.TrickPending = {
		Id = "TrickPending",
		EndsAt = now + 3,
		Params = { Seconds = t.BoostSeconds * e.Stats.TrickEfficiency, Bonus = t.SpeedBonus },
	}
	session:SendTo(key, "KartEffect", "Trick", { Jump = jumpId })
	session:Broadcast("VisualEvent", "Trick", { Key = key })
end

-- Landing resolves the pending trick boost.
function RaceProgressService.OnLanded(self: any, session: any, key: string, now: number)
	local r = session.Racers[key]
	local e = session.Extra[key]
	local pending = r.Effects.TrickPending
	if pending then
		r.Effects.TrickPending = nil
		table.insert(
			r.Boosts,
			KartPhysicsModel.MakeBoost("Trick", pending.Params.Seconds, pending.Params.Bonus, e.Stats, now)
		)
		session:SendTo(
			key,
			"KartEffect",
			"Boost",
			{ Source = "Trick", Seconds = pending.Params.Seconds, Bonus = pending.Params.Bonus }
		)
	end
end

RaceProgressService.Bucket = PlacementSystem.Bucket
RaceProgressService.LoopDelta = MathUtil.LoopDelta

return RaceProgressService
