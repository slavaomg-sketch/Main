--!strict
-- Server entry point: builds the environment, registers services in dependency order, starts them.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ServiceRegistry = require(script.Parent.ServiceRegistry)
local RobloxEnvFactory = require(script.Parent.RobloxEnvFactory)
local LobbyBuilder = require(script.Parent.Builders.LobbyBuilder)
local TrackValidator = require(script.Parent.Systems.TrackValidator)

local Services = (script :: any).Parent.Services

local registry = ServiceRegistry.new()
local env = RobloxEnvFactory.Build()
registry:Set("Env", env)

for _, name in
	{
		"TelemetryService",
		"SecurityService",
		"ModeService",
		"ProfileService",
		"RewardService",
		"PartyService",
		"RaceProgressService",
		"KartValidationService",
		"ItemService",
		"BotRacerService",
		"RaceService",
		"MatchmakingService",
		"LobbyService",
	}
do
	local module = require(Services:FindFirstChild(name)) :: any
	registry:Add(module.new())
end

-- Content validation before anything loads: a broken track never reaches players.
local reports = TrackValidator.ValidateAll()
for _, r in reports do
	if not r.Ok then
		for _, issue in r.Issues do
			warn(string.format("[TrackValidator] %s %s: %s", r.TrackId, issue.Code, issue.Message))
		end
		error("[RiftRacers] content validation failed for " .. r.TrackId)
	end
end

LobbyBuilder.Build()

registry:InitAll()
registry:StartAll()
env.Log(
	"Info",
	"Bootstrap",
	string.format(
		"%s server ready (MaxRacers=%d, localMode=%s)",
		GameConfig.ProjectName,
		GameConfig.MaxRacers,
		tostring(env.Teleport.LocalMode)
	)
)
