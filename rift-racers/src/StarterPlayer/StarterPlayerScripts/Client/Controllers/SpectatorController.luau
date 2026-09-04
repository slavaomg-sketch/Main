--!strict
-- Spectating after finishing/elimination: cycles targets via the server (so everyone agrees on validity).
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Network = require(Shared.Net.Network)
local ClientState = require(script.Parent.Parent.ClientState)

local SpectatorController = { Name = "SpectatorController" }
SpectatorController.__index = SpectatorController

function SpectatorController.new()
	return setmetatable(
		{ _input = nil :: any, _camera = nil :: any, Active = false, TargetKey = nil :: string? },
		SpectatorController
	)
end

function SpectatorController.Init(self: any, registry: any)
	self._input = registry:Get("InputController")
	self._camera = registry:Get("CameraController")
	ClientState.RaceEvent:Connect(function(name, data)
		if name == "Finished" or name == "Eliminated" then
			self.Active = true
			task.delay(2.5, function()
				if self.Active then
					self._camera.Mode = "Spectate"
					Network.Fire("SpectateAction", "Next")
				end
			end)
		elseif name == "Spectate" then
			self.TargetKey = data.Key
		end
	end)
	ClientState.RaceStateChanged:Connect(function(state)
		if state == "Lobby" or state == "GridSetup" then
			self.Active = false
			self.TargetKey = nil
		end
	end)
	self._input.SpectatePressed:Connect(function(dir)
		if self.Active then
			Network.Fire("SpectateAction", dir)
		end
	end)
end

return SpectatorController
