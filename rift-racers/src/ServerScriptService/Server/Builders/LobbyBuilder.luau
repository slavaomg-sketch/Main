--!strict
-- The social lobby: a plaza with hero pedestals, garage bay, party terminal and a portal to the practice loop.
-- Built once at server start at the world origin (sessions live at positive X offsets).
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local HeroDefinitions = require(Shared.Config.HeroDefinitions)
local GameConfig = require(Shared.Config.GameConfig)
local PartUtil = require(script.Parent.PartUtil)
local HeroBuilder = require(script.Parent.HeroBuilder)

local LobbyBuilder = {}

local C = Color3.fromRGB

function LobbyBuilder.Build(): Folder
	local rr: Instance = Workspace:FindFirstChild("RiftRacers") or Instance.new("Folder")
	rr.Name = "RiftRacers"
	rr.Parent = Workspace
	local existing = rr:FindFirstChild("Lobby")
	if existing then
		existing:Destroy()
	end
	local lobby = PartUtil.Folder("Lobby", rr)
	local origin = Vector3.new(0, 0, -600)
	-- Plaza floor and rift ring
	PartUtil.Part({ Size = Vector3.new(260, 2, 260), CFrame = CFrame.new(origin + Vector3.new(0, -1, 0)), Color = C(40, 44, 70), Material = Enum.Material.SmoothPlastic, Name = "PlazaFloor", Parent = lobby })
	local ring = PartUtil.Part({ Size = Vector3.new(4, 120, 120), CFrame = CFrame.new(origin + Vector3.new(0, 60, -120)) * CFrame.Angles(0, math.rad(90), 0), Color = C(120, 80, 255), Material = Enum.Material.Neon, Shape = Enum.PartType.Cylinder, CanCollide = false, Name = "RiftRing", Parent = lobby })
	ring:SetAttribute("Spin", 0.2)
	PartUtil.Light(ring, C(140, 100, 255), 160, 2)
	local core = PartUtil.Part({ Size = Vector3.new(2, 100, 100), CFrame = ring.CFrame, Color = C(20, 10, 40), Material = Enum.Material.Glass, Shape = Enum.PartType.Cylinder, Transparency = 0.3, CanCollide = false, Name = "RiftCore", Parent = lobby })
	local _ = core
	-- Hero pedestals in an arc
	local pedestals = PartUtil.Folder("HeroPedestals", lobby)
	local n = #HeroDefinitions.List
	for i, hero in HeroDefinitions.List do
		local a = math.rad(-70 + (i - 1) * (140 / (n - 1)))
		local pos = origin + Vector3.new(math.sin(a) * 90, 1.5, -math.cos(a) * 90 + 40)
		local ped = PartUtil.Part({ Size = Vector3.new(8, 1, 8), CFrame = CFrame.new(pos), Color = hero.Cosmetics.AccentColor, Material = Enum.Material.Neon, Name = "Pedestal_" .. hero.Id, Parent = pedestals })
		ped:SetAttribute("HeroId", hero.Id)
		local anchor = PartUtil.Part({ Size = Vector3.new(1, 1, 1), CFrame = CFrame.new(pos + Vector3.new(0, 1, 0)) * CFrame.Angles(0, math.pi + a, 0), Transparency = 1, CanCollide = false, CanQuery = false, Name = "HeroAnchor", Parent = ped })
		HeroBuilder.Build(hero, anchor.CFrame, anchor, ped)
	end
	-- Garage bay, party terminal, practice portal (markers the client UI anchors prompts to)
	local function kiosk(name: string, offset: Vector3, color: Color3)
		local k = PartUtil.Part({ Size = Vector3.new(10, 6, 4), CFrame = CFrame.new(origin + offset), Color = color, Material = Enum.Material.Metal, Name = name, Parent = lobby })
		local sign = PartUtil.Part({ Size = Vector3.new(10, 1.5, 0.5), CFrame = CFrame.new(origin + offset + Vector3.new(0, 4.5, -2.2)), Color = color:Lerp(C(255, 255, 255), 0.5), Material = Enum.Material.Neon, Name = name .. "Sign", Parent = lobby })
		PartUtil.Light(sign, color, 30, 1.5)
		k:SetAttribute("Kiosk", name)
		return k
	end
	kiosk("Garage", Vector3.new(-80, 3, 60), C(60, 140, 240))
	kiosk("Party", Vector3.new(80, 3, 60), C(240, 160, 60))
	kiosk("Practice", Vector3.new(0, 3, 100), C(120, 240, 140))
	-- Spawn pad for the lobby camera / free-cam viewpoint
	local spawn = PartUtil.Part({ Size = Vector3.new(20, 1, 20), CFrame = CFrame.new(origin + Vector3.new(0, 0.5, 60)), Color = C(80, 220, 255), Material = Enum.Material.Neon, Name = "LobbySpawn", Parent = lobby })
	spawn:SetAttribute("CameraPivot", true)
	lobby:SetAttribute("ProjectName", GameConfig.ProjectName)
	lobby:SetAttribute("Origin", origin)
	return lobby
end

return LobbyBuilder
