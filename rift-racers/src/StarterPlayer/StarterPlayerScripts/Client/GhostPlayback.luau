--!strict
-- Client copy of the compact ghost format reader (kept tiny so the client never requires server modules).
local GhostPlayback = {}

export type Frame = { T: number, P: Vector3, R: Vector3 }
export type Ghost = { Frames: { Frame }, TimeSeconds: number, Assist: boolean }

function GhostPlayback.Deserialize(s: string): Ghost?
	local segments = string.split(s, ";")
	local header = string.split(segments[1] or "", "|")
	if #header < 8 then
		return nil
	end
	local frames: { Frame } = {}
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
	return { Frames = frames, TimeSeconds = tonumber(header[6]) or 0, Assist = header[7] == "1" }
end

function GhostPlayback.PoseAt(ghost: Ghost, t: number): CFrame?
	local frames = ghost.Frames
	if #frames == 0 then
		return nil
	end
	local function cf(f: Frame): CFrame
		return CFrame.new(f.P) * CFrame.fromEulerAnglesYXZ(f.R.X, f.R.Y, f.R.Z)
	end
	if t <= frames[1].T then
		return cf(frames[1])
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
	local a, b = frames[lo], frames[lo + 1]
	if not b then
		return cf(a)
	end
	local alpha = math.clamp((t - a.T) / math.max(1e-3, b.T - a.T), 0, 1)
	return cf(a):Lerp(cf(b), alpha)
end

return GhostPlayback
