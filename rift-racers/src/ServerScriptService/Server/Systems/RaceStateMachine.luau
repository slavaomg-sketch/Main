--!strict
-- Explicit, verifiable state machine for a race session. Transitions outside the table are rejected loudly.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Signal = require(Shared.Utility.Signal)
local RaceTypes = require(Shared.Types.RaceTypes)

type RaceState = RaceTypes.RaceState

export type RaceStateMachine = {
	State: RaceState,
	EnteredAt: number,
	Changed: Signal.Signal<RaceState, RaceState>,
	CanTransition: (self: RaceStateMachine, to: RaceState) -> boolean,
	Transition: (self: RaceStateMachine, to: RaceState, now: number?) -> boolean,
	Is: (self: RaceStateMachine, ...RaceState) -> boolean,
	Elapsed: (self: RaceStateMachine, now: number?) -> number,
	Destroy: (self: RaceStateMachine) -> (),
}

local Transitions: { [RaceState]: { RaceState } } = {
	WaitingForPlayers = { "LoadingProfiles", "Returning" },
	LoadingProfiles = { "TrackVote", "LoadingTrack", "Returning" },
	TrackVote = { "LoadingTrack", "Returning" },
	LoadingTrack = { "LoadoutLock", "Returning" },
	LoadoutLock = { "GridSetup", "Returning" },
	GridSetup = { "Countdown", "Returning" },
	Countdown = { "Racing", "Returning" },
	Racing = { "FinishWindow", "Results", "Returning" },
	FinishWindow = { "Results", "Returning" },
	Results = { "Rewards", "Returning" },
	Rewards = { "Returning", "TrackVote", "LoadingTrack" },
	Returning = { "WaitingForPlayers" },
}

local RaceStateMachine = {}
RaceStateMachine.__index = RaceStateMachine

function RaceStateMachine.new(clock: (() -> number)?): RaceStateMachine
	local c = clock or os.clock
	local self = setmetatable({
		State = "WaitingForPlayers" :: RaceState,
		EnteredAt = c(),
		Changed = Signal.new() :: Signal.Signal<RaceState, RaceState>,
		_clock = c,
	}, RaceStateMachine)
	return (self :: any) :: RaceStateMachine
end

function RaceStateMachine.CanTransition(self: any, to: RaceState): boolean
	local allowed = Transitions[self.State]
	return allowed ~= nil and table.find(allowed, to) ~= nil
end

function RaceStateMachine.Transition(self: any, to: RaceState, now: number?): boolean
	if not RaceStateMachine.CanTransition(self, to) then
		warn(string.format("[RaceStateMachine] illegal transition %s -> %s", self.State, to))
		return false
	end
	local from = self.State
	self.State = to
	self.EnteredAt = now or self._clock()
	self.Changed:Fire(from, to)
	return true
end

function RaceStateMachine.Is(self: any, ...: RaceState): boolean
	for i = 1, select("#", ...) do
		if self.State == select(i, ...) then
			return true
		end
	end
	return false
end

function RaceStateMachine.Elapsed(self: any, now: number?): number
	return (now or self._clock()) - self.EnteredAt
end

function RaceStateMachine.Destroy(self: any)
	self.Changed:Destroy()
end

RaceStateMachine.Transitions = Transitions

return RaceStateMachine
