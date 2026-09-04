--!strict
export type Direction = "ClientToServer" | "ServerToClient" | "Function"

export type FieldSchema = {
	Type: "number" | "integer" | "string" | "boolean" | "enum" | "vector3" | "table" | "any" | "cframe",
	Min: number?,
	Max: number?,
	MaxLength: number?,
	Values: { string }?,
	Optional: boolean?,
	Fields: { [string]: FieldSchema }?,
	Item: FieldSchema?,
	MaxEntries: number?,
}

export type RemoteDefinition = {
	Name: string,
	Direction: Direction,
	Args: { FieldSchema },
	RateCapacity: number?,
	RateRefill: number?,
	RequiredStates: { string }?,
}

export type Rejection = { Reason: string, Detail: string? }

return nil
