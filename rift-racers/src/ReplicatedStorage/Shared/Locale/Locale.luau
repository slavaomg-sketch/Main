--!strict
-- Localisation with {0}-style substitution and Russian plural forms.
local Strings = require(script.Parent.Strings)

export type LocaleId = "en" | "ru"

local Locale = {}
local current: LocaleId = "en"

function Locale.Set(id: string)
	if id == "ru" or id == "en" then
		current = id :: LocaleId
	end
end

function Locale.Get(): LocaleId
	return current
end

function Locale.Has(key: string): boolean
	return Strings[key] ~= nil
end

function Locale.Format(template: string, ...: any): string
	local args = table.pack(...)
	return (template:gsub("{(%d+)}", function(idx)
		local v = args[tonumber(idx) :: number + 1]
		return if v == nil then "" else tostring(v)
	end))
end

function Locale.T(key: string, ...: any): string
	local entry = Strings[key]
	if entry == nil then
		return key
	end
	local template = entry[current] or entry.en
	if select("#", ...) == 0 then
		return template
	end
	return Locale.Format(template, ...)
end

-- Russian pluralisation: one (1, 21, 31…), few (2-4, 22-24…), many (0, 5-20, 25-30…).
function Locale.Plural(n: number, one: string, few: string, many: string): string
	if current == "en" then
		return if n == 1 then one else many
	end
	local n10, n100 = n % 10, n % 100
	if n10 == 1 and n100 ~= 11 then
		return one
	elseif n10 >= 2 and n10 <= 4 and (n100 < 12 or n100 > 14) then
		return few
	end
	return many
end

function Locale.Ordinal(n: number): string
	if current == "ru" then
		return tostring(n) .. "-й"
	end
	local n100 = n % 100
	if n100 >= 11 and n100 <= 13 then
		return tostring(n) .. "th"
	end
	local n10 = n % 10
	if n10 == 1 then
		return tostring(n) .. "st"
	elseif n10 == 2 then
		return tostring(n) .. "nd"
	elseif n10 == 3 then
		return tostring(n) .. "rd"
	end
	return tostring(n) .. "th"
end

function Locale.FormatNumber(n: number): string
	local s = tostring(math.floor(n + 0.5))
	local sep = if current == "ru" then " " else ","
	local out = s:reverse():gsub("(%d%d%d)", "%1" .. sep):reverse()
	return (out:gsub("^" .. sep, ""))
end

return Locale
