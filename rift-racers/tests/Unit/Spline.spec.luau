--!strict
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local Spline = Env.Load("Shared/Utility/Spline")
	local V = Env.Roblox().Vector3.new
	describe("Spline", function()
		it("computes a closed loop length close to a circle perimeter", function()
			local pts = {}
			for i = 0, 15 do
				local a = i / 16 * math.pi * 2
				table.insert(pts, V(math.cos(a) * 100, 0, math.sin(a) * 100))
			end
			local s = Spline.new(pts, 1, true, 16)
			expect(s.Length).toBeCloseTo(2 * math.pi * 100, 8)
		end)
		it("round-trips positions through ClosestProgress", function()
			local pts = { V(0, 0, 0), V(0, 0, 200), V(200, 0, 300), V(400, 0, 200), V(400, 0, -100), V(150, 0, -200) }
			local s = Spline.new(pts, 1, true, 16)
			for d = 0, s.Length - 1, 37 do
				local pos, _, right = s:SampleAt(d)
				local prog, lat, off = s:ClosestProgress(pos + right * 5, d)
				expect(math.abs(s:Delta(prog, d))).toBeLessThan(2)
				expect(lat).toBeCloseTo(5, 0.5)
				expect(off).toBeLessThan(5.5)
			end
		end)
		it("wraps and computes signed loop deltas", function()
			local pts = { V(0, 0, 0), V(0, 0, 100), V(100, 0, 100), V(100, 0, 0) }
			local s = Spline.new(pts, 1, true, 8)
			expect(s:Wrap(s.Length + 5)).toBeCloseTo(5, 1e-3)
			expect(s:Delta(s.Length - 5, 5)).toBeCloseTo(10, 1e-3)
			expect(s:Delta(5, s.Length - 5)).toBeCloseTo(-10, 1e-3)
		end)
		it("supports open shortcut splines", function()
			local s = Spline.new({ V(0, 0, 0), V(50, 0, 50), V(100, 0, 0) }, 1, false, 8)
			expect(s.Closed).toBe(false)
			expect(s:Wrap(-10)).toBe(0)
			expect(s:Wrap(s.Length + 10)).toBeCloseTo(s.Length, 1e-6)
		end)
	end)
end
