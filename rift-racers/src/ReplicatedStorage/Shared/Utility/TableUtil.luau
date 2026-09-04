--!strict
local TableUtil = {}

function TableUtil.DeepCopy<T>(t: T): T
	if type(t) ~= "table" then
		return t
	end
	local out = {}
	for k, v in t :: any do
		out[k] = TableUtil.DeepCopy(v)
	end
	return (out :: any) :: T
end

-- Fills missing keys in `target` from `template` recursively (used by profile reconciliation).
function TableUtil.Reconcile(target: { [any]: any }, template: { [any]: any }): { [any]: any }
	for k, v in template do
		if target[k] == nil then
			target[k] = TableUtil.DeepCopy(v)
		elseif type(v) == "table" and type(target[k]) == "table" and not TableUtil.IsArray(v) then
			TableUtil.Reconcile(target[k], v)
		end
	end
	return target
end

function TableUtil.IsArray(t: { [any]: any }): boolean
	local n = 0
	for _ in t do
		n += 1
	end
	return n == #t
end

function TableUtil.Count(t: { [any]: any }): number
	local n = 0
	for _ in t do
		n += 1
	end
	return n
end

function TableUtil.Keys<K, V>(t: { [K]: V }): { K }
	local out = {}
	for k in t do
		table.insert(out, k)
	end
	return out
end

function TableUtil.Values<K, V>(t: { [K]: V }): { V }
	local out = {}
	for _, v in t do
		table.insert(out, v)
	end
	return out
end

function TableUtil.Map<T, U>(t: { T }, fn: (T, number) -> U): { U }
	local out = table.create(#t)
	for i, v in t do
		out[i] = fn(v, i)
	end
	return out
end

function TableUtil.Filter<T>(t: { T }, fn: (T) -> boolean): { T }
	local out = {}
	for _, v in t do
		if fn(v) then
			table.insert(out, v)
		end
	end
	return out
end

function TableUtil.Find<T>(t: { T }, fn: (T) -> boolean): (T?, number?)
	for i, v in t do
		if fn(v) then
			return v, i
		end
	end
	return nil, nil
end

function TableUtil.Contains<T>(t: { T }, value: T): boolean
	return table.find(t, value) ~= nil
end

function TableUtil.Shuffle<T>(t: { T }, rng: Random): { T }
	local out = table.clone(t)
	for i = #out, 2, -1 do
		local j = rng:NextInteger(1, i)
		out[i], out[j] = out[j], out[i]
	end
	return out
end

-- Depth-limited structural size check to reject huge client payloads.
function TableUtil.CountEntries(t: any, maxDepth: number): number
	if type(t) ~= "table" or maxDepth <= 0 then
		return 0
	end
	local n = 0
	for _, v in t do
		n += 1
		if type(v) == "table" then
			n += TableUtil.CountEntries(v, maxDepth - 1)
		end
	end
	return n
end

return table.freeze(TableUtil)
