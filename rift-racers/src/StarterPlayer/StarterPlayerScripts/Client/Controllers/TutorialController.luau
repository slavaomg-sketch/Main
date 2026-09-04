--!strict
-- Five-step onboarding shown on the practice loop; progress is reported to the server (idempotent max step).
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Locale = require(Shared.Locale.Locale)
local Network = require(Shared.Net.Network)
local ClientState = require(script.Parent.Parent.ClientState)
local UIBuilder = require(script.Parent.Parent.UI.UIBuilder)
local Theme = require(script.Parent.Parent.UI.Theme)

local TutorialController = { Name = "TutorialController" }
TutorialController.__index = TutorialController

local STEPS =
	{ "TUTORIAL.STEP_1", "TUTORIAL.STEP_2", "TUTORIAL.STEP_3", "TUTORIAL.STEP_4", "TUTORIAL.STEP_5", "TUTORIAL.DONE" }

function TutorialController.new()
	return setmetatable(
		{
			_kart = nil :: any,
			Step = 0,
			_gui = nil :: ScreenGui?,
			_label = nil :: TextLabel?,
			_active = false,
			_driftBoosts = 0,
		},
		TutorialController
	)
end

function TutorialController.Init(self: any, registry: any)
	self._kart = registry:Get("KartController")
	ClientState.TutorialStep:Connect(function(step)
		self:Begin(step)
	end)
	ClientState.RaceStateChanged:Connect(function(state)
		if state == "Lobby" then
			self:End()
		end
	end)
	-- Progress triggers
	self._kart.StateChanged:Connect(function(s)
		if not self._active then
			return
		end
		if self.Step == 1 and s == "Accelerating" then
			task.delay(4, function()
				self:Advance(2)
			end)
		end
	end)
	ClientState.KartEffect:Connect(function(name, data)
		if not self._active then
			return
		end
		if name == "Boost" and self.Step == 2 and string.sub(tostring(data.Source), 1, 5) == "Drift" then
			self:Advance(3)
		elseif name == "Boost" and self.Step == 3 and data.Source == "Trick" then
			self:Advance(4)
		elseif name == "Boost" and self.Step == 5 and data.Source == "Slipstream" then
			self:Advance(6)
		end
	end)
	ClientState.ItemState:Connect(function()
		if self._active and self.Step == 4 then
			self:Advance(5)
		end
	end)
end

function TutorialController.Begin(self: any, step: number)
	if not self._gui then
		self._gui = UIBuilder.ScreenGui("Tutorial", Players.LocalPlayer:WaitForChild("PlayerGui"), 15, false)
		local box = UIBuilder.Frame({
			Size = UDim2.new(0, 700, 0, 90),
			Position = UDim2.new(0.5, 0, 1, -140),
			Anchor = Vector2.new(0.5, 1),
			Color = Theme.Colors.Panel,
			Stroke = true,
			Parent = self._gui,
		})
		UIBuilder.Padding(box, 12)
		self._label = UIBuilder.Label({
			Text = "",
			Size = UDim2.fromScale(1, 0.7),
			TextSize = Theme.TextSize.Body,
			Parent = box,
			Font = Theme.FontBody,
		})
		local skip = UIBuilder.Button({
			Text = "▶",
			Size = UDim2.new(0, 60, 0, 30),
			Position = UDim2.new(1, 0, 1, 0),
			Anchor = Vector2.new(1, 1),
			Parent = box,
			Color = Theme.Colors.PanelAlt,
			TextSize = 16,
			OnClick = function()
				self:Advance(self.Step + 1)
			end,
		})
		local _ = skip
	end
	self._active = true
	self:Advance(math.max(1, step))
end

function TutorialController.Advance(self: any, step: number)
	if not self._active or step <= self.Step then
		return
	end
	self.Step = step
	Network.Fire("TutorialProgress", step)
	local key = STEPS[step]
	if self._label then
		self._label.Text = if key then Locale.T(key) else ""
	end
	if self._gui then
		self._gui.Enabled = key ~= nil
	end
	-- Practice mode has no items/rivals; steps 4-5 auto-advance after a short read time.
	if step == 4 or step == 5 then
		task.delay(8, function()
			if self.Step == step then
				self:Advance(step + 1)
			end
		end)
	end
	if step >= #STEPS then
		task.delay(4, function()
			self:End()
		end)
	end
end

function TutorialController.End(self: any)
	self._active = false
	self.Step = 0
	if self._gui then
		self._gui.Enabled = false
	end
end

return TutorialController
