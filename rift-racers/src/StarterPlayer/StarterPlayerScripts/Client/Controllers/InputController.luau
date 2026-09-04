--!strict
-- Unified input: keyboard, gamepad, touch (virtual controls) and optional tilt. Produces a normalised input frame.
local ContextActionService = game:GetService("ContextActionService")
local UserInputService = game:GetService("UserInputService")
local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Signal = require(Shared.Utility.Signal)
local MathUtil = require(Shared.Utility.MathUtil)

export type InputFrame = { Throttle: number, Brake: number, Steer: number, Drift: boolean, LookBack: boolean }

local InputController = { Name = "InputController" }
InputController.__index = InputController

function InputController.new()
	return setmetatable({
		Frame = { Throttle = 0, Brake = 0, Steer = 0, Drift = false, LookBack = false } :: InputFrame,
		DriftPressed = Signal.new() :: Signal.Signal<>,
		DriftReleased = Signal.new() :: Signal.Signal<>,
		ItemPressed = Signal.new() :: Signal.Signal<string>,
		RespawnPressed = Signal.new() :: Signal.Signal<>,
		MenuPressed = Signal.new() :: Signal.Signal<>,
		ThrottlePressed = Signal.new() :: Signal.Signal<>,
		HornPressed = Signal.new() :: Signal.Signal<>,
		SpectatePressed = Signal.new() :: Signal.Signal<string>,
		DeviceChanged = Signal.new() :: Signal.Signal<string>,
		Device = "Keyboard" :: string,
		_keys = { W = false, S = false, A = false, D = false, Up = false, Down = false, Left = false, Right = false },
		_gamepad = { Throttle = 0, Brake = 0, Steer = 0 },
		_touch = { Throttle = 0, Brake = 0, Steer = 0, Drift = false, LookBack = false },
		_tilt = 0,
		_settings = nil :: any,
		_enabled = false,
		_bound = false,
		_touchGui = nil :: ScreenGui?,
	}, InputController)
end

function InputController.Init(self: any, registry: any)
	self._settings = registry:Get("SettingsController")
	local function detect()
		if
			UserInputService.TouchEnabled
			and not UserInputService.KeyboardEnabled
			and not UserInputService.GamepadEnabled
		then
			self.Device = "Touch"
		elseif UserInputService.GamepadEnabled and not UserInputService.KeyboardEnabled then
			self.Device = "Gamepad"
		else
			self.Device = "Keyboard"
		end
		self.DeviceChanged:Fire(self.Device)
	end
	detect()
	UserInputService.LastInputTypeChanged:Connect(function(inputType)
		local prev = self.Device
		if inputType == Enum.UserInputType.Touch then
			self.Device = "Touch"
		elseif string.find(tostring(inputType), "Gamepad") then
			self.Device = "Gamepad"
		elseif inputType == Enum.UserInputType.Keyboard or inputType == Enum.UserInputType.MouseMovement then
			self.Device = "Keyboard"
		end
		if prev ~= self.Device then
			self.DeviceChanged:Fire(self.Device)
		end
	end)
end

local function pressed(state: Enum.UserInputState): boolean
	return state == Enum.UserInputState.Begin
end

function InputController.Bind(self: any)
	if self._bound then
		return
	end
	self._bound = true
	local function keyAction(name: string, key: string)
		ContextActionService:BindActionAtPriority("RR_" .. name, function(_, state)
			if state == Enum.UserInputState.Cancel then
				self._keys[key] = false
				return Enum.ContextActionResult.Pass
			end
			self._keys[key] = pressed(state)
			if key == "W" and pressed(state) then
				self.ThrottlePressed:Fire()
			end
			return Enum.ContextActionResult.Sink
		end, false, 2000, (Enum :: any).KeyCode[key])
	end
	keyAction("Gas", "W")
	keyAction("Brake", "S")
	keyAction("SteerL", "A")
	keyAction("SteerR", "D")
	keyAction("GasArrow", "Up")
	keyAction("BrakeArrow", "Down")
	keyAction("SteerLArrow", "Left")
	keyAction("SteerRArrow", "Right")
	ContextActionService:BindActionAtPriority("RR_Drift", function(_, state)
		if pressed(state) then
			self.Frame.Drift = true
			self.DriftPressed:Fire()
		elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
			self.Frame.Drift = false
			self.DriftReleased:Fire()
		end
		return Enum.ContextActionResult.Sink
	end, false, 2000, Enum.KeyCode.Space, Enum.KeyCode.LeftShift, Enum.KeyCode.ButtonR1)
	ContextActionService:BindActionAtPriority("RR_Item", function(_, state)
		if pressed(state) then
			self.ItemPressed:Fire("Active")
		end
		return Enum.ContextActionResult.Sink
	end, false, 2000, Enum.KeyCode.E, Enum.KeyCode.ButtonX)
	ContextActionService:BindActionAtPriority("RR_ItemReserve", function(_, state)
		if pressed(state) then
			self.ItemPressed:Fire("Reserve")
		end
		return Enum.ContextActionResult.Sink
	end, false, 2000, Enum.KeyCode.F, Enum.KeyCode.ButtonY)
	ContextActionService:BindActionAtPriority("RR_LookBack", function(_, state)
		self.Frame.LookBack = pressed(state)
		return Enum.ContextActionResult.Sink
	end, false, 2000, Enum.KeyCode.Q, Enum.KeyCode.ButtonL1)
	ContextActionService:BindActionAtPriority("RR_Respawn", function(_, state)
		if pressed(state) then
			self.RespawnPressed:Fire()
		end
		return Enum.ContextActionResult.Sink
	end, false, 2000, Enum.KeyCode.R, Enum.KeyCode.ButtonSelect)
	ContextActionService:BindActionAtPriority("RR_Horn", function(_, state)
		if pressed(state) then
			self.HornPressed:Fire()
		end
		return Enum.ContextActionResult.Sink
	end, false, 2000, Enum.KeyCode.H, Enum.KeyCode.DPadDown)
	ContextActionService:BindActionAtPriority("RR_Spectate", function(_, state, input)
		if pressed(state) then
			self.SpectatePressed:Fire(
				if input.KeyCode == Enum.KeyCode.DPadLeft or input.KeyCode == Enum.KeyCode.Z then "Prev" else "Next"
			)
		end
		return Enum.ContextActionResult.Pass
	end, false, 1000, Enum.KeyCode.Z, Enum.KeyCode.X, Enum.KeyCode.DPadLeft, Enum.KeyCode.DPadRight)
	ContextActionService:BindActionAtPriority("RR_Gamepad", function(_, _state, input)
		if input.KeyCode == Enum.KeyCode.ButtonR2 then
			self._gamepad.Throttle = input.Position.Z
			if input.Position.Z > 0.5 then
				self.ThrottlePressed:Fire()
			end
		elseif input.KeyCode == Enum.KeyCode.ButtonL2 then
			self._gamepad.Brake = input.Position.Z
		elseif input.KeyCode == Enum.KeyCode.Thumbstick1 then
			local x = input.Position.X
			self._gamepad.Steer = if math.abs(x) < 0.15 then 0 else MathUtil.Sign(x) * (math.abs(x) - 0.15) / 0.85
		end
		return Enum.ContextActionResult.Sink
	end, false, 2000, Enum.KeyCode.ButtonR2, Enum.KeyCode.ButtonL2, Enum.KeyCode.Thumbstick1)
	-- Menu is handled by GuiService/Escape; we listen for the pause intent on gamepad Start.
	UserInputService.InputBegan:Connect(function(input, processed)
		if processed then
			return
		end
		if
			input.KeyCode == Enum.KeyCode.ButtonStart
			or input.KeyCode == Enum.KeyCode.Escape
			or input.KeyCode == Enum.KeyCode.Tab
		then
			self.MenuPressed:Fire()
		end
	end)
	GuiService.MenuOpened:Connect(function()
		self.MenuPressed:Fire()
	end)
	-- Tilt steering (optional, only when the accelerometer is available)
	if UserInputService.AccelerometerEnabled then
		UserInputService.DeviceGravityChanged:Connect(function(input)
			self._tilt = math.clamp(input.Position.X * 2.5, -1, 1)
		end)
	end
end

function InputController.Unbind(self: any)
	if not self._bound then
		return
	end
	self._bound = false
	for _, name in
		{
			"RR_Gas",
			"RR_Brake",
			"RR_SteerL",
			"RR_SteerR",
			"RR_GasArrow",
			"RR_BrakeArrow",
			"RR_SteerLArrow",
			"RR_SteerRArrow",
			"RR_Drift",
			"RR_Item",
			"RR_ItemReserve",
			"RR_LookBack",
			"RR_Respawn",
			"RR_Horn",
			"RR_Spectate",
			"RR_Gamepad",
		}
	do
		ContextActionService:UnbindAction(name)
	end
end

-- Touch controls -----------------------------------------------------------------------------------------------------
function InputController.SetTouchControls(self: any, gui: ScreenGui?)
	self._touchGui = gui
end

function InputController.TouchSet(self: any, field: string, value: any)
	self._touch[field] = value
	if field == "Drift" then
		self.Frame.Drift = value
		if value then
			self.DriftPressed:Fire()
		else
			self.DriftReleased:Fire()
		end
	elseif field == "Throttle" and value > 0 then
		self.ThrottlePressed:Fire()
	elseif field == "LookBack" then
		self.Frame.LookBack = value
	end
end

-- Called every frame by the KartController to read the merged input.
function InputController.Read(self: any): InputFrame
	local s = self._settings and self._settings:Get() or nil
	local sens = if s then s.SteerSensitivity else 1
	local auto = if s then s.AutoAccelerate else false
	local k = self._keys
	local throttle = if k.W or k.Up then 1 else 0
	local brake = if k.S or k.Down then 1 else 0
	local steer = (if k.D or k.Right then 1 else 0) - (if k.A or k.Left then 1 else 0)
	throttle = math.max(throttle, self._gamepad.Throttle, self._touch.Throttle)
	brake = math.max(brake, self._gamepad.Brake, self._touch.Brake)
	if steer == 0 then
		steer = self._gamepad.Steer
	end
	if steer == 0 then
		steer = self._touch.Steer
	end
	if steer == 0 and s and s.TiltSteering then
		steer = self._tilt
	end
	if auto and brake == 0 then
		throttle = math.max(throttle, 1)
	end
	local f = self.Frame
	f.Throttle = math.clamp(throttle, 0, 1)
	f.Brake = math.clamp(brake, 0, 1)
	f.Steer = math.clamp(steer * sens, -1, 1)
	return f
end

function InputController.IsTouch(self: any): boolean
	return self.Device == "Touch"
end

function InputController.LocalPlayer(): Player
	return Players.LocalPlayer
end

return InputController
