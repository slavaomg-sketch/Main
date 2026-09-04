--!strict
-- Mobile layout: virtual steering (thumb zone), gas, brake, drift, item, look-back, reset. Size/alpha/side configurable.
local UserInputService = game:GetService("UserInputService")
local UIBuilder = require(script.Parent.UIBuilder)
local Theme = require(script.Parent.Theme)

local TouchControls = {}

export type Handle = { Gui: ScreenGui, Apply: (settings: any) -> (), Destroy: () -> () }

function TouchControls.Build(parent: Instance, input: any, onItem: (string) -> (), onReset: () -> ()): Handle
	local gui = UIBuilder.ScreenGui("TouchControls", parent, 5, true)
	local root = UIBuilder.Frame({ Transparency = 1, Parent = gui, Name = "Root" })
	local scale = Instance.new("UIScale")
	scale.Parent = root

	local function pad(name: string, text: string, size: number, pos: UDim2, anchor: Vector2, color: Color3): TextButton
		local b = UIBuilder.Button({
			Text = text,
			Size = UDim2.new(0, size, 0, size),
			Position = pos,
			Anchor = anchor,
			Color = color,
			Parent = root,
			Name = name,
			Selectable = false,
		})
		b.AutoButtonColor = false
		return b
	end
	-- Right cluster: gas (big), drift, item; left cluster: steer zone + brake; top-left: look back, reset.
	local gas = pad("Gas", "▲", 120, UDim2.new(1, -30, 1, -30), Vector2.new(1, 1), Theme.Colors.Success)
	local drift = pad("Drift", "DRIFT", 96, UDim2.new(1, -170, 1, -40), Vector2.new(1, 1), Theme.Colors.Accent2)
	local item = pad("Item", "ITEM", 84, UDim2.new(1, -40, 1, -170), Vector2.new(1, 1), Theme.Colors.Warning)
	local brake = pad("Brake", "▼", 84, UDim2.new(0, 30, 1, -30), Vector2.new(0, 1), Theme.Colors.Danger)
	local look = pad("LookBack", "◀▶", 64, UDim2.new(0, 30, 0.5, 0), Vector2.new(0, 0.5), Theme.Colors.PanelAlt)
	local reset = pad("Reset", "⟲", 64, UDim2.new(0, 110, 0.5, 0), Vector2.new(0, 0.5), Theme.Colors.PanelAlt)
	local steerZone = UIBuilder.Frame({
		Size = UDim2.new(0, 260, 0, 130),
		Position = UDim2.new(0, 130, 1, -30),
		Anchor = Vector2.new(0, 1),
		Color = Theme.Colors.Panel,
		Transparency = 0.6,
		Parent = root,
		Name = "SteerZone",
		Corner = UDim.new(1, 0),
	})
	local knob = UIBuilder.Frame({
		Size = UDim2.new(0, 70, 0, 70),
		Position = UDim2.fromScale(0.5, 0.5),
		Anchor = Vector2.new(0.5, 0.5),
		Color = Theme.Colors.Accent,
		Corner = UDim.new(1, 0),
		Parent = steerZone,
	})
	UIBuilder.Label({
		Text = "◀",
		Size = UDim2.new(0, 40, 1, 0),
		Position = UDim2.new(0, 8, 0, 0),
		Parent = steerZone,
		Color = Theme.Colors.TextDim,
	})
	UIBuilder.Label({
		Text = "▶",
		Size = UDim2.new(0, 40, 1, 0),
		Position = UDim2.new(1, -48, 0, 0),
		Parent = steerZone,
		Color = Theme.Colors.TextDim,
	})

	local function hold(btn: TextButton, field: string, down: any, up: any)
		btn.InputBegan:Connect(function(io)
			if io.UserInputType == Enum.UserInputType.Touch or io.UserInputType == Enum.UserInputType.MouseButton1 then
				input:TouchSet(field, down)
				btn.BackgroundTransparency = 0.1
			end
		end)
		btn.InputEnded:Connect(function(io)
			if io.UserInputType == Enum.UserInputType.Touch or io.UserInputType == Enum.UserInputType.MouseButton1 then
				input:TouchSet(field, up)
				btn.BackgroundTransparency = 0.35
			end
		end)
	end
	hold(gas, "Throttle", 1, 0)
	hold(brake, "Brake", 1, 0)
	hold(drift, "Drift", true, false)
	hold(look, "LookBack", true, false)
	item.Activated:Connect(function()
		onItem("Active")
	end)
	reset.Activated:Connect(onReset)
	-- Steering zone: horizontal touch position -> steer in [-1, 1]
	local activeTouch: InputObject? = nil
	local function updateSteer(io: InputObject)
		local abs = steerZone.AbsolutePosition
		local size = steerZone.AbsoluteSize
		local x = math.clamp((io.Position.X - abs.X) / size.X, 0, 1)
		local steer = (x - 0.5) * 2
		knob.Position = UDim2.fromScale(x, 0.5)
		input:TouchSet("Steer", steer)
	end
	steerZone.InputBegan:Connect(function(io)
		if io.UserInputType == Enum.UserInputType.Touch or io.UserInputType == Enum.UserInputType.MouseButton1 then
			activeTouch = io
			updateSteer(io)
		end
	end)
	UserInputService.InputChanged:Connect(function(io)
		if activeTouch and io == activeTouch then
			updateSteer(io)
		end
	end)
	UserInputService.InputEnded:Connect(function(io)
		if activeTouch and io == activeTouch then
			activeTouch = nil
			knob.Position = UDim2.fromScale(0.5, 0.5)
			input:TouchSet("Steer", 0)
		end
	end)

	local function apply(settings: any)
		scale.Scale = settings.MobileControlScale or 1
		for _, b in { gas, drift, item, brake, look, reset } do
			b.BackgroundTransparency = 1 - (settings.MobileControlAlpha or 0.6)
		end
		steerZone.BackgroundTransparency = 1 - (settings.MobileControlAlpha or 0.6) * 0.6
		-- Mirror layout for left-handed players.
		local left = settings.MobileLayout == "Left"
		gas.Position = if left then UDim2.new(0, 30, 1, -30) else UDim2.new(1, -30, 1, -30)
		gas.AnchorPoint = if left then Vector2.new(0, 1) else Vector2.new(1, 1)
		drift.Position = if left then UDim2.new(0, 170, 1, -40) else UDim2.new(1, -170, 1, -40)
		drift.AnchorPoint = if left then Vector2.new(0, 1) else Vector2.new(1, 1)
		item.Position = if left then UDim2.new(0, 40, 1, -170) else UDim2.new(1, -40, 1, -170)
		item.AnchorPoint = if left then Vector2.new(0, 1) else Vector2.new(1, 1)
		brake.Position = if left then UDim2.new(1, -30, 1, -30) else UDim2.new(0, 30, 1, -30)
		brake.AnchorPoint = if left then Vector2.new(1, 1) else Vector2.new(0, 1)
		steerZone.Position = if left then UDim2.new(1, -130, 1, -30) else UDim2.new(0, 130, 1, -30)
		steerZone.AnchorPoint = if left then Vector2.new(1, 1) else Vector2.new(0, 1)
		gas.Visible = not (settings.AutoAccelerate == true)
	end
	return {
		Gui = gui,
		Apply = apply,
		Destroy = function()
			gui:Destroy()
		end,
	}
end

return TouchControls
