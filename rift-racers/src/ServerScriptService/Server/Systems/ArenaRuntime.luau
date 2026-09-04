--!strict
-- Battle arena model: spawn slots, bounds, pickups, surface patches. Pure data like TrackRuntime.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local TrackDefinitions = require(Shared.Config.TrackDefinitions)

export type ArenaRuntime = {
	Def: TrackDefinitions.ArenaDefinition,
	Radius: number,
	SpawnSlots: (self: ArenaRuntime, count: number) -> { CFrame },
	InBounds: (self: ArenaRuntime, position: Vector3) -> boolean,
	SurfaceAt: (self: ArenaRuntime, position: Vector3) -> string,
	SafeRespawn: (self: ArenaRuntime, position: Vector3) -> CFrame,
	ItemPadPositions: (self: ArenaRuntime) -> { { Position: Vector3, Group: number } },
	ShardPositions: (self: ArenaRuntime) -> { Vector3 },
	InsideObstacle: (self: ArenaRuntime, position: Vector3) -> boolean,
}

local ArenaRuntime = {}
ArenaRuntime.__index = ArenaRuntime

function ArenaRuntime.new(def: TrackDefinitions.ArenaDefinition): ArenaRuntime
	return (setmetatable({ Def = def, Radius = def.Radius }, ArenaRuntime) :: any) :: ArenaRuntime
end

function ArenaRuntime.SpawnSlots(self: any, count: number): { CFrame }
	local out = {}
	local pts = self.Def.SpawnPoints
	for i = 1, count do
		local p = pts[((i - 1) % #pts) + 1]
		local extra = Vector3.new(0, 0, 0)
		if i > #pts then
			extra = Vector3.new(6 * ((i - 1) // #pts), 0, 0)
		end
		local pos = p + extra
		out[i] = CFrame.lookAt(pos, Vector3.new(0, pos.Y, 0))
	end
	return out
end

function ArenaRuntime.InBounds(self: any, position: Vector3): boolean
	local flat = Vector3.new(position.X, 0, position.Z)
	if self.Def.Shape == "Bowl" then
		return flat.Magnitude <= self.Radius and position.Y > -30
	end
	return math.abs(position.X) <= self.Radius and math.abs(position.Z) <= self.Radius and position.Y > -30
end

function ArenaRuntime.SurfaceAt(self: any, position: Vector3): string
	for _, patch in self.Def.SurfacePatches do
		local d = position - patch.Position
		if math.abs(d.X) <= patch.Size.X / 2 and math.abs(d.Z) <= patch.Size.Z / 2 then
			return patch.Surface
		end
	end
	return self.Def.FloorSurface
end

function ArenaRuntime.InsideObstacle(self: any, position: Vector3): boolean
	for _, ob in self.Def.Obstacles do
		local d = position - ob.Position
		if math.abs(d.X) < ob.Size.X / 2 + 2 and math.abs(d.Z) < ob.Size.Z / 2 + 2 and math.abs(d.Y) < ob.Size.Y then
			return true
		end
	end
	return false
end

function ArenaRuntime.SafeRespawn(self: any, position: Vector3): CFrame
	local best, bestD = self.Def.SpawnPoints[1], math.huge
	for _, sp in self.Def.SpawnPoints do
		local d = (sp - position).Magnitude
		if d < bestD then
			best, bestD = sp, d
		end
	end
	return CFrame.lookAt(best + Vector3.new(0, 1, 0), Vector3.new(0, best.Y + 1, 0))
end

function ArenaRuntime.ItemPadPositions(self: any): { { Position: Vector3, Group: number } }
	local out = {}
	for i, p in self.Def.ItemPads do
		table.insert(out, { Position = p, Group = i })
	end
	return out
end

function ArenaRuntime.ShardPositions(self: any): { Vector3 }
	return table.clone(self.Def.ShardSpawns)
end

return ArenaRuntime
