--!strict
-- Original low-poly landmark props per theme, built from primitives. Each kind is a small named function so the
-- content layer can swap it for a mesh later without touching the track data.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local PartUtil = require(script.Parent.PartUtil)

local DecorBuilder = {}

type Builder = (cf: CFrame, scale: number, color: Color3?, parent: Instance, atm: TrackDefinitions.Atmosphere) -> ()

local C = Color3.fromRGB

local function box(cf: CFrame, size: Vector3, color: Color3, mat: Enum.Material, parent: Instance, name: string?): Part
	return PartUtil.Part({
		Size = size,
		CFrame = cf,
		Color = color,
		Material = mat,
		Parent = parent,
		Name = name or "Decor",
		CanCollide = true,
	})
end

local kinds: { [string]: Builder } = {}

kinds.ContainerStack = function(cf, scale, color, parent)
	local base = color or C(200, 80, 60)
	for i = 0, 2 do
		local c = if i == 1 then base:Lerp(C(255, 255, 255), 0.25) else base
		box(
			cf * CFrame.new((i % 2) * 6 * scale, 4 * scale + i * 8 * scale, 0),
			Vector3.new(16, 8, 8) * scale,
			c,
			Enum.Material.Metal,
			parent,
			"Container"
		)
	end
end

kinds.NeonSign = function(cf, scale, color, parent)
	local pole = box(
		cf * CFrame.new(0, 12 * scale, 0),
		Vector3.new(1.2, 24, 1.2) * scale,
		C(60, 60, 70),
		Enum.Material.Metal,
		parent,
		"SignPole"
	)
	local sign = box(
		cf * CFrame.new(0, 26 * scale, 0),
		Vector3.new(14, 6, 1) * scale,
		color or C(255, 60, 200),
		Enum.Material.Neon,
		parent,
		"Sign"
	)
	PartUtil.Light(sign, color or C(255, 60, 200), 40 * scale, 2)
	local _ = pole
end

kinds.Lighthouse = function(cf, scale, color, parent)
	local tower = PartUtil.Part({
		Size = Vector3.new(10, 50, 10) * scale,
		CFrame = cf * CFrame.new(0, 25 * scale, 0),
		Color = C(240, 240, 235),
		Material = Enum.Material.Concrete,
		Shape = Enum.PartType.Cylinder,
		Parent = parent,
		Name = "Lighthouse",
	})
	tower.CFrame = tower.CFrame * CFrame.Angles(0, 0, math.rad(90))
	tower.Size = Vector3.new(50, 10, 10) * scale
	local lamp = box(
		cf * CFrame.new(0, 52 * scale, 0),
		Vector3.new(8, 5, 8) * scale,
		C(255, 230, 120),
		Enum.Material.Neon,
		parent,
		"Lamp"
	)
	PartUtil.Light(lamp, C(255, 230, 120), 120 * scale, 3)
end

kinds.Warehouse = function(cf, scale, _color, parent)
	box(
		cf * CFrame.new(0, 10 * scale, 0),
		Vector3.new(60, 20, 30) * scale,
		C(80, 90, 110),
		Enum.Material.Metal,
		parent,
		"Warehouse"
	)
	box(
		cf * CFrame.new(0, 21 * scale, 0),
		Vector3.new(62, 2, 32) * scale,
		C(60, 65, 80),
		Enum.Material.Metal,
		parent,
		"Roof"
	)
end

kinds.WaterPlane = function(cf, _scale, _color, parent, atm)
	PartUtil.Part({
		Size = Vector3.new(3000, 1, 3000),
		CFrame = CFrame.new(cf.Position.X, cf.Position.Y, cf.Position.Z),
		Color = atm.GroundColor,
		Material = atm.GroundMaterial,
		Parent = parent,
		Name = "GroundPlane",
		CanCollide = true,
		Transparency = if atm.GroundMaterial == Enum.Material.Water then 0.2 else 0,
	})
end
kinds.CloudPlane = kinds.WaterPlane
kinds.LavaPlane = function(cf, _scale, _color, parent, atm)
	local p = PartUtil.Part({
		Size = Vector3.new(3000, 1, 3000),
		CFrame = CFrame.new(cf.Position),
		Color = C(255, 110, 30),
		Material = Enum.Material.Neon,
		Parent = parent,
		Name = "LavaPlane",
		CanCollide = true,
	})
	local _ = atm
	PartUtil.Light(p, C(255, 120, 40), 60, 0.5)
end
kinds.SnowPlane = kinds.WaterPlane

kinds.FloatingIsland = function(cf, scale, _color, parent)
	local top = box(
		cf * CFrame.new(0, 0, 0),
		Vector3.new(60, 6, 50) * scale,
		C(96, 170, 90),
		Enum.Material.Grass,
		parent,
		"IslandTop"
	)
	local rock = PartUtil.Part({
		Size = Vector3.new(50, 30, 40) * scale,
		CFrame = cf * CFrame.new(0, -16 * scale, 0),
		Color = C(120, 100, 90),
		Material = Enum.Material.Slate,
		Shape = Enum.PartType.Ball,
		Parent = parent,
		Name = "IslandRock",
	})
	local _ = top
	local _2 = rock
end

kinds.GardenTree = function(cf, scale, _color, parent)
	box(
		cf * CFrame.new(0, 5 * scale, 0),
		Vector3.new(2, 10, 2) * scale,
		C(120, 80, 50),
		Enum.Material.Wood,
		parent,
		"Trunk"
	)
	PartUtil.Part({
		Size = Vector3.new(12, 12, 12) * scale,
		CFrame = cf * CFrame.new(0, 13 * scale, 0),
		Color = C(110, 200, 120),
		Material = Enum.Material.Grass,
		Shape = Enum.PartType.Ball,
		Parent = parent,
		Name = "Canopy",
	})
end

kinds.Windmill = function(cf, scale, _color, parent)
	box(
		cf * CFrame.new(0, 15 * scale, 0),
		Vector3.new(8, 30, 8) * scale,
		C(235, 230, 220),
		Enum.Material.Concrete,
		parent,
		"Mill"
	)
	for i = 0, 3 do
		local blade = box(
			cf
				* CFrame.new(0, 30 * scale, 5 * scale)
				* CFrame.Angles(0, 0, math.rad(90 * i))
				* CFrame.new(0, 12 * scale, 0),
			Vector3.new(2, 24, 0.6) * scale,
			C(200, 190, 170),
			Enum.Material.Wood,
			parent,
			"Blade"
		)
		blade:SetAttribute("Spin", 0.6)
		blade:SetAttribute("Dynamic", true)
	end
end

kinds.Lantern = function(cf, scale, color, parent)
	box(
		cf * CFrame.new(0, 5 * scale, 0),
		Vector3.new(0.8, 10, 0.8) * scale,
		C(80, 70, 60),
		Enum.Material.Metal,
		parent,
		"LanternPole"
	)
	local l = box(
		cf * CFrame.new(0, 10 * scale, 0),
		Vector3.new(2, 3, 2) * scale,
		color or C(255, 220, 120),
		Enum.Material.Neon,
		parent,
		"LanternLamp"
	)
	PartUtil.Light(l, color or C(255, 220, 120), 30, 1.5)
end

kinds.Volcano = function(cf, scale, _color, parent)
	local cone = PartUtil.Part({
		Size = Vector3.new(160, 120, 160) * scale,
		CFrame = cf * CFrame.new(0, 40 * scale, 0),
		Color = C(50, 30, 30),
		Material = Enum.Material.Basalt,
		Shape = Enum.PartType.Ball,
		Parent = parent,
		Name = "Volcano",
	})
	local glow = box(
		cf * CFrame.new(0, 100 * scale, 0),
		Vector3.new(40, 6, 40) * scale,
		C(255, 120, 30),
		Enum.Material.Neon,
		parent,
		"Crater"
	)
	PartUtil.Light(glow, C(255, 120, 40), 200, 2)
	local _ = cone
end

kinds.ObsidianSpike = function(cf, scale, _color, parent)
	PartUtil.Wedge(
		Vector3.new(6, 26, 8) * scale,
		cf * CFrame.new(0, 13 * scale, 0),
		C(30, 25, 35),
		Enum.Material.Glass,
		parent
	)
end

kinds.EmberVent = function(cf, scale, color, parent)
	local v = box(
		cf * CFrame.new(0, 1.5 * scale, 0),
		Vector3.new(6, 3, 6) * scale,
		color or C(255, 140, 40),
		Enum.Material.Neon,
		parent,
		"Vent"
	)
	PartUtil.Light(v, color or C(255, 140, 40), 30, 1.5)
end

kinds.TunnelArch = function(cf, scale, _color, parent)
	box(
		cf * CFrame.new(-24 * scale, 10 * scale, 0),
		Vector3.new(3, 20, 6) * scale,
		C(70, 70, 90),
		Enum.Material.Metal,
		parent,
		"ArchLeg"
	)
	box(
		cf * CFrame.new(24 * scale, 10 * scale, 0),
		Vector3.new(3, 20, 6) * scale,
		C(70, 70, 90),
		Enum.Material.Metal,
		parent,
		"ArchLeg"
	)
	box(
		cf * CFrame.new(0, 21 * scale, 0),
		Vector3.new(51, 3, 6) * scale,
		C(90, 90, 120),
		Enum.Material.Metal,
		parent,
		"ArchTop"
	)
end

kinds.GlassTunnel = function(cf, scale, _color, parent)
	local ring = PartUtil.Part({
		Size = Vector3.new(6, 52, 52) * scale,
		CFrame = cf * CFrame.new(0, 14 * scale, 0),
		Color = C(140, 200, 240),
		Material = Enum.Material.Glass,
		Shape = Enum.PartType.Cylinder,
		Transparency = 0.6,
		CanCollide = false,
		Parent = parent,
		Name = "GlassRing",
	})
	local _ = ring
end

kinds.Smokestack = function(cf, scale, color, parent)
	box(
		cf * CFrame.new(0, 25 * scale, 0),
		Vector3.new(10, 50, 10) * scale,
		color or C(90, 100, 120),
		Enum.Material.Metal,
		parent,
		"Stack"
	)
	box(
		cf * CFrame.new(0, 51 * scale, 0),
		Vector3.new(12, 2, 12) * scale,
		C(200, 60, 40),
		Enum.Material.Metal,
		parent,
		"StackRing"
	)
end

kinds.IceSpire = function(cf, scale, _color, parent)
	PartUtil.Wedge(
		Vector3.new(8, 34, 10) * scale,
		cf * CFrame.new(0, 17 * scale, 0),
		C(200, 235, 255),
		Enum.Material.Ice,
		parent
	)
end

kinds.FurnaceGlow = function(cf, scale, color, parent)
	local f = box(
		cf * CFrame.new(0, 6 * scale, 0),
		Vector3.new(14, 12, 10) * scale,
		C(70, 60, 60),
		Enum.Material.Metal,
		parent,
		"Furnace"
	)
	local mouth = box(
		cf * CFrame.new(0, 5 * scale, 5.2 * scale),
		Vector3.new(8, 6, 0.5) * scale,
		color or C(255, 120, 40),
		Enum.Material.Neon,
		parent,
		"FurnaceMouth"
	)
	PartUtil.Light(mouth, color or C(255, 120, 40), 40, 2)
	local _ = f
end

kinds.PipeRun = function(cf, scale, _color, parent)
	for i = 0, 3 do
		local p = PartUtil.Part({
			Size = Vector3.new(60, 3, 3) * scale,
			CFrame = cf * CFrame.new(0, 12 * scale + i * 4 * scale, 0),
			Color = C(130, 140, 150),
			Material = Enum.Material.Metal,
			Shape = Enum.PartType.Cylinder,
			Parent = parent,
			Name = "Pipe",
		})
		local _ = p
	end
end

kinds.Dome = function(cf, scale, _color, parent)
	PartUtil.Part({
		Size = Vector3.new(120, 120, 120) * scale,
		CFrame = cf * CFrame.new(0, 10 * scale, 0),
		Color = C(150, 210, 240),
		Material = Enum.Material.Glass,
		Shape = Enum.PartType.Ball,
		Transparency = 0.45,
		Parent = parent,
		Name = "Dome",
	})
	box(
		cf * CFrame.new(0, 2 * scale, 0),
		Vector3.new(130, 4, 130) * scale,
		C(80, 90, 110),
		Enum.Material.Metal,
		parent,
		"DomeBase"
	)
end

kinds.Kelp = function(cf, scale, _color, parent)
	for i = 0, 4 do
		box(
			cf * CFrame.new(i * 3 * scale, 9 * scale, (i % 2) * 3 * scale),
			Vector3.new(1, 18, 1) * scale,
			C(60, 140, 90),
			Enum.Material.Grass,
			parent,
			"Kelp"
		)
	end
end

kinds.Telescope = function(cf, scale, _color, parent)
	local tube = PartUtil.Part({
		Size = Vector3.new(30, 6, 6) * scale,
		CFrame = cf * CFrame.Angles(0, 0, math.rad(35)),
		Color = C(200, 200, 210),
		Material = Enum.Material.Metal,
		Shape = Enum.PartType.Cylinder,
		Parent = parent,
		Name = "Telescope",
	})
	local _ = tube
end

kinds.Skyscraper = function(cf, scale, _color, parent)
	local h = 60 * scale
	local b =
		box(cf * CFrame.new(0, h / 2, 0), Vector3.new(30, h, 30), C(40, 45, 70), Enum.Material.Glass, parent, "Tower")
	for i = 1, math.floor(h / 12) do
		local strip = box(
			cf * CFrame.new(0, i * 12 - 4, 15.2),
			Vector3.new(26, 1.5, 0.4),
			C(120, 200, 255),
			Enum.Material.Neon,
			parent,
			"Window"
		)
		local _ = strip
	end
	local _ = b
end

kinds.Billboard = function(cf, scale, color, parent)
	box(
		cf * CFrame.new(0, 14 * scale, 0),
		Vector3.new(1.5, 28, 1.5) * scale,
		C(60, 60, 70),
		Enum.Material.Metal,
		parent,
		"BillboardPole"
	)
	local face = box(
		cf * CFrame.new(0, 30 * scale, 0),
		Vector3.new(24, 10, 1) * scale,
		color or C(255, 80, 200),
		Enum.Material.Neon,
		parent,
		"Billboard"
	)
	PartUtil.Light(face, color or C(255, 80, 200), 50, 2)
end

kinds.RailPylon = function(cf, scale, _color, parent)
	box(
		cf * CFrame.new(-30 * scale, 15 * scale, 0),
		Vector3.new(3, 30, 3) * scale,
		C(90, 90, 110),
		Enum.Material.Metal,
		parent,
		"Pylon"
	)
	box(
		cf * CFrame.new(30 * scale, 15 * scale, 0),
		Vector3.new(3, 30, 3) * scale,
		C(90, 90, 110),
		Enum.Material.Metal,
		parent,
		"Pylon"
	)
	box(
		cf * CFrame.new(0, 31 * scale, 0),
		Vector3.new(63, 2, 4) * scale,
		C(200, 120, 255),
		Enum.Material.Neon,
		parent,
		"RailBeam"
	)
end

kinds.MoonDisc = function(cf, scale, _color, parent)
	local m = PartUtil.Part({
		Size = Vector3.new(4, 180, 180) * scale,
		CFrame = cf * CFrame.Angles(0, 0, math.rad(90)),
		Color = C(230, 230, 200),
		Material = Enum.Material.Neon,
		Shape = Enum.PartType.Cylinder,
		CanCollide = false,
		Parent = parent,
		Name = "Moon",
	})
	m.CastShadow = false
end

function DecorBuilder.Build(
	kind: string,
	cf: CFrame,
	scale: number,
	color: Color3?,
	parent: Instance,
	atm: TrackDefinitions.Atmosphere
): boolean
	local fn = kinds[kind]
	if not fn then
		warn("[DecorBuilder] unknown decor kind " .. kind)
		return false
	end
	fn(cf, scale, color, parent, atm)
	return true
end

DecorBuilder.Kinds = kinds

return DecorBuilder
