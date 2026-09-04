--!strict
-- Client entry point: state store, controllers in dependency order, then start.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ClientRegistry = require(script.Parent.ClientRegistry)
local ClientState = require(script.Parent.ClientState)

local Controllers = (script :: any).Parent.Controllers
local registry = ClientRegistry.new()
ClientState.Start()

for _, name in
	{
		"SettingsController",
		"InputController",
		"KartController",
		"CameraController",
		"VenueController",
		"AudioController",
		"VFXController",
		"SpectatorController",
		"GhostController",
		"GarageController",
		"HUDController",
		"MenuController",
		"TutorialController",
	}
do
	local module = require(Controllers:FindFirstChild(name)) :: any
	registry:Add(module.new())
end

registry:InitAll()
registry:StartAll()
print(string.format("[%s] client ready", GameConfig.ProjectShortName))
