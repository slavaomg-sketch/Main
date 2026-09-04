--!strict
-- Server-simulated projectiles and traps (kinematic, no physics engine). Hit detection is distance-based against
-- server-known kart positions, so clients can never claim a hit.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ItemDefinitions = require(Shared.Config.ItemDefinitions)
local MathUtil = require(Shared.Utility.MathUtil)

export type Projectile = {
	Id: number,
	ItemId: string,
	OwnerKey: string,
	OwnerTeam: number,
	Position: Vector3,
	Velocity: Vector3,
	SpawnedAt: number,
	ExpiresAt: number,
	Bounces: number,
	TargetKey: string?,
	Kind: "Projectile" | "Homing" | "Trap",
	Radius: number,
	StunLevel: number,
	Alive: boolean,
}

export type World = {
	Now: number,
	Racers: { [string]: { Position: Vector3, Forward: Vector3, Team: number, Finished: boolean, Progress: number } },
	Raycast: ((from: Vector3, dir: Vector3) -> Vector3?)?, -- returns wall normal if a wall is hit
	TrackLength: number,
}

export type Hit = { Projectile: Projectile, TargetKey: string }

local ProjectileSim = {}
ProjectileSim.__index = ProjectileSim

local nextId = 0

function ProjectileSim.new()
	return setmetatable({ List = {} :: { Projectile } }, ProjectileSim)
end

function ProjectileSim.Spawn(
	self: any,
	itemId: string,
	ownerKey: string,
	ownerTeam: number,
	position: Vector3,
	direction: Vector3,
	now: number,
	targetKey: string?
): Projectile
	local def = ItemDefinitions.ById[itemId]
	assert(def, "unknown item " .. itemId)
	nextId += 1
	local kind: "Projectile" | "Homing" | "Trap" = if def.Kind == "Homing"
		then "Homing"
		elseif def.Kind == "Trap" then "Trap"
		else "Projectile"
	local speed = def.Params.Speed or 0
	local dir = if direction.Magnitude > 1e-3 then direction.Unit else Vector3.new(0, 0, -1)
	local p: Projectile = {
		Id = nextId,
		ItemId = itemId,
		OwnerKey = ownerKey,
		OwnerTeam = ownerTeam,
		Position = position,
		Velocity = dir * speed,
		SpawnedAt = now,
		ExpiresAt = now + (def.Params.LifeSeconds or 10),
		Bounces = 0,
		TargetKey = targetKey,
		Kind = kind,
		Radius = def.Params.Radius or 3,
		StunLevel = def.Params.StunLevel or 1,
		Alive = true,
	}
	table.insert(self.List, p)
	return p
end

-- Returns hits this step. Owner is immune to their own projectile for 0.4s after firing.
function ProjectileSim.Step(self: any, world: World, dt: number): { Hit }
	local hits: { Hit } = {}
	local now = world.Now
	for _, p in self.List do
		if not p.Alive then
			continue
		end
		if now >= p.ExpiresAt then
			p.Alive = false
			continue
		end
		local def = ItemDefinitions.ById[p.ItemId]
		if p.Kind == "Homing" then
			local target = if p.TargetKey then world.Racers[p.TargetKey] else nil
			if target and not target.Finished then
				local desired = (target.Position - p.Position)
				if desired.Magnitude > 1e-3 then
					desired = desired.Unit * (def.Params.Speed or 100)
					local turn = math.clamp((def.Params.TurnRate or 3) * dt, 0, 1)
					p.Velocity = p.Velocity:Lerp(desired, turn)
				end
			else
				p.Alive = false
				continue
			end
		end
		if p.Kind ~= "Trap" then
			local nextPos = p.Position + p.Velocity * dt
			if world.Raycast then
				local normal = world.Raycast(p.Position, nextPos - p.Position)
				if normal then
					if p.Bounces < (def.Params.MaxBounces or 0) then
						p.Bounces += 1
						local v = p.Velocity
						p.Velocity = v - 2 * v:Dot(normal) * normal
						nextPos = p.Position + p.Velocity * dt
					else
						p.Alive = false
						continue
					end
				end
			end
			p.Position = nextPos
		end
		for key, r in world.Racers do
			if r.Finished then
				continue
			end
			if key == p.OwnerKey and (now - p.SpawnedAt < 0.4 or p.Kind ~= "Trap") then
				continue
			end
			if (r.Position - p.Position).Magnitude <= p.Radius + 3 then
				p.Alive = false
				table.insert(hits, { Projectile = p, TargetKey = key })
				break
			end
		end
	end
	for i = #self.List, 1, -1 do
		if not self.List[i].Alive then
			table.remove(self.List, i)
		end
	end
	return hits
end

-- Destroys weak projectiles/traps within radius (Shockwave Horn, Gravity Drum).
function ProjectileSim.ClearNear(self: any, position: Vector3, radius: number, exceptOwner: string?): number
	local n = 0
	for _, p in self.List do
		if p.Alive and (p.Position - position).Magnitude <= radius then
			local def = ItemDefinitions.ById[p.ItemId]
			if def.Strength ~= "Strong" then
				p.Alive = false
				n += 1
			end
		end
	end
	return n
end

function ProjectileSim.CountByOwner(self: any, ownerKey: string): number
	local n = 0
	for _, p in self.List do
		if p.Alive and p.OwnerKey == ownerKey then
			n += 1
		end
	end
	return n
end

-- Picks the nearest valid target ahead of the owner along the track (for Hunter Wisp).
function ProjectileSim.PickTargetAhead(
	world: World,
	ownerKey: string,
	ownerTeam: number,
	friendlyFire: boolean
): string?
	local owner = world.Racers[ownerKey]
	if not owner then
		return nil
	end
	local bestKey, bestDelta = nil, math.huge
	for key, r in world.Racers do
		if key == ownerKey or r.Finished then
			continue
		end
		if ownerTeam ~= 0 and r.Team == ownerTeam and not friendlyFire then
			continue
		end
		local delta = MathUtil.LoopDelta(owner.Progress, r.Progress, world.TrackLength)
		if delta > 0 and delta < bestDelta then
			bestDelta = delta
			bestKey = key
		end
	end
	return bestKey
end

-- Snapshot for replication (compact).
function ProjectileSim.Snapshot(self: any): { { Id: number, Item: string, P: Vector3, V: Vector3 } }
	local out = {}
	for _, p in self.List do
		if p.Alive then
			table.insert(out, { Id = p.Id, Item = p.ItemId, P = p.Position, V = p.Velocity })
		end
	end
	return out
end

return ProjectileSim
