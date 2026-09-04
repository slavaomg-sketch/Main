--!strict
-- Decides when a racer must be returned to the track and where. Pure logic; RaceService applies the CFrame.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)

export type RespawnReason = "Fell" | "Stuck" | "Flipped" | "WrongWay" | "OffTrack" | "Requested"

export type Watch = { OffTrackSince: number?, StuckSince: number?, FlippedSince: number?, WrongWaySince: number?, LastRespawnAt: number }

local RespawnSystem = {}

function RespawnSystem.NewWatch(): Watch
	return { OffTrackSince = nil, StuckSince = nil, FlippedSince = nil, WrongWaySince = nil, LastRespawnAt = -100 }
end

export type Observation = { Y: number, Speed: number, UpDot: number, InCorridor: boolean, WrongWay: boolean, Racing: boolean }

function RespawnSystem.Evaluate(w: Watch, o: Observation, now: number): RespawnReason?
	if not o.Racing then
		return nil
	end
	if now - w.LastRespawnAt < GameConfig.Race.RespawnInvulnerabilitySeconds then
		return nil
	end
	if o.Y < GameConfig.Race.FallHeight then
		return "Fell"
	end
	local r = GameConfig.Race
	if not o.InCorridor then
		w.OffTrackSince = w.OffTrackSince or now
		if now - (w.OffTrackSince :: number) >= r.OffTrackRespawnSeconds then
			return "OffTrack"
		end
	else
		w.OffTrackSince = nil
	end
	if o.UpDot < 0.2 then
		w.FlippedSince = w.FlippedSince or now
		if now - (w.FlippedSince :: number) >= 2 then
			return "Flipped"
		end
	else
		w.FlippedSince = nil
	end
	if o.Speed < r.StuckSpeedThreshold then
		w.StuckSince = w.StuckSince or now
		if now - (w.StuckSince :: number) >= r.StuckSeconds then
			return "Stuck"
		end
	else
		w.StuckSince = nil
	end
	if o.WrongWay then
		w.WrongWaySince = w.WrongWaySince or now
		if now - (w.WrongWaySince :: number) >= r.WrongWaySeconds * 3 then
			return "WrongWay"
		end
	else
		w.WrongWaySince = nil
	end
	return nil
end

function RespawnSystem.MarkRespawned(w: Watch, now: number)
	w.LastRespawnAt = now
	w.OffTrackSince = nil
	w.StuckSince = nil
	w.FlippedSince = nil
	w.WrongWaySince = nil
end

return table.freeze(RespawnSystem)
