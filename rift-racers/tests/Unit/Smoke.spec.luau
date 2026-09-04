--!strict
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	describe("Smoke: shared modules load", function()
		it("loads GameConfig with project name", function()
			local GameConfig = Env.Load("Shared/Config/GameConfig")
			expect(GameConfig.ProjectName).toBe("RIFT RACERS")
			expect(GameConfig.MaxRacers).toBe(12)
		end)
		it("loads definitions", function()
			expect(#Env.Load("Shared/Config/HeroDefinitions").List).toBe(8)
			expect(#Env.Load("Shared/Config/VehicleDefinitions").List).toBe(8)
			expect(#Env.Load("Shared/Config/ItemDefinitions").List).toBe(12)
			expect(#Env.Load("Shared/Config/TrackDefinitions").Tracks).toBe(6)
			expect(#Env.Load("Shared/Config/TrackDefinitions").Arenas).toBe(2)
		end)
		it("builds a spline for every track with a plausible lap length", function()
			local Spline = Env.Load("Shared/Utility/Spline")
			local Tracks = Env.Load("Shared/Config/TrackDefinitions")
			for _, t in Tracks.Tracks do
				local s = Spline.new(t.Path, t.Scale, true, 16)
				expect(s.Length).toBeGreaterThan(3000)
				expect(s.Length).toBeLessThan(9000)
			end
		end)
	end)
end
