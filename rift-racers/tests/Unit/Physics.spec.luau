--!strict
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local KPM = Env.Load("Shared/Systems/KartPhysicsModel")
	local VehicleStats = Env.Load("Shared/Systems/VehicleStats")
	local GameConfig = Env.Load("Shared/Config/GameConfig")
	local Heroes = Env.Load("Shared/Config/HeroDefinitions")
	local Vehicles = Env.Load("Shared/Config/VehicleDefinitions")

	describe("KartPhysicsModel", function()
		it("has three drift tiers with increasing rewards", function()
			expect(KPM.DriftTier(0.5)).toBe(0)
			expect(KPM.DriftTier(1.0)).toBe(1)
			expect(KPM.DriftTier(2.5)).toBe(2)
			expect(KPM.DriftTier(4)).toBe(3)
			local b1, b2, b3 = KPM.DriftBoostFor(1), KPM.DriftBoostFor(2), KPM.DriftBoostFor(3)
			expect(b1.SpeedBonus).toBeLessThan(b2.SpeedBonus)
			expect(b2.SpeedBonus).toBeLessThan(b3.SpeedBonus)
			expect(KPM.DriftBoostFor(0)).toBeNil()
		end)
		it("rewards a weak drift with nothing", function()
			expect(KPM.DriftChargeRate(0.2, 1)).toBe(0)
			expect(KPM.DriftChargeRate(0.8, 0.3)).toBe(0)
			expect(KPM.DriftChargeRate(0.8, 0.9)).toBeGreaterThan(0)
		end)
		it("grades start boosts by timing offset", function()
			expect(KPM.EvaluateStartBoost(-2)).toBe("None")
			expect(KPM.EvaluateStartBoost(-0.6)).toBe("Early")
			expect(KPM.EvaluateStartBoost(-0.3)).toBe("Okay")
			expect(KPM.EvaluateStartBoost(-0.1)).toBe("Good")
			expect(KPM.EvaluateStartBoost(0.02)).toBe("Perfect")
			expect(KPM.EvaluateStartBoost(0.25)).toBe("Good")
			expect(KPM.EvaluateStartBoost(0.45)).toBe("Okay")
			expect(KPM.EvaluateStartBoost(1)).toBe("None")
			expect(KPM.StartBoostParams("Early").StallSeconds).toBeGreaterThan(0)
			expect(KPM.StartBoostParams("Perfect").SpeedBonus).toBeGreaterThan(KPM.StartBoostParams("Good").SpeedBonus)
		end)
		it("steers harder at low speed and never pivots in place", function()
			local stats = VehicleStats.Compute("NovaVale", "CometMk1")
			expect(KPM.SteerRate(0, stats, "Asphalt", false)).toBe(0)
			expect(KPM.SteerRate(0.3, stats, "Asphalt", false)).toBeGreaterThan(
				KPM.SteerRate(1, stats, "Asphalt", false)
			)
			expect(KPM.SteerRate(0.8, stats, "Asphalt", true)).toBeGreaterThan(
				KPM.SteerRate(0.8, stats, "Asphalt", false)
			)
		end)
		it("caps effective speed with boosts and shards", function()
			local stats = VehicleStats.Compute("NovaVale", "CometMk1")
			local now = 100
			local boosts = { KPM.MakeBoost("Drift3", 1, 0.32, stats, now) }
			local top = KPM.EffectiveTopSpeed(stats, "Asphalt", boosts, 10, now)
			expect(top).toBeCloseTo(stats.TopSpeed * (1 + 0.32 + GameConfig.Shards.MaxSpeedBonus), 1e-6)
			expect(KPM.ValidationSpeedCap(stats, "Asphalt", boosts, 10, now)).toBeLessThanOrEqual(
				VehicleStats.AbsoluteSpeedCap(stats)
			)
			KPM.PruneBoosts(boosts, now + 5)
			expect(#boosts).toBe(0)
		end)
		it("offroad vehicles lose less on dirt", function()
			local yak = VehicleStats.Compute("BrambleRook", "GlacierMule")
			local fang = VehicleStats.Compute("KitoEmber", "EmberFang")
			expect(KPM.SurfaceMultipliers("Dirt", yak).TopSpeed).toBeGreaterThan(
				KPM.SurfaceMultipliers("Dirt", fang).TopSpeed
			)
			expect(KPM.SurfaceMultipliers("Ice", yak).Grip).toBeCloseTo(KPM.SurfaceMultipliers("Ice", fang).Grip, 1e-6)
		end)
	end)

	describe("VehicleStats balance", function()
		it("keeps hero modifiers within the configured envelope", function()
			for _, h in Heroes.List do
				for _, k in { "Weight", "Acceleration", "Stability", "Recovery", "TrickEfficiency" } do
					expect(h.Modifier[k]).toBeGreaterThanOrEqual(Heroes.ModifierMin)
					expect(h.Modifier[k]).toBeLessThanOrEqual(Heroes.ModifierMax)
				end
			end
		end)
		it("normalises display stats to 0..100 for every combo", function()
			for _, h in Heroes.List do
				for _, v in Vehicles.List do
					for _, val in VehicleStats.DisplayStats(h.Id, v.Id) do
						expect(val).toBeGreaterThanOrEqual(0)
						expect(val).toBeLessThanOrEqual(100)
					end
				end
			end
		end)
		it("keeps top speed spread within 20% across vehicles", function()
			local lo, hi = math.huge, 0
			for _, v in Vehicles.List do
				lo = math.min(lo, v.Physics.TopSpeed)
				hi = math.max(hi, v.Physics.TopSpeed)
			end
			expect(hi / lo).toBeLessThan(1.2)
		end)
	end)
end
