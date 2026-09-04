--!strict
-- Item pads and energy shards: original glowing prisms, pooled and toggled rather than destroyed.
local CollectionService = game:GetService("CollectionService")
local PartUtil = require(script.Parent.PartUtil)

local PickupBuilder = {}

function PickupBuilder.Build(id: string, kind: "ItemPad" | "Shard", position: Vector3, parent: Instance): BasePart
	local p: Part
	if kind == "ItemPad" then
		p = PartUtil.Part({ Size = Vector3.new(6, 6, 0.8), CFrame = CFrame.new(position + Vector3.new(0, 3.5, 0)) * CFrame.Angles(0, 0, math.rad(45)), Color = Color3.fromRGB(80, 220, 255), Material = Enum.Material.Neon, Transparency = 0.15, CanCollide = false, CanQuery = false, Name = id, Tags = { "ItemPad" }, Parent = parent })
		PartUtil.Light(p, Color3.fromRGB(80, 220, 255), 18, 1.2)
		local core = PartUtil.Part({ Size = Vector3.new(2.5, 2.5, 2.5), CFrame = CFrame.new(position + Vector3.new(0, 3.5, 0)), Color = Color3.fromRGB(255, 255, 255), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Name = "Core", Parent = p })
		core:SetAttribute("Spin", 1.5)
	else
		p = PartUtil.Part({ Size = Vector3.new(1.6, 2.6, 1.6), CFrame = CFrame.new(position + Vector3.new(0, 2, 0)) * CFrame.Angles(0, math.rad(45), 0), Color = Color3.fromRGB(180, 140, 255), Material = Enum.Material.Neon, CanCollide = false, CanQuery = false, Name = id, Tags = { "Shard" }, Parent = parent })
		p:SetAttribute("Spin", 2)
	end
	p:SetAttribute("PickupId", id)
	p:SetAttribute("Active", true)
	CollectionService:AddTag(p, "Pickup")
	return p
end

function PickupBuilder.SetActive(part: BasePart, active: boolean)
	part:SetAttribute("Active", active)
	part.Transparency = if active then (if part.Name:sub(1, 3) == "pad" then 0.15 else 0) else 1
	for _, c in part:GetChildren() do
		if c:IsA("BasePart") then
			(c :: BasePart).Transparency = if active then 0 else 1
		elseif c:IsA("PointLight") then
			(c :: PointLight).Enabled = active
		end
	end
end

return PickupBuilder
