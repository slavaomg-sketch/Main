--!strict
-- Automated balance comparison: every hero/vehicle combo laps the reference track with the same Hard driver.
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local KartSim = Env.Load("Server/Systems/KartSim")
	local BotBrain = Env.Load("Server/Systems/BotBrain")
	local TrackRuntime = Env.Load("Server/Systems/TrackRuntime")
	local TrackDefinitions = Env.Load("Shared/Config/TrackDefinitions")
	local VehicleDefinitions = Env.Load("Shared/Config/VehicleDefinitions")
	local HeroDefinitions = Env.Load("Shared/Config/HeroDefinitions")
	local VehicleStats = Env.Load("Shared/Systems/VehicleStats")
	local track = TrackRuntime.new(TrackDefinitions.TrackById.NeonHarborCircuit, false)

	local function lapTime(heroId: string, vehicleId: string, difficulty: string, seed: number): number
		local stats = VehicleStats.Compute(heroId, vehicleId)
		local sim = KartSim.new(stats, track.Spline:CFrameAt(track.Length - 20, 0, 3))
		sim.Progress = track.Length - 20
		local mem = BotBrain.NewMemory(difficulty, seed)
		local now, dt = 0, 0.05
		local laps, prev = 0, sim.Progress
		local elapsed = 0
		local started = false
		while elapsed < 400 do
			local obs = {
				Position = sim.Position,
				Forward = sim:Forward(),
				Speed = sim.Speed,
				TopSpeed = stats.TopSpeed,
				Progress = sim.Progress,
				Grounded = not sim.Airborne,
				HasItem = false,
				ItemKind = nil,
				RivalAhead = nil,
				RivalBehind = nil,
				Obstacles = {},
				OnJump = track:JumpAt(sim.Progress) ~= nil,
				Now = now,
				RubberBand = 1,
			}
			local d = BotBrain.Think(mem, track, obs)
			sim:Step(
				{ Steer = d.Steer, Throttle = d.Throttle, Brake = d.Brake, Drift = d.Drift, Trick = d.Trick },
				dt,
				now,
				track
			)
			now += dt
			if prev > track.Length * 0.9 and sim.Progress < track.Length * 0.1 then
				if started then
					return elapsed
				end
				started = true
				elapsed = 0
			end
			if started then
				elapsed += dt
			end
			prev = sim.Progress
		end
		return elapsed
	end

	describe("Balance", function()
		it("all eight vehicles lap within a narrow band with the same driver", function()
			local times = {}
			local lo, hi = math.huge, 0
			for _, v in VehicleDefinitions.List do
				local t = lapTime("NovaVale", v.Id, "Hard", 5)
				times[v.Id] = t
				lo = math.min(lo, t)
				hi = math.max(hi, t)
			end
			local parts = {}
			for id, t in times do
				table.insert(parts, string.format("%s=%.1fs", id, t))
			end
			table.sort(parts)
			print("      lap times: " .. table.concat(parts, " "))
			expect(lo).toBeGreaterThan(40)
			expect(hi / lo).toBeLessThan(1.12)
		end)
		it("hero modifiers change lap time by less than 4%", function()
			local lo, hi = math.huge, 0
			for _, h in HeroDefinitions.List do
				local t = lapTime(h.Id, "CometMk1", "Hard", 5)
				lo = math.min(lo, t)
				hi = math.max(hi, t)
			end
			expect(hi / lo).toBeLessThan(1.04)
		end)
		it("bot difficulties are ordered Easy > Normal > Hard by lap time", function()
			local easy = lapTime("NovaVale", "CometMk1", "Easy", 9)
			local normal = lapTime("NovaVale", "CometMk1", "Normal", 9)
			local hard = lapTime("NovaVale", "CometMk1", "Hard", 9)
			print(string.format("      bots easy %.1fs normal %.1fs hard %.1fs", easy, normal, hard))
			expect(easy).toBeGreaterThan(normal)
			expect(normal).toBeGreaterThan(hard)
		end)
		it("every track is completable by a Normal bot within the target lap window", function()
			for _, def in TrackDefinitions.Tracks do
				local rt = TrackRuntime.new(def, false)
				local stats = VehicleStats.Compute("NovaVale", "CometMk1")
				local sim = KartSim.new(stats, rt.Spline:CFrameAt(rt.Length - 20, 0, 3))
				sim.Progress = rt.Length - 20
				local mem = BotBrain.NewMemory("Normal", 3)
				local now, dt = 0, 0.05
				local prev = sim.Progress
				local crossed = 0
				local lapStart = 0
				local lapTimes = {}
				while now < 400 and #lapTimes < 2 do
					local obs = {
						Position = sim.Position,
						Forward = sim:Forward(),
						Speed = sim.Speed,
						TopSpeed = stats.TopSpeed,
						Progress = sim.Progress,
						Grounded = not sim.Airborne,
						HasItem = false,
						ItemKind = nil,
						RivalAhead = nil,
						RivalBehind = nil,
						Obstacles = {},
						OnJump = rt:JumpAt(sim.Progress) ~= nil,
						Now = now,
						RubberBand = 1,
					}
					local d = BotBrain.Think(mem, rt, obs)
					sim:Step(
						{ Steer = d.Steer, Throttle = d.Throttle, Brake = d.Brake, Drift = d.Drift, Trick = d.Trick },
						dt,
						now,
						rt
					)
					now += dt
					if prev > rt.Length * 0.9 and sim.Progress < rt.Length * 0.1 then
						crossed += 1
						if crossed >= 2 then
							table.insert(lapTimes, now - lapStart)
						end
						lapStart = now
					end
					prev = sim.Progress
				end
				expect(#lapTimes).toBe(2)
				print(string.format("      %s lap %.1fs (%.0f studs)", def.Id, lapTimes[2], rt.Length))
				expect(lapTimes[2]).toBeGreaterThan(45)
				expect(lapTimes[2]).toBeLessThan(180)
			end
		end)
	end)
end
