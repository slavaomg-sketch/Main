--!strict
-- Small declarative helpers so screens stay readable. Everything is scaled by a UIScale computed from the
-- viewport, uses UIAspectRatioConstraint/UISizeConstraint where it matters, and is gamepad-selectable.
local GuiService = game:GetService("GuiService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local Theme = require(script.Parent.Theme)

local UIBuilder = {}

function UIBuilder.ScreenGui(name: string, parent: Instance, order: number?, ignoreInset: boolean?): ScreenGui
	local g = Instance.new("ScreenGui")
	g.Name = name
	g.ResetOnSpawn = false
	g.IgnoreGuiInset = ignoreInset == true
	g.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	g.DisplayOrder = order or 0
	g.Enabled = false
	g.Parent = parent
	local scale = Instance.new("UIScale")
	scale.Name = "Scale"
	scale.Parent = g
	local function applyScale()
		local cam = Workspace.CurrentCamera
		if not cam then
			return
		end
		local vp = cam.ViewportSize
		local design = GameConfig.UI.DesignResolution
		local s = math.min(vp.X / design.X, vp.Y / design.Y)
		-- Phones: bias up so touch targets stay big.
		if vp.Y < 500 then
			s = math.max(s, 0.5) * 1.15
		end
		scale.Scale = math.clamp(s, GameConfig.UI.MinScale, GameConfig.UI.MaxScale)
	end
	applyScale()
	local cam = Workspace.CurrentCamera
	if cam then
		cam:GetPropertyChangedSignal("ViewportSize"):Connect(applyScale)
	end
	return g
end

function UIBuilder.Corner(parent: Instance, radius: UDim?)
	local c = Instance.new("UICorner")
	c.CornerRadius = radius or Theme.Corner
	c.Parent = parent
end

function UIBuilder.Stroke(parent: Instance, color: Color3?, thickness: number?)
	local s = Instance.new("UIStroke")
	s.Color = color or Theme.Colors.Accent
	s.Thickness = thickness or Theme.Stroke
	s.Transparency = 0.2
	s.Parent = parent
	return s
end

function UIBuilder.Padding(parent: Instance, px: number)
	local p = Instance.new("UIPadding")
	p.PaddingTop = UDim.new(0, px)
	p.PaddingBottom = UDim.new(0, px)
	p.PaddingLeft = UDim.new(0, px)
	p.PaddingRight = UDim.new(0, px)
	p.Parent = parent
end

function UIBuilder.List(
	parent: Instance,
	direction: Enum.FillDirection?,
	gap: number?,
	align: Enum.HorizontalAlignment?,
	valign: Enum.VerticalAlignment?
): UIListLayout
	local l = Instance.new("UIListLayout")
	l.FillDirection = direction or Enum.FillDirection.Vertical
	l.Padding = UDim.new(0, gap or 10)
	l.HorizontalAlignment = align or Enum.HorizontalAlignment.Center
	l.VerticalAlignment = valign or Enum.VerticalAlignment.Top
	l.SortOrder = Enum.SortOrder.LayoutOrder
	l.Parent = parent
	return l
end

function UIBuilder.Grid(parent: Instance, cell: UDim2, gap: number): UIGridLayout
	local g = Instance.new("UIGridLayout")
	g.CellSize = cell
	g.CellPadding = UDim2.new(0, gap, 0, gap)
	g.HorizontalAlignment = Enum.HorizontalAlignment.Center
	g.SortOrder = Enum.SortOrder.LayoutOrder
	g.Parent = parent
	return g
end

export type FrameOpts = {
	Size: UDim2?,
	Position: UDim2?,
	Anchor: Vector2?,
	Color: Color3?,
	Transparency: number?,
	Name: string?,
	Corner: UDim?,
	Stroke: boolean?,
	Parent: Instance?,
	LayoutOrder: number?,
	ZIndex: number?,
	Aspect: number?,
	Visible: boolean?,
}

function UIBuilder.Frame(o: FrameOpts): Frame
	local f = Instance.new("Frame")
	f.Name = o.Name or "Frame"
	f.Size = o.Size or UDim2.fromScale(1, 1)
	f.Position = o.Position or UDim2.fromScale(0, 0)
	f.AnchorPoint = o.Anchor or Vector2.new(0, 0)
	f.BackgroundColor3 = o.Color or Theme.Colors.Panel
	f.BackgroundTransparency = o.Transparency or 0
	f.BorderSizePixel = 0
	f.LayoutOrder = o.LayoutOrder or 0
	f.ZIndex = o.ZIndex or 1
	if o.Visible ~= nil then
		f.Visible = o.Visible
	end
	if o.Corner then
		UIBuilder.Corner(f, o.Corner)
	elseif o.Transparency ~= 1 then
		UIBuilder.Corner(f)
	end
	if o.Stroke then
		UIBuilder.Stroke(f)
	end
	if o.Aspect then
		local a = Instance.new("UIAspectRatioConstraint")
		a.AspectRatio = o.Aspect
		a.Parent = f
	end
	if o.Parent then
		f.Parent = o.Parent
	end
	return f
end

export type LabelOpts = {
	Text: string,
	Size: UDim2?,
	Position: UDim2?,
	Anchor: Vector2?,
	TextSize: number?,
	Color: Color3?,
	Font: Enum.Font?,
	Align: Enum.TextXAlignment?,
	Parent: Instance?,
	Name: string?,
	LayoutOrder: number?,
	Wrap: boolean?,
	ZIndex: number?,
	AutoSize: boolean?,
	Scaled: boolean?,
}

function UIBuilder.Label(o: LabelOpts): TextLabel
	local l = Instance.new("TextLabel")
	l.Name = o.Name or "Label"
	l.Text = o.Text
	l.Size = o.Size or UDim2.new(1, 0, 0, 30)
	l.Position = o.Position or UDim2.fromScale(0, 0)
	l.AnchorPoint = o.Anchor or Vector2.new(0, 0)
	l.BackgroundTransparency = 1
	l.TextColor3 = o.Color or Theme.Colors.Text
	l.Font = o.Font or Theme.Font
	l.TextSize = o.TextSize or Theme.TextSize.Body
	l.TextXAlignment = o.Align or Enum.TextXAlignment.Center
	l.TextWrapped = o.Wrap ~= false
	l.TextScaled = o.Scaled == true
	l.LayoutOrder = o.LayoutOrder or 0
	l.ZIndex = o.ZIndex or 2
	l.RichText = true
	if o.AutoSize then
		l.AutomaticSize = Enum.AutomaticSize.Y
	end
	if o.Scaled then
		local c = Instance.new("UITextSizeConstraint")
		c.MaxTextSize = o.TextSize or Theme.TextSize.Body
		c.MinTextSize = 12
		c.Parent = l
	end
	if o.Parent then
		l.Parent = o.Parent
	end
	return l
end

export type ButtonOpts = {
	Text: string,
	Size: UDim2?,
	Position: UDim2?,
	Anchor: Vector2?,
	Color: Color3?,
	TextSize: number?,
	Parent: Instance?,
	Name: string?,
	LayoutOrder: number?,
	OnClick: (() -> ())?,
	Selectable: boolean?,
	ZIndex: number?,
	Icon: string?,
}

function UIBuilder.Button(o: ButtonOpts): TextButton
	local b = Instance.new("TextButton")
	b.Name = o.Name or ("Button_" .. o.Text)
	b.Text = o.Text
	b.Size = o.Size or UDim2.new(0, 260, 0, 56)
	b.Position = o.Position or UDim2.fromScale(0, 0)
	b.AnchorPoint = o.Anchor or Vector2.new(0, 0)
	b.BackgroundColor3 = o.Color or Theme.Colors.Accent
	b.TextColor3 = Theme.Colors.Text
	b.Font = Theme.Font
	b.TextSize = o.TextSize or Theme.TextSize.Body
	b.TextScaled = true
	b.AutoButtonColor = true
	b.BorderSizePixel = 0
	b.LayoutOrder = o.LayoutOrder or 0
	b.Selectable = o.Selectable ~= false
	b.ZIndex = o.ZIndex or 2
	UIBuilder.Corner(b)
	local c = Instance.new("UITextSizeConstraint")
	c.MaxTextSize = o.TextSize or Theme.TextSize.Body
	c.MinTextSize = 12
	c.Parent = b
	UIBuilder.Padding(b, 8)
	local stroke = UIBuilder.Stroke(b, Theme.Colors.Accent2, 0)
	b.SelectionGained:Connect(function()
		stroke.Thickness = 3
	end)
	b.SelectionLost:Connect(function()
		stroke.Thickness = 0
	end)
	b.MouseEnter:Connect(function()
		stroke.Thickness = 2
	end)
	b.MouseLeave:Connect(function()
		if GuiService.SelectedObject ~= b then
			stroke.Thickness = 0
		end
	end)
	if o.OnClick then
		b.Activated:Connect(o.OnClick)
	end
	if o.Parent then
		b.Parent = o.Parent
	end
	return b
end

-- 0..100 stat bar with label
function UIBuilder.StatBar(parent: Instance, label: string, value: number, order: number): (Frame, Frame)
	local row =
		UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 26), Transparency = 1, Parent = parent, LayoutOrder = order })
	UIBuilder.Label({
		Text = label,
		Size = UDim2.new(0.45, 0, 1, 0),
		Align = Enum.TextXAlignment.Left,
		TextSize = Theme.TextSize.Small,
		Color = Theme.Colors.TextDim,
		Parent = row,
	})
	local track = UIBuilder.Frame({
		Size = UDim2.new(0.55, 0, 0, 12),
		Position = UDim2.new(0.45, 0, 0.5, 0),
		Anchor = Vector2.new(0, 0.5),
		Color = Theme.Colors.PanelAlt,
		Corner = UDim.new(1, 0),
		Parent = row,
	})
	local fill = UIBuilder.Frame({
		Size = UDim2.fromScale(math.clamp(value / 100, 0, 1), 1),
		Color = Theme.Colors.Accent2,
		Corner = UDim.new(1, 0),
		Parent = track,
	})
	return row, fill
end

function UIBuilder.Toggle(
	parent: Instance,
	label: string,
	value: boolean,
	order: number,
	onChange: (boolean) -> ()
): TextButton
	local row =
		UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 48), Transparency = 1, Parent = parent, LayoutOrder = order })
	UIBuilder.Label({
		Text = label,
		Size = UDim2.new(0.65, 0, 1, 0),
		Align = Enum.TextXAlignment.Left,
		TextSize = Theme.TextSize.Body,
		Parent = row,
	})
	local state = value
	local btn = UIBuilder.Button({
		Text = "",
		Size = UDim2.new(0.3, 0, 0, 40),
		Position = UDim2.new(0.7, 0, 0.5, 0),
		Anchor = Vector2.new(0, 0.5),
		Parent = row,
		Color = if state then Theme.Colors.Success else Theme.Colors.Locked,
	})
	local function refresh()
		btn.BackgroundColor3 = if state then Theme.Colors.Success else Theme.Colors.Locked
		btn:SetAttribute("Value", state)
	end
	btn.Activated:Connect(function()
		state = not state
		refresh()
		onChange(state)
	end)
	btn:SetAttribute("IsToggle", true)
	refresh()
	return btn
end

function UIBuilder.Slider(
	parent: Instance,
	label: string,
	value: number,
	min: number,
	max: number,
	order: number,
	onChange: (number) -> ()
): Frame
	local row =
		UIBuilder.Frame({ Size = UDim2.new(1, 0, 0, 48), Transparency = 1, Parent = parent, LayoutOrder = order })
	local text = UIBuilder.Label({
		Text = label,
		Size = UDim2.new(0.5, 0, 1, 0),
		Align = Enum.TextXAlignment.Left,
		TextSize = Theme.TextSize.Body,
		Parent = row,
	})
	local v = value
	local function fmt()
		text.Text = string.format(
			"%s  <font color='#80DCFF'>%d%%</font>",
			label,
			math.floor((v - min) / (max - min) * 100 + 0.5)
		)
	end
	local minus = UIBuilder.Button({
		Text = "−",
		Size = UDim2.new(0, 44, 0, 40),
		Position = UDim2.new(0.55, 0, 0.5, 0),
		Anchor = Vector2.new(0, 0.5),
		Parent = row,
		Color = Theme.Colors.PanelAlt,
	})
	local plus = UIBuilder.Button({
		Text = "+",
		Size = UDim2.new(0, 44, 0, 40),
		Position = UDim2.new(1, 0, 0.5, 0),
		Anchor = Vector2.new(1, 0.5),
		Parent = row,
		Color = Theme.Colors.PanelAlt,
	})
	local track = UIBuilder.Frame({
		Size = UDim2.new(0.28, 0, 0, 10),
		Position = UDim2.new(0.61, 0, 0.5, 0),
		Anchor = Vector2.new(0, 0.5),
		Color = Theme.Colors.PanelAlt,
		Corner = UDim.new(1, 0),
		Parent = row,
	})
	local fill = UIBuilder.Frame({
		Size = UDim2.fromScale((v - min) / (max - min), 1),
		Color = Theme.Colors.Accent2,
		Corner = UDim.new(1, 0),
		Parent = track,
	})
	local step = (max - min) / 10
	local function set(n: number)
		v = math.clamp(n, min, max)
		fill.Size = UDim2.fromScale((v - min) / (max - min), 1)
		fmt()
		onChange(v)
	end
	minus.Activated:Connect(function()
		set(v - step)
	end)
	plus.Activated:Connect(function()
		set(v + step)
	end)
	fmt()
	return row
end

function UIBuilder.Select(obj: GuiObject?)
	if obj then
		GuiService.SelectedObject = obj
	end
end

return UIBuilder
