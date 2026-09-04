--!strict
-- Token-bucket rate limiter keyed by an arbitrary id (player+remote). Pure Luau; clock is injectable for tests.
export type Bucket = { Tokens: number, LastRefill: number }
export type RateLimiter = {
	TryConsume: (self: RateLimiter, key: string, cost: number?) -> boolean,
	Remove: (self: RateLimiter, key: string) -> (),
	RemovePrefix: (self: RateLimiter, prefix: string) -> (),
	Count: (self: RateLimiter) -> number,
}

local RateLimiter = {}
RateLimiter.__index = RateLimiter

function RateLimiter.new(capacity: number, refillPerSecond: number, clock: (() -> number)?): RateLimiter
	local self = setmetatable({
		_capacity = capacity,
		_refill = refillPerSecond,
		_clock = clock or os.clock,
		_buckets = {} :: { [string]: Bucket },
	}, RateLimiter)
	return (self :: any) :: RateLimiter
end

function RateLimiter.TryConsume(self: any, key: string, cost: number?): boolean
	local now = self._clock()
	local bucket: Bucket? = self._buckets[key]
	if bucket == nil then
		bucket = { Tokens = self._capacity, LastRefill = now }
		self._buckets[key] = bucket
	end
	local b = bucket :: Bucket
	local elapsed = math.max(0, now - b.LastRefill)
	b.Tokens = math.min(self._capacity, b.Tokens + elapsed * self._refill)
	b.LastRefill = now
	local c = cost or 1
	if b.Tokens >= c then
		b.Tokens -= c
		return true
	end
	return false
end

function RateLimiter.Remove(self: any, key: string)
	self._buckets[key] = nil
end

function RateLimiter.RemovePrefix(self: any, prefix: string)
	for k in self._buckets do
		if string.sub(k, 1, #prefix) == prefix then
			self._buckets[k] = nil
		end
	end
end

function RateLimiter.Count(self: any): number
	local n = 0
	for _ in self._buckets do
		n += 1
	end
	return n
end

return RateLimiter
