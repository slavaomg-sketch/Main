--!strict
-- Procedural original vehicles: one physical chassis (collision box within the balanced envelope) plus
-- non-colliding visual body/wheels welded on. The client controls wheels via Weld.C0; physics uses attachments.
local PhysicsService = game:GetService("PhysicsService")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local VehicleDefinitions = require(Shared.Config.VehicleDefinitions)
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local GameConfig = require(Shared.Config.GameConfig)
local PartUtil = require(script.Parent.PartUtil)
local HeroBuilder = require(script.Parent.HeroBuilder)

local VehicleBuilder = {}

local GROUP_KARTS = "Karts"
local GROUP_KARTS_NOCOLLIDE = "KartsGhost"
local groupsReady = false

function VehicleBuilder.EnsureCollisionGroups()
	if groupsReady then
		return
	end
	groupsReady = true
	pcall(function()
		PhysicsService:RegisterCollisionGroup(GROUP_KARTS)
		PhysicsService:RegisterCollisionGroup(GROUP_KARTS_NOCOLLIDE)
		PhysicsService:CollisionGroupSetCollidable(GROUP_KARTS_NOCOLLIDE, GROUP_KARTS_NOCOLLIDE, false)
		PhysicsService:CollisionGroupSetCollidable(GROUP_KARTS_NOCOLLIDE, GROUP_KARTS, false)
	end)
end

local PAINTS: { [string]: Color3 } = {
	Paint_SolarFlare = Color3.fromRGB(255, 140, 30),
	Paint_DeepRift = Color3.fromRGB(70, 30, 140),
	Paint_MossGlow = Color3.fromRGB(110, 200, 90),
}

export type BuiltKart = {
	Model: Model,
	Chassis: Part,
	Wheels: { { Part: BasePart, Weld: Weld, Offset: Vector3, Steer: boolean } },
	Attachments: { Attachment },
	Forces: { VectorForce },
	Drive: VectorForce,
	Align: AlignOrientation,
	Seat: Attachment,
}

function VehicleBuilder.Build(
	key: string,
	heroId: string,
	vehicleId: string,
	cosmetics: any,
	cframe: CFrame,
	collisions: boolean,
	isBot: boolean,
	parent: Instance
): BuiltKart
	VehicleBuilder.EnsureCollisionGroups()
	local def = VehicleDefinitions.ById[vehicleId] or VehicleDefinitions.ById[VehicleDefinitions.DefaultVehicleId]
	local hero = HeroDefinitions.ById[heroId] or HeroDefinitions.ById[HeroDefinitions.DefaultHeroId]
	local v = def.Visual
	local paint = if cosmetics
			and cosmetics.Paint
			and PAINTS[cosmetics.Paint]
		then PAINTS[cosmetics.Paint]
		else v.PrimaryColor
	local model = Instance.new("Model")
	model.Name = "Kart_" .. key

	local box = VehicleDefinitions.CollisionBox
	local chassis = Instance.new("Part")
	chassis.Name = "Chassis"
	chassis.Size = Vector3.new(box.X, 2.2, box.Z)
	chassis.CFrame = cframe
	chassis.Transparency = 1
	chassis.CanCollide = collisions
	chassis.CanTouch = true
	chassis.CanQuery = true
	chassis.Anchored = false
	chassis.Massless = false
	chassis.CustomPhysicalProperties =
		PhysicalProperties.new(def.Physics.Mass / (chassis.Size.X * chassis.Size.Y * chassis.Size.Z), 0.3, 0.2, 1, 1)
	chassis.CollisionGroup = if collisions then GROUP_KARTS else GROUP_KARTS_NOCOLLIDE
	chassis.Parent = model
	model.PrimaryPart = chassis
	CollectionService:AddTag(chassis, "KartChassis")
	chassis:SetAttribute("RacerKey", key)
	chassis:SetAttribute("VehicleId", def.Id)
	chassis:SetAttribute("HeroId", hero.Id)
	chassis:SetAttribute("IsBot", isBot)

	local function visual(
		size: Vector3,
		offset: CFrame,
		color: Color3,
		material: Enum.Material?,
		shape: Enum.PartType?,
		name: string?
	): Part
		local p = Instance.new("Part")
		p.Name = name or "Body"
		p.Size = size
		p.Color = color
		p.Material = material or v.Material
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.Massless = true
		p.Anchored = false
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		if shape then
			p.Shape = shape
		end
		p.CFrame = cframe * offset
		p.Parent = model
		local w = Instance.new("WeldConstraint")
		w.Part0 = chassis
		w.Part1 = p
		w.Parent = p
		return p
	end

	-- Body by silhouette
	local bs = v.BodySize
	local bodyY = -0.2
	if v.Silhouette == "Wedge" then
		visual(Vector3.new(bs.X, bs.Y, bs.Z * 0.6), CFrame.new(0, bodyY, bs.Z * 0.15), paint)
		local nose = PartUtil.Wedge(
			Vector3.new(bs.X * 0.9, bs.Y, bs.Z * 0.4),
			cframe * CFrame.new(0, bodyY, -bs.Z * 0.35) * CFrame.Angles(0, math.pi, 0),
			paint,
			v.Material,
			model
		)
		nose.Anchored = false
		nose.CanCollide = false
		nose.Massless = true
		local wn = Instance.new("WeldConstraint")
		wn.Part0 = chassis
		wn.Part1 = nose
		wn.Parent = nose
	elseif v.Silhouette == "Pod" then
		visual(Vector3.new(bs.X, bs.Y * 1.6, bs.Z * 0.8), CFrame.new(0, bodyY + 0.3, 0), paint, nil, Enum.PartType.Ball)
		visual(
			Vector3.new(bs.X * 0.8, bs.Y * 0.6, bs.Z * 0.5),
			CFrame.new(0, bodyY - 0.2, -bs.Z * 0.3),
			v.SecondaryColor
		)
	elseif v.Silhouette == "Long" then
		visual(Vector3.new(bs.X * 0.8, bs.Y, bs.Z), CFrame.new(0, bodyY, 0), paint)
		visual(
			Vector3.new(bs.X, bs.Y * 0.5, bs.Z * 0.35),
			CFrame.new(0, bodyY + 0.2, bs.Z * 0.28),
			v.SecondaryColor,
			nil,
			nil,
			"Spoiler"
		)
		visual(
			Vector3.new(bs.X * 0.5, bs.Y * 0.4, bs.Z * 0.3),
			CFrame.new(0, bodyY - 0.1, -bs.Z * 0.38),
			v.AccentColor,
			Enum.Material.Neon,
			nil,
			"Nose"
		)
	elseif v.Silhouette == "Wide" then
		visual(Vector3.new(bs.X, bs.Y, bs.Z * 0.9), CFrame.new(0, bodyY, 0), paint)
		visual(
			Vector3.new(bs.X * 1.05, bs.Y * 0.3, bs.Z * 0.2),
			CFrame.new(0, bodyY + 0.5, -bs.Z * 0.35),
			v.AccentColor,
			Enum.Material.Metal,
			nil,
			"Bumper"
		)
	else -- Box
		visual(Vector3.new(bs.X, bs.Y, bs.Z), CFrame.new(0, bodyY, 0), paint)
		visual(
			Vector3.new(bs.X * 0.9, bs.Y * 0.4, bs.Z * 0.3),
			CFrame.new(0, bodyY + bs.Y * 0.6, bs.Z * 0.2),
			v.SecondaryColor,
			nil,
			nil,
			"Rack"
		)
	end
	-- Cabin + accents + light
	local cabin = visual(
		v.CabinSize,
		CFrame.new(0, bodyY + bs.Y / 2 + v.CabinSize.Y / 2 - 0.1, bs.Z * 0.05),
		v.SecondaryColor,
		nil,
		nil,
		"Cabin"
	)
	local _ = cabin
	visual(
		Vector3.new(bs.X * 0.7, 0.3, 0.4),
		CFrame.new(0, bodyY + 0.2, -bs.Z / 2 + 0.2),
		v.AccentColor,
		Enum.Material.Neon,
		nil,
		"HeadLight"
	)
	local tail = visual(
		Vector3.new(bs.X * 0.6, 0.3, 0.3),
		CFrame.new(0, bodyY + 0.2, bs.Z / 2 - 0.1),
		Color3.fromRGB(255, 60, 60),
		Enum.Material.Neon,
		nil,
		"TailLight"
	)
	local _t = tail
	-- Exhaust/boost emitter anchor
	local exhaust = Instance.new("Attachment")
	exhaust.Name = "Exhaust"
	exhaust.Position = Vector3.new(0, -0.3, bs.Z / 2 + 0.3)
	exhaust.Parent = chassis

	-- Wheels (visual only; hover vehicles get glowing pads instead)
	local wheels: { { Part: BasePart, Weld: Weld, Offset: Vector3, Steer: boolean } } = {}
	local wheelY = -0.6
	local positions: { { Pos: Vector3, Steer: boolean } } = {}
	if v.WheelCount == 3 then
		positions = {
			{ Pos = Vector3.new(0, wheelY, -bs.Z * 0.42), Steer = true },
			{ Pos = Vector3.new(-bs.X * 0.5, wheelY, bs.Z * 0.35), Steer = false },
			{ Pos = Vector3.new(bs.X * 0.5, wheelY, bs.Z * 0.35), Steer = false },
		}
	else
		positions = {
			{ Pos = Vector3.new(-bs.X * 0.5, wheelY, -bs.Z * 0.35), Steer = true },
			{ Pos = Vector3.new(bs.X * 0.5, wheelY, -bs.Z * 0.35), Steer = true },
			{ Pos = Vector3.new(-bs.X * 0.5, wheelY, bs.Z * 0.35), Steer = false },
			{ Pos = Vector3.new(bs.X * 0.5, wheelY, bs.Z * 0.35), Steer = false },
		}
	end
	for i, entry in positions do
		local offset, steer = entry.Pos, entry.Steer
		local wheel = Instance.new("Part")
		wheel.Name = "Wheel" .. i
		if v.Kind == "Hover" then
			wheel.Shape = Enum.PartType.Cylinder
			wheel.Size = Vector3.new(0.4, v.WheelRadius * 2, v.WheelRadius * 2)
			wheel.Color = v.AccentColor
			wheel.Material = Enum.Material.Neon
		else
			wheel.Shape = Enum.PartType.Cylinder
			wheel.Size = Vector3.new(v.WheelWidth, v.WheelRadius * 2, v.WheelRadius * 2)
			wheel.Color = Color3.fromRGB(35, 35, 40)
			wheel.Material = Enum.Material.Rubber
		end
		wheel.CanCollide = false
		wheel.CanQuery = false
		wheel.CanTouch = false
		wheel.Massless = true
		wheel.Anchored = false
		local base = CFrame.new(offset)
			* (if v.Kind == "Hover" then CFrame.Angles(0, 0, math.rad(90)) else CFrame.Angles(0, 0, math.rad(90)))
		wheel.CFrame = cframe * base
		wheel.Parent = model
		local weld = Instance.new("Weld")
		weld.Name = "WheelWeld"
		weld.Part0 = chassis
		weld.Part1 = wheel
		weld.C0 = base
		weld.Parent = wheel
		table.insert(wheels, { Part = wheel :: BasePart, Weld = weld, Offset = offset, Steer = steer })
	end

	-- Suspension attachments + forces (client-driven; zero force by default)
	local attachments = {}
	local forces = {}
	for i, entry in positions do
		local att = Instance.new("Attachment")
		att.Name = "Suspension" .. i
		att.Position = Vector3.new(entry.Pos.X, 0, entry.Pos.Z)
		att.Parent = chassis
		local vf = Instance.new("VectorForce")
		vf.Name = "SuspensionForce" .. i
		vf.Attachment0 = att
		vf.RelativeTo = Enum.ActuatorRelativeTo.World
		vf.ApplyAtCenterOfMass = false
		vf.Force = Vector3.new()
		vf.Parent = chassis
		table.insert(attachments, att)
		table.insert(forces, vf)
	end
	local center = Instance.new("Attachment")
	center.Name = "Center"
	center.Parent = chassis
	local drive = Instance.new("VectorForce")
	drive.Name = "DriveForce"
	drive.Attachment0 = center
	drive.RelativeTo = Enum.ActuatorRelativeTo.World
	drive.ApplyAtCenterOfMass = true
	drive.Force = Vector3.new()
	drive.Parent = chassis
	local align = Instance.new("AlignOrientation")
	align.Name = "Upright"
	align.Mode = Enum.OrientationAlignmentMode.OneAttachment
	align.Attachment0 = center
	align.AlignType = Enum.AlignType.PrimaryAxisParallel
	align.PrimaryAxis = Vector3.new(0, 1, 0)
	align.MaxTorque = def.Physics.Mass * 2500
	align.Responsiveness = 25
	align.RigidityEnabled = false
	align.Parent = chassis

	-- Seat anchor and hero
	local seat = Instance.new("Attachment")
	seat.Name = "Seat"
	seat.Position = Vector3.new(0, bs.Y / 2 + 0.2, bs.Z * 0.05)
	seat.Parent = chassis
	HeroBuilder.Build(hero, cframe * CFrame.new(seat.Position), chassis, model)

	-- Bots: server keeps ownership and moves the assembly directly.
	if isBot then
		chassis.Anchored = true
	end
	model.Parent = parent
	if not isBot then
		pcall(function()
			chassis:SetNetworkOwner(nil)
		end)
	end
	local _g = GameConfig
	return {
		Model = model,
		Chassis = chassis,
		Wheels = wheels,
		Attachments = attachments,
		Forces = forces,
		Drive = drive,
		Align = align,
		Seat = seat,
	}
end

return VehicleBuilder
