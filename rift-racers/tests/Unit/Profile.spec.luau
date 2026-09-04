--!strict
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local ProfileStore = Env.Load("Server/Systems/ProfileStore")
	local Migrations = Env.Load("Server/Systems/Migrations")
	local ProfileTemplate = Env.Load("Server/Systems/ProfileTemplate")
	local RewardService = Env.Load("Server/Services/RewardService")

	local function store(backend, sessionId: string, clockRef)
		return ProfileStore.new(backend, sessionId, function()
			return clockRef.t
		end, function() end)
	end

	describe("Profile migrations", function()
		it("migrates v1 -> v3 preserving currency and converting unlock arrays to sets", function()
			local old = {
				SchemaVersion = 1,
				Coins = 250,
				UnlockedHeroes = { "NovaVale", "BoltFinch" },
				TrackRecords = { NeonHarborCircuit = { BestTime = 100, BestLap = 30 } },
			}
			local data, applied = Migrations.Apply(old, 1000)
			expect(applied).toEqual({ 2, 3 })
			expect(data.SchemaVersion).toBe(3)
			expect(data.Currency).toBe(250)
			expect(data.Coins).toBeNil()
			expect(data.UnlockedHeroes.NovaVale).toBe(true)
			expect(data.TrackRecords.NeonHarborCircuit.Assist).toBe(false)
			expect(data.Settings.Locale).toBe("en") -- reconciled from template
			expect(data.ProcessedPurchaseIds).toEqual({})
		end)
		it("refuses profiles newer than the server", function()
			expect(function()
				Migrations.Apply({ SchemaVersion = 99 }, 0)
			end).toThrow("newer")
		end)
	end)

	describe("ProfileStore session locking", function()
		it("loads, saves and releases with UpdateAsync and refuses a second session while locked", function()
			local backend = ProfileStore.MemoryBackend()
			local clock = { t = 5000 }
			local a = store(backend, "serverA", clock)
			local b = store(backend, "serverB", clock)
			local res = a:Load(7)
			expect(res.Ok).toBe(true)
			res.Handle.Data.Currency = 123
			res.Handle.Dirty = true
			expect(a:Save(res.Handle)).toBe(true)
			local locked = b:Load(7)
			expect(locked.Ok).toBe(false)
			expect(locked.Reason).toBe("SessionLocked")
			expect(a:Release(res.Handle)).toBe(true)
			local after = b:Load(7)
			expect(after.Ok).toBe(true)
			expect(after.Handle.Data.Currency).toBe(123)
		end)
		it("steals an expired lock and never lets the stale session overwrite", function()
			local backend = ProfileStore.MemoryBackend()
			local clock = { t = 1000 }
			local a = store(backend, "serverA", clock)
			local b = store(backend, "serverB", clock)
			local h = a:Load(9).Handle
			h.Data.Currency = 10
			a:Save(h)
			clock.t = 1000 + 500 -- beyond SessionLockTimeoutSeconds
			local res = b:Load(9)
			expect(res.Ok).toBe(true)
			res.Handle.Data.Currency = 999
			expect(b:Save(res.Handle)).toBe(true)
			-- Stale server A tries to save its old copy: refused (lock lost), data intact.
			h.Data.Currency = 10
			expect(a:Save(h)).toBe(false)
			expect(backend.Records["p_9"].Data.Currency).toBe(999)
		end)
		it("retries with backoff and fails safe without writing defaults", function()
			local backend = ProfileStore.MemoryBackend()
			backend.Records["p_3"] = { Data = { SchemaVersion = 3, Currency = 777 }, SavedAt = 0 }
			local clock = { t = 100 }
			local s = store(backend, "s", clock)
			backend.FailNext = 99
			local res = s:Load(3)
			expect(res.Ok).toBe(false)
			expect(backend.Records["p_3"].Data.Currency).toBe(777)
			local temp = s:Temporary(3)
			expect(temp.Status).toBe("Temporary")
			expect(s:Save(temp)).toBe(false)
			backend.FailNext = 0
			expect(backend.Records["p_3"].Data.Currency).toBe(777)
			-- Transient failure then success
			backend.FailNext = 2
			s:Release(temp)
			local ok = s:Load(3)
			expect(ok.Ok).toBe(true)
			expect(ok.Handle.Data.Currency).toBe(777)
		end)
	end)

	describe("Rewards", function()
		it("applies exactly once per RaceId+UserId and levels up", function()
			local FakeEnv = require("../Lune/FakeEnv")
			local env = FakeEnv.new()
			local registry = FakeEnv.Boot(env)
			local rewards = registry:Get("RewardService")
			local profile = ProfileTemplate.New(0)
			local ctx = {
				ModeId = "QuickRace",
				TrackId = "NeonHarborCircuit",
				Laps = 3,
				Record = {
					Key = "u1",
					Position = 1,
					TimeSeconds = 180,
					BestLap = 60,
					Finished = true,
					Team = 0,
					Points = 15,
					Shards = 4,
					Eliminated = false,
					StageReached = 0,
					Score = 0,
				},
				Total = 8,
				TourPosition = nil,
				TourFinal = false,
				KnockoutStages = 0,
				IsBattle = false,
				BattleWon = false,
				Assist = false,
				VehicleId = "CometMk1",
				HeroId = "NovaVale",
				Ghost = nil,
			}
			local b1 = rewards:Apply(profile, "race_1", 1, ctx, true)
			expect(b1).toBeTruthy()
			expect(profile.Currency).toBe(b1.Currency)
			expect(b1.NewRecord).toBe(true)
			local dup = rewards:Apply(profile, "race_1", 1, ctx, true)
			expect(dup).toBeNil()
			expect(profile.Currency).toBe(b1.Currency)
			local b2 = rewards:Apply(profile, "race_2", 1, ctx, false)
			expect(b2).toBeTruthy()
			expect(b2.NewRecord).toBe(false)
			expect(profile.Level).toBeGreaterThanOrEqual(1)
			registry:DestroyAll()
		end)
		it("level curve is monotonic and unlocks are granted at thresholds", function()
			local RewardConfig = Env.Load("Shared/Config/RewardConfig")
			local prev = -1
			for lvl = 1, RewardConfig.MaxLevel do
				local xp = RewardConfig.LevelCurve(lvl)
				expect(xp).toBeGreaterThan(prev)
				prev = xp
				expect(RewardConfig.LevelForXP(xp)).toBe(lvl)
			end
			local profile = ProfileTemplate.New(0)
			profile.Level = 3
			local unlocked = RewardService.EvaluateUnlocks(profile)
			expect(profile.UnlockedHeroes.BrambleRook).toBe(true)
			expect(#unlocked).toBeGreaterThanOrEqual(1)
		end)
	end)
end
