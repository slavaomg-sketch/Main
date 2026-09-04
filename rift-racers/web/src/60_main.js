// ===== Input + Game loop ===========================================================================================
class Input {
  constructor() { this.keys = {}; this.tThrottle = 0; this.tBrake = 0; this.tSteer = 0; this.drift = false; this.driftJustPressed = false; this.itemPressed = false; this.resetPressed = false; this.lookBack = false; this.throttlePressed = false; this.pad = { steer: 0, throttle: 0, brake: 0 };
    window.addEventListener("keydown", (e) => { if (e.repeat) return; this.keys[e.code] = true; if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") this.driftDown(); if (e.code === "KeyE" || e.code === "Enter") this.itemPressed = true; if (e.code === "KeyF") this.reservePressed = true; if (e.code === "KeyR") this.resetPressed = true; if (e.code === "KeyW" || e.code === "ArrowUp") this.throttlePressed = true; if (e.code === "KeyQ") this.lookBack = true; if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault(); });
    window.addEventListener("keyup", (e) => { this.keys[e.code] = false; if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") this.driftUp(); if (e.code === "KeyQ") this.lookBack = false; });
    window.addEventListener("blur", () => { this.keys = {}; this.driftUp(); });
  }
  driftDown() { if (!this.drift) { this.drift = true; this.driftJustPressed = true; } }
  driftUp() { this.drift = false; }
  poll(settings, isTouch) {
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : []; const gp = pads && pads[0];
    if (gp) { const x = gp.axes[0] || 0; this.pad.steer = Math.abs(x) < 0.15 ? 0 : sign(x) * (Math.abs(x) - 0.15) / 0.85; this.pad.throttle = gp.buttons[7] ? gp.buttons[7].value : 0; this.pad.brake = gp.buttons[6] ? gp.buttons[6].value : 0; const rb = gp.buttons[5] && gp.buttons[5].pressed; if (rb && !this.gpDrift) this.driftDown(); if (!rb && this.gpDrift) this.driftUp(); this.gpDrift = rb; const bx = gp.buttons[2] && gp.buttons[2].pressed; if (bx && !this.gpItem) this.itemPressed = true; this.gpItem = bx; this.lookBack = this.lookBack || (gp.buttons[4] && gp.buttons[4].pressed); if (this.pad.throttle > 0.5) this.throttlePressed = true; }
    const k = this.keys; let throttle = k.KeyW || k.ArrowUp ? 1 : 0, brake = k.KeyS || k.ArrowDown ? 1 : 0, steer = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    throttle = Math.max(throttle, this.tThrottle, this.pad.throttle); brake = Math.max(brake, this.tBrake, this.pad.brake); if (steer === 0) steer = this.tSteer || this.pad.steer;
    const auto = settings.autoAccelerate === null ? isTouch : settings.autoAccelerate; if (auto && brake === 0) throttle = 1;
    const out = { steer: clamp(steer * settings.sensitivity, -1, 1), throttle, brake, drift: this.drift, trick: this.driftJustPressed, item: this.itemPressed, reserve: !!this.reservePressed, reset: this.resetPressed, lookBack: this.lookBack, throttlePressed: this.throttlePressed || (auto && throttle > 0) };
    this.driftJustPressed = false; this.itemPressed = false; this.reservePressed = false; this.resetPressed = false; this.throttlePressed = false; return out;
  }
}

class Game {
  constructor() {
    Profile.load(); Audio.enabled = Profile.data.settings.sound;
    this.canvas = $("#c"); this.scene = new Scene3D(this.canvas); this.input = new Input(); this.ui = new UI(this); this.race = null; this.paused = false; this.frame = 0; this.fps = 60; this.lastDt = 0; this.tour = null; this.now = 0; this.accum = 0; this.lastT = performance.now(); this.lobbyTrack = null; this.ghost = null; this.ghostRec = null;
    window.addEventListener("resize", () => this.scene.resize()); document.addEventListener("visibilitychange", () => { if (document.hidden && this.race) this.paused = true; });
    Leaderboard.init(); this.showLobby(); requestAnimationFrame((t) => this.loop(t));
    // wake audio on first interaction
    const wake = () => { Audio.init(); Audio.resume(); }; window.addEventListener("pointerdown", wake, { once: true }); window.addEventListener("keydown", wake, { once: true });
  }
  showLobby() { const def = trackById[Profile.data.settings.lobbyTrack || "NeonHarborCircuit"] || C.Tracks[0]; this.lobbyTrack = new TrackRuntime(def, false); this.scene.buildTrack(this.lobbyTrack); this.previewLoadout(Profile.data.hero, Profile.data.vehicle); this.ui.showTouch(false); this.hudVisible(false); this.ui.home(); }
  previewLoadout(heroId, vehicleId) { for (const k of this.scene.karts.values()) this.scene.scene.remove(k.group); this.scene.karts.clear(); const pt = this.lobbyTrack.spline.pointAt(40, 0, 1.4); const stats = computeStats(heroId, vehicleId); const kart = new Kart(stats, pt); this.preview = { key: "preview", heroId, vehicleId, kart, input: { steer: 0 }, effects: {}, phaseUntil: 0, prog: { eliminated: false } }; this.scene.buildKart(this.preview); this.previewPivot = pt.pos; }
  hudVisible(v) { $("#hud").style.display = v ? "block" : "none"; }
  toLobby() { this.race = null; this.tour = null; this.paused = false; Audio.stopEngine(); this.ghost = null; this.scene.clearTrack(); this.showLobby(); }
  togglePause() { if (!this.race) return; this.paused = !this.paused; if (this.paused) { this.ui.pause(); Audio.stopEngine(); } else { this.ui.hide(); Audio.startEngine(); this.lastT = performance.now(); } }
  pickTrack(id, exclude = []) { if (id && id !== "random") return id; const pool = C.Tracks.map((t) => t.Id).filter((t) => !exclude.includes(t)); return pool[Math.floor(Math.random() * pool.length)]; }
  startRace(o) {
    const p = Profile.data; Audio.init(); Audio.resume();
    if (o.mode === "GrandTour" && !this.tour) this.tour = { index: 0, points: {}, played: [], opts: o };
    const trackId = this.pickTrack(o.trackId, this.tour ? this.tour.played : []); if (this.tour) { this.tour.index++; this.tour.played.push(trackId); }
    const gridOrder = this.tour && this.tour.index > 1 ? Object.fromEntries(Object.entries(this.tour.points).map(([k, v]) => [k, v])) : null;
    this.raceOpts = o;
    this.race = new Race({ trackId, laps: o.mode === "Knockout" ? 4 : o.laps || 3, mode: o.mode, player: { heroId: p.hero, vehicleId: p.vehicle, name: p.name || (Locale.lang === "ru" ? "Гонщик" : "Racer") }, bots: o.mode === "TimeTrial" ? 0 : o.bots, difficulty: o.difficulty, seed: (Date.now() % 100000) + 7, mirror: o.mirror, itemsEnabled: o.itemsEnabled, speedClass: o.speedClass || 1, gridOrder });
    this.scene.buildTrack(this.race.track); this.ui.setMinimap(this.race.track); this.ui.hide(); this.hudVisible(true); this.ui.showTouch(true); this.paused = false;
    this.now = 0; this.race.startCountdown(this.now); this.scene.syncKarts(this.race, 0); this.scene.updateCamera(this.race, 0.016, { snap: true }); Audio.startEngine(); this.lastTick = -1;
    // ghost for time trial
    this.ghost = null; this.ghostRec = []; if (o.mode === "TimeTrial") { const g = p.ghosts[trackId]; if (g && g.frames && g.frames.length) { this.ghost = g; this.ghostMesh = this.scene.buildKart({ key: "ghost", heroId: g.hero || p.hero, vehicleId: g.vehicle || p.vehicle, input: { steer: 0 }, effects: {}, phaseUntil: 0, prog: { eliminated: false } }); this.ghostMesh.group.traverse((m) => { if (m.material) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.35; } }); } }
    if (o.tutorial) this.ui.toast(T("TUTORIAL.STEP_1"));
  }
  nextRace() { const o = this.raceOpts; if (this.tour) { if (this.tour.index >= 4) { this.toLobby(); return; } this.startRace({ ...o, mode: "GrandTour" }); } else this.startRace(o); }
  onRaceOver() {
    const race = this.race, me = race.results.find((r) => r.key === "me"); Audio.stopEngine();
    let tour = null; if (this.tour) { for (const r of race.results) this.tour.points[r.key] = (this.tour.points[r.key] || 0) + r.points; tour = this.tour; }
    const tourFinal = tour && tour.index >= 4; let tourPosition = null; if (tourFinal) { const ranked = Object.entries(tour.points).sort((a, b) => b[1] - a[1]); tourPosition = ranked.findIndex(([k]) => k === "me") + 1; }
    const reward = this.raceOpts.tutorial ? null : Profile.applyRace(me, { mode: race.mode, trackId: race.track.def.Id, laps: race.laps, heroId: Profile.data.hero, vehicleId: Profile.data.vehicle, assist: Profile.data.settings.trackAssist, tourFinal, tourPosition });
    if (reward && reward.newRecord && me.time !== null) { Leaderboard.submit(race.track.def.Id, { name: Profile.data.name || "Racer", time: me.time, hero: Profile.data.hero, vehicle: Profile.data.vehicle, laps: race.laps }); if (race.mode === "TimeTrial" && this.ghostRec.length) { Profile.data.ghosts[race.track.def.Id] = { hero: Profile.data.hero, vehicle: Profile.data.vehicle, time: me.time, frames: this.ghostRec }; Profile.save(); } }
    this.ui.showTouch(false); this.ui.results(race, reward, tour); Audio.sfx("finish");
  }
  handleEvents(race) {
    for (const e of race.events) {
      switch (e.kind) {
        case "StartBoost": this.ui.toast(T(e.result === "Perfect" ? "RACE.START_PERFECT" : e.result === "Good" ? "RACE.START_GOOD" : e.result === "Early" ? "RACE.START_EARLY" : "RACE.START_OKAY"), e.result === "Early" ? "bad" : ""); if (e.result !== "Early" && e.result !== "None") Audio.sfx("boost"); break;
        case "DriftBoost": this.ui.toast(T("RACE.DRIFT_" + e.tier)); Audio.sfx("boost"); break;
        case "Landed": if (e.trick) { this.ui.toast(T("RACE.TRICK")); Audio.sfx("trick"); } this.scene.camState.dip = 0.8; break;
        case "Lap": this.ui.toast(e.index === race.laps - 1 ? T("RACE.FINAL_LAP") : T("RACE.LAP", e.index + 1, race.laps)); Audio.sfx("tick"); break;
        case "Finished": this.ui.toast(T("RACE.FINISH") + " " + Locale.ordinal(e.position)); Audio.sfx("finish"); break;
        case "Item": Audio.sfx("pickup"); break;
        case "ItemUse": if (e.racer.key === "me") Audio.sfx("use"); break;
        case "Hit": if (e.racer.key === "me") { Audio.sfx("hit"); this.scene.camState.shake = e.level >= 2 ? 1 : 0.5; } break;
        case "Shielded": break;
        case "Incoming": this.ui.toast(T("RACE.INCOMING"), "bad"); Audio.sfx("warn"); break;
        case "Respawn": this.ui.toast(T("RACE.RESPAWN")); this.scene.updateCamera(race, 0.016, { snap: true }); break;
        case "Shard": Audio.sfx("shard"); break;
        case "Slipstream": this.ui.toast(T("RACE.SLIPSTREAM")); Audio.sfx("boost"); break;
        case "Eliminated": this.ui.toast(T("RACE.ELIMINATED"), "bad"); break;
        case "KnockoutStage": this.ui.toast(T("RACE.STAGE", e.stage, e.stages)); break;
        case "Gate": this.scene.setGate(e.id, e.open); break;
        case "InvalidFinishCross": this.ui.toast(T("RACE.WRONG_WAY"), "bad"); break;
        case "RaceOver": this.onRaceOver(); break;
        case "Wave": case "Storm": case "Blink": break;
      }
    }
  }
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = Math.min(0.1, (t - this.lastT) / 1000); this.lastT = t; this.frame++; this.fps = damp(this.fps, 1 / Math.max(1e-3, dt), 2, dt); this.lastDt = dt;
    const s = Profile.data.settings; const reduced = s.reducedMotion;
    if (this.race && !this.paused) {
      const race = this.race; const inp = this.input.poll(s, this.ui.isTouch);
      if (race.state !== "Results") {
        if (inp.item && race.me.items.active) race.useItem(race.me, "active", this.now); if (inp.reserve && race.me.items.reserve) race.useItem(race.me, "reserve", this.now); if (inp.reset) race.requestRespawn(this.now);
        if (s.trackAssist && race.me.kart.wallHit) inp.steer = clamp(inp.steer - race.me.kart.wallHit * 0.25, -1, 1);
        race.humanInput({ steer: inp.steer, throttle: inp.throttle, brake: inp.brake, drift: inp.drift, trick: inp.trick }, this.now);
        if (inp.throttlePressed) race.pressThrottle(race.me, this.now);
        // fixed-step physics at 60 Hz
        this.accum += dt; const step = 1 / 60; let n = 0;
        while (this.accum >= step && n < 4) { this.now += step; race.tick(step, this.now); this.handleEvents(race); this.accum -= step; n++; if (race.state === "Results") break; }
        if (race.state === "Countdown") { const rem = Math.ceil(race.goAt - this.now); if (rem !== this.lastTick && rem >= 0 && rem <= 3) { this.lastTick = rem; Audio.sfx(rem === 0 ? "go" : "tick"); } }
        if (race.mode === "TimeTrial" && race.state !== "Countdown" && race.me.prog.finishedAt === null && this.frame % 6 === 0) { const k = race.me.kart; this.ghostRec.push([+(this.now - race.goAt).toFixed(2), +k.pos.x.toFixed(1), +k.pos.y.toFixed(1), +k.pos.z.toFixed(1), +k.yaw.toFixed(2)]); if (this.ghostRec.length > 4000) this.ghostRec.shift(); }
        if (this.ghost && this.ghostMesh) { const tt = this.now - race.goAt; const f = this.ghost.frames; let i = 0; while (i < f.length - 1 && f[i + 1][0] <= tt) i++; const a = f[i], b = f[i + 1] || a; const al = clamp((tt - a[0]) / Math.max(0.01, b[0] - a[0]), 0, 1); this.ghostMesh.group.position.set(lerp(a[1], b[1], al), lerp(a[2], b[2], al), lerp(a[3], b[3], al)); this.ghostMesh.group.rotation.set(0, lerp(a[4], b[4], al), 0); }
        Audio.engineUpdate(Math.abs(race.me.kart.speed) / race.me.stats.topSpeed, boostBonus(race.me.kart.boosts, this.now) > 0);
      }
      this.scene.syncKarts(race, dt); this.scene.syncPickups(race);
      this.scene.updateCamera(race, dt, { lookBack: inp.lookBack, reduced, results: race.state === "Results", shakeAmt: s.cameraShake, speedFov: s.speedFov });
      if (race.state !== "Results") this.ui.updateHud(this, race, this.now);
    } else if (!this.race) {
      if (this.preview) { this.preview.kart.yaw += dt * 0.4; this.scene.syncKarts({ racers: [this.preview], time: 0 }, dt); }
      this.scene.updateCamera(null, dt, { lobbyPivot: this.previewPivot, reduced });
    }
    this.scene.render(dt, this.now || t / 1000);
  }
}
window.addEventListener("load", () => { window.game = new Game(); });
