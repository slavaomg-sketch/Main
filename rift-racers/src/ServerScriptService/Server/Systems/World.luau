--!strict
-- World adapter contract. Session logic works in track-local coordinates; the adapter maps to the place.
export type KartPose = { CFrame: CFrame, Velocity: Vector3, AngularVelocity: Vector3, Grounded: boolean }

export type World = {
	Now: () -> number,
	BuildVenue: (sessionId: string, venueId: string, runtime: any, isArena: boolean, mirror: boolean) -> any,
	DestroyVenue: (handle: any) -> (),
	UpdateVenue: (handle: any, now: number) -> (),
	SetGate: (handle: any, shortcutId: string, open: boolean) -> (),
	SpawnKart: (sessionId: string, key: string, heroId: string, vehicleId: string, cosmetics: any, cframe: CFrame, player: any?, isBot: boolean) -> any,
	DestroyKart: (sessionId: string, key: string) -> (),
	GetPose: (sessionId: string, key: string) -> KartPose?,
	SetPose: (sessionId: string, key: string, cframe: CFrame, velocity: Vector3?) -> (),
	SetKartAttributes: (sessionId: string, key: string, attrs: { [string]: any }) -> (),
	ApplyImpulse: (sessionId: string, key: string, impulse: Vector3) -> (),
	Raycast: (sessionId: string, from: Vector3, dir: Vector3) -> Vector3?,
	SpawnPickup: (sessionId: string, id: string, kind: "ItemPad" | "Shard", position: Vector3) -> (),
	SetPickupActive: (sessionId: string, id: string, active: boolean) -> (),
	SpawnProjectileVisual: (sessionId: string, id: number, itemId: string, position: Vector3) -> (),
	UpdateProjectileVisual: (sessionId: string, id: number, position: Vector3) -> (),
	DestroyProjectileVisual: (sessionId: string, id: number) -> (),
	SetSpectatorTarget: (player: any, sessionId: string, key: string?) -> (),
}

return nil
