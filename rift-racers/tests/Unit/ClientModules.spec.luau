--!strict
-- Smoke: every client module and UI module loads (module-scope code runs) in a client-flavoured fake DataModel.
return function(T, Env)
	local describe, it, expect = T.describe, T.it, T.expect
	describe("Client modules load", function()
		local game = Env.Game()
		local client = game.StarterPlayer.StarterPlayerScripts.Client
		-- Client-only services the modules touch at module scope.
		local function stubService(name: string, fields: { [string]: any })
			local svc = game:GetService(name)
			for k, v in fields do
				svc[k] = v
			end
		end
		stubService("UserInputService", { TouchEnabled = false, KeyboardEnabled = true, GamepadEnabled = false, AccelerometerEnabled = false, LastInputTypeChanged = Env.FakeSignal(), InputBegan = Env.FakeSignal(), InputChanged = Env.FakeSignal(), InputEnded = Env.FakeSignal(), DeviceGravityChanged = Env.FakeSignal() })
		stubService("GuiService", { MenuOpened = Env.FakeSignal(), SelectedObject = nil })
		stubService("ContextActionService", {})
		stubService("Players", { LocalPlayer = { UserId = 1, DisplayName = "Tester", Name = "Tester" } })
		stubService("Lighting", {})
		stubService("SoundService", {})
		stubService("Stats", {})
		stubService("LocalizationService", { RobloxLocaleId = "ru-ru" })
		Env.SetIsServer(false)
		local names = { "ClientRegistry", "ClientState", "TrackAssist", "GhostPlayback" }
		for _, c in client.Controllers:GetChildren() do
			table.insert(names, "Controllers/" .. c.Name)
		end
		for _, u in client.UI:GetChildren() do
			table.insert(names, "UI/" .. u.Name)
		end
		for _, name in names do
			it("loads " .. name, function()
				local m = Env.Load("Client/" .. name)
				expect(m).toBeTruthy()
			end)
		end
		it("constructs every controller", function()
			for _, c in client.Controllers:GetChildren() do
				local m = Env.Load("Client/Controllers/" .. c.Name)
				if type(m) == "table" and type(m.new) == "function" then
					local inst = m.new()
					expect(inst.Name).toBe(c.Name)
				end
			end
		end)
		Env.SetIsServer(true)
	end)
end
