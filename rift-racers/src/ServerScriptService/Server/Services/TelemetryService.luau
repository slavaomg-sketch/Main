--!strict
-- Counters and structured logs; in Roblox they also flow to the Developer Console.
local TelemetryService = { Name = "TelemetryService" }
TelemetryService.__index = TelemetryService

function TelemetryService.new()
	return setmetatable(
		{
			_counters = {} :: { [string]: number },
			_events = {} :: { { At: number, Tag: string, Message: string } },
			_env = nil :: any,
		},
		TelemetryService
	)
end

function TelemetryService.Init(self: any, registry: any)
	self._env = registry:Get("Env")
end

function TelemetryService.Count(self: any, name: string, amount: number?)
	self._counters[name] = (self._counters[name] or 0) + (amount or 1)
end

function TelemetryService.Get(self: any, name: string): number
	return self._counters[name] or 0
end

function TelemetryService.Log(self: any, level: "Info" | "Warn" | "Error", tag: string, message: string)
	table.insert(self._events, { At = self._env.Unix(), Tag = tag, Message = message })
	if #self._events > 500 then
		table.remove(self._events, 1)
	end
	self._env.Log(level, tag, message)
end

function TelemetryService.Snapshot(self: any): { [string]: number }
	return table.clone(self._counters)
end

function TelemetryService.Events(self: any): { { At: number, Tag: string, Message: string } }
	return table.clone(self._events)
end

return TelemetryService
