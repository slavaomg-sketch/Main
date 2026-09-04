--!strict
-- Stylised seated hero figure built from primitives, coloured by HeroCosmetics. Poses are simple CFrame offsets
-- (see HeroBuilder.Poses) so the client can animate selection/emotes without external animation assets.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local HeroDefinitions = require(Shared.Config.HeroDefinitions)

local HeroBuilder = {}

local function part(name: string, size: Vector3, color: Color3, material: Enum.Material, shape: Enum.PartType?): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Color = color
	p.Material = material
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
	return p
end

-- Builds the figure welded to `root` (a chassis or a lobby pedestal). Returns the figure model.
function HeroBuilder.Build(
	hero: HeroDefinitions.HeroDefinition,
	cframe: CFrame,
	root: BasePart,
	parent: Instance
): Model
	local c = hero.Cosmetics
	local model = Instance.new("Model")
	model.Name = "Hero_" .. hero.Id
	local pieces: { { P: Part, C: CFrame } } = {}
	local torso = part("Torso", Vector3.new(1.6, 1.6, 0.9), c.PrimaryColor, Enum.Material.SmoothPlastic)
	table.insert(pieces, { P = torso, C = CFrame.new(0, 0.8, 0) })
	local head: Part
	if c.HeadShape == "Round" then
		head =
			part("Head", Vector3.new(1.2, 1.2, 1.2), c.SecondaryColor, Enum.Material.SmoothPlastic, Enum.PartType.Ball)
	elseif c.HeadShape == "Dome" then
		head = part("Head", Vector3.new(1.2, 1.1, 1.2), c.SecondaryColor, Enum.Material.Glass, Enum.PartType.Ball)
	elseif c.HeadShape == "Block" then
		head = part("Head", Vector3.new(1.1, 1.1, 1.0), c.SecondaryColor, Enum.Material.Metal)
	else
		head = part("Head", Vector3.new(1.1, 1.2, 1.1), c.SecondaryColor, Enum.Material.SmoothPlastic)
	end
	table.insert(pieces, { P = head, C = CFrame.new(0, 2.3, 0) })
	if c.HeadShape == "Visor" then
		table.insert(
			pieces,
			{
				P = part("Visor", Vector3.new(1.0, 0.4, 0.2), c.AccentColor, Enum.Material.Neon),
				C = CFrame.new(0, 2.35, -0.55),
			}
		)
	else
		table.insert(
			pieces,
			{
				P = part("Eyes", Vector3.new(0.8, 0.2, 0.15), c.AccentColor, Enum.Material.Neon),
				C = CFrame.new(0, 2.4, -0.55),
			}
		)
	end
	table.insert(
		pieces,
		{
			P = part("ArmL", Vector3.new(0.4, 1.2, 0.4), c.PrimaryColor, Enum.Material.SmoothPlastic),
			C = CFrame.new(-1.0, 1.1, -0.3) * CFrame.Angles(math.rad(-50), 0, 0),
		}
	)
	table.insert(
		pieces,
		{
			P = part("ArmR", Vector3.new(0.4, 1.2, 0.4), c.PrimaryColor, Enum.Material.SmoothPlastic),
			C = CFrame.new(1.0, 1.1, -0.3) * CFrame.Angles(math.rad(-50), 0, 0),
		}
	)
	table.insert(
		pieces,
		{
			P = part("LegL", Vector3.new(0.5, 1.1, 0.5), c.SecondaryColor, Enum.Material.SmoothPlastic),
			C = CFrame.new(-0.45, 0.1, -0.5) * CFrame.Angles(math.rad(-80), 0, 0),
		}
	)
	table.insert(
		pieces,
		{
			P = part("LegR", Vector3.new(0.5, 1.1, 0.5), c.SecondaryColor, Enum.Material.SmoothPlastic),
			C = CFrame.new(0.45, 0.1, -0.5) * CFrame.Angles(math.rad(-80), 0, 0),
		}
	)
	-- Accessory silhouette (kept tiny and readable).
	local acc: Part? = nil
	local accCf = CFrame.new(0, 2.95, 0)
	local a = c.Accessory
	if a == "Goggles" or a == "DiveMask" then
		acc = part("Accessory", Vector3.new(1.2, 0.35, 0.5), c.AccentColor, Enum.Material.Glass)
		accCf = CFrame.new(0, 2.7, -0.35)
	elseif a == "Antenna" then
		acc = part("Accessory", Vector3.new(0.15, 0.9, 0.15), c.AccentColor, Enum.Material.Neon)
		accCf = CFrame.new(0.3, 3.3, 0)
	elseif a == "FeatherCap" or a == "FurHood" or a == "PilotScarf" then
		acc = part("Accessory", Vector3.new(1.3, 0.35, 1.3), c.AccentColor, Enum.Material.Fabric)
	elseif a == "ToolBelt" then
		acc = part("Accessory", Vector3.new(1.7, 0.3, 1.0), c.AccentColor, Enum.Material.Leather)
		accCf = CFrame.new(0, 0.2, 0)
	elseif a == "CourierSatchel" then
		acc = part("Accessory", Vector3.new(0.6, 0.7, 0.3), c.AccentColor, Enum.Material.Leather)
		accCf = CFrame.new(0.9, 0.9, 0.5)
	end
	if acc then
		table.insert(pieces, { P = acc :: Part, C = accCf })
	end
	for _, entry in pieces do
		local p, offset = entry.P, entry.C
		p.CFrame = cframe * offset
		p.Parent = model
		local w = Instance.new("Weld")
		w.Name = "PoseWeld"
		w.Part0 = root
		w.Part1 = p
		w.C0 = root.CFrame:ToObjectSpace(cframe) * offset
		w.Parent = p
		p:SetAttribute("PoseOffset", offset)
	end
	model:SetAttribute("HeroId", hero.Id)
	model:SetAttribute("Pose", c.IdlePose)
	model.Parent = parent
	return model
end

-- Named pose deltas applied by the client (rotation about the torso) for selection/emotes.
HeroBuilder.Poses = table.freeze({
	PoseReady = { Head = CFrame.Angles(0, 0, 0) },
	PoseTinker = { Head = CFrame.Angles(math.rad(10), math.rad(15), 0) },
	PoseSturdy = { Head = CFrame.Angles(math.rad(-5), 0, 0) },
	PoseCalm = { Head = CFrame.Angles(math.rad(5), 0, 0) },
	PoseLean = { Head = CFrame.Angles(0, math.rad(-12), math.rad(6)) },
	PoseScan = { Head = CFrame.Angles(0, math.rad(20), 0) },
	PoseGuard = { Head = CFrame.Angles(math.rad(-8), 0, 0) },
	PoseGlide = { Head = CFrame.Angles(math.rad(8), 0, math.rad(-8)) },
})

return HeroBuilder
