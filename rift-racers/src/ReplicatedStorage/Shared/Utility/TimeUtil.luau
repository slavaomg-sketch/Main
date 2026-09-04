--!strict
local TimeUtil = {}

-- Server-synchronised clock. workspace:GetServerTimeNow() exists in Roblox; Lune falls back to os.clock().
local hasWorkspace = typeof(workspace) == "Instance"

function TimeUtil.Now(): number
	if hasWorkspace then
		local ws: any = workspace
		return ws:GetServerTimeNow()
	end
	return os.clock()
end

function TimeUtil.Clock(): number
	return os.clock()
end

function TimeUtil.FormatRaceTime(seconds: number?): string
	if seconds == nil or seconds ~= seconds or seconds == math.huge or seconds < 0 then
		return "--:--.---"
	end
	local s = seconds :: number
	local minutes = math.floor(s / 60)
	local rem = s - minutes * 60
	local whole = math.floor(rem)
	local ms = math.floor((rem - whole) * 1000 + 0.5)
	if ms >= 1000 then
		ms = 999
	end
	return string.format("%02d:%02d.%03d", minutes, whole, ms)
end

function TimeUtil.FormatGap(seconds: number): string
	local sign = if seconds >= 0 then "+" else "-"
	return sign .. string.format("%.2f", math.abs(seconds))
end

function TimeUtil.UnixNow(): number
	return os.time()
end

return table.freeze(TimeUtil)
