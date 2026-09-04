--!strict
-- Versioned profile migrations. Each step upgrades exactly one version; never skip, never downgrade.
local ProfileTemplate = require(script.Parent.ProfileTemplate)

local Migrations = {}

type Step = (data: { [string]: any }) -> ()

local steps: { [number]: Step } = {
	-- v1 -> v2: currency renamed, statistics introduced
	[1] = function(data)
		if data.Coins ~= nil then
			data.Currency = (data.Currency or 0) + (data.Coins or 0)
			data.Coins = nil
		end
		data.Statistics = data.Statistics or {}
		data.ProcessedRaceRewards = data.ProcessedRaceRewards or {}
	end,
	-- v2 -> v3: unlock maps became sets, records gained Assist flag, purchase ids introduced
	[2] = function(data)
		if type(data.UnlockedHeroes) == "table" and #data.UnlockedHeroes > 0 then
			local set = {}
			for _, id in ipairs(data.UnlockedHeroes) do
				set[id] = true
			end
			data.UnlockedHeroes = set
		end
		if type(data.UnlockedVehicles) == "table" and #data.UnlockedVehicles > 0 then
			local set = {}
			for _, id in ipairs(data.UnlockedVehicles) do
				set[id] = true
			end
			data.UnlockedVehicles = set
		end
		if type(data.TrackRecords) == "table" then
			for _, rec in data.TrackRecords do
				if type(rec) == "table" and rec.Assist == nil then
					rec.Assist = false
				end
			end
		end
		data.ProcessedPurchaseIds = data.ProcessedPurchaseIds or {}
	end,
}

function Migrations.Apply(data: { [string]: any }, now: number): ({ [string]: any }, { number })
	local applied = {}
	local version = tonumber(data.SchemaVersion) or 1
	if version > ProfileTemplate.SchemaVersion then
		error(string.format("profile schema %d is newer than this server supports (%d)", version, ProfileTemplate.SchemaVersion))
	end
	while version < ProfileTemplate.SchemaVersion do
		local step = steps[version]
		if step == nil then
			error("missing migration step from version " .. version)
		end
		step(data)
		version += 1
		data.SchemaVersion = version
		table.insert(applied, version)
	end
	ProfileTemplate.Reconcile(data, now)
	return data, applied
end

Migrations.CurrentVersion = ProfileTemplate.SchemaVersion

return Migrations
