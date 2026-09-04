--!strict
-- Headless environment: fake players, virtual clock, in-memory stores and a FakeWorld that drives every kart
-- with KartSim (humans get a Hard bot brain standing in for the client physics controller).
local RobloxEnv = require("./RobloxEnv")

local FakeEnv = {}

export type FakePlayer = { UserId: number, Name: string, DisplayName: string, Parent: any, Kicked: boolean, Kick: (self: any, reason: string?) -> (), Inbox: { { Name: string, Args: { any } } } }

function FakeEnv.Player(userId: number, name: string?): FakePlayer
	local p: any = { UserId = userId, Name = name or ("Player" .. userId), DisplayName = name or ("Player" .. userId), Parent = true, Kicked = false, Inbox = {} }
	function p:Kick(_reason)
		self.Kicked = true
		self.Parent = nil
	end
	return p
end

function FakeEnv.new(opts: { Seed: number?, HumanDriver: boolean? }?)
	local o = opts or {}
	local roblox = RobloxEnv.Roblox()
	local Vector3 = roblox.Vector3
	local CFrame = roblox.CFrame
	local Network = RobloxEnv.Load("Shared/Net/Network")
	local ProfileStore = RobloxEnv.Load("Server/Systems/ProfileStore")
	local KartSim = RobloxEnv.Load("Server/Systems/KartSim")
	local BotBrain = RobloxEnv.Load("Server/Systems/BotBrain")
	local VehicleStats = RobloxEnv.Load("Shared/Systems/VehicleStats")
	local RandomShim = require("./RandomShim")

	local clock = 1000
	local players: { FakePlayer } = {}
	local env: any = {}
	env.Now = function()
		return clock
	end
	env.Unix = function()
		return 1700000000 + math.floor(clock)
	end
	env.IsStudio = true
	env.Dispatcher = Network.CreateDispatcher(env.Now)
	env.Messages = {} :: { { Player: any, Name: string, Args: { any } } }
	env.FireClient = function(name: string, player: any, ...: any)
		local args = table.pack(...)
		table.insert(player.Inbox, { Name = name, Args = args })
		if #player.Inbox > 400 then
			table.remove(player.Inbox, 1)
		end
	end
	env.FireAll = function(name: string, ...: any)
		for _, p in players do
			env.FireClient(name, p, ...)
		end
	end
	env.Players = {
		PlayerAdded = RobloxEnv.FakeSignal(),
		PlayerRemoving = RobloxEnv.FakeSignal(),
		GetPlayers = function()
			return table.clone(players)
		end,
		GetPlayerByUserId = function(id: number)
			for _, p in players do
				if p.UserId == id then
					return p
				end
			end
			return nil
		end,
	}
	env.ProfileBackend = ProfileStore.MemoryBackend()
	local mem: { [string]: any } = {}
	env.MemoryQueue = {
		Add = function(_, key, value)
			mem[key] = value
			return true
		end,
		Read = function(_)
			local out = {}
			for k, v in mem do
				table.insert(out, { Key = k, Value = v })
			end
			return out
		end,
		Remove = function(_, key)
			mem[key] = nil
		end,
	}
	env.Teleport = {
		LocalMode = true,
		ReserveAndTeleport = function()
			return true, nil
		end,
		ReadTeleportData = function()
			return nil
		end,
	}
	env.Heartbeat = RobloxEnv.FakeSignal()
	env.BindToClose = function(fn)
		env._closeFn = fn
	end
	env.SessionId = "fake_server"
	env.Random = RandomShim.new(o.Seed or 42)
	env.Logs = {} :: { string }
	env.Log = function(level: string, tag: string, message: string)
		table.insert(env.Logs, string.format("[%s][%s] %s", level, tag, message))
	end

	-- FakeWorld ----------------------------------------------------------------------------------------------------
	type Kart = { Key: string, Sim: any, IsBot: boolean, Stats: any, Memory: any?, Session: string, Attrs: { [string]: any }, Grounded: boolean }
	local world: any = {}
	local venues: { [string]: any } = {}
	local karts: { [string]: Kart } = {}
	local pickups: { [string]: { Kind: string, Position: any, Active: boolean } } = {}
	local projectileVisuals = 0
	world.Now = env.Now
	world.Venues = venues
	world.Karts = karts
	world.Pickups = pickups
	world.BuildVenue = function(sessionId: string, venueId: string, runtime: any, isArena: boolean)
		venues[sessionId] = { Id = venueId, Runtime = runtime, IsArena = isArena, Gates = {} }
		return venues[sessionId]
	end
	world.DestroyVenue = function(handle: any)
		for id, v in venues do
			if v == handle then
				venues[id] = nil
			end
		end
	end
	world.UpdateVenue = function() end
	world.SetGate = function(handle: any, id: string, open: boolean)
		handle.Gates[id] = open
	end
	world.SpawnKart = function(sessionId: string, key: string, heroId: string, vehicleId: string, _cos: any, cframe: any, _player: any, isBot: boolean)
		local stats = VehicleStats.Compute(heroId, vehicleId)
		local sim = KartSim.new(stats, cframe)
		local venue = venues[sessionId]
		if venue and not venue.IsArena then
			sim.Progress = venue.Runtime:Locate(cframe.Position, venue.Runtime.Length - 30).Progress
		end
		karts[sessionId .. ":" .. key] = { Key = key, Sim = sim, IsBot = isBot, Stats = stats, Memory = if isBot then nil else BotBrain.NewMemory("Hard", 7 + #key), Session = sessionId, Attrs = {}, Grounded = true }
		return karts[sessionId .. ":" .. key]
	end
	world.DestroyKart = function(sessionId: string, key: string)
		karts[sessionId .. ":" .. key] = nil
	end
	world.GetPose = function(sessionId: string, key: string)
		local k = karts[sessionId .. ":" .. key]
		if not k then
			return nil
		end
		return { CFrame = k.Sim:CFrame(), Velocity = k.Sim:Velocity(), AngularVelocity = Vector3.new(), Grounded = not k.Sim.Airborne }
	end
	world.SetPose = function(sessionId: string, key: string, cframe: any, velocity: any?)
		local k = karts[sessionId .. ":" .. key]
		if not k then
			return
		end
		if k.IsBot then
			-- Bots are simulated by BotRacerService's own sim; mirror its pose.
			k.Sim.Position = cframe.Position
			local look = cframe.LookVector
			k.Sim.Yaw = math.atan2(-look.X, -look.Z)
			k.Sim.Speed = if velocity then velocity.Magnitude else 0
		else
			k.Sim:Teleport(cframe)
			local venue = venues[sessionId]
			if venue and not venue.IsArena then
				k.Sim.Progress = venue.Runtime:Locate(cframe.Position, k.Sim.Progress).Progress
			end
		end
	end
	world.SetKartAttributes = function(sessionId: string, key: string, attrs: { [string]: any })
		local k = karts[sessionId .. ":" .. key]
		if k then
			for a, v in attrs do
				k.Attrs[a] = v
			end
		end
	end
	world.ApplyImpulse = function() end
	world.Raycast = function()
		return nil
	end
	world.SpawnPickup = function(sessionId: string, id: string, kind: string, position: any)
		pickups[sessionId .. ":" .. id] = { Kind = kind, Position = position, Active = true }
	end
	world.SetPickupActive = function(sessionId: string, id: string, active: boolean)
		local p = pickups[sessionId .. ":" .. id]
		if p then
			p.Active = active
		end
	end
	world.SpawnProjectileVisual = function()
		projectileVisuals += 1
	end
	world.UpdateProjectileVisual = function() end
	world.DestroyProjectileVisual = function()
		projectileVisuals -= 1
	end
	world.SetSpectatorTarget = function() end
	world.ProjectileVisuals = function()
		return projectileVisuals
	end

	-- Human stand-in driver: mirrors server-side effects (boosts/stun/stall) into the sim like the real client does.
	world.DriveHumans = function(dt: number, raceService: any, inputOverride: ((key: string, obs: any) -> any)?)
		for _, k in karts do
			if k.IsBot then
				continue
			end
			local venue = venues[k.Session]
			if not venue or venue.IsArena then
				continue
			end
			local session = nil
			for _, s in raceService:Sessions() do
				if s.Id == k.Session then
					session = s
				end
			end
			if not session then
				continue
			end
			local racer = session.Racers[k.Key]
			if not racer then
				continue
			end
			local racing = session.SM:Is("Racing", "FinishWindow") and racer.Progress.FinishedAt == nil
			local input = { Steer = 0, Throttle = 0, Brake = 0, Drift = false, Trick = false }
			if racing then
				local obs = {
					Position = k.Sim.Position, Forward = k.Sim:Forward(), Speed = k.Sim.Speed, TopSpeed = k.Stats.TopSpeed, Progress = k.Sim.Progress,
					Grounded = not k.Sim.Airborne, HasItem = racer.Items.Active ~= nil, ItemKind = nil, RivalAhead = nil, RivalBehind = nil, Obstacles = {},
					OnJump = venue.Runtime:JumpAt(k.Sim.Progress) ~= nil, Now = clock, RubberBand = 1,
				}
				local d = BotBrain.Think(k.Memory, venue.Runtime, obs)
				input = { Steer = d.Steer, Throttle = d.Throttle, Brake = d.Brake, Drift = d.Drift, Trick = d.Trick }
				if inputOverride then
					local o2 = inputOverride(k.Key, obs)
					if o2 then
						input = o2
					end
				end
			end
			-- Mirror server effects the way the client honours them.
			k.Sim.Boosts = racer.Boosts
			k.Sim.Shards = racer.Shards
			local stun = racer.Effects.HitStun
			if stun then
				k.Sim.StunUntil = stun.EndsAt
				k.Sim.StunScale = stun.Params.SpeedScale or 0.5
			end
			local stall = racer.Effects.Stall
			if stall then
				k.Sim.StallUntil = stall.EndsAt
			end
			local slow = racer.Effects.Slow
			if slow then
				k.Sim.SlowScale = slow.Params.Scale or 0.8
				k.Sim.SlowUntil = slow.EndsAt
			end
			k.Sim:Step(input, dt, clock, venue.Runtime)
		end
	end
	env.World = world

	-- Player management -------------------------------------------------------------------------------------------
	env.AddPlayer = function(userId: number, name: string?): FakePlayer
		local p = FakeEnv.Player(userId, name)
		table.insert(players, p)
		env.Players.PlayerAdded:Fire(p)
		return p
	end
	env.RemovePlayer = function(p: FakePlayer)
		local idx = table.find(players, p)
		if idx then
			table.remove(players, idx)
		end
		p.Parent = nil
		env.Players.PlayerRemoving:Fire(p)
	end
	-- Advance the virtual clock by dt and fire one heartbeat.
	env.Advance = function(dt: number, raceService: any?)
		clock += dt
		if raceService then
			env.World.DriveHumans(dt, raceService)
		end
		env.Heartbeat:Fire(dt)
	end
	env.SetClock = function(t: number)
		clock = t
	end
	-- Client intent helper (goes through the validated dispatcher exactly like a RemoteEvent would).
	env.Send = function(player: any, name: string, ...: any)
		local args = table.pack(...)
		return env.Dispatcher:Handle(name, player, args.n, args)
	end
	env.Inbox = function(player: any, name: string): { any }
		local out = {}
		for _, m in player.Inbox do
			if m.Name == name then
				table.insert(out, m.Args)
			end
		end
		return out
	end
	env.LastMessage = function(player: any, name: string): any?
		for i = #player.Inbox, 1, -1 do
			if player.Inbox[i].Name == name then
				return player.Inbox[i].Args
			end
		end
		return nil
	end
	env.PlayersList = players
	return env
end

-- Builds a full server registry with all services on top of an env.
function FakeEnv.Boot(env: any): any
	local ServiceRegistry = RobloxEnv.Load("Server/ServiceRegistry")
	local registry = ServiceRegistry.new()
	registry:Set("Env", env)
	for _, name in { "TelemetryService", "SecurityService", "ModeService", "ProfileService", "RewardService", "PartyService", "RaceProgressService", "KartValidationService", "ItemService", "BotRacerService", "RaceService", "MatchmakingService", "LobbyService" } do
		local module = RobloxEnv.Load("Server/Services/" .. name)
		registry:Add(module.new())
	end
	registry:InitAll()
	registry:StartAll()
	return registry
end

return FakeEnv
