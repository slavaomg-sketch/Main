--!strict
-- Server-side geometric model of a track built from its TrackDefinition: main spline, checkpoints, shortcuts,
-- surface lookup, grid slots and safe respawn points. Pure data (no Instances) so it runs in tests and drives
-- the TrackBuilder, progress tracking, bots and validation identically.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Spline = require(Shared.Utility.Spline)
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local SurfaceDefinitions = require(Shared.Config.SurfaceDefinitions)
local GameConfig = require(Shared.Config.GameConfig)
local VehicleDefinitions = require(Shared.Config.VehicleDefinitions)

type TrackDefinition = TrackDefinitions.TrackDefinition

export type ShortcutRuntime = {
	Def: TrackDefinitions.ShortcutDefinition,
	Spline: Spline.Spline,
	EntryDist: number,
	ExitDist: number,
	GateOpen: boolean,
}

export type Location = { Progress: number, Lateral: number, Offset: number, OnShortcut: string?, InCorridor: boolean, Surface: string, Width: number }

export type TrackRuntime = {
	Def: TrackDefinition,
	Spline: Spline.Spline,
	Length: number,
	Mirror: boolean,
	CheckpointCount: number,
	CheckpointDists: { number },
	Shortcuts: { ShortcutRuntime },
	Locate: (self: TrackRuntime, position: Vector3, hint: number?) -> Location,
	WidthAt: (self: TrackRuntime, dist: number) -> number,
	SurfaceAt: (self: TrackRuntime, dist: number) -> string,
	GridSlots: (self: TrackRuntime, count: number) -> { CFrame },
	SafeRespawn: (self: TrackRuntime, progress: number) -> (CFrame, number),
	ItemPadPositions: (self: TrackRuntime) -> { { Position: Vector3, Group: number } },
	ShardPositions: (self: TrackRuntime) -> { Vector3 },
	JumpAt: (self: TrackRuntime, dist: number) -> TrackDefinitions.JumpDefinition?,
	HazardsAt: (self: TrackRuntime, dist: number, lateral: number) -> { TrackDefinitions.HazardZone },
	MinSectorTime: (self: TrackRuntime, speedCap: number) -> number,
	SetGate: (self: TrackRuntime, shortcutId: string, open: boolean) -> (),
	KnockoutGateDists: (self: TrackRuntime) -> { number },
}

local TrackRuntime = {}
TrackRuntime.__index = TrackRuntime

local function mirrorPoints(points: { Vector3 }): { Vector3 }
	local out = table.create(#points)
	for i, p in points do
		out[i] = Vector3.new(-p.X, p.Y, p.Z)
	end
	return out
end

function TrackRuntime.new(def: TrackDefinition, mirror: boolean?): TrackRuntime
	local useMirror = (mirror == true) and def.MirrorSupport
	local path: { Vector3 } = if useMirror then mirrorPoints(def.Path) else def.Path
	local spline = Spline.new(path, def.Scale, true, 18)
	local n = def.CheckpointCount
	local dists = table.create(n)
	for i = 1, n do
		dists[i] = spline.Length * (i / n) -- checkpoint n == finish line (dist == Length == 0)
	end
	local shortcuts: { ShortcutRuntime } = {}
	for _, sc in def.Shortcuts do
		local scPath: { Vector3 } = if useMirror then mirrorPoints(sc.Path) else sc.Path
		-- Anchor shortcut ends to the main path so the geometry connects.
		local entryDist = spline:FractionToDistance(sc.EntryT)
		local exitDist = spline:FractionToDistance(sc.ExitT)
		local pts: { Vector3 } = { spline:PositionAt(entryDist) / def.Scale }
		for _, p in scPath do
			table.insert(pts, p)
		end
		table.insert(pts, spline:PositionAt(exitDist) / def.Scale)
		table.insert(shortcuts, { Def = sc, Spline = Spline.new(pts, def.Scale, false, 14), EntryDist = entryDist, ExitDist = exitDist, GateOpen = true })
	end
	local self = setmetatable({
		Def = def,
		Spline = spline,
		Length = spline.Length,
		Mirror = useMirror,
		CheckpointCount = n,
		CheckpointDists = dists,
		Shortcuts = shortcuts,
	}, TrackRuntime)
	return (self :: any) :: TrackRuntime
end

function TrackRuntime.WidthAt(self: any, dist: number): number
	local t = self.Spline:DistanceToFraction(dist)
	for _, o in self.Def.WidthOverrides do
		if t >= o.From and t < o.To then
			return o.Width
		end
	end
	return self.Def.Width
end

function TrackRuntime.SurfaceAt(self: any, dist: number): string
	local t = self.Spline:DistanceToFraction(dist)
	local result = "Asphalt"
	for _, z in self.Def.SurfaceZones do
		if t >= z.From and t < z.To then
			-- Later zones override earlier ones; BoostPads are narrow and win.
			if SurfaceDefinitions[z.Surface] then
				result = z.Surface
			end
		end
	end
	return result
end

function TrackRuntime.JumpAt(self: any, dist: number): TrackDefinitions.JumpDefinition?
	local t = self.Spline:DistanceToFraction(dist)
	for _, j in self.Def.Jumps do
		local span = (j.GapLength + 20) / self.Length
		if t >= j.At - 0.004 and t <= j.At + span then
			return j
		end
	end
	return nil
end

function TrackRuntime.HazardsAt(self: any, dist: number, lateral: number): { TrackDefinitions.HazardZone }
	local t = self.Spline:DistanceToFraction(dist)
	local out = {}
	for _, h in self.Def.HazardZones do
		local from = h.At
		local to = h.To or (h.At + 18 / self.Length)
		if t >= from and t <= to then
			if h.Lateral ~= nil then
				if math.abs(lateral - h.Lateral) <= 7 then
					table.insert(out, h)
				end
			else
				table.insert(out, h)
			end
		end
	end
	return out
end

-- Locates a world position on the track (main path or a shortcut) and reports whether it is inside the corridor.
function TrackRuntime.Locate(self: any, position: Vector3, hint: number?): Location
	local progress, lateral, offset = self.Spline:ClosestProgress(position, hint, 40)
	local width = TrackRuntime.WidthAt(self, progress)
	local corridor = width * GameConfig.Race.TrackCorridorWidthMultiplier
	local vertical = math.abs((position - self.Spline:PositionAt(progress)).Y)
	local onMain = math.abs(lateral) <= width * 0.75 + 4 and vertical < GameConfig.Security.MaxHeightAbovePath
	if not onMain then
		-- Try shortcuts whose span covers this progress.
		for _, sc in self.Shortcuts do
			local spanStart, spanEnd = sc.EntryDist - 40, sc.ExitDist + 40
			local inSpan = if spanStart <= spanEnd then progress >= spanStart and progress <= spanEnd else (progress >= spanStart or progress <= spanEnd)
			if inSpan or hint ~= nil then
				local sp, sl, so = sc.Spline:ClosestProgress(position, nil)
				if math.abs(sl) <= sc.Def.Width * 0.75 + 4 and so < sc.Def.Width * 1.5 then
					local frac = sp / math.max(1, sc.Spline.Length)
					local span = self.Spline:Delta(sc.EntryDist, sc.ExitDist)
					if span < 0 then
						span += self.Length
					end
					local mapped = self.Spline:Wrap(sc.EntryDist + span * frac)
					return { Progress = mapped, Lateral = sl, Offset = so, OnShortcut = sc.Def.Id, InCorridor = true, Surface = sc.Def.Surface, Width = sc.Def.Width }
				end
			end
		end
	end
	return {
		Progress = progress,
		Lateral = lateral,
		Offset = offset,
		OnShortcut = nil,
		InCorridor = math.abs(lateral) <= corridor and vertical < GameConfig.Security.MaxHeightAbovePath,
		Surface = if onMain then TrackRuntime.SurfaceAt(self, progress) else "Dirt",
		Width = width,
	}
end

-- Start grid: slots placed behind the finish line, staggered in rows.
function TrackRuntime.GridSlots(self: any, count: number): { CFrame }
	local slots = {}
	local cols = math.max(1, self.Def.GridColumns)
	local width = TrackRuntime.WidthAt(self, 0)
	local spacing = math.min(9, width / (cols + 1))
	for i = 1, count do
		local row = (i - 1) // cols
		local col = (i - 1) % cols
		local lateral = (col - (cols - 1) / 2) * spacing * 1.6
		local back = 14 + row * 11 + (col % 2) * 4
		table.insert(slots, self.Spline:CFrameAt(-back, lateral, 3))
	end
	return slots
end

-- Nearest safe respawn: a checkpoint or grid line at/behind the given progress, centred on the road.
function TrackRuntime.SafeRespawn(self: any, progress: number): (CFrame, number)
	local best = 0
	for _, d in self.CheckpointDists do
		if d <= progress + 1 and d < self.Length then
			best = math.max(best, d)
		end
	end
	local respawnDist = self.Spline:Wrap(best - 6)
	-- Make sure we do not drop the racer inside a jump gap.
	local jump = TrackRuntime.JumpAt(self, respawnDist)
	if jump then
		respawnDist = self.Spline:Wrap(self.Spline:FractionToDistance(jump.At) - 30)
	end
	return self.Spline:CFrameAt(respawnDist, 0, 4), respawnDist
end

function TrackRuntime.ItemPadPositions(self: any): { { Position: Vector3, Group: number } }
	local out = {}
	for gi, g in self.Def.ItemSpawnGroups do
		local d = self.Spline:FractionToDistance(g.At)
		for _, lat in g.Lateral do
			local cf = self.Spline:CFrameAt(d, if self.Mirror then -lat else lat, 2)
			table.insert(out, { Position = cf.Position, Group = gi })
		end
	end
	return out
end

function TrackRuntime.ShardPositions(self: any): { Vector3 }
	local out = {}
	for _, g in self.Def.ShardGroups do
		local d = self.Spline:FractionToDistance(g.At)
		for i = 1, g.Count do
			local cf = self.Spline:CFrameAt(d + (i - 1) * g.Spacing, if self.Mirror then -g.Lateral else g.Lateral, 2.5)
			table.insert(out, cf.Position)
		end
	end
	return out
end

-- Impossible-sector floor: the shortest sector can't be driven faster than the global speed cap allows.
function TrackRuntime.MinSectorTime(self: any, speedCap: number): number
	local sector = self.Length / self.CheckpointCount
	-- Shortcuts may shorten a sector; use the shortest possible mapped span.
	local shortest = sector
	for _, sc in self.Shortcuts do
		local mainSpan = self.Spline:Delta(sc.EntryDist, sc.ExitDist)
		if mainSpan < 0 then
			mainSpan += self.Length
		end
		local ratio = sc.Spline.Length / math.max(1, mainSpan)
		shortest = math.min(shortest, sector * ratio)
	end
	return (shortest / speedCap) * GameConfig.Race.MinSectorTimeFactor
end

function TrackRuntime.SetGate(self: any, shortcutId: string, open: boolean)
	for _, sc in self.Shortcuts do
		if sc.Def.Id == shortcutId then
			sc.GateOpen = open
		end
	end
end

function TrackRuntime.KnockoutGateDists(self: any): { number }
	local out = {}
	for _, t in self.Def.KnockoutGates do
		table.insert(out, self.Spline:FractionToDistance(t))
	end
	return out
end

-- Global maximum plausible speed across the roster (used by MinSectorTime callers).
function TrackRuntime.GlobalSpeedCap(speedClassScale: number): number
	local best = 0
	for _, v in VehicleDefinitions.List do
		best = math.max(best, v.Physics.TopSpeed)
	end
	return best * speedClassScale * GameConfig.Physics.BoostSpeedCapFraction * GameConfig.Security.SpeedTolerance
end

return TrackRuntime
