--!strict
-- Schema validation for every remote payload: types, ranges, string length, enums, table sizes, NaN/inf, Instance refs.
local NetworkTypes = require(script.Parent.Parent.Types.NetworkTypes)
local MathUtil = require(script.Parent.Parent.Utility.MathUtil)
local TableUtil = require(script.Parent.Parent.Utility.TableUtil)

type FieldSchema = NetworkTypes.FieldSchema

local Validator = {}

local MAX_DEPTH = 4

local function fail(path: string, msg: string): (boolean, string?)
	return false, path .. ": " .. msg
end

function Validator.CheckValue(value: any, schema: FieldSchema, path: string?, depth: number?): (boolean, string?)
	local p = path or "arg"
	local d = depth or 0
	if d > MAX_DEPTH then
		return fail(p, "too deep")
	end
	if value == nil then
		if schema.Optional then
			return true, nil
		end
		return fail(p, "missing")
	end
	local kind = schema.Type
	if kind == "any" then
		if type(value) == "table" and TableUtil.CountEntries(value, MAX_DEPTH) > (schema.MaxEntries or 32) then
			return fail(p, "table too large")
		end
		return true, nil
	elseif kind == "number" or kind == "integer" then
		if type(value) ~= "number" then
			return fail(p, "expected number")
		end
		if not MathUtil.IsFinite(value) then
			return fail(p, "non-finite number")
		end
		if kind == "integer" and value % 1 ~= 0 then
			return fail(p, "expected integer")
		end
		if schema.Min ~= nil and value < schema.Min then
			return fail(p, "below min")
		end
		if schema.Max ~= nil and value > schema.Max then
			return fail(p, "above max")
		end
		return true, nil
	elseif kind == "string" then
		if type(value) ~= "string" then
			return fail(p, "expected string")
		end
		if #value > (schema.MaxLength or 128) then
			return fail(p, "string too long")
		end
		return true, nil
	elseif kind == "boolean" then
		if type(value) ~= "boolean" then
			return fail(p, "expected boolean")
		end
		return true, nil
	elseif kind == "enum" then
		if type(value) ~= "string" then
			return fail(p, "expected enum string")
		end
		if schema.Values == nil or table.find(schema.Values, value) == nil then
			return fail(p, "invalid enum value")
		end
		return true, nil
	elseif kind == "vector3" then
		if not MathUtil.IsFiniteVector(value) then
			return fail(p, "expected finite Vector3")
		end
		if schema.Max ~= nil and (value :: Vector3).Magnitude > schema.Max then
			return fail(p, "vector too large")
		end
		return true, nil
	elseif kind == "cframe" then
		if typeof(value) ~= "CFrame" then
			return fail(p, "expected CFrame")
		end
		if not MathUtil.IsFiniteVector((value :: CFrame).Position) then
			return fail(p, "non-finite CFrame")
		end
		return true, nil
	elseif kind == "table" then
		if type(value) ~= "table" then
			return fail(p, "expected table")
		end
		local entries = TableUtil.CountEntries(value, MAX_DEPTH)
		if entries > (schema.MaxEntries or 32) then
			return fail(p, "table too large")
		end
		if schema.Fields ~= nil then
			for key in value do
				if type(key) ~= "string" or schema.Fields[key] == nil then
					return fail(p, "unexpected field " .. tostring(key))
				end
			end
			for key, sub in schema.Fields do
				local ok, err = Validator.CheckValue(value[key], sub, p .. "." .. key, d + 1)
				if not ok then
					return false, err
				end
			end
		elseif schema.Item ~= nil then
			if not TableUtil.IsArray(value) then
				return fail(p, "expected array")
			end
			for i, item in ipairs(value) do
				local ok, err = Validator.CheckValue(item, schema.Item :: FieldSchema, p .. "[" .. i .. "]", d + 1)
				if not ok then
					return false, err
				end
			end
		end
		return true, nil
	end
	return fail(p, "unknown schema type")
end

function Validator.CheckArgs(args: { any }, argCount: number, schemas: { FieldSchema }): (boolean, string?)
	if argCount > #schemas then
		return false, "too many arguments"
	end
	for i, schema in schemas do
		local ok, err = Validator.CheckValue(args[i], schema, "arg" .. i)
		if not ok then
			return false, err
		end
	end
	return true, nil
end

-- Rejects Instances passed where data is expected (a common exploit vector).
function Validator.ContainsInstance(value: any, depth: number?): boolean
	local d = depth or 0
	if typeof(value) == "Instance" then
		return true
	end
	if type(value) == "table" and d < MAX_DEPTH then
		for k, v in value do
			if Validator.ContainsInstance(k, d + 1) or Validator.ContainsInstance(v, d + 1) then
				return true
			end
		end
	end
	return false
end

return table.freeze(Validator)
