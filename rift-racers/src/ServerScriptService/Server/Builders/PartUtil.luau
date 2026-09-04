--!strict
-- Small helpers for procedural geometry. Every part created here is anchored, non-scripted and tagged by purpose.
local CollectionService = game:GetService("CollectionService")

local PartUtil = {}

export type PartOpts = {
	Size: Vector3,
	CFrame: CFrame,
	Color: Color3?,
	Material: Enum.Material?,
	Transparency: number?,
	CanCollide: boolean?,
	Shape: Enum.PartType?,
	Name: string?,
	Tags: { string }?,
	CanQuery: boolean?,
	CanTouch: boolean?,
	Parent: Instance?,
	Reflectance: number?,
}

function PartUtil.Part(opts: PartOpts): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.Size = opts.Size
	p.CFrame = opts.CFrame
	p.Color = opts.Color or Color3.fromRGB(120, 120, 130)
	p.Material = opts.Material or Enum.Material.SmoothPlastic
	p.Transparency = opts.Transparency or 0
	p.CanCollide = if opts.CanCollide == nil then true else opts.CanCollide
	p.CanQuery = if opts.CanQuery == nil then p.CanCollide else opts.CanQuery
	p.CanTouch = if opts.CanTouch == nil then false else opts.CanTouch
	p.CastShadow = opts.Size.Magnitude > 6
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	if opts.Shape then
		p.Shape = opts.Shape
	end
	if opts.Reflectance then
		p.Reflectance = opts.Reflectance
	end
	p.Name = opts.Name or "Part"
	if opts.Tags then
		for _, t in opts.Tags do
			CollectionService:AddTag(p, t)
		end
	end
	if opts.Parent then
		p.Parent = opts.Parent
	end
	return p
end

function PartUtil.Wedge(
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	material: Enum.Material?,
	parent: Instance?
): WedgePart
	local w = Instance.new("WedgePart")
	w.Anchored = true
	w.Size = size
	w.CFrame = cframe
	w.Color = color
	w.Material = material or Enum.Material.SmoothPlastic
	w.TopSurface = Enum.SurfaceType.Smooth
	w.BottomSurface = Enum.SurfaceType.Smooth
	w.CanTouch = false
	if parent then
		w.Parent = parent
	end
	return w
end

function PartUtil.Folder(name: string, parent: Instance): Folder
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = parent
	return f
end

function PartUtil.Light(parent: BasePart, color: Color3, range: number, brightness: number)
	local l = Instance.new("PointLight")
	l.Color = color
	l.Range = range
	l.Brightness = brightness
	l.Shadows = false
	l.Parent = parent
end

function PartUtil.Weld(a: BasePart, b: BasePart, c0: CFrame?): Weld
	local w = Instance.new("Weld")
	w.Part0 = a
	w.Part1 = b
	w.C0 = c0 or CFrame.new()
	w.Parent = a
	return w
end

return PartUtil
