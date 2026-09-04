--!strict
local task = require("@lune/task")
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	local MatchmakingService = Env.Load("Server/Services/MatchmakingService")
	local FakeEnv = require("../Lune/FakeEnv")

	local function ticket(id: string, mode: string, users: { number }, created: number)
		return { Id = id, ModeId = mode, UserIds = users, CreatedAt = created, ExpiresAt = created + 90, ServerId = "s" }
	end

	describe("Matchmaking.FormMatches", function()
		it("waits for the target size or the bot-fill timeout", function()
			local t = { ticket("a", "QuickRace", { 1 }, 0), ticket("b", "QuickRace", { 2 }, 0) }
			expect(#MatchmakingService.FormMatches(t, 5, 25)).toBe(0)
			local m = MatchmakingService.FormMatches(t, 30, 25)
			expect(#m).toBe(1)
			expect(#m[1].UserIds).toBe(2)
			expect(m[1].BotCount).toBe(6)
		end)
		it("starts immediately with a full lobby and never splits a party", function()
			local t = {}
			for i = 1, 7 do
				table.insert(t, ticket("t" .. i, "QuickRace", { i }, 0))
			end
			table.insert(t, ticket("party", "QuickRace", { 100, 101, 102 }, 0))
			local m = MatchmakingService.FormMatches(t, 1, 25)
			expect(#m).toBe(1)
			-- 7 solos + a party of 3 = 10 <= 12 -> all in one match, party intact
			expect(#m[1].UserIds).toBe(10)
			expect(m[1].BotCount).toBe(0)
		end)
		it("keeps a party that does not fit for the next match instead of splitting it", function()
			local t = {}
			for i = 1, 11 do
				table.insert(t, ticket("t" .. i, "QuickRace", { i }, 0))
			end
			table.insert(t, ticket("party", "QuickRace", { 100, 101, 102, 103 }, 0))
			local m = MatchmakingService.FormMatches(t, 1, 25)
			expect(#m).toBe(1)
			expect(#m[1].UserIds).toBe(11)
			for _, u in m[1].UserIds do
				expect(u < 100).toBe(true)
			end
		end)
		it("expired tickets are ignored and modes never mix", function()
			local t = {
				ticket("a", "QuickRace", { 1 }, 0),
				ticket("b", "Knockout", { 2 }, 0),
				ticket("c", "QuickRace", { 3 }, 0),
			}
			t[1].ExpiresAt = 10
			local m = MatchmakingService.FormMatches(t, 50, 25)
			expect(#m).toBe(0) -- a expired; c alone < MinRealPlayers; b alone
			t[1].ExpiresAt = 100
			m = MatchmakingService.FormMatches(t, 50, 25)
			expect(#m).toBe(1)
			expect(m[1].ModeId).toBe("QuickRace")
		end)
	end)

	describe("Party & queue services", function()
		it("parties invite/accept/kick/leave with max size and act as one queue ticket", function()
			local env = FakeEnv.new()
			local registry = FakeEnv.Boot(env)
			local party = registry:Get("PartyService")
			local mm = registry:Get("MatchmakingService")
			local ps = {}
			for i = 1, 5 do
				ps[i] = env.AddPlayer(6000 + i, "M" .. i)
			end
			task.wait()
			env.Send(ps[1], "PartyAction", "Create")
			for i = 2, 5 do
				env.Send(ps[1], "PartyAction", "Invite", ps[i].UserId)
				env.Send(ps[i], "PartyAction", "Accept", ps[1].UserId)
			end
			expect(#party:Members(6001)).toBe(4) -- 5th refused: party full
			expect(env.LastMessage(ps[1], "ErrorDialog")[1]).toBe("ERROR.PARTY_FULL")
			-- non-leader cannot queue the party
			local ok, reason = mm:Join(6002, "QuickRace")
			expect(ok).toBe(false)
			expect(reason).toBe("NotPartyLeader")
			expect((mm:Join(6001, "QuickRace"))).toBe(true)
			expect(mm:TicketOf(6003)).toBeTruthy()
			expect(#mm:TicketOf(6001).UserIds).toBe(4)
			env.Send(ps[1], "PartyAction", "Kick", 6004)
			expect(#party:Members(6001)).toBe(3)
			env.Send(ps[1], "PartyAction", "Leave")
			expect(party:GetParty(6002).LeaderId).toBe(6002)
			mm:Leave(6001)
			expect(mm:TicketOf(6002)).toBeNil()
			-- private modes are not queueable
			local ok2, reason2 = mm:Join(6005, "TimeTrial")
			expect(ok2).toBe(false)
			expect(reason2).toBe("ModeNotPublic")
			registry:DestroyAll()
		end)
	end)
end
