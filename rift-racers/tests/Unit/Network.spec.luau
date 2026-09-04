--!strict
local task = require("@lune/task")
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local RateLimiter = Env.Load("Shared/Net/RateLimiter")
	local Validator = Env.Load("Shared/Net/Validator")
	local Network = Env.Load("Shared/Net/Network")
	local V = Env.Roblox().Vector3.new

	describe("RateLimiter", function()
		it("refills tokens over time", function()
			local now = 0
			local rl = RateLimiter.new(3, 1, function()
				return now
			end)
			expect(rl:TryConsume("a")).toBe(true)
			expect(rl:TryConsume("a")).toBe(true)
			expect(rl:TryConsume("a")).toBe(true)
			expect(rl:TryConsume("a")).toBe(false)
			now = 2
			expect(rl:TryConsume("a")).toBe(true)
			expect(rl:TryConsume("a")).toBe(true)
			expect(rl:TryConsume("a")).toBe(false)
			rl:RemovePrefix("a")
			expect(rl:Count()).toBe(0)
		end)
	end)

	describe("Validator", function()
		it("rejects NaN, inf, wrong types and out-of-range values", function()
			local num = { Type = "number", Min = 0, Max = 10 }
			expect((Validator.CheckValue(0 / 0, num))).toBe(false)
			expect((Validator.CheckValue(math.huge, num))).toBe(false)
			expect((Validator.CheckValue(-1, num))).toBe(false)
			expect((Validator.CheckValue(11, num))).toBe(false)
			expect((Validator.CheckValue("5", num))).toBe(false)
			expect((Validator.CheckValue(5, num))).toBe(true)
			expect((Validator.CheckValue(5.5, { Type = "integer" }))).toBe(false)
			expect((Validator.CheckValue(V(0 / 0, 0, 0), { Type = "vector3" }))).toBe(false)
			expect((Validator.CheckValue(string.rep("x", 200), { Type = "string", MaxLength = 128 }))).toBe(false)
			expect((Validator.CheckValue("Nope", { Type = "enum", Values = { "A", "B" } }))).toBe(false)
		end)
		it("rejects oversized and unexpected tables", function()
			local big = {}
			for i = 1, 100 do
				big[i] = i
			end
			expect((Validator.CheckValue(big, { Type = "table", MaxEntries = 32 }))).toBe(false)
			expect(
				(
					Validator.CheckValue(
						{ Laps = 3, Evil = 1 },
						{ Type = "table", Fields = { Laps = { Type = "integer" } } }
					)
				)
			).toBe(false)
			expect((Validator.CheckValue({ Laps = 3 }, { Type = "table", Fields = { Laps = { Type = "integer" } } }))).toBe(
				true
			)
		end)
	end)

	describe("Network dispatcher", function()
		local function make()
			local now = 0
			local d = Network.CreateDispatcher(function()
				return now
			end)
			return d, function(t)
				now = t
			end
		end
		it("routes valid calls to handlers and rejects schema violations", function()
			local d = make()
			local got = nil
			d:On("SelectLoadout", function(player, hero, vehicle)
				got = { player, hero, vehicle }
			end)
			local ok = d:Handle("SelectLoadout", { UserId = 1 }, 2, { "NovaVale", "CometMk1" })
			expect(ok).toBe(true)
			expect(got[2]).toBe("NovaVale")
			local ok2, rej = d:Handle("SelectLoadout", { UserId = 1 }, 2, { "Mario", "CometMk1" })
			expect(ok2).toBe(false)
			expect(rej.Reason).toBe("SchemaViolation")
		end)
		it("rate limits spam and reports rejections", function()
			local d = make()
			local rejections = 0
			d.Rejected:Connect(function()
				rejections += 1
			end)
			d:On("UseItem", function() end)
			d:SetStateProvider(function()
				return "Racing"
			end)
			local accepted = 0
			for _ = 1, 100 do
				if d:Handle("UseItem", { UserId = 7 }, 1, { "Active" }) then
					accepted += 1
				end
			end
			expect(accepted).toBeLessThanOrEqual(6)
			task.wait()
			expect(rejections).toBeGreaterThanOrEqual(94)
		end)
		it("gates remotes by race state", function()
			local d = make()
			d:On("VoteTrack", function() end)
			d:SetStateProvider(function()
				return "Racing"
			end)
			local ok, rej = d:Handle("VoteTrack", { UserId = 1 }, 1, { "NeonHarborCircuit" })
			expect(ok).toBe(false)
			expect(rej.Reason).toBe("WrongState")
		end)
		it("rejects Instances and unknown remotes", function()
			local d = make()
			d:On("ClientTelemetry", function() end)
			local inst = Env.Roblox().Instance.new("Part")
			local ok, rej = d:Handle("ClientTelemetry", { UserId = 1 }, 1, { { inst } })
			expect(ok).toBe(false)
			expect(rej.Reason).toBe("InstanceArgument")
			local ok2, rej2 = d:Handle("GrantCurrency", { UserId = 1 }, 1, { 99999 })
			expect(ok2).toBe(false)
			expect(rej2.Reason).toBe("UnknownRemote")
			local ok3, rej3 = d:Handle("ProfileUpdated", { UserId = 1 }, 1, { {} })
			expect(ok3).toBe(false)
			expect(rej3.Reason).toBe("UnknownRemote")
		end)
	end)
end
