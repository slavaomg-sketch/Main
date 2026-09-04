--!strict
-- Headless load experiments: full race sessions with N participants driven at 20 Hz. Measures server tick cost.
-- Physics here is KartSim (kinematic), so numbers bound the game logic cost, not Roblox physics/rendering.
local task = require("@lune/task")
local fs = require("@lune/fs")
local serde = require("@lune/serde")
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local FakeEnv = require("../Lune/FakeEnv")
	local results = {}

	local function runLoad(n: number, humans: number, seed: number)
		local env = FakeEnv.new({ Seed = seed })
		local registry = FakeEnv.Boot(env)
		local race = registry:Get("RaceService")
		local players = {}
		for i = 1, humans do
			table.insert(players, env.AddPlayer(7000 + i, "H" .. i))
		end
		task.wait()
		local session = race:StartSession(
			"QuickRace",
			players,
			{ Laps = 2 },
			{ Venue = "EmberglassCaldera", BotCount = 0 }
		)
		registry:Get("BotRacerService"):Fill(session, n - humans, "Normal")
		for _, p in players do
			env.Send(p, "TrackLoaded", session.VenueId)
		end
		env.Advance(0.1, race)
		for _, p in players do
			env.Send(p, "LoadoutConfirm")
		end
		env.Advance(0.1, race)
		env.Advance(1.1, race)
		env.SetClock(session.GoAt)
		env.Advance(0.05, race)
		expect(session.SM.State).toBe("Racing")
		expect(#session.Order).toBe(n)
		local tickTimes = {}
		local ticks = 0
		local t0 = os.clock()
		while session.SM:Is("Racing", "FinishWindow") and ticks < 20 * 60 * 6 do
			local s = os.clock()
			env.Advance(0.05, race)
			table.insert(tickTimes, os.clock() - s)
			ticks += 1
			if ticks % 40 == 0 then
				for _, p in players do
					local r = session.Racers["u" .. p.UserId]
					if r.Items.Active then
						env.Send(p, "UseItem", "Active")
					end
				end
			end
		end
		local wall = os.clock() - t0
		table.sort(tickTimes)
		local sum = 0
		for _, t in tickTimes do
			sum += t
		end
		local finished = 0
		for _, key in session.Order do
			if session.Racers[key].Progress.FinishedAt then
				finished += 1
			end
		end
		local msgs = 0
		for _, p in players do
			msgs += #p.Inbox
		end
		local row = {
			Participants = n,
			Humans = humans,
			Bots = n - humans,
			Ticks = ticks,
			VirtualSeconds = ticks * 0.05,
			WallSeconds = wall,
			AvgTickMs = sum / #tickTimes * 1000,
			P95TickMs = tickTimes[math.floor(#tickTimes * 0.95)] * 1000,
			MaxTickMs = tickTimes[#tickTimes] * 1000,
			Finished = finished,
			Results = session.SM:Is("Results", "Rewards"),
			Projectiles = registry:Get("TelemetryService"):Get("item.used.PulseDisc")
				+ registry:Get("TelemetryService"):Get("item.used.HunterWisp"),
		}
		registry:DestroyAll()
		return row
	end

	describe("Multiplayer load (headless)", function()
		for _, n in { 2, 4, 8, 12, 16, 24 } do
			it(string.format("%d participants finish a 2-lap race", n), function()
				local humans = math.min(2, n)
				local row = runLoad(n, humans, 100 + n)
				table.insert(results, row)
				print(
					string.format(
						"      load n=%d avg %.2fms p95 %.2fms max %.2fms finished %d/%d wall %.1fs",
						n,
						row.AvgTickMs,
						row.P95TickMs,
						row.MaxTickMs,
						row.Finished,
						n,
						row.WallSeconds
					)
				)
				expect(row.Results).toBe(true)
				-- Supported sizes (<= MaxRacers) must finish cleanly; 16/24 are recorded experiments (see PERFORMANCE_REPORT).
				if n <= 12 then
					expect(row.Finished).toBeGreaterThanOrEqual(math.floor(n * 0.9))
					-- Budget: server logic tick for 12 racers must stay well under a 50 ms frame at 20 Hz.
					expect(row.AvgTickMs).toBeLessThan(10)
				end
			end)
		end
		it("writes the load results for the performance report", function()
			if not fs.isDir("build") then
				fs.writeDir("build")
			end
			fs.writeFile("build/load_results.json", serde.encode("json", results, true))
			expect(#results).toBe(6)
		end)
	end)
end
