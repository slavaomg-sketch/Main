--!strict
-- Environment adapter: everything that touches Roblox platform services goes through here so every service can
-- run headless in Lune with fakes. Bootstrap builds the real one; tests build fakes.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Network = require(Shared.Net.Network)
local ProfileStore = require(script.Parent.Systems.ProfileStore)

export type PlayerLike = { UserId: number, Name: string, DisplayName: string, Parent: any?, Kick: ((self: any, reason: string?) -> ())? }

export type MemoryQueue = {
	Add: (self: MemoryQueue, key: string, value: any, ttl: number) -> boolean,
	Read: (self: MemoryQueue, max: number) -> { { Key: string, Value: any } },
	Remove: (self: MemoryQueue, key: string) -> (),
}

export type TeleportAdapter = {
	LocalMode: boolean,
	ReserveAndTeleport: (self: TeleportAdapter, players: { PlayerLike }, data: any) -> (boolean, string?),
	ReadTeleportData: (self: TeleportAdapter, player: PlayerLike) -> any?,
}

export type Env = {
	Now: () -> number, -- server-synchronised race clock (seconds)
	Unix: () -> number,
	IsStudio: boolean,
	Dispatcher: Network.Dispatcher,
	FireClient: (name: string, player: PlayerLike, ...any) -> (),
	FireAll: (name: string, ...any) -> (),
	Players: { PlayerAdded: any, PlayerRemoving: any, GetPlayers: () -> { PlayerLike }, GetPlayerByUserId: (number) -> PlayerLike? },
	ProfileBackend: ProfileStore.Backend,
	MemoryQueue: MemoryQueue,
	Teleport: TeleportAdapter,
	Heartbeat: any, -- signal with Connect(fn(dt))
	BindToClose: (fn: () -> ()) -> (),
	SessionId: string,
	Random: Random,
	Log: (level: "Info" | "Warn" | "Error", tag: string, message: string) -> (),
	World: any, -- World adapter (see RaceService); Roblox or fake
}

return nil
