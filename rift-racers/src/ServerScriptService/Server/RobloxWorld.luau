--!strict
-- World adapter for Roblox: builds venues/karts with the procedural builders and maps session-local coordinates
-- to a per-session world origin so several sessions can coexist in one place.
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local ItemDefinitions = require(Shared.Config.ItemDefinitions)
local TrackBuilder = require(script.Parent.Builders.TrackBuilder)
local ArenaBuilder = require(script.Parent.Builders.ArenaBuilder)
local VehicleBuilder = require(script.Parent.Builders.VehicleBuilder)
local PickupBuilder = require(script.Parent.Builders.PickupBuilder)
local PartUtil = require(script.Parent.Builders.PartUtil)

local RobloxWorld = {}

local SESSION_SPACING = 12000

type SessionSpace = {
	Origin: Vector3,
	Folder: Folder,
	Karts: { [string]: VehicleBuilder.BuiltKart },
	Pickups: { [string]: BasePart },
	Projectiles: { [number]: BasePart },
	Venue: any?,
	Collisions: boolean,
}

local spaces: { [string]: SessionSpace } = {}
local nextSlot = 1
local freeSlots: { number } = {}

local function root(): Folder
	local rr = Workspace:FindFirstChild("RiftRacers")
	if rr then
		return rr :: Folder
	end
	local f = Instance.new("Folder")
	f.Name = "RiftRacers"
	f.Parent = Workspace
	return f
end

local function folderIn(parent: Instance, name: string): Folder
	local f = parent:FindFirstChild(name)
	if f then
		return f :: Folder
	end
	return PartUtil.Folder(name, parent)
end

local function space(sessionId: string): SessionSpace
	local existing = spaces[sessionId]
	if existing then
		return existing
	end
	local slot = table.remove(freeSlots) or nextSlot
	if slot == nextSlot then
		nextSlot += 1
	end
	local origin = Vector3.new(slot * SESSION_SPACING, 0, 0)
	local folder = PartUtil.Folder("Session_" .. sessionId, folderIn(root(), "Tracks"))
	folder:SetAttribute("Slot", slot)
	folder:SetAttribute("Origin", origin)
	local s: SessionSpace =
		{ Origin = origin, Folder = folder, Karts = {}, Pickups = {}, Projectiles = {}, Venue = nil, Collisions = true }
	spaces[sessionId] = s
	return s
end

function RobloxWorld.Now(): number
	return Workspace:GetServerTimeNow()
end

function RobloxWorld.BuildVenue(
	sessionId: string,
	venueId: string,
	runtime: any,
	isArena: boolean,
	mirror: boolean
): any
	local s = space(sessionId)
	if s.Venue then
		RobloxWorld.DestroyVenue(s.Venue)
	end
	local built
	if isArena then
		built = ArenaBuilder.Build(runtime, s.Origin, s.Folder)
	else
		built = TrackBuilder.Build(runtime, s.Origin, s.Folder)
	end
	built.Model:SetAttribute("SessionId", sessionId)
	s.Venue = built
	local _ = mirror
	return built
end

function RobloxWorld.DestroyVenue(handle: any)
	if handle and handle.Model then
		handle.Model:Destroy()
	end
	for id, s in spaces do
		if s.Venue == handle then
			s.Venue = nil
			for _, p in s.Pickups do
				p:Destroy()
			end
			s.Pickups = {}
			for _, p in s.Projectiles do
				p:Destroy()
			end
			s.Projectiles = {}
			local _ = id
		end
	end
end

function RobloxWorld.UpdateVenue(handle: any, now: number)
	if handle and handle.Moving and #handle.Moving > 0 then
		TrackBuilder.Update(handle, now)
	end
end

function RobloxWorld.SetGate(handle: any, shortcutId: string, open: boolean)
	if handle and handle.Gates then
		TrackBuilder.SetGate(handle, shortcutId, open)
	end
end

function RobloxWorld.SetCollisions(sessionId: string, enabled: boolean)
	space(sessionId).Collisions = enabled
end

function RobloxWorld.SpawnKart(
	sessionId: string,
	key: string,
	heroId: string,
	vehicleId: string,
	cosmetics: any,
	cframe: CFrame,
	player: any?,
	isBot: boolean
): any
	local s = space(sessionId)
	RobloxWorld.DestroyKart(sessionId, key)
	local kartFolder = folderIn(s.Folder, "Karts")
	local built =
		VehicleBuilder.Build(key, heroId, vehicleId, cosmetics, cframe + s.Origin, s.Collisions, isBot, kartFolder)
	s.Karts[key] = built
	built.Chassis:SetAttribute("SessionId", sessionId)
	if player and typeof(player) == "Instance" then
		built.Chassis:SetAttribute("OwnerUserId", (player :: Player).UserId)
		task.defer(function()
			pcall(function()
				built.Chassis:SetNetworkOwner(player :: Player)
			end)
		end)
	end
	return built
end

function RobloxWorld.DestroyKart(sessionId: string, key: string)
	local s = spaces[sessionId]
	if not s then
		return
	end
	local k = s.Karts[key]
	if k then
		k.Model:Destroy()
		s.Karts[key] = nil
	end
end

function RobloxWorld.GetPose(sessionId: string, key: string): any?
	local s = spaces[sessionId]
	if not s then
		return nil
	end
	local k = s.Karts[key]
	if not k or not k.Chassis.Parent then
		return nil
	end
	local ch = k.Chassis
	local grounded = ch:GetAttribute("Grounded")
	return {
		CFrame = ch.CFrame - s.Origin,
		Velocity = ch.AssemblyLinearVelocity,
		AngularVelocity = ch.AssemblyAngularVelocity,
		Grounded = if grounded == nil then true else grounded == true,
	}
end

function RobloxWorld.SetPose(sessionId: string, key: string, cframe: CFrame, velocity: Vector3?)
	local s = spaces[sessionId]
	local k = if s then s.Karts[key] else nil
	if not k then
		return
	end
	k.Chassis.CFrame = cframe + s.Origin
	if velocity and not k.Chassis.Anchored then
		k.Chassis.AssemblyLinearVelocity = velocity
		k.Chassis.AssemblyAngularVelocity = Vector3.new()
	end
end

function RobloxWorld.SetKartAttributes(sessionId: string, key: string, attrs: { [string]: any })
	local s = spaces[sessionId]
	local k = if s then s.Karts[key] else nil
	if not k then
		return
	end
	for name, v in attrs do
		k.Chassis:SetAttribute(name, v)
	end
	if attrs.Phased ~= nil then
		k.Chassis.CollisionGroup = if attrs.Phased
			then "KartsGhost"
			else (if s.Collisions then "Karts" else "KartsGhost")
	end
end

function RobloxWorld.ApplyImpulse(sessionId: string, key: string, impulse: Vector3)
	local s = spaces[sessionId]
	local k = if s then s.Karts[key] else nil
	if not k or k.Chassis.Anchored then
		return
	end
	-- Owner-simulated parts ignore server impulses; send it as an attribute pulse the client applies.
	k.Chassis:SetAttribute("Impulse", impulse)
	k.Chassis:SetAttribute("ImpulseAt", Workspace:GetServerTimeNow())
end

local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Include

function RobloxWorld.Raycast(sessionId: string, from: Vector3, dir: Vector3): Vector3?
	local s = spaces[sessionId]
	if not s or not s.Venue then
		return nil
	end
	local walls = s.Venue.Model:FindFirstChild("Walls")
	if not walls then
		return nil
	end
	rayParams.FilterDescendantsInstances = { walls }
	local result = Workspace:Raycast(from + s.Origin, dir, rayParams)
	if result then
		return result.Normal
	end
	return nil
end

function RobloxWorld.SpawnPickup(sessionId: string, id: string, kind: "ItemPad" | "Shard", position: Vector3)
	local s = space(sessionId)
	local existing = s.Pickups[id]
	if existing then
		existing:Destroy()
	end
	local folder = if s.Venue then (s.Venue.Model:FindFirstChild("ItemPads") or s.Folder) else s.Folder
	s.Pickups[id] = PickupBuilder.Build(id, kind, position + s.Origin, folder)
end

function RobloxWorld.SetPickupActive(sessionId: string, id: string, active: boolean)
	local s = spaces[sessionId]
	local p = if s then s.Pickups[id] else nil
	if p then
		PickupBuilder.SetActive(p, active)
	end
end

function RobloxWorld.SpawnProjectileVisual(sessionId: string, id: number, itemId: string, position: Vector3)
	local s = space(sessionId)
	local def = ItemDefinitions.ById[itemId]
	local folder = folderIn(folderIn(root(), "Projectiles"), "Session_" .. sessionId)
	local size = if def.Kind == "Trap"
		then Vector3.new(3, 1.2, 3)
		elseif def.Kind == "Homing" then Vector3.new(2, 2, 2)
		else Vector3.new(3, 0.6, 3)
	local p = PartUtil.Part({
		Size = size,
		CFrame = CFrame.new(position + s.Origin),
		Color = def.Color,
		Material = Enum.Material.Neon,
		CanCollide = false,
		CanQuery = false,
		Name = "Proj_" .. id,
		Shape = if def.Kind == "Homing" then Enum.PartType.Ball else Enum.PartType.Cylinder,
		Tags = { "Projectile" },
		Parent = folder,
	})
	p:SetAttribute("ItemId", itemId)
	p:SetAttribute("Spin", if def.Kind == "Trap" then 1 else 6)
	PartUtil.Light(p, def.Color, 14, 1)
	s.Projectiles[id] = p
end

function RobloxWorld.UpdateProjectileVisual(sessionId: string, id: number, position: Vector3)
	local s = spaces[sessionId]
	local p = if s then s.Projectiles[id] else nil
	if p then
		p.CFrame = CFrame.new(position + s.Origin)
	end
end

function RobloxWorld.DestroyProjectileVisual(sessionId: string, id: number)
	local s = spaces[sessionId]
	local p = if s then s.Projectiles[id] else nil
	if p then
		p:Destroy()
		s.Projectiles[id] = nil
	end
end

function RobloxWorld.SetSpectatorTarget(player: any, sessionId: string, key: string?)
	if typeof(player) == "Instance" then
		(player :: Player):SetAttribute("SpectateKey", key);
		(player :: Player):SetAttribute("SpectateSession", if key then sessionId else nil)
	end
end

function RobloxWorld.ReleaseSession(sessionId: string)
	local s = spaces[sessionId]
	if not s then
		return
	end
	for key in s.Karts do
		RobloxWorld.DestroyKart(sessionId, key)
	end
	if s.Venue then
		RobloxWorld.DestroyVenue(s.Venue)
	end
	s.Folder:Destroy()
	local projFolder = root():FindFirstChild("Projectiles")
	local pf = if projFolder then projFolder:FindFirstChild("Session_" .. sessionId) else nil
	if pf then
		pf:Destroy()
	end
	table.insert(freeSlots, s.Folder:GetAttribute("Slot") :: number)
	spaces[sessionId] = nil
end

function RobloxWorld.OriginOf(sessionId: string): Vector3?
	local s = spaces[sessionId]
	return if s then s.Origin else nil
end

return RobloxWorld
