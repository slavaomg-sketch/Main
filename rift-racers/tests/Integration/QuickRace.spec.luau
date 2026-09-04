--!strict
local task = require("@lune/task")
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local FakeEnv = require("../Lune/FakeEnv")

	describe("Integration: Quick Race end to end (2 humans + bots)", function()
		it("runs lobby -> queue -> vote -> grid -> countdown -> 3 laps -> results -> rewards -> save", function()
			local env = FakeEnv.new({ Seed = 11 })
			local registry = FakeEnv.Boot(env)
			local race = registry:Get("RaceService")
			local profiles = registry:Get("ProfileService")
			local p1 = env.AddPlayer(1001, "Ana")
			local p2 = env.AddPlayer(1002, "Boris")
			task.wait()
			expect(profiles:Get(p1)).toBeTruthy()
			expect(profiles:Get(p2)).toBeTruthy()
			expect(env.LastMessage(p1, "ProfileLoaded")).toBeTruthy()

			-- Both queue for Quick Race; the queue forms a match once the bot-fill wait elapses.
			expect((env.Send(p1, "QueueAction", "Join", "QuickRace"))).toBe(true)
			expect((env.Send(p2, "QueueAction", "Join", "QuickRace"))).toBe(true)
			local mm = registry:Get("MatchmakingService")
			env.Advance(1)
			mm:Poll()
			expect(#race:Sessions()).toBe(0)
			env.Advance(30)
			mm:Poll()
			expect(#race:Sessions()).toBe(1)
			local session = race:Sessions()[1]
			expect(session.SM.State).toBe("TrackVote")
			expect(#session.VoteOptions).toBe(3)
			expect(#session.Order).toBe(8) -- 2 humans + 6 bots to target size

			-- Vote (both for option 1) -> resolves early.
			expect((env.Send(p1, "VoteTrack", session.VoteOptions[1]))).toBe(true)
			expect((env.Send(p2, "VoteTrack", session.VoteOptions[1]))).toBe(true)
			env.Advance(0.1, race)
			expect(session.SM.State).toBe("LoadingTrack")
			expect(session.VenueId).toBe(session.VoteOptions[1])
			-- Clients report loaded + confirm loadout
			env.Send(p1, "TrackLoaded", session.VenueId)
			env.Send(p2, "TrackLoaded", session.VenueId)
			env.Advance(0.1, race)
			expect(session.SM.State).toBe("LoadoutLock")
			env.Send(p1, "LoadoutConfirm")
			env.Send(p2, "LoadoutConfirm")
			env.Advance(0.1, race)
			expect(session.SM.State).toBe("GridSetup")
			env.Advance(1.1, race)
			expect(session.SM.State).toBe("Countdown")
			-- Perfect start for p1, too early for p2
			env.SetClock(session.GoAt - 0.02)
			env.Send(p1, "StartThrottle")
			env.SetClock(session.GoAt - 0.6)
			env.Send(p2, "StartThrottle")
			env.SetClock(session.GoAt)
			env.Advance(0.05, race)
			expect(session.SM.State).toBe("Racing")
			expect(session.Racers.u1001.StartBoostResult).toBe("Perfect")
			expect(session.Racers.u1002.StartBoostResult).toBe("Early")

			-- Race: step at 20 Hz until results, max 8 virtual minutes.
			local ticks = 0
			local itemUses = 0
			while session.SM:Is("Racing", "FinishWindow") and ticks < 20 * 60 * 8 do
				env.Advance(0.05, race)
				ticks += 1
				if ticks % 40 == 0 then
					for _, p in { p1, p2 } do
						local r = session.Racers["u" .. p.UserId]
						if r.Items.Active then
							if env.Send(p, "UseItem", "Active") then
								itemUses += 1
							end
						end
					end
				end
			end
			expect(session.SM:Is("Results", "Rewards", "Returning")).toBe(true)
			local finished = 0
			for _, key in session.Order do
				if session.Racers[key].Progress.FinishedAt then
					finished += 1
				end
			end
			expect(finished).toBeGreaterThanOrEqual(2)
			expect(session.Racers.u1001.Progress.Lap).toBe(3)
			expect(itemUses).toBeGreaterThan(0)
			-- Results delivered once with a full ranking
			local results = env.LastMessage(p1, "Results")
			expect(results).toBeTruthy()
			expect(#results[1].Records).toBe(8)
			-- Rewards applied exactly once, profile dirty & saved
			env.Advance(1, race)
			local handle = profiles:Get(p1)
			expect(handle.Data.Currency).toBeGreaterThan(0)
			expect(handle.Data.XP).toBeGreaterThan(0)
			local processed = 0
			for _ in handle.Data.ProcessedRaceRewards do
				processed += 1
			end
			expect(processed).toBe(1)
			local before = handle.Data.Currency
			session:ApplyRewards() -- duplicate processing must be a no-op
			expect(handle.Data.Currency).toBe(before)
			expect(handle.Data.TrackRecords[session.VenueId]).toBeTruthy()
			-- Player chooses lobby; session ends
			env.Send(p1, "PostRaceChoice", "Lobby")
			env.Send(p2, "PostRaceChoice", "Lobby")
			env.Advance(1, race)
			env.Advance(1, race)
			expect(#race:Sessions()).toBe(0)
			-- Saved to the backend
			profiles:SaveAll()
			expect(env.ProfileBackend.Records["p_1001"].Data.Currency).toBe(before)
			registry:DestroyAll()
		end)
	end)
end
