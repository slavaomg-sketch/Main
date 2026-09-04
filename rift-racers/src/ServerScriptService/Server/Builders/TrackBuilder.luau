--!strict
-- Builds a TrackModel (Instances) from a TrackRuntime: road segments, walls, jumps, checkpoints, pads, shards,
-- shortcuts, hazards, moving elements and decor. Everything is anchored and tagged; nothing here has scripts.
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local SurfaceDefinitions = require(Shared.Config.SurfaceDefinitions)
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local PartUtil = require(script.Parent.PartUtil)
local DecorBuilder = require(script.Parent.DecorBuilder)
local TrackRuntime = require(script.Parent.Parent.Systems.TrackRuntime)

local TrackBuilder = {}

local SEGMENT_LENGTH = 12
local WALL_HEIGHT = 5
local WALL_THICKNESS = 1.5

export type Built = { Model: Model, Origin: Vector3, Moving: { { Part: BasePart, Def: TrackDefinitions.MovingElement, Base: CFrame } }, Gates: { [string]: { BasePart } }, Runtime: TrackRuntime.TrackRuntime }

local function surfaceFor(id: string)
	return SurfaceDefinitions[id] or SurfaceDefinitions.Asphalt
end

local function buildRoad(rt: TrackRuntime.TrackRuntime, origin: Vector3, roadFolder: Folder, wallFolder: Folder, atm: TrackDefinitions.Atmosphere)
	local spline = rt.Spline
	local length = spline.Length
	local count = math.ceil(length / SEGMENT_LENGTH)
	local def = rt.Def
	-- Precompute gap ranges (jumps).
	local gaps: { { From: number, To: number } } = {}
	for _, j in def.Jumps do
		local from = spline:FractionToDistance(j.At)
		table.insert(gaps, { From = from, To = from + j.GapLength })
	end
	local function inGap(d: number): boolean
		for _, g in gaps do
			if d > g.From and d < g.To then
				return true
			end
		end
		return false
	end
	for i = 0, count - 1 do
		local d0 = i * SEGMENT_LENGTH
		local d1 = math.min(length, d0 + SEGMENT_LENGTH)
		local mid = (d0 + d1) / 2
		if inGap(mid) then
			continue
		end
		local p0, tan0 = spline:SampleAt(d0)
		local p1 = spline:PositionAt(d1)
		local width = rt:WidthAt(mid)
		local surfId = rt:SurfaceAt(mid)
		local surf = surfaceFor(surfId)
		local segLen = (p1 - p0).Magnitude + 0.6
		local center = (p0 + p1) / 2 + origin
		local look = if (p1 - p0).Magnitude > 1e-3 then (p1 - p0).Unit else tan0
		local cf = CFrame.lookAt(center, center + look)
		local part = PartUtil.Part({
			Size = Vector3.new(width, 1, segLen),
			CFrame = cf * CFrame.new(0, -0.5, 0),
			Color = surf.Color,
			Material = surf.Material,
			Name = "Road_" .. i,
			Tags = { "Road", surf.Tag },
			Parent = roadFolder,
			CanQuery = true,
		})
		part:SetAttribute("Surface", surfId)
		part:SetAttribute("Progress", mid)
		if surf.BoostPad or surf.Id == "EnergyLane" or surf.Id == "MagRail" then
			PartUtil.Light(part, surf.Color, width, 1)
		end
		-- Lane markings every other segment for readability.
		if i % 2 == 0 and not surf.BoostPad then
			PartUtil.Part({ Size = Vector3.new(0.6, 0.15, segLen * 0.5), CFrame = cf * CFrame.new(0, 0.08, 0), Color = Color3.fromRGB(240, 240, 250), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Name = "Lane", Parent = roadFolder })
		end
		-- Walls
		for _, side in { -1, 1 } do
			local wallCf = cf * CFrame.new(side * (width / 2 + WALL_THICKNESS / 2), WALL_HEIGHT / 2 - 0.5, 0)
			local wall = PartUtil.Part({
				Size = Vector3.new(WALL_THICKNESS, WALL_HEIGHT, segLen + 1.2),
				CFrame = wallCf,
				Color = atm.WallColor,
				Material = Enum.Material.SmoothPlastic,
				Name = "Wall",
				Tags = { "Wall", "RiftWall" },
				Parent = wallFolder,
				CanQuery = true,
			})
			if atm.Glow then
				local strip = PartUtil.Part({ Size = Vector3.new(0.3, 0.6, segLen + 1.2), CFrame = wallCf * CFrame.new(-side * (WALL_THICKNESS / 2 + 0.1), WALL_HEIGHT / 2 - 0.4, 0), Color = Color3.fromRGB(80, 220, 255), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Name = "WallStrip", Parent = wallFolder })
				strip.CastShadow = false
			end
			local _ = wall
		end
	end
	-- Jump ramps and landing pads.
	for _, j in def.Jumps do
		local from = spline:FractionToDistance(j.At)
		local rampLen = 16
		local cf = spline:CFrameAt(from - rampLen / 2, 0, 0)
		local width = rt:WidthAt(from)
		local rise = math.tan(math.rad(j.LaunchPitch)) * rampLen
		local wedge = PartUtil.Wedge(Vector3.new(width, rise, rampLen), (cf + origin) * CFrame.new(0, rise / 2 - 0.5, 0) * CFrame.Angles(0, math.pi, 0), Color3.fromRGB(255, 200, 60), Enum.Material.Neon, roadFolder)
		wedge.Name = "Ramp_" .. j.Id
		CollectionService:AddTag(wedge, "Jump")
		wedge:SetAttribute("JumpId", j.Id)
		wedge:SetAttribute("Trick", j.Trick)
		-- Invisible trigger volume the client uses to know it left a ramp.
		local trigger = PartUtil.Part({ Size = Vector3.new(width, 8, 6), CFrame = (spline:CFrameAt(from + 2, 0, 4) + origin), Transparency = 1, CanCollide = false, CanQuery = true, Name = "JumpTrigger_" .. j.Id, Tags = { "JumpTrigger" }, Parent = roadFolder })
		trigger:SetAttribute("JumpId", j.Id)
		trigger:SetAttribute("Trick", j.Trick)
	end
end

local function buildShortcuts(rt: TrackRuntime.TrackRuntime, origin: Vector3, folder: Folder, atm: TrackDefinitions.Atmosphere): { [string]: { BasePart } }
	local gates: { [string]: { BasePart } } = {}
	for _, sc in rt.Shortcuts do
		local sp = sc.Spline
		local count = math.ceil(sp.Length / SEGMENT_LENGTH)
		local surf = surfaceFor(sc.Def.Surface)
		local parts = {}
		for i = 0, count - 1 do
			local d0 = i * SEGMENT_LENGTH
			local d1 = math.min(sp.Length, d0 + SEGMENT_LENGTH)
			if d1 - d0 < 1 then
				continue
			end
			local p0 = sp:PositionAt(d0)
			local p1 = sp:PositionAt(d1)
			local center = (p0 + p1) / 2 + origin
			local cf = CFrame.lookAt(center, center + (p1 - p0).Unit)
			local part = PartUtil.Part({ Size = Vector3.new(sc.Def.Width, 1, (p1 - p0).Magnitude + 0.6), CFrame = cf * CFrame.new(0, -0.5, 0), Color = surf.Color:Lerp(Color3.fromRGB(255, 255, 255), 0.08), Material = surf.Material, Name = "Shortcut_" .. sc.Def.Id .. "_" .. i, Tags = { "Road", "Shortcut", surf.Tag }, Parent = folder, CanQuery = true })
			part:SetAttribute("Surface", sc.Def.Surface)
			part:SetAttribute("Shortcut", sc.Def.Id)
			-- Low rails (shortcuts are riskier: shorter walls).
			for _, side in { -1, 1 } do
				PartUtil.Part({ Size = Vector3.new(1, 2.5, (p1 - p0).Magnitude + 1), CFrame = cf * CFrame.new(side * (sc.Def.Width / 2 + 0.5), 0.75, 0), Color = atm.WallColor, Material = Enum.Material.Metal, Name = "Rail", Tags = { "Wall" }, Parent = folder, CanQuery = true })
			end
			table.insert(parts, part)
		end
		if sc.Def.Gate then
			local entryCf = sp:CFrameAt(6, 0, 0) + origin
			local gate = PartUtil.Part({ Size = Vector3.new(sc.Def.Width, 10, 2), CFrame = entryCf * CFrame.new(0, 4.5, 0), Color = Color3.fromRGB(255, 90, 40), Material = Enum.Material.Neon, Transparency = 0.35, Name = "Gate_" .. sc.Def.Id, Tags = { "Gate" }, Parent = folder, CanQuery = true })
			gate:SetAttribute("Dynamic", true)
			gates[sc.Def.Id] = { gate }
		end
	end
	return gates
end

local function buildMarkers(rt: TrackRuntime.TrackRuntime, origin: Vector3, folder: Folder)
	for i, d in rt.CheckpointDists do
		local isFinish = i == rt.CheckpointCount
		local cf = rt.Spline:CFrameAt(if isFinish then 0 else d, 0, 0) + origin
		local width = rt:WidthAt(d)
		local marker = PartUtil.Part({ Size = Vector3.new(width, 0.2, 2), CFrame = cf * CFrame.new(0, 0.1, 0), Color = if isFinish then Color3.fromRGB(255, 255, 255) else Color3.fromRGB(80, 220, 255), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Transparency = if isFinish then 0 else 0.6, Name = if isFinish then "FinishLine" else "Checkpoint_" .. i, Tags = { if isFinish then "FinishLine" else "Checkpoint" }, Parent = folder })
		marker:SetAttribute("Index", i)
		if isFinish then
			-- Finish arch
			for _, side in { -1, 1 } do
				PartUtil.Part({ Size = Vector3.new(2, 16, 2), CFrame = cf * CFrame.new(side * (width / 2 + 2), 8, 0), Color = Color3.fromRGB(240, 240, 250), Material = Enum.Material.Metal, Name = "FinishPost", Parent = folder })
			end
			local banner = PartUtil.Part({ Size = Vector3.new(width + 6, 3, 1.5), CFrame = cf * CFrame.new(0, 16, 0), Color = Color3.fromRGB(80, 220, 255), Material = Enum.Material.Neon, Name = "FinishBanner", Parent = folder })
			PartUtil.Light(banner, Color3.fromRGB(80, 220, 255), 60, 2)
		end
	end
	-- Knockout gates markers (visual)
	for i, t in rt.Def.KnockoutGates do
		local d = rt.Spline:FractionToDistance(t)
		local cf = rt.Spline:CFrameAt(d, 0, 0) + origin
		local m = PartUtil.Part({ Size = Vector3.new(rt:WidthAt(d), 0.2, 1.5), CFrame = cf * CFrame.new(0, 0.1, 0), Color = Color3.fromRGB(255, 120, 60), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Transparency = 0.7, Name = "KnockoutGate_" .. i, Tags = { "KnockoutGate" }, Parent = folder })
		m:SetAttribute("Stage", i)
	end
end

local function buildHazards(rt: TrackRuntime.TrackRuntime, origin: Vector3, folder: Folder): { { Part: BasePart, Def: TrackDefinitions.MovingElement, Base: CFrame } }
	local moving = {}
	for _, h in rt.Def.HazardZones do
		local d = rt.Spline:FractionToDistance(h.At)
		local cf = rt.Spline:CFrameAt(d, h.Lateral or 0, 0) + origin
		if h.Kind == "Geyser" then
			local vent = PartUtil.Part({ Size = Vector3.new(8, 0.4, 8), CFrame = cf * CFrame.new(0, 0.2, 0), Color = Color3.fromRGB(255, 120, 40), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Name = "Geyser_" .. h.Id, Tags = { "Hazard", "Geyser" }, Parent = folder })
			vent:SetAttribute("Period", h.Period)
			vent:SetAttribute("Duration", h.Duration)
		elseif h.Kind == "LavaPool" then
			local to = rt.Spline:FractionToDistance(h.To or h.At)
			local len = rt.Spline:Delta(d, to)
			local mid = rt.Spline:CFrameAt(d + len / 2, 0, 0) + origin
			local pool = PartUtil.Part({ Size = Vector3.new(rt:WidthAt(d) * 0.4, 0.3, math.abs(len)), CFrame = mid * CFrame.new(rt:WidthAt(d) * 0.28, 0.1, 0), Color = Color3.fromRGB(255, 90, 30), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Name = "LavaPool_" .. h.Id, Tags = { "Hazard" }, Parent = folder })
			PartUtil.Light(pool, Color3.fromRGB(255, 90, 30), 30, 1)
		elseif h.Kind == "Wind" or h.Kind == "Current" or h.Kind == "Conveyor" then
			local to = rt.Spline:FractionToDistance(h.To or h.At)
			local len = rt.Spline:Delta(d, to)
			local mid = rt.Spline:CFrameAt(d + len / 2, 0, 0) + origin
			local zone = PartUtil.Part({ Size = Vector3.new(rt:WidthAt(d), 6, math.abs(len)), CFrame = mid * CFrame.new(0, 3, 0), Color = Color3.fromRGB(120, 220, 255), Material = Enum.Material.ForceField, Transparency = 0.85, CanCollide = false, CanQuery = false, Name = h.Kind .. "_" .. h.Id, Tags = { "Hazard", h.Kind }, Parent = folder })
			zone:SetAttribute("Force", h.Force)
		end
	end
	for _, m in rt.Def.MovingElements do
		local d = rt.Spline:FractionToDistance(m.At)
		local cf = rt.Spline:CFrameAt(d, m.Lateral, m.Height) + origin
		local part: BasePart
		if m.Kind == "Crane" then
			PartUtil.Part({ Size = Vector3.new(6, m.Height, 6), CFrame = cf * CFrame.new(0, -m.Height / 2, 0), Color = Color3.fromRGB(230, 170, 40), Material = Enum.Material.Metal, Name = "CraneTower", Parent = folder })
			part = PartUtil.Part({ Size = Vector3.new(4, 4, 90), CFrame = cf, Color = Color3.fromRGB(230, 170, 40), Material = Enum.Material.Metal, Name = "CraneArm", CanCollide = false, Parent = folder })
		elseif m.Kind == "Ring" then
			part = PartUtil.Part({ Size = Vector3.new(4, 60, 60) * m.Scale, CFrame = cf, Color = Color3.fromRGB(180, 220, 255), Material = Enum.Material.Glass, Shape = Enum.PartType.Cylinder, Transparency = 0.5, CanCollide = false, Name = "Ring", Parent = folder })
		elseif m.Kind == "Press" then
			part = PartUtil.Part({ Size = Vector3.new(10, 6, 10), CFrame = cf, Color = Color3.fromRGB(160, 170, 190), Material = Enum.Material.Metal, Name = "Press", CanCollide = false, Parent = folder })
			PartUtil.Part({ Size = Vector3.new(3, m.Height + 6, 3), CFrame = cf * CFrame.new(0, 6, 0), Color = Color3.fromRGB(90, 100, 120), Material = Enum.Material.Metal, Name = "PressRod", CanCollide = false, Parent = folder })
		elseif m.Kind == "Bridge" then
			part = PartUtil.Part({ Size = Vector3.new(rt:WidthAt(d) - 2, 1.2, m.Amplitude), CFrame = cf * CFrame.new(0, 0.6, 0), Color = Color3.fromRGB(120, 90, 70), Material = Enum.Material.WoodPlanks, Name = "BridgeDeck", Parent = folder, CanQuery = true })
		elseif m.Kind == "Conveyor" then
			part = PartUtil.Part({ Size = Vector3.new(rt:WidthAt(d) * 0.6, 0.3, 40), CFrame = cf * CFrame.new(0, 0.15, 0), Color = Color3.fromRGB(60, 70, 90), Material = Enum.Material.DiamondPlate, Name = "Conveyor", CanCollide = false, Parent = folder })
		elseif m.Kind == "Rail" then
			part = PartUtil.Part({ Size = Vector3.new(8, 8, 40), CFrame = cf, Color = Color3.fromRGB(220, 220, 240), Material = Enum.Material.Metal, Name = "MonorailTrain", CanCollide = false, Parent = folder })
			PartUtil.Light(part, Color3.fromRGB(200, 120, 255), 40, 1.5)
		else
			part = PartUtil.Part({ Size = Vector3.new(6, 6, 6), CFrame = cf, Color = Color3.fromRGB(200, 200, 200), Name = "Moving", CanCollide = false, Parent = folder })
		end
		part:SetAttribute("Dynamic", true)
		part:SetAttribute("MovingId", m.Id)
		CollectionService:AddTag(part, "Moving")
		table.insert(moving, { Part = part, Def = m, Base = cf })
	end
	return moving
end

local function buildDecor(rt: TrackRuntime.TrackRuntime, origin: Vector3, folder: Folder)
	local atm = rt.Def.Atmosphere
	for _, item in rt.Def.Decor do
		local d = rt.Spline:FractionToDistance(item.At)
		local cf = rt.Spline:CFrameAt(d, if rt.Mirror then -item.Lateral else item.Lateral, item.Height or 0) + origin
		-- Keep decor upright and facing the road.
		cf = CFrame.new(cf.Position) * CFrame.Angles(0, math.atan2(-cf.LookVector.X, -cf.LookVector.Z), 0)
		DecorBuilder.Build(item.Kind, cf, item.Scale, item.Color, folder, atm)
	end
end

function TrackBuilder.Build(rt: TrackRuntime.TrackRuntime, origin: Vector3, parent: Instance): Built
	local model = Instance.new("Model")
	model.Name = "Track_" .. rt.Def.Id
	local road = PartUtil.Folder("Road", model)
	local walls = PartUtil.Folder("Walls", model)
	local checkpoints = PartUtil.Folder("Checkpoints", model)
	local pads = PartUtil.Folder("ItemPads", model)
	local decor = PartUtil.Folder("Decor", model)
	local hazards = PartUtil.Folder("Hazards", model)
	local shortcuts = PartUtil.Folder("Shortcuts", model)
	local atm = rt.Def.Atmosphere
	buildRoad(rt, origin, road, walls, atm)
	local gates = buildShortcuts(rt, origin, shortcuts, atm)
	buildMarkers(rt, origin, checkpoints)
	local moving = buildHazards(rt, origin, hazards)
	buildDecor(rt, origin, decor)
	model:SetAttribute("TrackId", rt.Def.Id)
	model:SetAttribute("ContentVersion", rt.Def.ContentVersion)
	model:SetAttribute("Origin", origin)
	model:SetAttribute("Mirror", rt.Mirror)
	model.Parent = parent
	local _ = pads
	return { Model = model, Origin = origin, Moving = moving, Gates = gates, Runtime = rt }
end

-- Animates moving elements deterministically from the server clock (clients see replicated CFrames).
function TrackBuilder.Update(built: Built, now: number)
	for _, m in built.Moving do
		local d = m.Def
		local phase = (now % d.Period) / d.Period
		local part = m.Part
		if d.Kind == "Crane" then
			part.CFrame = m.Base * CFrame.Angles(0, math.sin(phase * math.pi * 2) * math.rad(d.Amplitude), 0)
		elseif d.Kind == "Ring" then
			part.CFrame = m.Base * CFrame.Angles(phase * math.pi * 2, 0, 0)
		elseif d.Kind == "Press" then
			local down = if phase < 0.2 then phase / 0.2 elseif phase < 0.4 then 1 - (phase - 0.2) / 0.2 else 0
			part.CFrame = m.Base * CFrame.new(0, -d.Amplitude * down, 0)
		elseif d.Kind == "Bridge" then
			local cycle = phase * d.Period
			local collapsed = cycle > d.Period - 4
			part.CFrame = m.Base * CFrame.new(0, if collapsed then -30 else 0.6, 0)
			part.CanCollide = not collapsed
			part.Transparency = if collapsed then 0.7 else 0
		elseif d.Kind == "Rail" then
			part.CFrame = m.Base * CFrame.new(0, 0, (phase - 0.5) * d.Amplitude)
		elseif d.Kind == "Conveyor" then
			-- Static geometry; the surface push is applied by ItemService hazards.
		end
	end
end

function TrackBuilder.SetGate(built: Built, shortcutId: string, open: boolean)
	local parts = built.Gates[shortcutId]
	if not parts then
		return
	end
	for _, p in parts do
		p.CanCollide = not open
		p.Transparency = if open then 0.9 else 0.35
	end
end

return TrackBuilder
