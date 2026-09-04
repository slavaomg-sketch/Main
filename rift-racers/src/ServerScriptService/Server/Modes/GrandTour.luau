--!strict
-- Four races; points per position; champion after the last race; tracks never repeat inside a tour.
local BaseMode = require(script.Parent.BaseMode)
local GrandTour = setmetatable({}, { __index = BaseMode })
GrandTour.__index = GrandTour
function GrandTour.new()
	return setmetatable(BaseMode.new("GrandTour"), GrandTour)
end
function GrandTour.Standings(self: any, session: any): { { Key: string, Points: number } }
	local out = {}
	for _, key in session.Order do
		table.insert(out, { Key = key, Points = session.TourPoints[key] or 0 })
	end
	table.sort(out, function(a, b)
		return a.Points > b.Points
	end)
	return out
end
return GrandTour
