--!strict
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local TrackValidator = Env.Load("Server/Systems/TrackValidator")
	local TrackDefinitions = Env.Load("Shared/Config/TrackDefinitions")
	local Strings = Env.Load("Shared/Locale/Strings")
	local HeroDefinitions = Env.Load("Shared/Config/HeroDefinitions")
	local VehicleDefinitions = Env.Load("Shared/Config/VehicleDefinitions")
	local ItemDefinitions = Env.Load("Shared/Config/ItemDefinitions")
	local ModeDefinitions = Env.Load("Shared/Config/ModeDefinitions")
	local Locale = Env.Load("Shared/Locale/Locale")

	describe("TrackValidator", function()
		for _, def in TrackDefinitions.Tracks do
			it("validates " .. def.Id, function()
				local r = TrackValidator.ValidateDefinition(def)
				if not r.Ok then
					local msgs = {}
					for _, i in r.Issues do
						table.insert(msgs, i.Code .. ": " .. i.Message)
					end
					error(table.concat(msgs, "; "))
				end
				expect(r.LapLength).toBeGreaterThan(2500)
				expect(r.LapLength).toBeLessThan(9000)
			end)
		end
		for _, def in TrackDefinitions.Arenas do
			it("validates arena " .. def.Id, function()
				local r = TrackValidator.ValidateArena(def)
				if not r.Ok then
					local msgs = {}
					for _, i in r.Issues do
						table.insert(msgs, i.Code .. ": " .. i.Message)
					end
					error(table.concat(msgs, "; "))
				end
			end)
		end
		it("rejects a broken definition (duplicate ids, missing finish grid, bad surface)", function()
			local base = TrackDefinitions.Tracks[1]
			local broken = table.clone(base)
			broken.Id = "Broken"
			broken.GridRows = 1
			broken.SurfaceZones = { { From = 0.1, To = 0.2, Surface = "Lava" } }
			broken.HazardZones = { { Id = "X", At = 0.1, Kind = "Geyser" }, { Id = "X", At = 0.2, Kind = "Geyser" } }
			broken.Shortcuts = {}
			local r = TrackValidator.ValidateDefinition(broken)
			expect(r.Ok).toBe(false)
			local codes = {}
			for _, i in r.Issues do
				codes[i.Code] = true
			end
			expect(codes.GridTooSmall).toBe(true)
			expect(codes.UnknownSurface).toBe(true)
			expect(codes.DuplicateId).toBe(true)
			expect(codes.NoAlternativeRoute).toBe(true)
		end)
	end)

	describe("Content integrity", function()
		it("every hero, vehicle, item, mode, track and shortcut has EN and RU strings", function()
			local missing = {}
			local function check(key: string)
				local e = Strings[key]
				if not e or not e.en or not e.ru or e.ru == "" then
					table.insert(missing, key)
				end
			end
			for _, h in HeroDefinitions.List do
				check(h.NameKey)
				check(h.TaglineKey)
			end
			for _, v in VehicleDefinitions.List do
				check(v.NameKey)
				check(v.DescriptionKey)
			end
			for _, i in ItemDefinitions.List do
				check(i.NameKey)
				check(i.DescriptionKey)
			end
			for _, m in ModeDefinitions.List do
				check(m.NameKey)
				check(m.DescriptionKey)
			end
			for _, t in TrackDefinitions.Tracks do
				check(t.NameKey)
				check(t.DescriptionKey)
				for _, sc in t.Shortcuts do
					check(sc.NameKey)
				end
			end
			for _, a in TrackDefinitions.Arenas do
				check(a.NameKey)
				check(a.DescriptionKey)
			end
			expect(missing).toEqual({})
		end)
		it("Russian plural forms and formatting work", function()
			Locale.Set("ru")
			expect(Locale.Plural(1, "круг", "круга", "кругов")).toBe("круг")
			expect(Locale.Plural(3, "круг", "круга", "кругов")).toBe("круга")
			expect(Locale.Plural(11, "круг", "круга", "кругов")).toBe("кругов")
			expect(Locale.Plural(22, "круг", "круга", "кругов")).toBe("круга")
			expect(Locale.T("RACE.LAP", 2, 3)).toBe("Круг 2/3")
			expect(Locale.FormatNumber(1234567)).toBe("1 234 567")
			Locale.Set("en")
			expect(Locale.Ordinal(2)).toBe("2nd")
			expect(Locale.Ordinal(12)).toBe("12th")
			expect(Locale.FormatNumber(1234567)).toBe("1,234,567")
		end)
		it("no string references Nintendo IP", function()
			local banned = { "mario", "luigi", "peach", "bowser", "nintendo", "koopa", "yoshi" }
			for key, e in Strings do
				for _, w in banned do
					expect(string.find((e.en .. e.ru .. key):lower(), w)).toBeNil()
				end
			end
		end)
		it("time formatting handles bad inputs", function()
			local TimeUtil = Env.Load("Shared/Utility/TimeUtil")
			expect(TimeUtil.FormatRaceTime(nil)).toBe("--:--.---")
			expect(TimeUtil.FormatRaceTime(0 / 0)).toBe("--:--.---")
			expect(TimeUtil.FormatRaceTime(61.2345)).toBe("01:01.235")
		end)
	end)
end
