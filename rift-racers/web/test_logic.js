// Node smoke test of the pure logic layer: simulate a full race with 8 bots + auto-driven player.
const fs = require("fs");
global.window = { __RR_CONTENT__: JSON.parse(fs.readFileSync(__dirname + "/content.json", "utf8")) };
global.navigator = { language: "en" };
const src = ["00_core.js", "10_track.js", "20_physics.js", "30_race.js"].map((f) => fs.readFileSync(__dirname + "/src/" + f, "utf8")).join("\n");
eval(src + "\nglobal.Race = Race; global.BotBrain = BotBrain; global.C = C; global.TrackRuntime = TrackRuntime; global.trackById = trackById;");
for (const t of C.Tracks) {
  const race = new Race({ trackId: t.Id, laps: 2, mode: "QuickRace", player: { heroId: "NovaVale", vehicleId: "CometMk1", name: "Me" }, bots: 7, difficulty: "Normal", seed: 7 });
  const brain = new BotBrain("Hard", 99);
  let now = 0; race.startCountdown(now);
  const dt = 1 / 60; let ticks = 0, items = 0, hits = 0;
  while (race.state !== "Results" && ticks < 60 * 400) {
    now += dt; ticks++;
    if (race.state === "Countdown" && now >= race.goAt - 0.05 && race.me.startPressAt === null) race.humanInput({ steer: 0, throttle: 1, brake: 0, drift: false, trick: false }, now);
    if (race.state === "Racing" || race.state === "FinishWindow") { const d = brain.think(race.track, race.me.kart, { now, rubber: 1, obstacles: [], itemKind: null, rivalAhead: null, rivalBehind: null }); race.humanInput({ steer: d.steer, throttle: d.throttle, brake: d.brake, drift: d.drift, trick: d.trick }, now); if (race.me.items.active && ticks % 90 === 0) race.useItem(race.me, "active", now); }
    race.tick(dt, now);
    for (const e of race.events) { if (e.kind === "ItemUse") items++; if (e.kind === "Hit") hits++; }
  }
  const me = race.results.find((r) => r.key === "me");
  console.log(t.Id.padEnd(20), "state", race.state, "time", now.toFixed(1), "me pos", me.position, "time", me.time && me.time.toFixed(1), "finished", race.results.filter((r) => r.finished).length + "/" + race.results.length, "items", items, "hits", hits);
  if (race.state !== "Results") process.exit(1);
}
console.log("logic OK");
