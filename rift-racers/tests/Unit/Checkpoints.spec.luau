--!strict
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local CheckpointSystem = Env.Load("Server/Systems/CheckpointSystem")
	local PlacementSystem = Env.Load("Server/Systems/PlacementSystem")

	local function shape(length: number, n: number, laps: number, minSector: number?)
		local dists = {}
		for i = 1, n do
			dists[i] = length * i / n
		end
		return { Length = length, CheckpointCount = n, CheckpointDists = dists, MinSectorTime = minSector or 0, Laps = laps }
	end

	local function drive(p, sh, from: number, to: number, step: number, t0: number, dt: number)
		local events = {}
		local t = t0
		local d = from
		while d < to do
			d = math.min(d + step, to)
			t += dt
			for _, e in CheckpointSystem.Update(p, d % sh.Length, t, sh, dt) do
				table.insert(events, e)
			end
		end
		return events, t
	end

	describe("CheckpointSystem", function()
		it("passes checkpoints in order and completes laps", function()
			local sh = shape(1000, 4, 2)
			local p = CheckpointSystem.NewProgress(0)
			local events = drive(p, sh, 0, 2000, 20, 0, 0.1)
			local kinds = {}
			for _, e in events do
				table.insert(kinds, e.Kind .. (e.Index and tostring(e.Index) or ""))
			end
			expect(kinds).toEqual({ "Checkpoint1", "Checkpoint2", "Checkpoint3", "Lap1", "Checkpoint1", "Checkpoint2", "Checkpoint3", "Finish" })
			expect(p.Lap).toBe(2)
			expect(p.FinishedAt).toBeTruthy()
			expect(#p.LapTimes).toBe(2)
		end)
		it("does not credit a lap when a checkpoint was skipped (teleport across sector)", function()
			local sh = shape(1000, 4, 3)
			local p = CheckpointSystem.NewProgress(0)
			drive(p, sh, 0, 300, 20, 0, 0.1)
			expect(p.Checkpoint).toBe(1)
			-- jump from 300 to 800 in one tick: teleport-sized (> sector*0.9) -> ignored
			local ev = CheckpointSystem.Update(p, 800, 10, sh, 0.1)
			expect(ev[1].Kind).toBe("Teleport")
			expect(p.Progress).toBe(300)
		end)
		it("caps effective progress at the next mandatory checkpoint when cutting", function()
			local sh = shape(1000, 4, 3)
			local p = CheckpointSystem.NewProgress(0)
			-- Move in moderate steps but skip checkpoint 2 by pretending a cut: progress advances 20/tick but we
			-- fake a 'Checkpoint' miss by starting from 260 -> 520 within allowed jumps (each step < maxJump).
			drive(p, sh, 0, 240, 20, 0, 0.1)
			expect(p.Checkpoint).toBe(0)
			-- jump legally sized steps from 240 to 520 crosses cp1 (250) and cp2 (500) in order -> both credited
			drive(p, sh, 240, 520, 20, 1, 0.1)
			expect(p.Checkpoint).toBe(2)
			expect(CheckpointSystem.EffectiveProgress(p, sh)).toBeCloseTo(520, 1e-6)
		end)
		it("refuses a finish crossed from the wrong direction and un-credits checkpoints when reversing", function()
			local sh = shape(1000, 4, 3)
			local p = CheckpointSystem.NewProgress(0)
			drive(p, sh, 0, 260, 20, 0, 0.1)
			expect(p.Checkpoint).toBe(1)
			-- reverse across checkpoint 1
			local ev = CheckpointSystem.Update(p, 240, 5, sh, 0.1)
			expect(ev[#ev].Kind).toBe("Backtrack")
			expect(p.Checkpoint).toBe(0)
			-- reverse across the finish line from 10 -> 990 with lap 0 does nothing but wrong-way accounting
			p.Progress = 10
			CheckpointSystem.Update(p, 990, 6, sh, 0.1)
			expect(p.Lap).toBe(0)
			-- now drive forward across the finish without checkpoints -> InvalidFinishCross, no lap
			local ev2 = CheckpointSystem.Update(p, 10, 7, sh, 0.1)
			expect(ev2[1].Kind).toBe("InvalidFinishCross")
			expect(p.Lap).toBe(0)
		end)
		it("flags impossible sector times", function()
			local sh = shape(1000, 4, 3, 5)
			local p = CheckpointSystem.NewProgress(0)
			-- 250 studs in 0.5s of sim time (steps of 20 over 13 ticks at dt 0.04) is below the 5s floor
			local events = drive(p, sh, 0, 260, 20, 0, 0.04)
			local kinds = {}
			for _, e in events do
				kinds[e.Kind] = true
			end
			expect(kinds.ImpossibleSector).toBe(true)
			expect(p.Checkpoint).toBe(0)
		end)
		it("raises WrongWay after sustained reversing", function()
			local sh = shape(1000, 4, 3)
			local p = CheckpointSystem.NewProgress(0)
			p.Progress = 500
			local sawWrongWay = false
			for i = 1, 40 do
				for _, e in CheckpointSystem.Update(p, 500 - i * 5, i * 0.1, sh, 0.1) do
					if e.Kind == "WrongWay" then
						sawWrongWay = true
					end
				end
			end
			expect(sawWrongWay).toBe(true)
		end)
	end)

	describe("PlacementSystem", function()
		it("ranks finished first, then laps, then checkpoint progress, then distance to next", function()
			local sh = shape(1000, 4, 3)
			local a = CheckpointSystem.NewProgress(0)
			a.FinishedAt = 100
			a.FinishPosition = 1
			local b = CheckpointSystem.NewProgress(0)
			b.Lap = 1
			b.Checkpoint = 2
			b.Progress = 600
			local c = CheckpointSystem.NewProgress(0)
			c.Lap = 1
			c.Checkpoint = 1
			c.Progress = 900 -- cut the course: progress ahead but checkpoint 2 missing -> capped at 500
			local d = CheckpointSystem.NewProgress(0)
			d.Lap = 0
			d.Checkpoint = 3
			d.Progress = 990
			local ranked = PlacementSystem.Rank({ { Key = "d", Progress = d }, { Key = "c", Progress = c }, { Key = "b", Progress = b }, { Key = "a", Progress = a } }, sh)
			local keys = {}
			for _, r in ranked do
				table.insert(keys, r.Key)
			end
			expect(keys).toEqual({ "a", "b", "c", "d" })
		end)
		it("buckets placements for item distribution", function()
			expect(PlacementSystem.Bucket(1, 8)).toBe("Front")
			expect(PlacementSystem.Bucket(4, 8)).toBe("Mid")
			expect(PlacementSystem.Bucket(6, 8)).toBe("Back")
			expect(PlacementSystem.Bucket(8, 8)).toBe("Last")
			expect(PlacementSystem.Bucket(1, 1)).toBe("Front")
		end)
	end)
end
