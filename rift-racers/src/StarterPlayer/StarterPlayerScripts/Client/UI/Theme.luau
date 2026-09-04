--!strict
-- Original sci-fantasy UI theme: rift purple/cyan accents, rounded panels, large readable type.
local Theme = {
	Font = Enum.Font.GothamBold,
	FontBody = Enum.Font.Gotham,
	Colors = {
		Background = Color3.fromRGB(16, 14, 36),
		Panel = Color3.fromRGB(28, 24, 58),
		PanelAlt = Color3.fromRGB(38, 32, 74),
		Accent = Color3.fromRGB(120, 80, 255),
		Accent2 = Color3.fromRGB(80, 220, 255),
		Warning = Color3.fromRGB(255, 160, 60),
		Danger = Color3.fromRGB(255, 80, 90),
		Success = Color3.fromRGB(90, 230, 150),
		Text = Color3.fromRGB(245, 245, 255),
		TextDim = Color3.fromRGB(180, 178, 210),
		Locked = Color3.fromRGB(90, 88, 120),
	},
	Corner = UDim.new(0, 14),
	CornerSmall = UDim.new(0, 8),
	TextSize = { Title = 44, Header = 30, Body = 22, Small = 17, Huge = 96 },
	Stroke = 2,
}

return table.freeze(Theme)
