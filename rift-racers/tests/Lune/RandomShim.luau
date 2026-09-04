--!strict
-- Deterministic Random shim for Lune (Roblox provides Random natively). xorshift64* based.
local RandomShim = {}
RandomShim.__index = RandomShim

function RandomShim.new(seed: number?)
	local s = math.floor((seed or os.clock() * 1e6) % 2147483647)
	if s == 0 then
		s = 1
	end
	return setmetatable({ _state = s }, RandomShim)
end

local function nextRaw(self: any): number
	-- Park-Miller minimal standard generator (period 2^31-2), plenty for tests.
	local x = self._state
	x = (x * 48271) % 2147483647
	self._state = x
	return x
end

function RandomShim:NextNumber(min: number?, max: number?): number
	local r = nextRaw(self) / 2147483647
	if min ~= nil and max ~= nil then
		return min + (max - min) * r
	end
	return r
end

function RandomShim:NextInteger(min: number, max: number): number
	local r = nextRaw(self)
	return min + (r % (max - min + 1))
end

function RandomShim:NextUnitVector(): any
	local Vector3 = (require("@lune/roblox") :: any).Vector3
	local theta = self:NextNumber() * math.pi * 2
	local z = self:NextNumber() * 2 - 1
	local r = math.sqrt(1 - z * z)
	return Vector3.new(r * math.cos(theta), r * math.sin(theta), z)
end

function RandomShim:Shuffle(t: { any })
	for i = #t, 2, -1 do
		local j = self:NextInteger(1, i)
		t[i], t[j] = t[j], t[i]
	end
end

return RandomShim
