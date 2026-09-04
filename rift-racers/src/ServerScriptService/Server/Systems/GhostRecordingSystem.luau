--!strict
-- Compact ghost recording: keyframes only when the pose changed meaningfully (not every frame), quantised.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local RaceTypes = require(Shared.Types.RaceTypes)

type GhostRecording = RaceTypes.GhostRecording
type GhostFrame = RaceTypes.GhostFrame

local GhostRecordingSystem = {}
GhostRecordingSystem.__index = GhostRecordingSystem

local VERSION = 1
local SAMPLE_HZ = 10
local MIN_MOVE = 1.5 -- studs
local MIN_TURN = 0.08 -- radians

export type Recorder = { Frames: { GhostFrame }, StartedAt: number, LastSampleAt: number, Last: GhostFrame? }

function GhostRecordingSystem.NewRecorder(startedAt: number): Recorder
	return { Frames = {}, StartedAt = startedAt, LastSampleAt = -1, Last = nil }
end

local function q(n: number): number
	return math.floor(n * 100 + 0.5) / 100
end

function GhostRecordingSystem.Sample(rec: Recorder, now: number, cframe: CFrame)
	if now - rec.LastSampleAt < 1 / SAMPLE_HZ then
		return
	end
	local rx, ry, rz = cframe:ToEulerAnglesYXZ()
	local frame: GhostFrame = { T = q(now - rec.StartedAt), P = Vector3.new(q(cframe.X), q(cframe.Y), q(cframe.Z)), R = Vector3.new(q(rx), q(ry), q(rz)) }
	local last = rec.Last
	if last then
		local moved = (frame.P - last.P).Magnitude >= MIN_MOVE
		local turned = (frame.R - last.R).Magnitude >= MIN_TURN
		if not moved and not turned then
			return
		end
	end
	table.insert(rec.Frames, frame)
	rec.Last = frame
	rec.LastSampleAt = now
end

function GhostRecordingSystem.Finish(rec: Recorder, trackId: string, vehicleId: string, heroId: string, laps: number, timeSeconds: number, assist: boolean): GhostRecording
	return { Version = VERSION, TrackId = trackId, VehicleId = vehicleId, HeroId = heroId, Laps = laps, TimeSeconds = timeSeconds, Assist = assist, Frames = rec.Frames, SampleHz = SAMPLE_HZ }
end

-- Interpolated pose at time t for playback.
function GhostRecordingSystem.PoseAt(ghost: GhostRecording, t: number): CFrame?
	local frames = ghost.Frames
	if #frames == 0 then
		return nil
	end
	if t <= frames[1].T then
		local f = frames[1]
		return CFrame.new(f.P) * CFrame.fromEulerAnglesYXZ(f.R.X, f.R.Y, f.R.Z)
	end
	local lo, hi = 1, #frames
	while lo < hi do
		local mid = (lo + hi + 1) // 2
		if frames[mid].T <= t then
			lo = mid
		else
			hi = mid - 1
		end
	end
	local a = frames[lo]
	local b = frames[lo + 1]
	if not b then
		return CFrame.new(a.P) * CFrame.fromEulerAnglesYXZ(a.R.X, a.R.Y, a.R.Z)
	end
	local alpha = math.clamp((t - a.T) / math.max(1e-3, b.T - a.T), 0, 1)
	local ca = CFrame.new(a.P) * CFrame.fromEulerAnglesYXZ(a.R.X, a.R.Y, a.R.Z)
	local cb = CFrame.new(b.P) * CFrame.fromEulerAnglesYXZ(b.R.X, b.R.Y, b.R.Z)
	return ca:Lerp(cb, alpha)
end

-- Serialise to a compact string for DataStore (~12 bytes per frame as text).
function GhostRecordingSystem.Serialize(ghost: GhostRecording): string
	local parts = { string.format("%d|%s|%s|%s|%d|%.3f|%d|%d", ghost.Version, ghost.TrackId, ghost.VehicleId, ghost.HeroId, ghost.Laps, ghost.TimeSeconds, if ghost.Assist then 1 else 0, ghost.SampleHz) }
	for _, f in ghost.Frames do
		table.insert(parts, string.format("%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f", f.T, f.P.X, f.P.Y, f.P.Z, f.R.X, f.R.Y, f.R.Z))
	end
	return table.concat(parts, ";")
end

function GhostRecordingSystem.Deserialize(s: string): GhostRecording?
	local segments = string.split(s, ";")
	local header = string.split(segments[1] or "", "|")
	if #header < 8 then
		return nil
	end
	local frames: { GhostFrame } = {}
	for i = 2, #segments do
		local v = string.split(segments[i], ",")
		if #v == 7 then
			local n = {}
			for k = 1, 7 do
				n[k] = tonumber(v[k]) or 0
			end
			table.insert(frames, { T = n[1], P = Vector3.new(n[2], n[3], n[4]), R = Vector3.new(n[5], n[6], n[7]) })
		end
	end
	return {
		Version = tonumber(header[1]) or 1,
		TrackId = header[2],
		VehicleId = header[3],
		HeroId = header[4],
		Laps = tonumber(header[5]) or 3,
		TimeSeconds = tonumber(header[6]) or 0,
		Assist = header[7] == "1",
		Frames = frames,
		SampleHz = tonumber(header[8]) or SAMPLE_HZ,
	}
end

return table.freeze(GhostRecordingSystem)
