--!strict
-- Entry point: `lune run tests/run.luau [filter]` from the rift-racers directory.
local fs = require("@lune/fs")
local process = require("@lune/process")
local TestRunner = require("./Lune/TestRunner")
local RobloxEnv = require("./Lune/RobloxEnv")

local filter = process.args[1]

RobloxEnv.Reset()

local dirs = { "tests/Unit", "tests/Security", "tests/ContentValidation", "tests/Integration", "tests/Multiplayer" }
local files: { string } = {}
for _, dir in dirs do
	if fs.isDir(dir) then
		for _, entry in fs.readDir(dir) do
			if entry:match("%.spec%.luau$") then
				table.insert(files, dir .. "/" .. entry)
			end
		end
	end
end
table.sort(files)

for _, file in files do
	local spec = require(("./" .. file:gsub("^tests/", ""):gsub("%.luau$", "")) :: any) :: (typeof(TestRunner), typeof(RobloxEnv)) -> ()
	spec(TestRunner, RobloxEnv)
end

local t0 = os.clock()
local passed, failed, failures = TestRunner.run(filter)
print(string.format("\n%d passed, %d failed in %.2fs (%d spec files)", passed, failed, os.clock() - t0, #files))
if failed > 0 then
	print("\nFailures:")
	for _, f in failures do
		print("  - " .. f)
	end
	process.exit(1)
end
