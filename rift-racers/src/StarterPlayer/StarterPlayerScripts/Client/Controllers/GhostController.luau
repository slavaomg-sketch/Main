--!strict
-- Time Trial ghost playback: a translucent kart shell following the recorded keyframes (interpolated).
local Workspace = game:GetService("Workspace")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Network = require(Shared.Net.Network)
local ClientState = require(script.Parent.Parent.ClientState)
local GhostPlayback = require(script.Parent.Parent.GhostPlayback)

local GhostController = { Name = "GhostController" }
GhostController.__index = GhostController

function GhostController.new()
	return setmetatable(
		{
			_ghost = nil :: any,
			_model = nil :: Model?,
			_conn = nil :: RBXScriptConnection?,
			_origin = Vector3.new(),
			_goAt = 0,
		},
		GhostController
	)
end

function GhostController.Init(self: any, _registry: any)
	ClientState.RaceStateChanged:Connect(function(state, view)
		if state == "LoadingTrack" and view and view.ModeId == "TimeTrial" then
			task.spawn(function()
				local rec = Network.Invoke("GetRecords", view.VenueId)
				if rec and rec.Ghost then
					self._ghost = GhostPlayback.Deserialize(rec.Ghost)
				else
					self._ghost = nil
				end
			end)
		elseif state == "Countdown" and view then
			self._goAt = view.GoAt
			self:Spawn(view.SessionId)
		elseif state == "Lobby" or state == "Results" then
			self:Clear()
		end
	end)
end

function GhostController.Spawn(self: any, sessionId: string)
	self:Clear()
	if not self._ghost then
		return
	end
	local rr = Workspace:FindFirstChild("RiftRacers")
	local tracks = rr and rr:FindFirstChild("Tracks")
	local folder = tracks and tracks:FindFirstChild("Session_" .. sessionId)
	if folder then
		local o = folder:GetAttribute("Origin")
		if typeof(o) == "Vector3" then
			self._origin = o
		end
	end
	local model = Instance.new("Model")
	model.Name = "Ghost"
	local body = Instance.new("Part")
	body.Size = Vector3.new(4.4, 1.4, 7.2)
	body.Anchored = true
	body.CanCollide = false
	body.CanQuery = false
	body.Material = Enum.Material.ForceField
	body.Color = Color3.fromRGB(120, 200, 255)
	body.Transparency = 0.5
	body.Parent = model
	model.PrimaryPart = body
	model.Parent = Workspace
	self._model = model
	self._conn = RunService.RenderStepped:Connect(function()
		local t = Workspace:GetServerTimeNow() - self._goAt
		local cf = GhostPlayback.PoseAt(self._ghost, math.max(0, t))
		if cf then
			body.CFrame = cf + self._origin
		end
	end)
end

function GhostController.Clear(self: any)
	if self._conn then
		self._conn:Disconnect()
		self._conn = nil
	end
	if self._model then
		self._model:Destroy()
		self._model = nil
	end
end

return GhostController
