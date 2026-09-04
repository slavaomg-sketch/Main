--!strict
-- Single client-side state store fed by server events; controllers subscribe to slices they care about.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Signal = require(Shared.Utility.Signal)
local Network = require(Shared.Net.Network)

local ClientState = {}

ClientState.Profile = nil :: any
ClientState.ProfileStatus = "Loading" :: string
ClientState.Lobby = nil :: any
ClientState.Party = nil :: any
ClientState.Queue = { InQueue = false } :: any
ClientState.Race = nil :: any -- RaceState view
ClientState.RaceStateName = "Lobby" :: string
ClientState.Snapshot = nil :: any
ClientState.Me = nil :: any -- personal view from snapshot
ClientState.Kart = nil :: any -- KartAssigned payload
ClientState.Results = nil :: any
ClientState.Rewards = nil :: any
ClientState.Ghost = nil :: any

ClientState.ProfileChanged = Signal.new() :: Signal.Signal<any>
ClientState.LobbyChanged = Signal.new() :: Signal.Signal<any>
ClientState.PartyChanged = Signal.new() :: Signal.Signal<any>
ClientState.QueueChanged = Signal.new() :: Signal.Signal<any>
ClientState.RaceStateChanged = Signal.new() :: Signal.Signal<string, any>
ClientState.SnapshotReceived = Signal.new() :: Signal.Signal<any>
ClientState.RaceEvent = Signal.new() :: Signal.Signal<string, any>
ClientState.KartEffect = Signal.new() :: Signal.Signal<string, any>
ClientState.VisualEvent = Signal.new() :: Signal.Signal<string, any>
ClientState.ItemState = Signal.new() :: Signal.Signal<any>
ClientState.KartAssigned = Signal.new() :: Signal.Signal<any, any>
ClientState.ResultsReceived = Signal.new() :: Signal.Signal<any, any>
ClientState.ErrorDialog = Signal.new() :: Signal.Signal<string, any>
ClientState.TutorialStep = Signal.new() :: Signal.Signal<number>
ClientState.GhostReceived = Signal.new() :: Signal.Signal<any>

local started = false

function ClientState.Start()
	if started then
		return
	end
	started = true
	Network.OnClient("ProfileLoaded", function(view, status)
		ClientState.Profile = view
		ClientState.ProfileStatus = status
		ClientState.ProfileChanged:Fire(view)
	end)
	Network.OnClient("ProfileUpdated", function(view)
		ClientState.Profile = view
		ClientState.ProfileChanged:Fire(view)
	end)
	Network.OnClient("LobbyState", function(view)
		ClientState.Lobby = view
		ClientState.LobbyChanged:Fire(view)
	end)
	Network.OnClient("PartyState", function(view)
		if view.Invite == nil then
			ClientState.Party = view
		end
		ClientState.PartyChanged:Fire(view)
	end)
	Network.OnClient("QueueState", function(view)
		ClientState.Queue = view
		ClientState.QueueChanged:Fire(view)
	end)
	Network.OnClient("RaceState", function(state, view)
		ClientState.Race = view
		ClientState.RaceStateName = state
		if state == "Returning" then
			ClientState.Race = nil
			ClientState.Snapshot = nil
			ClientState.Me = nil
			ClientState.Kart = nil
			ClientState.RaceStateName = "Lobby"
		end
		ClientState.RaceStateChanged:Fire(ClientState.RaceStateName, view)
	end)
	Network.OnClient("RaceSnapshot", function(snap)
		ClientState.Snapshot = snap
		ClientState.Me = snap.Me
		ClientState.SnapshotReceived:Fire(snap)
	end)
	Network.OnClient("RaceEvent", function(name, data)
		ClientState.RaceEvent:Fire(name, data)
	end)
	Network.OnClient("KartEffect", function(name, data)
		ClientState.KartEffect:Fire(name, data)
	end)
	Network.OnClient("VisualEvent", function(name, data)
		ClientState.VisualEvent:Fire(name, data)
	end)
	Network.OnClient("ItemState", function(view)
		ClientState.Me = view
		ClientState.ItemState:Fire(view)
	end)
	Network.OnClient("KartAssigned", function(info, loadout)
		ClientState.Kart = info
		ClientState.KartAssigned:Fire(info, loadout)
	end)
	Network.OnClient("Results", function(results, rewards)
		ClientState.Results = results
		ClientState.Rewards = rewards
		ClientState.ResultsReceived:Fire(results, rewards)
	end)
	Network.OnClient("ErrorDialog", function(key, data)
		ClientState.ErrorDialog:Fire(key, data)
	end)
	Network.OnClient("Tutorial", function(step)
		ClientState.TutorialStep:Fire(step)
	end)
	Network.OnClient("GhostData", function(ghost)
		ClientState.Ghost = ghost
		ClientState.GhostReceived:Fire(ghost)
	end)
end

function ClientState.MyKey(): string?
	return if ClientState.Kart then ClientState.Kart.Key else nil
end

function ClientState.InRace(): boolean
	local s = ClientState.RaceStateName
	return s == "GridSetup" or s == "Countdown" or s == "Racing" or s == "FinishWindow"
end

return ClientState
