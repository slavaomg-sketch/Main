--!strict
-- Tiny BDD runner: describe/it/expect with a plain-text report. No external dependencies.
local TestRunner = {}

type Case = { Name: string, Fn: () -> () }
type Suite = { Name: string, Cases: { Case }, BeforeEach: (() -> ())? }

local suites: { Suite } = {}
local current: Suite? = nil

function TestRunner.describe(name: string, body: () -> ())
	local suite: Suite = { Name = name, Cases = {} }
	table.insert(suites, suite)
	local prev = current
	current = suite
	body()
	current = prev
end

function TestRunner.it(name: string, fn: () -> ())
	assert(current, "it() outside describe()")
	table.insert((current :: Suite).Cases, { Name = name, Fn = fn })
end

function TestRunner.beforeEach(fn: () -> ())
	assert(current, "beforeEach() outside describe()");
	(current :: Suite).BeforeEach = fn
end

local function fmt(v: any): string
	if type(v) == "table" then
		local parts = {}
		for k, x in v do
			table.insert(parts, tostring(k) .. "=" .. tostring(x))
			if #parts > 8 then
				table.insert(parts, "…")
				break
			end
		end
		return "{" .. table.concat(parts, ", ") .. "}"
	end
	return tostring(v)
end

export type Expectation = {
	toBe: (expected: any) -> (),
	toEqual: (expected: any) -> (),
	toBeCloseTo: (expected: number, tolerance: number?) -> (),
	toBeTruthy: () -> (),
	toBeFalsy: () -> (),
	toBeNil: () -> (),
	toBeGreaterThan: (n: number) -> (),
	toBeGreaterThanOrEqual: (n: number) -> (),
	toBeLessThan: (n: number) -> (),
	toBeLessThanOrEqual: (n: number) -> (),
	toThrow: (pattern: string?) -> (),
	toContain: (value: any) -> (),
	toHaveLength: (n: number) -> (),
}

local function deepEqual(a: any, b: any): boolean
	if type(a) ~= type(b) then
		return false
	end
	if type(a) ~= "table" then
		return a == b
	end
	for k, v in a do
		if not deepEqual(v, b[k]) then
			return false
		end
	end
	for k in b do
		if a[k] == nil then
			return false
		end
	end
	return true
end

function TestRunner.expect(value: any): Expectation
	local e = {}
	function e.toBe(expected)
		if value ~= expected then
			error(string.format("expected %s to be %s", fmt(value), fmt(expected)), 2)
		end
	end
	function e.toEqual(expected)
		if not deepEqual(value, expected) then
			error(string.format("expected %s to equal %s", fmt(value), fmt(expected)), 2)
		end
	end
	function e.toBeCloseTo(expected, tolerance)
		local tol = tolerance or 1e-4
		if type(value) ~= "number" or math.abs(value - expected) > tol then
			error(string.format("expected %s to be within %s of %s", fmt(value), tostring(tol), tostring(expected)), 2)
		end
	end
	function e.toBeTruthy()
		if not value then
			error("expected truthy, got " .. fmt(value), 2)
		end
	end
	function e.toBeFalsy()
		if value then
			error("expected falsy, got " .. fmt(value), 2)
		end
	end
	function e.toBeNil()
		if value ~= nil then
			error("expected nil, got " .. fmt(value), 2)
		end
	end
	function e.toBeGreaterThan(n)
		if not (type(value) == "number" and value > n) then
			error(string.format("expected %s > %s", fmt(value), tostring(n)), 2)
		end
	end
	function e.toBeGreaterThanOrEqual(n)
		if not (type(value) == "number" and value >= n) then
			error(string.format("expected %s >= %s", fmt(value), tostring(n)), 2)
		end
	end
	function e.toBeLessThan(n)
		if not (type(value) == "number" and value < n) then
			error(string.format("expected %s < %s", fmt(value), tostring(n)), 2)
		end
	end
	function e.toBeLessThanOrEqual(n)
		if not (type(value) == "number" and value <= n) then
			error(string.format("expected %s <= %s", fmt(value), tostring(n)), 2)
		end
	end
	function e.toThrow(pattern)
		assert(type(value) == "function", "toThrow expects a function")
		local ok, err = pcall(value)
		if ok then
			error("expected function to throw", 2)
		end
		if pattern and not string.find(tostring(err), pattern) then
			error(string.format("expected error matching %q, got %s", pattern, tostring(err)), 2)
		end
	end
	function e.toContain(v)
		if type(value) == "string" then
			if not string.find(value, v, 1, true) then
				error(string.format("expected %q to contain %q", value, tostring(v)), 2)
			end
			return
		end
		if type(value) ~= "table" or table.find(value, v) == nil then
			error(string.format("expected %s to contain %s", fmt(value), fmt(v)), 2)
		end
	end
	function e.toHaveLength(n)
		if type(value) ~= "table" or #value ~= n then
			error(string.format("expected length %d, got %s", n, fmt(value)), 2)
		end
	end
	return (e :: any) :: Expectation
end

function TestRunner.run(filter: string?): (number, number, { string })
	local passed, failed = 0, 0
	local failures: { string } = {}
	for _, suite in suites do
		if filter and not string.find(suite.Name, filter, 1, true) then
			continue
		end
		print("• " .. suite.Name)
		for _, case in suite.Cases do
			if suite.BeforeEach then
				suite.BeforeEach()
			end
			local t0 = os.clock()
			local ok, err = pcall(case.Fn)
			local ms = (os.clock() - t0) * 1000
			if ok then
				passed += 1
				print(string.format("    ✓ %s (%.1fms)", case.Name, ms))
			else
				failed += 1
				local msg = string.format("%s :: %s — %s", suite.Name, case.Name, tostring(err))
				table.insert(failures, msg)
				print(string.format("    ✗ %s\n        %s", case.Name, tostring(err)))
			end
		end
	end
	return passed, failed, failures
end

function TestRunner.reset()
	table.clear(suites)
end

return TestRunner
