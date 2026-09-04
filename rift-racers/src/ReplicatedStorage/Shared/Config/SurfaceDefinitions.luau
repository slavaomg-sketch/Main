--!strict
-- Surface types change grip, acceleration, top speed and handling. Tracks reference them by Id.
export type SurfaceDefinition = {
	Id: string,
	Grip: number,
	Acceleration: number,
	TopSpeed: number,
	Handling: number,
	Material: Enum.Material,
	Color: Color3,
	Tag: string,
	VFX: string,
	SFX: string,
	OffroadForVehicles: boolean, -- vehicles' OffroadEfficiency applies
	Hazard: boolean,
	BoostPad: boolean,
}

local function def(id: string, grip: number, accel: number, top: number, handling: number, material: Enum.Material, color: Color3, extra: { [string]: any }?): SurfaceDefinition
	local e: { [string]: any } = extra or {}
	return {
		Id = id,
		Grip = grip,
		Acceleration = accel,
		TopSpeed = top,
		Handling = handling,
		Material = material,
		Color = color,
		Tag = "Surface_" .. id,
		VFX = (e.VFX :: string?) or "None",
		SFX = (e.SFX :: string?) or "Road",
		OffroadForVehicles = (e.Offroad :: boolean?) or false,
		Hazard = (e.Hazard :: boolean?) or false,
		BoostPad = (e.BoostPad :: boolean?) or false,
	}
end

local SurfaceDefinitions: { [string]: SurfaceDefinition } = {
	Asphalt = def("Asphalt", 1.0, 1.0, 1.0, 1.0, Enum.Material.Asphalt, Color3.fromRGB(58, 62, 78)),
	Dirt = def("Dirt", 0.8, 0.85, 0.82, 0.9, Enum.Material.Ground, Color3.fromRGB(122, 92, 60), { Offroad = true, VFX = "Dust", SFX = "Dirt" }),
	Sand = def("Sand", 0.72, 0.7, 0.72, 0.85, Enum.Material.Sand, Color3.fromRGB(214, 190, 130), { Offroad = true, VFX = "Dust", SFX = "Sand" }),
	Ice = def("Ice", 0.38, 0.9, 1.02, 0.6, Enum.Material.Ice, Color3.fromRGB(190, 230, 255), { VFX = "Frost", SFX = "Ice" }),
	Wet = def("Wet", 0.7, 0.95, 1.0, 0.85, Enum.Material.SmoothPlastic, Color3.fromRGB(40, 60, 90), { VFX = "Splash", SFX = "Wet" }),
	EnergyLane = def("EnergyLane", 1.05, 1.2, 1.18, 1.0, Enum.Material.Neon, Color3.fromRGB(80, 220, 255), { VFX = "Energy", SFX = "Energy" }),
	Hazard = def("Hazard", 0.6, 0.5, 0.6, 0.7, Enum.Material.CrackedLava, Color3.fromRGB(255, 90, 30), { Hazard = true, VFX = "Sparks", SFX = "Hazard" }),
	BoostPad = def("BoostPad", 1.0, 1.0, 1.0, 1.0, Enum.Material.Neon, Color3.fromRGB(255, 200, 60), { BoostPad = true, VFX = "Boost", SFX = "Boost" }),
	Grass = def("Grass", 0.78, 0.8, 0.78, 0.9, Enum.Material.Grass, Color3.fromRGB(86, 160, 84), { Offroad = true, VFX = "Dust", SFX = "Dirt" }),
	MagRail = def("MagRail", 1.3, 1.1, 1.12, 0.5, Enum.Material.Neon, Color3.fromRGB(200, 120, 255), { VFX = "Energy", SFX = "Energy" }),
}

return table.freeze(SurfaceDefinitions)
