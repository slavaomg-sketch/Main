--!strict
-- Server-owned items: pads, shards, slots, use resolution, projectiles, effects and hit application.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ItemDefinitions = require(Shared.Config.ItemDefinitions)
local KartPhysicsModel = require(Shared.Systems.KartPhysicsModel)
local MathUtil = require(Shared.Utility.MathUtil)
local ItemRoll = require(script.Parent.Parent.Systems.ItemRoll)
local HitSystem = require(script.Parent.Parent.Systems.HitSystem)
local PlacementSystem = require(script.Parent.Parent.Systems.PlacementSystem)
local ProjectileSim = require(script.Parent.Parent.Systems.ProjectileSim)

local ItemService = { Name = "ItemService" }
ItemService.__index = ItemService

function ItemService.new()
	return setmetatable(
		{ _env = nil :: any, _security = nil :: any, _telemetry = nil :: any, _progress = nil :: any },
		ItemService
	)
end

function ItemService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
	self._security = registry:Get("SecurityService")
	self._telemetry = registry:Get("TelemetryService")
	self._progress = registry:Get("RaceProgressService")
end

-- Pickups -----------------------------------------------------------------------------------------------------------
function ItemService.SetupPickups(self: any, session: any)
	session.Pads = {}
	session.Shards = {}
	local venue = session.Track or session.Arena
	if session.Rules.ItemsEnabled then
		for i, pad in venue:ItemPadPositions() do
			local id = "pad" .. i
			table.insert(session.Pads, { Id = id, Position = pad.Position, Active = true, RespawnAt = 0 })
			self._env.World.SpawnPickup(session.Id, id, "ItemPad", pad.Position)
		end
	end
	if session.ModeId ~= "TimeTrial" then
		for i, pos in venue:ShardPositions() do
			local id = "shard" .. i
			table.insert(session.Shards, { Id = id, Position = pos, Active = true, RespawnAt = 0 })
			self._env.World.SpawnPickup(session.Id, id, "Shard", pos)
		end
	end
end

local function distanceToLeader(session: any, key: string): number
	local r = session.Racers[key]
	if session.IsArena then
		return 0
	end
	local best = 0
	for _, other in session.Racers do
		if other.Position == 1 and other ~= r then
			local shape = session.Shape
			local a = other.Progress.Lap * shape.Length + other.Progress.Progress
			local b = r.Progress.Lap * shape.Length + r.Progress.Progress
			best = math.max(0, a - b)
		end
	end
	return best
end

local function distanceToNearest(session: any, key: string): number
	local e = session.Extra[key]
	if not e.LastPose then
		return 1000
	end
	local best = 1000
	for otherKey, other in session.Racers do
		if otherKey ~= key and other.Connected then
			local op = session.Extra[otherKey].LastPose
			if op then
				best = math.min(best, (op.CFrame.Position - e.LastPose.CFrame.Position).Magnitude)
			end
		end
	end
	return best
end

function ItemService.CountStrongEffects(self: any, session: any): number
	local n = 0
	for _, p in session.Projectiles.List do
		if p.Alive and ItemDefinitions.ById[p.ItemId].Strength == "Strong" then
			n += 1
		end
	end
	for _, r in session.Racers do
		for _, id in { "StormCrownWarn" } do
			if r.Effects[id] then
				n += 1
			end
		end
	end
	return n
end

function ItemService.Grant(self: any, session: any, key: string, now: number): string?
	local r = session.Racers[key]
	if r.Items.Active ~= nil and r.Items.Reserve ~= nil then
		if GameConfig.Items.WhenBothSlotsFull == "Skip" then
			return nil
		end
	end
	local total = #session.Order
	local held = {}
	if r.Items.Active then
		table.insert(held, r.Items.Active)
	end
	if r.Items.Reserve then
		table.insert(held, r.Items.Reserve)
	end
	local ctx: ItemRoll.RollContext = {
		Position = r.Position,
		Total = total,
		DistanceToLeader = distanceToLeader(session, key),
		DistanceToNearest = distanceToNearest(session, key),
		LapsRemaining = math.max(0, session.Rules.Laps - r.Progress.Lap),
		ActiveStrongEffects = self:CountStrongEffects(session),
		AllowedItems = session.Rules.AllowedItems,
		StormCrownAvailable = now >= session.StormCrownAvailableAt,
		HeldItems = held,
		Bucket = PlacementSystem.Bucket(r.Position, total),
	}
	local itemId = ItemRoll.Roll(ctx, self._env.Random)
	if not itemId then
		return nil
	end
	if r.Items.Active == nil then
		r.Items.Active = itemId
	elseif r.Items.Reserve == nil then
		r.Items.Reserve = itemId
	else
		r.Items.Reserve = itemId
	end
	self._telemetry:Count("item.granted." .. itemId)
	session:SendTo(key, "ItemState", session:PersonalView(key))
	return itemId
end

function ItemService.TickPickups(self: any, session: any, now: number)
	for _, pad in session.Pads do
		if not pad.Active and now >= pad.RespawnAt then
			pad.Active = true
			self._env.World.SetPickupActive(session.Id, pad.Id, true)
		end
	end
	for _, shard in session.Shards do
		if not shard.Active and now >= shard.RespawnAt then
			shard.Active = true
			self._env.World.SetPickupActive(session.Id, shard.Id, true)
		end
	end
	local padR = GameConfig.Items.PickupRadius
	local shardR = GameConfig.Shards.PickupRadius
	for key, r in session.Racers do
		if not r.Connected or r.Progress.FinishedAt ~= nil or r.Progress.Eliminated then
			continue
		end
		local e = session.Extra[key]
		local pose = e.LastPose
		if not pose then
			continue
		end
		local pos = pose.CFrame.Position
		if session.Rules.ItemsEnabled then
			for _, pad in session.Pads do
				if pad.Active and (pad.Position - pos).Magnitude <= padR then
					pad.Active = false
					pad.RespawnAt = now + GameConfig.Items.PadRespawnSeconds
					self._env.World.SetPickupActive(session.Id, pad.Id, false)
					self:Grant(session, key, now)
				end
			end
		end
		local magnetR = if e.MagnetUntil > now
			then (ItemDefinitions.ById.MagnetCoil.Params.PullRadius or 22)
			else shardR
		for _, shard in session.Shards do
			if shard.Active and (shard.Position - pos).Magnitude <= magnetR then
				if r.Shards < GameConfig.Shards.MaxHeld then
					shard.Active = false
					shard.RespawnAt = now + GameConfig.Shards.RespawnSeconds
					self._env.World.SetPickupActive(session.Id, shard.Id, false)
					r.Shards += 1
					if e.Sim then
						e.Sim.Shards = r.Shards
					end
					session.Mode:OnShardPickup(session, key, now)
					session:SendTo(key, "RaceEvent", "Shard", { Count = r.Shards })
				end
			end
		end
	end
end

-- Use --------------------------------------------------------------------------------------------------------------
function ItemService.OnUseItem(self: any, session: any, player: any, slot: string, aim: Vector3?)
	local key = session.KeyFor(player.UserId)
	self:Use(session, key, slot, aim, player)
end

function ItemService.Use(self: any, session: any, key: string, slot: string, aim: Vector3?, player: any?): boolean
	local r = session.Racers[key]
	local e = session.Extra[key]
	if not r or not e then
		return false
	end
	local now = self._env.Now()
	if not session.SM:Is("Racing", "FinishWindow") or r.Progress.FinishedAt ~= nil or r.Progress.Eliminated then
		return false
	end
	if player and self._security:IsActionLocked(player, "UseItem") then
		return false
	end
	if now < r.ItemLockUntil or now - r.LastItemUseAt < GameConfig.Items.UseCooldownSeconds then
		if player then
			self._security:Flag(player, "ItemSpam", nil, 0.5)
		end
		return false
	end
	if e.PhaseUntil > now then
		return false
	end
	local itemId = if slot == "Reserve" then r.Items.Reserve else r.Items.Active
	if itemId == nil then
		if player then
			self._security:Flag(player, "FakeItem", "empty slot " .. slot)
		end
		return false
	end
	local def = ItemDefinitions.ById[itemId]
	if session.Rules.AllowedItems and table.find(session.Rules.AllowedItems, itemId) == nil then
		return false
	end
	if def.Kind == "Projectile" or def.Kind == "Homing" or def.Kind == "Trap" then
		if session.Projectiles:CountByOwner(key) >= GameConfig.Items.MaxProjectilesPerPlayer then
			return false
		end
	end
	local pose = e.LastPose
	if not pose then
		return false
	end
	local ok = self:Resolve(session, key, def, pose, aim, now)
	if not ok then
		return false
	end
	-- Consume the slot; Reserve shifts into Active.
	if slot == "Reserve" then
		r.Items.Reserve = nil
	else
		r.Items.Active = r.Items.Reserve
		r.Items.Reserve = nil
	end
	r.LastItemUseAt = now
	e.ItemsUsed += 1
	self._telemetry:Count("item.used." .. itemId)
	session:SendTo(key, "ItemState", session:PersonalView(key))
	session:Broadcast("VisualEvent", "ItemUse", { Key = key, Item = itemId })
	return true
end

local function worldForSession(session: any, now: number): ProjectileSim.World
	local racers = {}
	for key, r in session.Racers do
		local e = session.Extra[key]
		if r.Connected and e.LastPose then
			racers[key] = {
				Position = e.LastPose.CFrame.Position,
				Forward = e.LastPose.CFrame.LookVector,
				Team = r.Team,
				Finished = r.Progress.FinishedAt ~= nil or r.Progress.Eliminated,
				Progress = r.Progress.Lap * (if session.Shape then session.Shape.Length else 0) + r.Progress.Progress,
			}
		end
	end
	return {
		Now = now,
		Racers = racers,
		Raycast = nil,
		TrackLength = if session.Shape then session.Shape.Length * math.max(1, session.Rules.Laps) else 1e9,
	}
end

function ItemService.Resolve(
	self: any,
	session: any,
	key: string,
	def: any,
	pose: any,
	aim: Vector3?,
	now: number
): boolean
	local r = session.Racers[key]
	local e = session.Extra[key]
	local p = def.Params
	local pos = pose.CFrame.Position
	local forward = pose.CFrame.LookVector
	local aimDir = forward
	if aim and aim.Magnitude > 0.1 then
		-- Aim is only a direction hint; clamp it to a cone around the actual heading to prevent 180° snipes.
		local a = aim.Unit
		local angle = MathUtil.AngleBetween(forward, a)
		if angle <= math.rad(35) then
			aimDir = a
		elseif angle > math.rad(150) then
			aimDir = -forward -- explicit rear fire is allowed
		end
	end
	local world = self._env.World

	if def.Kind == "Boost" then
		table.insert(r.Boosts, KartPhysicsModel.MakeBoost("Item", p.BoostSeconds, p.SpeedBonus, e.Stats, now))
		if e.Sim then
			table.insert(e.Sim.Boosts, KartPhysicsModel.MakeBoost("Item", p.BoostSeconds, p.SpeedBonus, e.Stats, now))
		end
		session:SendTo(
			key,
			"KartEffect",
			"Boost",
			{ Source = "Item", Seconds = p.BoostSeconds * e.Stats.BoostEfficiency, Bonus = p.SpeedBonus }
		)
		return true
	elseif def.Kind == "Multi" then
		e.OverchargePulses = p.Pulses
		e.NextOverchargeAt = now
		return true
	elseif def.Kind == "Projectile" then
		local proj =
			session.Projectiles:Spawn(def.Id, key, r.Team, pos + aimDir * 5 + Vector3.new(0, 1.5, 0), aimDir, now)
		world.SpawnProjectileVisual(session.Id, proj.Id, def.Id, proj.Position)
		return true
	elseif def.Kind == "Homing" then
		local target =
			ProjectileSim.PickTargetAhead(worldForSession(session, now), key, r.Team, session.Rules.FriendlyFire)
		local proj = session.Projectiles:Spawn(
			def.Id,
			key,
			r.Team,
			pos + forward * 5 + Vector3.new(0, 2, 0),
			forward,
			now,
			target
		)
		world.SpawnProjectileVisual(session.Id, proj.Id, def.Id, proj.Position)
		if target then
			session:SendTo(target, "RaceEvent", "Incoming", { Item = def.Id, Seconds = p.WarnSeconds })
		end
		return true
	elseif def.Kind == "Trap" then
		local place = pos - forward * (p.PlaceBehind or 9)
		if not session.IsArena then
			local loc = session.Track:Locate(place, r.Progress.Progress)
			-- Never inside the finish/grid zone, a respawn point, or a narrow passage.
			local nearFinish = loc.Progress < 40 or loc.Progress > session.Track.Length - 60
			if nearFinish or not loc.InCorridor or loc.Width < 24 then
				return false
			end
			for _, cd in session.Track.CheckpointDists do
				if math.abs(session.Track.Spline:Delta(loc.Progress, cd - 6)) < 10 then
					return false
				end
			end
			place = session.Track.Spline:CFrameAt(
				loc.Progress,
				math.clamp(loc.Lateral, -loc.Width * 0.4, loc.Width * 0.4),
				1.5
			).Position
		end
		local proj = session.Projectiles:Spawn(def.Id, key, r.Team, place, forward, now)
		world.SpawnProjectileVisual(session.Id, proj.Id, def.Id, proj.Position)
		return true
	elseif def.Kind == "Shield" then
		r.Effects.AegisBubble = {
			Id = "AegisBubble",
			EndsAt = now + p.DurationSeconds,
			Params = { StrongAbsorb = p.StrongAbsorb, WeakAbsorb = p.WeakAbsorb },
		}
		session:Broadcast("VisualEvent", "Shield", { Key = key, Seconds = p.DurationSeconds })
		return true
	elseif def.Kind == "Wave" then
		local cleared = session.Projectiles:ClearNear(pos, p.Radius, key)
		local _ = cleared
		for otherKey, other in session.Racers do
			if otherKey ~= key and other.Connected then
				local op = session.Extra[otherKey].LastPose
				if op then
					local delta = op.CFrame.Position - pos
					if delta.Magnitude <= p.Radius and delta.Magnitude > 0.1 then
						if r.Team == 0 or other.Team ~= r.Team or session.Rules.FriendlyFire then
							world.ApplyImpulse(session.Id, otherKey, delta.Unit * p.PushImpulse * 100)
							if p.SlowSeconds then
								other.Effects.Slow =
									{ Id = "Slow", EndsAt = now + p.SlowSeconds, Params = { Scale = p.SlowScale } }
								local oe = session.Extra[otherKey]
								if oe.Sim then
									oe.Sim.SlowScale = p.SlowScale
									oe.Sim.SlowUntil = now + p.SlowSeconds
								end
							end
						end
					end
				end
			end
		end
		session:Broadcast("VisualEvent", "Wave", { Key = key, Item = def.Id, Radius = p.Radius })
		return true
	elseif def.Kind == "Warp" then
		if session.IsArena then
			return false
		end
		local track = session.Track
		local prog = r.Progress
		-- Do not cross the finish and do not skip a checkpoint that is not the next one.
		local maxByFinish = track.Length - 20 - prog.Progress
		if prog.Progress > track.Length - 20 then
			maxByFinish = 0
		end
		local warp = math.min(p.WarpDistance, maxByFinish)
		if warp < 15 then
			return false
		end
		-- Cannot gain more than MaxPlacementGain positions.
		local targetProgress = prog.Progress + warp
		local gain = 0
		for otherKey, other in session.Racers do
			if
				otherKey ~= key
				and other.Progress.Lap == prog.Lap
				and other.Progress.Progress > prog.Progress
				and other.Progress.Progress < targetProgress
			then
				gain += 1
			end
		end
		if gain > p.MaxPlacementGain then
			targetProgress = prog.Progress + warp * (p.MaxPlacementGain / gain)
		end
		-- Walk checkpoints in order so the warp is legal, then land on the road.
		local cf = track.Spline:CFrameAt(targetProgress, 0, 4)
		local nowT = now
		for i = prog.Checkpoint + 1, track.CheckpointCount - 1 do
			if track.CheckpointDists[i] <= targetProgress then
				prog.Checkpoint = i
				prog.LastCheckpointAt = nowT
				prog.LastSafeProgress = track.CheckpointDists[i]
			end
		end
		prog.Progress = track.Spline:Wrap(targetProgress)
		world.SetPose(session.Id, key, cf, pose.Velocity.Magnitude * cf.LookVector)
		if e.Sim then
			e.Sim:Teleport(cf)
			e.Sim.Progress = prog.Progress
		end
		e.LastValidPos = cf.Position
		r.RespawnLockUntil = now + 0.6
		session:Broadcast("VisualEvent", "Blink", { Key = key, From = pos, To = cf.Position })
		return true
	elseif def.Kind == "Global" then
		if now < session.StormCrownAvailableAt then
			return false
		end
		session.StormCrownAvailableAt = now + (def.GlobalCooldown or GameConfig.Items.StormCrownGlobalCooldownSeconds)
		local targets = {}
		for otherKey, other in session.Racers do
			if
				otherKey ~= key
				and other.Connected
				and other.Position <= p.TargetsTop
				and other.Progress.FinishedAt == nil
			then
				if r.Team == 0 or other.Team ~= r.Team or session.Rules.FriendlyFire then
					table.insert(targets, otherKey)
					other.Effects.StormCrownWarn =
						{ Id = "StormCrownWarn", EndsAt = now + p.WarnSeconds, Params = { Attacker = 0 } }
					session:SendTo(otherKey, "RaceEvent", "Incoming", { Item = def.Id, Seconds = p.WarnSeconds })
				end
			end
		end
		-- Delayed strike resolved by TickEffects.
		session.Traps[#session.Traps + 1] = { Id = -1, Position = pos, OwnerKey = key, ExpiresAt = now + p.WarnSeconds }
		session:Broadcast("VisualEvent", "StormCrown", { Key = key, Targets = targets, Seconds = p.WarnSeconds })
		return true
	elseif def.Kind == "Magnet" then
		e.MagnetUntil = now + p.DurationSeconds
		r.Effects.MagnetCoil = { Id = "MagnetCoil", EndsAt = now + p.DurationSeconds, Params = {} }
		return true
	elseif def.Kind == "Phase" then
		e.PhaseUntil = now + p.DurationSeconds
		r.Effects.PhaseVeil = { Id = "PhaseVeil", EndsAt = now + p.DurationSeconds, Params = {} }
		self._env.World.SetKartAttributes(session.Id, key, { Phased = true })
		session:Broadcast("VisualEvent", "Phase", { Key = key, Seconds = p.DurationSeconds })
		return true
	end
	return false
end

-- Hits -------------------------------------------------------------------------------------------------------------
function ItemService.ApplyHit(
	self: any,
	session: any,
	attackerKey: string?,
	targetKey: string,
	itemId: string,
	level: number,
	now: number
)
	local target = session.Racers[targetKey]
	local te = session.Extra[targetKey]
	local def = ItemDefinitions.ById[itemId]
	local attackerTeam = if attackerKey then session.Racers[attackerKey].Team else 0
	local result = HitSystem.Resolve(target, attackerTeam, level, now, session.Rules.FriendlyFire, def.BlockedByShield)
	if result.Outcome == "Hit" then
		local stun = KartPhysicsModel.HitStunParams(level, te.Stats)
		target.Effects.HitStun = {
			Id = "HitStun",
			EndsAt = now + stun.Seconds,
			Params = { Level = level, SpeedScale = stun.SpeedScale, Spin = if stun.Spin then 1 else 0 },
		}
		if level >= 2 then
			te.CleanRace = false
		end
		if te.Sim then
			te.Sim.StunUntil = now + stun.Seconds
			te.Sim.StunScale = stun.SpeedScale
			te.Sim.Boosts = {}
			te.Sim.Shards = target.Shards
		end
		if result.ShardsDropped > 0 then
			-- Dropped shards reappear near the hit for anyone to grab.
			local pose = te.LastPose
			if pose then
				for i = 1, result.ShardsDropped do
					local id = string.format("drop%d_%d", session.Ticks, i)
					local offset =
						Vector3.new(self._env.Random:NextNumber(-6, 6), 2, self._env.Random:NextNumber(-6, 6))
					table.insert(
						session.Shards,
						{ Id = id, Position = pose.CFrame.Position + offset, Active = true, RespawnAt = math.huge }
					)
					self._env.World.SpawnPickup(session.Id, id, "Shard", pose.CFrame.Position + offset)
				end
			end
		end
		if attackerKey and attackerKey ~= targetKey then
			session.Extra[attackerKey].HitsLanded += 1
		end
		session:SendTo(
			targetKey,
			"KartEffect",
			"Hit",
			{ Level = level, Seconds = stun.Seconds, SpeedScale = stun.SpeedScale, Spin = stun.Spin, Item = itemId }
		)
		session:Broadcast("VisualEvent", "Hit", { Key = targetKey, Item = itemId, Level = level })
		session.Mode:OnHit(session, attackerKey, targetKey, level, now)
		self._telemetry:Count("item.hit." .. itemId)
	elseif result.Outcome == "Shielded" then
		session:Broadcast("VisualEvent", "Shielded", { Key = targetKey, Broken = result.ShieldBroken })
	end
	return result
end

-- Per-tick projectile simulation, traps, hazards, delayed effects, overcharge pulses.
function ItemService.TickEffects(self: any, session: any, now: number, dt: number)
	local world = worldForSession(session, now)
	world.Raycast = function(from: Vector3, dir: Vector3): Vector3?
		return self._env.World.Raycast(session.Id, from, dir)
	end
	local hits = session.Projectiles:Step(world, dt)
	for _, hit in hits do
		local p = hit.Projectile
		self:ApplyHit(session, p.OwnerKey, hit.TargetKey, p.ItemId, p.StunLevel, now)
		self._env.World.DestroyProjectileVisual(session.Id, p.Id)
	end
	for _, p in session.Projectiles.List do
		if p.Alive and p.Kind ~= "Trap" then
			self._env.World.UpdateProjectileVisual(session.Id, p.Id, p.Position)
		end
	end
	-- Storm Crown delayed strikes
	for i = #session.Traps, 1, -1 do
		local t = session.Traps[i]
		if t.Id == -1 and now >= t.ExpiresAt then
			table.remove(session.Traps, i)
			local def = ItemDefinitions.ById.StormCrown
			for otherKey, other in session.Racers do
				if other.Effects.StormCrownWarn then
					other.Effects.StormCrownWarn = nil
					local result = self:ApplyHit(session, t.OwnerKey, otherKey, "StormCrown", def.Params.StunLevel, now)
					if result.Outcome == "Hit" then
						other.Effects.Slow = {
							Id = "Slow",
							EndsAt = now + def.Params.SlowSeconds,
							Params = { Scale = def.Params.SlowScale },
						}
						local oe = session.Extra[otherKey]
						if oe.Sim then
							oe.Sim.SlowScale = def.Params.SlowScale
							oe.Sim.SlowUntil = now + def.Params.SlowSeconds
						end
					end
				end
			end
		end
	end
	-- Track hazards (geysers, presses, lava) and overcharge pulses
	for key, r in session.Racers do
		local e = session.Extra[key]
		if not r.Connected or r.Progress.FinishedAt ~= nil or not e.LastPose then
			continue
		end
		if e.OverchargePulses > 0 and now >= e.NextOverchargeAt then
			local def = ItemDefinitions.ById.OverchargePack
			e.OverchargePulses -= 1
			e.NextOverchargeAt = now + def.Params.PulseSeconds + def.Params.GapSeconds
			table.insert(
				r.Boosts,
				KartPhysicsModel.MakeBoost("Overcharge", def.Params.PulseSeconds, def.Params.SpeedBonus, e.Stats, now)
			)
			if e.Sim then
				table.insert(
					e.Sim.Boosts,
					KartPhysicsModel.MakeBoost(
						"Overcharge",
						def.Params.PulseSeconds,
						def.Params.SpeedBonus,
						e.Stats,
						now
					)
				)
			end
			session:SendTo(
				key,
				"KartEffect",
				"Boost",
				{ Source = "Overcharge", Seconds = def.Params.PulseSeconds, Bonus = def.Params.SpeedBonus }
			)
		end
		if e.PhaseUntil > 0 and e.PhaseUntil <= now then
			e.PhaseUntil = 0
			self._env.World.SetKartAttributes(session.Id, key, { Phased = false })
		end
		if not session.IsArena and r.HitImmuneUntil < now then
			local loc = session.Track:Locate(e.LastPose.CFrame.Position, r.Progress.Progress)
			for _, h in session.Track:HazardsAt(loc.Progress, loc.Lateral) do
				local active = true
				if h.Period and h.Duration then
					active = (now % h.Period) < h.Duration
				end
				if active and h.StunLevel and e.PhaseUntil <= now then
					self:ApplyHit(session, nil, key, "StaticPod", h.StunLevel, now)
				end
				if active and h.Force then
					self._env.World.ApplyImpulse(session.Id, key, h.Force * dt * 60)
				end
			end
		end
	end
end

return ItemService
