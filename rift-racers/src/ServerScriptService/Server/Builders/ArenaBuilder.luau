--!strict
-- Builds a battle arena model from an ArenaRuntime.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local SurfaceDefinitions = require(Shared.Config.SurfaceDefinitions)
local PartUtil = require(script.Parent.PartUtil)

local ArenaBuilder = {}

export type Built = { Model: Model, Origin: Vector3, Moving: { any }, Gates: { [string]: { BasePart } }, Runtime: any }

function ArenaBuilder.Build(rt: any, origin: Vector3, parent: Instance): Built
	local def = rt.Def
	local model = Instance.new("Model")
	model.Name = "Arena_" .. def.Id
	local road = PartUtil.Folder("Road", model)
	local walls = PartUtil.Folder("Walls", model)
	PartUtil.Folder("Checkpoints", model)
	PartUtil.Folder("ItemPads", model)
	local decor = PartUtil.Folder("Decor", model)
	local floorSurf = SurfaceDefinitions[def.FloorSurface] or SurfaceDefinitions.Asphalt
	local atm = def.Atmosphere
	local size = def.Radius * 2 + 20
	local floor = PartUtil.Part({
		Size = Vector3.new(size, 2, size),
		CFrame = CFrame.new(origin + Vector3.new(0, -1, 0)),
		Color = floorSurf.Color,
		Material = floorSurf.Material,
		Name = "Floor",
		Tags = { "Road", floorSurf.Tag },
		Parent = road,
		CanQuery = true,
	})
	floor:SetAttribute("Surface", def.FloorSurface)
	for _, patch in def.SurfacePatches do
		local s = SurfaceDefinitions[patch.Surface] or SurfaceDefinitions.Asphalt
		local p = PartUtil.Part({
			Size = Vector3.new(patch.Size.X, 0.4, patch.Size.Z),
			CFrame = CFrame.new(origin + patch.Position + Vector3.new(0, 0.2, 0)),
			Color = s.Color,
			Material = s.Material,
			Name = "Patch",
			Tags = { "Road", s.Tag },
			Parent = road,
			CanQuery = true,
		})
		p:SetAttribute("Surface", patch.Surface)
	end
	-- Perimeter walls
	if def.Shape == "Bowl" then
		local segments = 36
		for i = 0, segments - 1 do
			local a = (i / segments) * math.pi * 2
			local pos = origin + Vector3.new(math.cos(a) * def.Radius, 4, math.sin(a) * def.Radius)
			local cf = CFrame.lookAt(pos, origin + Vector3.new(0, 4, 0))
			PartUtil.Part({
				Size = Vector3.new(def.Radius * 2 * math.pi / segments + 1, 8, 2),
				CFrame = cf,
				Color = atm.WallColor,
				Material = Enum.Material.Glass,
				Transparency = 0.3,
				Name = "BowlWall",
				Tags = { "Wall", "RiftWall" },
				Parent = walls,
				CanQuery = true,
			})
		end
	else
		for _, side in { Vector3.new(1, 0, 0), Vector3.new(-1, 0, 0), Vector3.new(0, 0, 1), Vector3.new(0, 0, -1) } do
			local pos = origin + side * def.Radius + Vector3.new(0, 4, 0)
			local cf = CFrame.lookAt(pos, origin + Vector3.new(0, 4, 0))
			PartUtil.Part({
				Size = Vector3.new(def.Radius * 2 + 4, 8, 2),
				CFrame = cf,
				Color = atm.WallColor,
				Material = Enum.Material.Metal,
				Name = "YardWall",
				Tags = { "Wall", "RiftWall" },
				Parent = walls,
				CanQuery = true,
			})
		end
	end
	for _, ob in def.Obstacles do
		local color = ob.Color or Color3.fromRGB(120, 120, 140)
		local mat = if ob.Kind == "Crystal"
			then Enum.Material.Glass
			elseif ob.Kind == "TirePile" then Enum.Material.Rubber
			else Enum.Material.Metal
		local p = PartUtil.Part({
			Size = ob.Size,
			CFrame = CFrame.new(origin + ob.Position),
			Color = color,
			Material = mat,
			Name = ob.Kind,
			Tags = { "Wall", "Obstacle" },
			Parent = decor,
			CanQuery = true,
		})
		if ob.Kind == "Crystal" then
			p.Transparency = 0.25
			PartUtil.Light(p, color, 30, 1.2)
		end
	end
	model:SetAttribute("ArenaId", def.Id)
	model:SetAttribute("Origin", origin)
	model.Parent = parent
	return { Model = model, Origin = origin, Moving = {}, Gates = {}, Runtime = rt }
end

return ArenaBuilder
