--!strict
-- DataStore-backed profile store with session locking, UpdateAsync, retries with exponential backoff and migrations.
-- The store backend is injected so tests use an in-memory fake with failure injection.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local GameConfig = require(Shared.Config.GameConfig)
local ProfileTypes = require(Shared.Types.ProfileTypes)
local ProfileTemplate = require(script.Parent.ProfileTemplate)
local Migrations = require(script.Parent.Migrations)

type Profile = ProfileTypes.Profile
type ProfileHandle = ProfileTypes.ProfileHandle

export type Backend = {
	UpdateAsync: (self: Backend, key: string, transform: (old: any) -> any?) -> any,
	GetAsync: (self: Backend, key: string) -> any,
}

export type LoadResult = { Ok: boolean, Handle: ProfileHandle?, Reason: string?, Migrated: { number }? }

export type ProfileStore = {
	Load: (self: ProfileStore, userId: number) -> LoadResult,
	Save: (self: ProfileStore, handle: ProfileHandle) -> boolean,
	Release: (self: ProfileStore, handle: ProfileHandle) -> boolean,
	Get: (self: ProfileStore, userId: number) -> ProfileHandle?,
	Loaded: (self: ProfileStore) -> { ProfileHandle },
	Temporary: (self: ProfileStore, userId: number) -> ProfileHandle,
}

local ProfileStore = {}
ProfileStore.__index = ProfileStore

type Record = { Data: { [string]: any }, SessionLock: { SessionId: string, LockedAt: number }?, SavedAt: number }

function ProfileStore.new(backend: Backend, sessionId: string, clock: (() -> number)?, sleep: ((number) -> ())?)
	return setmetatable({
		_backend = backend,
		_sessionId = sessionId,
		_clock = clock or os.time,
		_sleep = sleep or task.wait,
		_handles = {} :: { [number]: ProfileHandle },
	}, ProfileStore)
end

local function keyFor(userId: number): string
	return "p_" .. tostring(userId)
end

local function withRetry(self: any, fn: () -> (boolean, any)): (boolean, any)
	local delay = GameConfig.Profile.RetryBaseSeconds
	local lastErr: any = nil
	for attempt = 1, GameConfig.Profile.MaxRetries do
		local ok, result = fn()
		if ok then
			return true, result
		end
		lastErr = result
		if attempt < GameConfig.Profile.MaxRetries then
			self._sleep(delay)
			delay *= 2
		end
	end
	return false, lastErr
end

function ProfileStore.Load(self: any, userId: number): LoadResult
	if self._handles[userId] then
		return { Ok = true, Handle = self._handles[userId] }
	end
	local now = self._clock()
	local lockedByOther = false
	local migrated: { number } = {}
	local loadedData: { [string]: any }? = nil
	local ok, err = withRetry(self, function()
		lockedByOther = false
		local success, result = pcall(function()
			return self._backend:UpdateAsync(keyFor(userId), function(old: Record?): Record?
				local record: Record = old
					or { Data = ProfileTemplate.New(now) :: any, SessionLock = nil, SavedAt = now }
				if type(record.Data) ~= "table" then
					record.Data = ProfileTemplate.New(now) :: any
				end
				local lock = record.SessionLock
				if
					lock
					and lock.SessionId ~= self._sessionId
					and (now - lock.LockedAt) < GameConfig.Profile.SessionLockTimeoutSeconds
				then
					lockedByOther = true
					return nil -- abort the write
				end
				local data, applied = Migrations.Apply(record.Data, now)
				migrated = applied
				record.Data = data
				record.SessionLock = { SessionId = self._sessionId, LockedAt = now }
				return record
			end)
		end)
		if not success then
			return false, result
		end
		if lockedByOther then
			return false, "SessionLocked"
		end
		if result == nil then
			return false, "NoRecord"
		end
		loadedData = (result :: Record).Data
		return true, result
	end)
	if not ok then
		return { Ok = false, Reason = tostring(err) }
	end
	local data = loadedData :: { [string]: any }
	data.LastSeenAt = now
	local handle: ProfileHandle = {
		UserId = userId,
		Data = data :: any,
		Status = "Loaded",
		Dirty = false,
		LoadedAt = now,
		SessionId = self._sessionId,
	}
	self._handles[userId] = handle
	return { Ok = true, Handle = handle, Migrated = migrated }
end

-- Writes only if we still own the lock; never overwrites a real profile with fallback data.
function ProfileStore.Save(self: any, handle: ProfileHandle): boolean
	if handle.Status ~= "Loaded" then
		return false
	end
	local now = self._clock()
	local lost = false
	local ok = withRetry(self, function()
		local success, result = pcall(function()
			return self._backend:UpdateAsync(keyFor(handle.UserId), function(old: Record?): Record?
				local lock = old and old.SessionLock
				if
					lock
					and lock.SessionId ~= self._sessionId
					and (now - lock.LockedAt) < GameConfig.Profile.SessionLockTimeoutSeconds
				then
					lost = true
					return nil
				end
				handle.Data.LastSeenAt = now
				return {
					Data = handle.Data,
					SessionLock = { SessionId = self._sessionId, LockedAt = now },
					SavedAt = now,
				}
			end)
		end)
		if lost then
			return false, "LockLost"
		end
		return success and result ~= nil, result
	end)
	if ok then
		handle.Dirty = false
	end
	return ok
end

function ProfileStore.Release(self: any, handle: ProfileHandle): boolean
	if handle.Status == "Temporary" then
		self._handles[handle.UserId] = nil
		handle.Status = "Released"
		return true
	end
	if handle.Status ~= "Loaded" then
		return false
	end
	local now = self._clock()
	local ok = withRetry(self, function()
		local success, result = pcall(function()
			return self._backend:UpdateAsync(keyFor(handle.UserId), function(old: Record?): Record?
				local lock = old and old.SessionLock
				if lock and lock.SessionId ~= self._sessionId then
					return nil -- someone else owns it now; do not clobber
				end
				handle.Data.LastSeenAt = now
				return { Data = handle.Data, SessionLock = nil, SavedAt = now }
			end)
		end)
		return success, result
	end)
	self._handles[handle.UserId] = nil
	handle.Status = "Released"
	return ok
end

function ProfileStore.Get(self: any, userId: number): ProfileHandle?
	return self._handles[userId]
end

function ProfileStore.Loaded(self: any): { ProfileHandle }
	local out = {}
	for _, h in self._handles do
		table.insert(out, h)
	end
	return out
end

-- A non-persistent profile for players whose real profile failed to load. Never saved.
function ProfileStore.Temporary(self: any, userId: number): ProfileHandle
	local now = self._clock()
	local handle: ProfileHandle = {
		UserId = userId,
		Data = ProfileTemplate.New(now),
		Status = "Temporary",
		Dirty = false,
		LoadedAt = now,
		SessionId = self._sessionId,
	}
	self._handles[userId] = handle
	return handle
end

-- In-memory backend for tests and Studio offline mode, with optional failure injection.
function ProfileStore.MemoryBackend(): Backend & { Records: { [string]: any }, FailNext: number, Calls: number }
	local b: any = { Records = {}, FailNext = 0, Calls = 0 }
	function b:UpdateAsync(key: string, transform: (any) -> any?)
		self.Calls += 1
		if self.FailNext > 0 then
			self.FailNext -= 1
			error("DataStore request failed (injected)")
		end
		local old = self.Records[key]
		local copy = if old ~= nil then (require(Shared.Utility.TableUtil) :: any).DeepCopy(old) else nil
		local new = transform(copy)
		if new ~= nil then
			self.Records[key] = (require(Shared.Utility.TableUtil) :: any).DeepCopy(new)
		end
		return self.Records[key]
	end
	function b:GetAsync(key: string)
		self.Calls += 1
		return self.Records[key]
	end
	return b
end

return ProfileStore
