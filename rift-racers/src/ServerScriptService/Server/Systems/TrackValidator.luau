--!strict
-- Validates TrackDefinitions (data) and optionally a built TrackModel (Instances) before a track is used.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local TrackDefinitions = require(Shared.Config.TrackDefinitions)
local SurfaceDefinitions = require(Shared.Config.SurfaceDefinitions)
local ModeDefinitions = require(Shared.Config.ModeDefinitions)
local TrackRuntime = require(script.Parent.TrackRuntime)

export type Issue = { Severity: "Error" | "Warning", Code: string, Message: string }
export type Report = { TrackId: string, Ok: boolean, Issues: { Issue }, LapLength: number?, Checkpoints: number? }

local TrackValidator = {}

local function issue(list: { Issue }, severity: "Error" | "Warning", code: string, message: string)
	table.insert(list, { Severity = severity, Code = code, Message = message })
end

local function inRange(t: number): boolean
	return t >= 0 and t < 1
end

function TrackValidator.ValidateDefinition(def: TrackDefinitions.TrackDefinition): Report
	local issues: { Issue } = {}
	if def.Id == nil or def.Id == "" then
		issue(issues, "Error", "MissingId", "track has no Id")
	end
	if def.NameKey == nil or def.ContentVersion == nil then
		issue(issues, "Error", "MissingMetadata", "NameKey/ContentVersion missing")
	end
	if #def.Path < 6 then
		issue(issues, "Error", "PathTooShort", "path needs at least 6 control points")
	end
	if def.CheckpointCount < 4 then
		issue(issues, "Error", "TooFewCheckpoints", "need >= 4 checkpoints")
	end
	if def.GridRows * def.GridColumns < 12 then
		issue(issues, "Error", "GridTooSmall", "grid must seat 12 racers")
	end
	if def.Width < 16 then
		issue(issues, "Error", "TooNarrow", "width < 16")
	end
	for _, z in def.SurfaceZones do
		if not SurfaceDefinitions[z.Surface] then
			issue(issues, "Error", "UnknownSurface", "surface " .. z.Surface)
		end
		if not (inRange(z.From) and z.To <= 1 and z.From < z.To) then
			issue(issues, "Error", "BadSurfaceRange", z.Surface)
		end
	end
	local ids: { [string]: boolean } = {}
	local function uniq(id: string, kind: string)
		local key = kind .. ":" .. id
		if ids[key] then
			issue(issues, "Error", "DuplicateId", key)
		end
		ids[key] = true
	end
	for _, h in def.HazardZones do
		uniq(h.Id, "Hazard")
		if not inRange(h.At) then
			issue(issues, "Error", "BadHazardRange", h.Id)
		end
	end
	for _, j in def.Jumps do
		uniq(j.Id, "Jump")
		if not inRange(j.At) or j.GapLength <= 0 or j.GapLength > 120 then
			issue(issues, "Error", "BadJump", j.Id)
		end
	end
	for _, sc in def.Shortcuts do
		uniq(sc.Id, "Shortcut")
		if not (inRange(sc.EntryT) and inRange(sc.ExitT)) then
			issue(issues, "Error", "BadShortcutRange", sc.Id)
		end
		if #sc.Path < 2 then
			issue(issues, "Error", "ShortcutPathTooShort", sc.Id)
		end
		if not SurfaceDefinitions[sc.Surface] then
			issue(issues, "Error", "UnknownSurface", sc.Id)
		end
		if sc.NameKey == nil then
			issue(issues, "Warning", "ShortcutNoName", sc.Id)
		end
	end
	for _, m in def.MovingElements do
		uniq(m.Id, "Moving")
	end
	if #def.ItemSpawnGroups < 2 then
		issue(issues, "Error", "TooFewItemGroups", "need >= 2 item spawn groups")
	end
	for _, g in def.ItemSpawnGroups do
		if not inRange(g.At) or #g.Lateral == 0 then
			issue(issues, "Error", "BadItemGroup", tostring(g.At))
		end
	end
	if #def.Shortcuts < 1 then
		issue(issues, "Error", "NoAlternativeRoute", "each track needs an alternative route")
	end
	if #def.Landmarks < 1 then
		issue(issues, "Warning", "NoLandmarks", "no visual landmarks declared")
	end
	if def.UniqueMechanic == nil or def.UniqueMechanic == "" then
		issue(issues, "Error", "NoUniqueMechanic", "track must declare its unique mechanic")
	end
	for _, m in def.SupportedModes do
		if not ModeDefinitions.ById[m] then
			issue(issues, "Error", "UnknownMode", m)
		end
	end
	if #def.SupportedLapCounts == 0 then
		issue(issues, "Error", "NoLapCounts", "no supported lap counts")
	end
	if #def.KnockoutGates < 2 then
		issue(issues, "Error", "TooFewKnockoutGates", "need >= 2 knockout gates")
	end
	if #def.SpectatorCameras < 1 or #def.CameraZones < 1 or #def.AudioZones < 1 then
		issue(issues, "Error", "MissingZones", "camera/audio/spectator zones required")
	end
	if def.MinimapDetail < 16 then
		issue(issues, "Warning", "LowMinimapDetail", "minimap detail < 16")
	end

	local lapLength: number? = nil
	local checkpoints: number? = nil
	local ok, runtime = pcall(TrackRuntime.new, def, false)
	if not ok then
		issue(issues, "Error", "RuntimeBuildFailed", tostring(runtime))
	else
		local rt = runtime :: TrackRuntime.TrackRuntime
		lapLength = rt.Length
		checkpoints = rt.CheckpointCount
		if rt.Length < 2500 or rt.Length > 9000 then
			issue(issues, "Error", "LapLengthOutOfRange", string.format("%.0f studs", rt.Length))
		end
		-- Ordered checkpoints strictly increasing
		for i = 2, #rt.CheckpointDists do
			if rt.CheckpointDists[i] <= rt.CheckpointDists[i - 1] then
				issue(issues, "Error", "CheckpointOrder", "checkpoint " .. i)
			end
		end
		-- Reachability: walking the spline in 10-stud steps must always relocate onto the path within corridor.
		local prev = 0
		for d = 0, rt.Length, 10 do
			local pos = rt.Spline:PositionAt(d)
			local loc = rt:Locate(pos, prev)
			if not loc.InCorridor or math.abs(rt.Spline:Delta(loc.Progress, d)) > 6 then
				issue(issues, "Error", "PathUnreachable", string.format("progress %.0f", d))
				break
			end
			prev = loc.Progress
		end
		-- Grid slots must sit on the road
		for i, cf in rt:GridSlots(12) do
			local loc = rt:Locate(cf.Position, rt.Length - 40)
			if not loc.InCorridor then
				issue(issues, "Error", "GridOffTrack", "slot " .. i)
			end
		end
		-- Safe respawn points must exist for every checkpoint and be on the road
		for _, cd in rt.CheckpointDists do
			local cf = rt:SafeRespawn(cd)
			local loc = rt:Locate(cf.Position, cd - 10)
			if not loc.InCorridor then
				issue(issues, "Error", "RespawnOffTrack", string.format("checkpoint at %.0f", cd))
			end
		end
		-- Shortcuts must reconnect: ends within a few studs of the main path
		for _, sc in rt.Shortcuts do
			local a = sc.Spline:PositionAt(0)
			local b = sc.Spline:PositionAt(sc.Spline.Length)
			if (a - rt.Spline:PositionAt(sc.EntryDist)).Magnitude > 3 or (b - rt.Spline:PositionAt(sc.ExitDist)).Magnitude > 3 then
				issue(issues, "Error", "ShortcutDisconnected", sc.Def.Id)
			end
			local mainSpan = rt.Spline:Delta(sc.EntryDist, sc.ExitDist)
			if mainSpan < 0 then
				mainSpan += rt.Length
			end
			if sc.Spline.Length > mainSpan * 1.05 then
				issue(issues, "Warning", "ShortcutLonger", sc.Def.Id .. " is longer than the main route")
			end
			if sc.Spline.Length < mainSpan * 0.55 then
				issue(issues, "Error", "ShortcutTooShort", sc.Def.Id .. " saves more than 45% of a sector")
			end
		end
		-- Bot path sanity: curvature must be finite everywhere
		for d = 0, rt.Length, 25 do
			local c = rt.Spline:Curvature(d)
			if c ~= c or c > 0.2 then
				issue(issues, "Error", "BotPathTooSharp", string.format("progress %.0f curvature %.3f", d, c))
				break
			end
		end
	end

	local okAll = true
	for _, i in issues do
		if i.Severity == "Error" then
			okAll = false
		end
	end
	return { TrackId = def.Id, Ok = okAll, Issues = issues, LapLength = lapLength, Checkpoints = checkpoints }
end

function TrackValidator.ValidateArena(def: TrackDefinitions.ArenaDefinition): Report
	local issues: { Issue } = {}
	if def.Radius < 80 then
		issue(issues, "Error", "ArenaTooSmall", "radius < 80")
	end
	if #def.SpawnPoints < 12 then
		issue(issues, "Error", "TooFewSpawns", "need >= 12 spawn points")
	end
	if #def.ItemPads < 4 or #def.ShardSpawns < 6 then
		issue(issues, "Error", "TooFewPickups", "need >= 4 item pads and >= 6 shard spawns")
	end
	if not SurfaceDefinitions[def.FloorSurface] then
		issue(issues, "Error", "UnknownSurface", def.FloorSurface)
	end
	for _, sp in def.SpawnPoints do
		local outside = if def.Shape == "Bowl" then Vector3.new(sp.X, 0, sp.Z).Magnitude > def.Radius else (math.abs(sp.X) > def.Radius or math.abs(sp.Z) > def.Radius)
		if outside then
			issue(issues, "Error", "SpawnOutside", tostring(sp))
		end
		for _, ob in def.Obstacles do
			local d = ob.Position - sp
			if math.abs(d.X) < ob.Size.X / 2 + 3 and math.abs(d.Z) < ob.Size.Z / 2 + 3 then
				issue(issues, "Error", "SpawnInsideObstacle", tostring(sp))
			end
		end
	end
	for _, m in def.SupportedModes do
		if not ModeDefinitions.ById[m] then
			issue(issues, "Error", "UnknownMode", m)
		end
	end
	local okAll = true
	for _, i in issues do
		if i.Severity == "Error" then
			okAll = false
		end
	end
	return { TrackId = def.Id, Ok = okAll, Issues = issues }
end

-- Model-level checks for a built/imported TrackModel: no loose parts, no foreign scripts, required folders.
function TrackValidator.ValidateModel(model: Instance, allowScripts: boolean?): Report
	local issues: { Issue } = {}
	local required = { "Road", "Walls", "Checkpoints", "ItemPads", "Decor" }
	for _, name in required do
		if not model:FindFirstChild(name) then
			issue(issues, "Error", "MissingFolder", name)
		end
	end
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and not (d :: BasePart).Anchored then
			local anchoredByTag = d:GetAttribute("Dynamic") == true
			if not anchoredByTag then
				issue(issues, "Error", "LoosePart", d:GetFullName())
			end
		end
		if (d:IsA("Script") or d:IsA("LocalScript") or d:IsA("ModuleScript")) and not allowScripts then
			issue(issues, "Error", "ForeignScript", d:GetFullName())
		end
	end
	local okAll = true
	for _, i in issues do
		if i.Severity == "Error" then
			okAll = false
		end
	end
	return { TrackId = model.Name, Ok = okAll, Issues = issues }
end

function TrackValidator.ValidateAll(): { Report }
	local out = {}
	for _, t in TrackDefinitions.Tracks do
		table.insert(out, TrackValidator.ValidateDefinition(t))
	end
	for _, a in TrackDefinitions.Arenas do
		table.insert(out, TrackValidator.ValidateArena(a))
	end
	return out
end

return table.freeze(TrackValidator)
