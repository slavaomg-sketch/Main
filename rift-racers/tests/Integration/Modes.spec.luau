--!strict
local task = require("@lune/task")
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local FakeEnv = require("../Lune/FakeEnv")

	-- Drives a session from its current state through vote/load/grid/countdown into Racing.
	local function toRacing(env, race, session, players)
		if session.SM.State == "TrackVote" then
			for _, p in players do
				env.Send(p, "VoteTrack", session.VoteOptions[1])
			end
			env.Advance(0.1, race)
		end
		expect(session.SM.State).toBe("LoadingTrack")
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
	end

	local function runRace(env, race, session, maxMinutes: number?, onTick: ((number) -> ())?)
		local ticks = 0
		while session.SM:Is("Racing", "FinishWindow") and ticks < 20 * 60 * (maxMinutes or 8) do
			env.Advance(0.05, race)
			ticks += 1
			if onTick then
				onTick(ticks)
			end
		end
		return ticks
	end

	local function boot(seed: number, count: number)
		local env = FakeEnv.new({ Seed = seed })
		local registry = FakeEnv.Boot(env)
		local players = {}
		for i = 1, count do
			table.insert(players, env.AddPlayer(3000 + i, "P" .. i))
		end
		task.wait()
		return env, registry, registry:Get("RaceService"), players
	end

	describe("Modes", function()
		it("Grand Tour runs four races on distinct tracks and crowns a champion", function()
			local env, registry, race, players = boot(21, 2)
			local session = race:StartSession("GrandTour", players, { Laps = 1 }, { BotCount = 4 })
			for raceIndex = 1, 4 do
				toRacing(env, race, session, players)
				expect(session.RaceIndex).toBe(raceIndex)
				runRace(env, race, session, 6)
				expect(session.SM:Is("Results", "Rewards")).toBe(true)
				env.Advance(0.6, race) -- Results -> Rewards
				expect(session.SM.State).toBe("Rewards")
				if raceIndex < 4 then
					for _, p in players do
						env.Send(p, "PostRaceChoice", "ContinueTour")
					end
					env.Advance(0.1, race)
					expect(session.SM.State).toBe("TrackVote")
				end
			end
			expect(#session.PlayedTracks).toBe(4)
			local seen = {}
			for _, t in session.PlayedTracks do
				expect(seen[t]).toBeNil()
				seen[t] = true
			end
			local total = 0
			for _, pts in session.TourPoints do
				total += pts
			end
			expect(total).toBeGreaterThan(0)
			local profile = registry:Get("ProfileService"):Get(players[1])
			expect(#profile.Data.GrandTourResults).toBe(1)
			env.Advance(13, race)
			expect(#race:Sessions()).toBe(0)
			registry:DestroyAll()
		end)

		it("Knockout eliminates the tail at each gate and rewards by stage reached", function()
			local env, registry, race, players = boot(22, 2)
			local session = race:StartSession("Knockout", players, nil, { Venue = "NeonHarborCircuit", BotCount = 6 })
			toRacing(env, race, session, players)
			expect(session.Rules.KnockoutStages).toBe(3)
			runRace(env, race, session, 8)
			local eliminated, survivors = 0, 0
			for _, key in session.Order do
				if session.Racers[key].Progress.Eliminated then
					eliminated += 1
				else
					survivors += 1
				end
			end
			expect(eliminated).toBeGreaterThanOrEqual(3)
			expect(survivors).toBeGreaterThanOrEqual(2)
			expect(session.KnockoutStage).toBe(3)
			local results = session.Results
			expect(results).toBeTruthy()
			local Knockout = Env.Load("Server/Modes/Knockout")
			expect(Knockout.EliminationCount(8, 3)).toBe(2)
			expect(Knockout.EliminationCount(2, 1)).toBe(0)
			registry:DestroyAll()
		end)

		it("Time Trial: solo, no items, ghost recorded and served for the next attempt", function()
			local env, registry, race, players = boot(23, 1)
			local p = players[1]
			env.Send(p, "StartMode", "TimeTrial", "NeonHarborCircuit")
			local session = race:Sessions()[1]
			expect(session).toBeTruthy()
			expect(session.ModeId).toBe("TimeTrial")
			toRacing(env, race, session, players)
			expect(#session.Pads).toBe(0)
			expect(#session.Order).toBe(1)
			runRace(env, race, session, 8)
			env.Advance(0.6, race)
			local profile = registry:Get("ProfileService"):Get(p)
			local rec = profile.Data.TrackRecords.NeonHarborCircuit
			expect(rec).toBeTruthy()
			expect(rec.Ghost).toBeTruthy()
			expect(#rec.Ghost).toBeLessThan(60000) -- compact
			local Ghost = Env.Load("Server/Systems/GhostRecordingSystem")
			local g = Ghost.Deserialize(rec.Ghost)
			expect(g.Frames[1]).toBeTruthy()
			expect(#g.Frames).toBeLessThan(rec.BestTime * 10 + 5) -- never more than SampleHz per second
			local pose = Ghost.PoseAt(g, g.TimeSeconds / 2)
			expect(pose).toBeTruthy()
			local ok, _, served = env.Send(p, "GetRecords", "NeonHarborCircuit")
			expect(ok).toBe(true)
			expect(served.BestTime).toBe(rec.BestTime)
			registry:DestroyAll()
		end)

		it("Team Race assigns balanced teams and scores by team points", function()
			local env, registry, race, players = boot(24, 2)
			local session = race:StartSession(
				"TeamRace",
				players,
				{ Laps = 1 },
				{ Venue = "CloudgardenRun", BotCount = 6 }
			)
			toRacing(env, race, session, players)
			local counts = {}
			for _, key in session.Order do
				local t = session.Racers[key].Team
				expect(t).toBeGreaterThan(0)
				counts[t] = (counts[t] or 0) + 1
			end
			expect(counts[1]).toBe(4)
			expect(counts[2]).toBe(4)
			runRace(env, race, session, 6)
			expect(session.Results.TeamScores).toBeTruthy()
			expect(session.Results.TeamScores[1] + session.Results.TeamScores[2]).toBeGreaterThan(0)
			registry:DestroyAll()
		end)

		it("Core Clash: cores drop on hits, recovery restores them, timer ends the battle", function()
			local env, registry, race, players = boot(25, 2)
			local session = race:StartSession("CoreClash", players, nil, { Venue = "PrismBowl", BotCount = 2 })
			expect(session.IsArena).toBe(true)
			toRacing(env, race, session, players)
			local items = registry:Get("ItemService")
			local a, b = "u3001", "u3002"
			expect(session.Racers[b].Cores).toBe(3)
			for _ = 1, 3 do
				session.Racers[b].HitImmuneUntil = 0
				items:ApplyHit(session, a, b, "PulseDisc", 1, env.Now())
				env.Advance(2.5, race)
			end
			expect(session.Racers[b].Cores).toBe(0)
			expect(session.Racers[a].Score).toBeGreaterThanOrEqual(3)
			env.Advance(7, race)
			expect(session.Racers[b].Cores).toBe(3)
			env.SetClock(session.BattleEndsAt + 0.1)
			env.Advance(0.05, race)
			expect(session.SM:Is("Results", "Rewards")).toBe(true)
			expect(session.Results.Records[1].Key).toBe(a)
			registry:DestroyAll()
		end)

		it("Shard Rush: shards score, hits drop shards, most shards wins at the buzzer", function()
			local env, registry, race, players = boot(26, 2)
			local session = race:StartSession(
				"ShardRush",
				players,
				{ Teams = 2 },
				{ Venue = "ScrapworksArena", BotCount = 2 }
			)
			toRacing(env, race, session, players)
			local items = registry:Get("ItemService")
			session.Racers.u3001.Shards = 8
			session.Racers.u3002.Shards = 5
			session.Racers.u3002.HitImmuneUntil = 0
			local res = items:ApplyHit(session, "u3001", "u3002", "HunterWisp", 2, env.Now())
			-- Same team may block the hit: force cross-team by checking outcome.
			if res.Outcome == "Friendly" then
				session.Racers.u3002.Team = 3 - session.Racers.u3001.Team
				res = items:ApplyHit(session, "u3001", "u3002", "HunterWisp", 2, env.Now())
			end
			expect(res.Outcome).toBe("Hit")
			expect(session.Racers.u3002.Shards).toBe(2)
			env.SetClock(session.BattleEndsAt + 0.1)
			env.Advance(0.05, race)
			expect(session.SM:Is("Results", "Rewards")).toBe(true)
			expect(session.Results.Records[1].Key).toBe("u3001")
			expect(session.Results.TeamScores).toBeTruthy()
			registry:DestroyAll()
		end)

		it("Private room: validated rules reach the session (mirror, laps, bots, items)", function()
			local env, registry, race, players = boot(27, 2)
			local owner, guest = players[1], players[2]
			expect(
				(
					env.Send(
						owner,
						"CustomRoomAction",
						"Create",
						{
							TrackId = "NeonHarborCircuit",
							Laps = 2,
							BotCount = 3,
							BotDifficulty = "Hard",
							Mirror = true,
							AllowedItems = { "NitroCell", "PulseDisc" },
							SpeedClass = "Swift",
						}
					)
				)
			).toBe(true)
			expect((env.Send(guest, "CustomRoomAction", "Join", {}, owner.UserId))).toBe(true)
			-- Guest cannot start or change rules
			env.Send(guest, "CustomRoomAction", "Update", { Laps = 7 })
			env.Send(guest, "CustomRoomAction", "Start", {})
			expect(#race:Sessions()).toBe(0)
			expect((env.Send(owner, "CustomRoomAction", "Start", {}))).toBe(true)
			local session = race:Sessions()[1]
			expect(session).toBeTruthy()
			expect(session.ModeId).toBe("CustomRace")
			expect(session.Rules.Laps).toBe(2)
			expect(session.Rules.Mirror).toBe(true)
			expect(session.Track.Mirror).toBe(true)
			expect(session.Rules.BotCount).toBe(3)
			expect(session.Rules.SpeedClass).toBe("Swift")
			expect(#session.Order).toBe(5)
			toRacing(env, race, session, players)
			-- Only allowed items are ever granted
			local items = registry:Get("ItemService")
			for _ = 1, 30 do
				session.Racers.u3001.Items = { Active = nil, Reserve = nil }
				local id = items:Grant(session, "u3001", env.Now())
				if id then
					expect(id == "NitroCell" or id == "PulseDisc").toBe(true)
				end
			end
			expect(session.Extra.u3001.Stats.TopSpeed).toBeGreaterThan(92)
			registry:DestroyAll()
		end)

		it("Practice loop keeps running while a human is present and ends when they leave", function()
			local env, registry, race, players = boot(28, 1)
			env.Send(players[1], "StartMode", "Practice")
			local session = race:Sessions()[1]
			expect(session.ModeId).toBe("Practice")
			expect(session.VenueId).toBe("NeonHarborCircuit")
			toRacing(env, race, session, players)
			for _ = 1, 200 do
				env.Advance(0.05, race)
			end
			expect(session.SM.State).toBe("Racing")
			env.RemovePlayer(players[1])
			task.wait()
			expect(#race:Sessions()).toBe(0)
			registry:DestroyAll()
		end)
	end)

	describe("Disconnects and failures", function()
		it("a player leaving mid-race becomes DNF and the race finishes for the rest", function()
			local env, registry, race, players = boot(29, 2)
			local session = race:StartSession(
				"QuickRace",
				players,
				{ Laps = 1 },
				{ Venue = "NeonHarborCircuit", BotCount = 2 }
			)
			toRacing(env, race, session, players)
			for _ = 1, 100 do
				env.Advance(0.05, race)
			end
			env.RemovePlayer(players[2])
			task.wait()
			expect(session.Racers.u3002.Connected).toBe(false)
			runRace(env, race, session, 6)
			expect(session.Results).toBeTruthy()
			local dnf = nil
			for _, rec in session.Results.Records do
				if rec.Key == "u3002" then
					dnf = rec
				end
			end
			expect(dnf.Finished).toBe(false)
			expect(#session.Results.Records).toBe(4)
			registry:DestroyAll()
		end)
		it("a player leaving after finishing still receives rewards exactly once", function()
			local env, registry, race, players = boot(30, 2)
			local profiles = registry:Get("ProfileService")
			local session = race:StartSession(
				"QuickRace",
				players,
				{ Laps = 1 },
				{ Venue = "NeonHarborCircuit", BotCount = 0 }
			)
			toRacing(env, race, session, players)
			runRace(env, race, session, 6, function()
				if session.Racers.u3001.Progress.FinishedAt and players[1].Parent then
					env.RemovePlayer(players[1])
				end
			end)
			task.wait()
			local rec = env.ProfileBackend.Records["p_3001"]
			expect(rec).toBeTruthy()
			expect(rec.Data.Currency).toBeGreaterThan(0)
			local processed = 0
			for _ in rec.Data.ProcessedRaceRewards do
				processed += 1
			end
			expect(processed).toBe(1)
			expect(profiles:GetByUserId(3001)).toBeNil()
			registry:DestroyAll()
		end)
		it("DataStore outage: player gets a temporary profile, cannot buy, real data is never overwritten", function()
			local env = FakeEnv.new({ Seed = 31 })
			env.ProfileBackend.Records["p_4001"] = { Data = { SchemaVersion = 3, Currency = 5000 }, SavedAt = 0 }
			env.ProfileBackend.FailNext = 99
			local registry = FakeEnv.Boot(env)
			local p = env.AddPlayer(4001, "Unlucky")
			task.wait()
			local profiles = registry:Get("ProfileService")
			expect(profiles:IsTemporary(p)).toBe(true)
			expect(env.LastMessage(p, "ErrorDialog")[1]).toBe("ERROR.PROFILE_LOAD_FAILED")
			env.ProfileBackend.FailNext = 0
			expect((env.Send(p, "RequestUnlock", "Hero", "KitoEmber", "x1"))).toBe(true)
			expect(env.LastMessage(p, "ErrorDialog")[1]).toBe("ERROR.PURCHASE_DISABLED")
			profiles:SaveAll()
			env.RemovePlayer(p)
			task.wait()
			expect(env.ProfileBackend.Records["p_4001"].Data.Currency).toBe(5000)
			registry:DestroyAll()
		end)
		it("teleport failure returns players to the queue with an error", function()
			local env = FakeEnv.new({ Seed = 32 })
			env.Teleport.LocalMode = false
			env.Teleport.ReserveAndTeleport = function()
				return false, "boom"
			end
			local registry = FakeEnv.Boot(env)
			local p1 = env.AddPlayer(5001, "A")
			local p2 = env.AddPlayer(5002, "B")
			task.wait()
			env.Send(p1, "QueueAction", "Join", "QuickRace")
			env.Send(p2, "QueueAction", "Join", "QuickRace")
			local mm = registry:Get("MatchmakingService")
			env.Advance(30)
			mm:Poll()
			task.wait()
			expect(env.LastMessage(p1, "ErrorDialog")[1]).toBe("ERROR.TELEPORT_FAILED")
			expect(mm:TicketOf(5001)).toBeTruthy()
			registry:DestroyAll()
		end)
	end)
end
