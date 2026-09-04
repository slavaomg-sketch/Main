// ===== Race session: racers, items, projectiles, hits, pickups, hazards, results (port of RaceSession/ItemService) ===
class Race {
  constructor(opts) {
    // opts: trackId, laps, mode ("QuickRace"|"TimeTrial"|"GrandTour"|"Knockout"), player {heroId, vehicleId, name}, bots, difficulty, seed, mirror, itemsEnabled, speedClass
    this.opts = opts; this.rng = new RNG(opts.seed || 1234);
    this.track = new TrackRuntime(trackById[opts.trackId], opts.mirror);
    this.laps = opts.laps; this.mode = opts.mode; this.itemsEnabled = opts.itemsEnabled !== false && opts.mode !== "TimeTrial";
    const globalCap = Math.max(...C.Vehicles.map((v) => v.Physics.TopSpeed)) * (opts.speedClass || 1) * P.BoostSpeedCapFraction * 1.12;
    let sector = this.track.length / this.track.cpCount;
    for (const sc of this.track.shortcuts) { let span = this.track.spline.delta(sc.entryDist, sc.exitDist); if (span < 0) span += this.track.length; sector = Math.min(sector, sector * sc.spline.length / Math.max(1, span)); }
    this.shape = { length: this.track.length, cpCount: this.track.cpCount, cpDists: this.track.cpDists, laps: this.laps, minSector: sector / globalCap * C.Race.MinSectorTimeFactor };
    this.racers = []; this.projectiles = []; this.pads = []; this.shards = []; this.events = []; this.time = 0; this.state = "Grid"; this.goAt = 0; this.firstFinishAt = null; this.results = null; this.stormAvailableAt = 0; this.knockoutStage = 0; this.stormStrikes = [];
    this.buildRoster(); this.setupPickups();
  }
  buildRoster() {
    const o = this.opts, names = C.Bots.NamePool.slice();
    const roster = [{ key: "me", name: o.player.name, heroId: o.player.heroId, vehicleId: o.player.vehicleId, isBot: false, difficulty: null }];
    for (let i = 0; i < o.bots; i++) { const ni = this.rng.int(0, names.length - 1); const name = names.splice(ni, 1)[0] || "Racer" + i; roster.push({ key: "b" + i, name, heroId: this.rng.pick(C.Heroes).Id, vehicleId: this.rng.pick(C.Vehicles).Id, isBot: true, difficulty: o.difficulty || "Normal" }); }
    // shuffle grid (Grand Tour: order by standings passed in opts.gridOrder)
    let order = roster.slice(); for (let i = order.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
    if (o.gridOrder) order.sort((a, b) => (o.gridOrder[a.key] || 0) - (o.gridOrder[b.key] || 0));
    const slots = this.track.gridSlots(order.length);
    order.forEach((r, i) => {
      const stats = computeStats(r.heroId, r.vehicleId, o.speedClass || 1);
      const kart = new Kart(stats, slots[i]); kart.progress = this.track.locate(kart.pos, this.track.length - 30).progress;
      this.racers.push({ ...r, stats, kart, prog: newProgress(0, kart.progress), position: i + 1, items: { active: null, reserve: null }, brain: r.isBot ? new BotBrain(r.difficulty, this.rng.int(1, 1e9)) : null, hitImmuneUntil: 0, itemLockUntil: 0, lastItemAt: -100, itemsUsed: 0, hitsTaken: 0, strongHits: 0, cleanRace: true, startBoost: null, startPressAt: null, effects: {}, overcharge: 0, nextOvercharge: 0, magnetUntil: 0, phaseUntil: 0, shieldStrong: 0, shieldWeak: 0, tricks: 0, driftBoosts: 0, wrongWay: false, watch: { off: null, stuck: null }, respawnLockUntil: 0, lastPos: null, input: { steer: 0, throttle: 0, brake: 0, drift: false, trick: false } });
    });
    this.me = this.racers.find((r) => !r.isBot);
  }
  setupPickups() {
    if (this.itemsEnabled) this.track.itemPads().forEach((p, i) => this.pads.push({ id: "pad" + i, pos: p.pos, active: true, respawnAt: 0 }));
    if (this.mode !== "TimeTrial") this.track.shardSpawns().forEach((pos, i) => this.shards.push({ id: "shard" + i, pos, active: true, respawnAt: 0 }));
  }
  emit(kind, data) { this.events.push({ kind, ...data }); }
  startCountdown(now) { this.state = "Countdown"; this.countdownStartAt = now + 1.0; this.goAt = this.countdownStartAt + C.Race.CountdownSeconds; }
  pressThrottle(racer, now) { if (this.state === "Countdown" && racer.startPressAt === null) racer.startPressAt = now; else if (this.state === "Racing" && racer.startBoost === null && now - this.goAt < 1) this.resolveStart(racer, now); }
  resolveStart(racer, pressedAt) {
    if (racer.startBoost !== null) return; const res = evalStartBoost(pressedAt - this.goAt); racer.startBoost = res; const p = startBoostParams(res);
    if (p.sec > 0) racer.kart.boosts.push(makeBoost("Start", p.sec, p.bonus, racer.stats, this.goAt)); if (p.stall > 0) racer.kart.stallUntil = this.goAt + p.stall;
    if (!racer.isBot) this.emit("StartBoost", { result: res });
  }
  go(now) {
    this.state = "Racing"; this.stormAvailableAt = now;
    for (const r of this.racers) { r.prog.lapStartedAt = this.goAt; r.prog.lastCheckpointAt = this.goAt; if (r.startPressAt !== null) this.resolveStart(r, r.startPressAt); }
  }
  humanInput(input, now) { const r = this.me; r.input = input; if (input.throttle > 0 && (this.state === "Countdown" || (this.state === "Racing" && now - this.goAt < 1))) this.pressThrottle(r, now); }
  active() { return this.racers.filter((r) => r.prog.finishedAt === null && !r.prog.eliminated); }
  // --- main tick --------------------------------------------------------------------------------------------------
  tick(dt, now) {
    this.time = now; this.events.length = 0;
    if (this.state === "Countdown" && now >= this.goAt) this.go(now);
    const racing = this.state === "Racing" || this.state === "FinishWindow";
    for (const r of this.racers) {
      if (r.prog.eliminated) continue;
      let input = r.isBot ? this.botInput(r, now) : r.input;
      if (!racing) { input = { steer: 0, throttle: 0, brake: 0, drift: false, trick: false }; r.kart.speed = 0; }
      if (r.prog.finishedAt !== null) input = r.isBot ? { ...input, throttle: 0.4, drift: false } : { steer: r.input.steer, throttle: 0.5, brake: 0, drift: false, trick: false };
      if (r.isBot && r.brain && r.brain.last.useItem && r.items.active && racing) this.useItem(r, "active", now);
      r.kart.shards = r.shards || 0;
      const wasAir = r.kart.airborne; r.kart.landed = false; r.kart.landedTrick = false;
      r.kart.step(input, dt, now, this.track);
      if (r.kart.lastTier > 0) { r.driftBoosts++; if (!r.isBot) this.emit("DriftBoost", { tier: r.kart.lastTier }); r.kart.lastTier = 0; }
      if (r.kart.landed && !r.isBot) this.emit("Landed", { trick: r.kart.landedTrick }); if (r.kart.landedTrick) r.tricks++;
      void wasAir;
      if (racing && r.prog.finishedAt === null) {
        for (const ev of updateProgress(r.prog, r.kart.progress, now, this.shape, dt)) {
          if (ev.kind === "Finish") this.onFinish(r, now); else if (!r.isBot) this.emit(ev.kind, ev);
        }
        r.wrongWay = r.prog.direction < 0 && r.prog.wrongWaySince !== null && now - r.prog.wrongWaySince >= C.Race.WrongWaySeconds;
        this.watchRespawn(r, now);
      }
    }
    if (racing) {
      this.rank(); this.tickPickups(now); this.tickProjectiles(dt, now); this.tickHazards(dt, now); this.tickEffects(dt, now); this.tickSlipstream(now);
      if (this.mode === "Knockout") this.tickKnockout(now);
      if (this.state === "Racing" && this.firstFinishAt !== null) this.state = "FinishWindow";
      const humanDone = this.me.prog.finishedAt !== null || this.me.prog.eliminated;
      const allDone = this.active().length === 0;
      const windowOver = this.firstFinishAt !== null && now - this.firstFinishAt >= (humanDone ? 6 : C.Race.FinishWindowSeconds);
      if (allDone || windowOver) this.finish(now);
    }
  }
  rank() { const ranked = rankRacers(this.racers, this.shape); ranked.forEach((r, i) => (r.position = i + 1)); }
  onFinish(r, now) {
    const finished = this.racers.filter((x) => x.prog.finishedAt !== null).length; r.prog.finishPosition = finished;
    if (this.firstFinishAt === null) this.firstFinishAt = now;
    if (!r.isBot) this.emit("Finished", { position: finished, time: now - this.goAt });
  }
  finish(now) {
    if (this.state !== "Racing" && this.state !== "FinishWindow") return;
    this.state = "Results"; this.rank();
    this.results = rankRacers(this.racers, this.shape).map((r, i) => ({ key: r.key, name: r.name, heroId: r.heroId, vehicleId: r.vehicleId, isBot: r.isBot, position: i + 1, time: r.prog.finishedAt !== null ? r.prog.finishedAt - this.goAt : null, bestLap: r.prog.bestLap, finished: r.prog.finishedAt !== null, eliminated: r.prog.eliminated, stage: r.prog.stage, points: C.GrandTourPoints[i] || 0, shards: r.shards || 0, cleanRace: r.cleanRace, tricks: r.tricks, driftBoosts: r.driftBoosts, itemsUsed: r.itemsUsed }));
    this.emit("RaceOver", {});
  }
  // --- bots ---------------------------------------------------------------------------------------------------------
  botInput(r, now) {
    if (this.state === "Countdown") { if (r.startPressAt === null) r.startPressAt = this.goAt + (this.rng.next() * 2 - 1) * r.brain.prof.reaction; return { steer: 0, throttle: 0, brake: 1, drift: false, trick: false }; }
    const L = this.track.length, mine = r.prog.lap * L + r.prog.progress; let leader = mine, lastHuman = mine, ahead = null, behind = null;
    for (const o of this.racers) { if (o.prog.eliminated) continue; const theirs = o.prog.lap * L + o.prog.progress; leader = Math.max(leader, theirs); if (!o.isBot) lastHuman = Math.min(lastHuman, theirs); if (o !== r && o.prog.finishedAt === null) { const d = theirs - mine; if (d > 0 && (ahead === null || d < ahead)) ahead = d; else if (d < 0 && (behind === null || -d < behind)) behind = -d; } }
    const rubber = rubberBand(leader - mine, lastHuman - mine);
    const obstacles = this.projectiles.filter((p) => p.kind === "Trap" && p.owner !== r).map((p) => p.pos);
    const d = r.brain.think(this.track, r.kart, { now, rubber, obstacles, itemKind: r.items.active ? itemById[r.items.active].Kind : null, rivalAhead: ahead, rivalBehind: behind });
    return d;
  }
  // --- respawn -------------------------------------------------------------------------------------------------------
  watchRespawn(r, now) {
    if (now < r.respawnLockUntil) return; const w = r.watch, loc = r.kart.loc; let reason = null;
    if (loc && !loc.inCorridor) { w.off = w.off || now; if (now - w.off > C.Race.OffTrackRespawnSeconds) reason = "OffTrack"; } else w.off = null;
    if (Math.abs(r.kart.speed) < C.Race.StuckSpeedThreshold && this.state !== "Countdown") { w.stuck = w.stuck || now; if (now - w.stuck > C.Race.StuckSeconds) reason = "Stuck"; } else w.stuck = null;
    if (r.wrongWay && r.prog.wrongWaySince !== null && now - r.prog.wrongWaySince > C.Race.WrongWaySeconds * 3) reason = "WrongWay";
    if (reason) this.respawn(r, reason, now);
  }
  respawn(r, reason, now) {
    const sr = this.track.safeRespawn(r.prog.lastSafeProgress); r.kart.teleport(sr.point); r.kart.progress = sr.progress; r.prog.progress = sr.progress; r.prog.wrongWaySince = null; r.prog.direction = 0;
    r.hitImmuneUntil = Math.max(r.hitImmuneUntil, now + C.Race.RespawnInvulnerabilitySeconds); r.itemLockUntil = Math.max(r.itemLockUntil, now + C.Race.RespawnItemLockoutSeconds); r.respawnLockUntil = now + C.Race.RespawnInvulnerabilitySeconds;
    r.watch = { off: null, stuck: null }; if (!r.isBot) this.emit("Respawn", { reason });
  }
  requestRespawn(now) { if (this.me.respawnLockUntil < now && (this.state === "Racing" || this.state === "FinishWindow")) this.respawn(this.me, "Requested", now); }
  // --- pickups --------------------------------------------------------------------------------------------------------
  tickPickups(now) {
    for (const p of this.pads) if (!p.active && now >= p.respawnAt) p.active = true;
    for (const s of this.shards) if (!s.active && now >= s.respawnAt) s.active = true;
    for (const r of this.racers) {
      if (r.prog.finishedAt !== null || r.prog.eliminated) continue; const pos = r.kart.pos;
      if (this.itemsEnabled) for (const p of this.pads) if (p.active && vlen(vsub(p.pos, pos)) <= C.Items.PickupRadius) { p.active = false; p.respawnAt = now + C.Items.PadRespawnSeconds; this.grant(r, now); }
      const radius = r.magnetUntil > now ? itemById.MagnetCoil.Params.PullRadius : C.Shards.PickupRadius;
      for (const s of this.shards) if (s.active && vlen(vsub(s.pos, pos)) <= radius && (r.shards || 0) < C.Shards.MaxHeld) { s.active = false; s.respawnAt = now + C.Shards.RespawnSeconds; r.shards = (r.shards || 0) + 1; if (!r.isBot) this.emit("Shard", { count: r.shards }); }
    }
  }
  grant(r, now) {
    if (r.items.active && r.items.reserve) return null;
    const total = this.racers.length, held = [r.items.active, r.items.reserve].filter(Boolean);
    const leader = this.racers.find((x) => x.position === 1); const L = this.shape.length;
    const distToLeader = leader && leader !== r ? Math.max(0, leader.prog.lap * L + leader.prog.progress - (r.prog.lap * L + r.prog.progress)) : 0;
    let nearest = 1000; for (const o of this.racers) if (o !== r) nearest = Math.min(nearest, vlen(vsub(o.kart.pos, r.kart.pos)));
    const activeStrong = this.projectiles.filter((p) => itemById[p.item].Strength === "Strong").length;
    const id = rollItem({ bucket: bucketOf(r.position, total), total, distToLeader, distToNearest: nearest, lapsRemaining: Math.max(0, this.laps - r.prog.lap), activeStrong, stormAvailable: now >= this.stormAvailableAt, held, allowed: this.opts.allowedItems || null }, this.rng);
    if (!id) return null; if (!r.items.active) r.items.active = id; else r.items.reserve = id;
    if (!r.isBot) this.emit("Item", { id }); return id;
  }
  // --- items -------------------------------------------------------------------------------------------------------
  useItem(r, slot, now) {
    if (this.state !== "Racing" && this.state !== "FinishWindow") return false; if (r.prog.finishedAt !== null || r.prog.eliminated) return false;
    if (now < r.itemLockUntil || now - r.lastItemAt < C.Items.UseCooldownSeconds || r.phaseUntil > now) return false;
    const id = slot === "reserve" ? r.items.reserve : r.items.active; if (!id) return false; const def = itemById[id];
    if ((def.Kind === "Projectile" || def.Kind === "Homing" || def.Kind === "Trap") && this.projectiles.filter((p) => p.owner === r).length >= C.Items.MaxProjectilesPerPlayer) return false;
    if (!this.resolveItem(r, def, now)) return false;
    if (slot === "reserve") r.items.reserve = null; else { r.items.active = r.items.reserve; r.items.reserve = null; }
    r.lastItemAt = now; r.itemsUsed++; this.emit("ItemUse", { racer: r, id }); return true;
  }
  resolveItem(r, def, now) {
    const p = def.Params, k = r.kart, pos = k.pos, fwd = k.forward();
    switch (def.Kind) {
      case "Boost": k.boosts.push(makeBoost("Item", p.BoostSeconds, p.SpeedBonus, r.stats, now)); return true;
      case "Multi": r.overcharge = p.Pulses; r.nextOvercharge = now; return true;
      case "Projectile": this.projectiles.push({ id: Math.random(), item: def.Id, kind: "Projectile", owner: r, pos: vadd(vadd(pos, vmul(fwd, 5)), V3(0, 1.5, 0)), vel: vmul(fwd, p.Speed), spawnedAt: now, expiresAt: now + p.LifeSeconds, bounces: 0, radius: p.Radius, stun: p.StunLevel, progress: k.progress }); return true;
      case "Homing": { const L = this.shape.length, mine = r.prog.lap * L + r.prog.progress; let target = null, best = Infinity; for (const o of this.racers) { if (o === r || o.prog.finishedAt !== null || o.prog.eliminated) continue; const d = o.prog.lap * L + o.prog.progress - mine; if (d > 0 && d < best) { best = d; target = o; } } this.projectiles.push({ id: Math.random(), item: def.Id, kind: "Homing", owner: r, target, pos: vadd(vadd(pos, vmul(fwd, 5)), V3(0, 2, 0)), vel: vmul(fwd, p.Speed), spawnedAt: now, expiresAt: now + p.LifeSeconds, radius: p.Radius, stun: p.StunLevel, progress: k.progress }); if (target && !target.isBot) this.emit("Incoming", { item: def.Id, seconds: p.WarnSeconds }); return true; }
      case "Trap": { const place = vsub(pos, vmul(fwd, p.PlaceBehind)); const loc = this.track.locate(place, k.progress); if (loc.progress < 40 || loc.progress > this.track.length - 60 || !loc.inCorridor || loc.width < 24) return false; for (const cd of this.track.cpDists) if (Math.abs(this.track.spline.delta(loc.progress, cd - 6)) < 10) return false; const pt = this.track.spline.pointAt(loc.progress, clamp(loc.lateral, -loc.width * 0.4, loc.width * 0.4), 1.5); this.projectiles.push({ id: Math.random(), item: def.Id, kind: "Trap", owner: r, pos: pt.pos, vel: V3(0, 0, 0), spawnedAt: now, expiresAt: now + p.LifeSeconds, radius: p.Radius, stun: p.StunLevel }); return true; }
      case "Shield": r.effects.shield = now + p.DurationSeconds; r.shieldStrong = p.StrongAbsorb; r.shieldWeak = p.WeakAbsorb; return true;
      case "Wave": { for (let i = this.projectiles.length - 1; i >= 0; i--) { const pr = this.projectiles[i]; if (vlen(vsub(pr.pos, pos)) <= p.Radius && itemById[pr.item].Strength !== "Strong") this.projectiles.splice(i, 1); } for (const o of this.racers) { if (o === r) continue; const d = vsub(o.kart.pos, pos), dist = vlen(d); if (dist <= p.Radius && dist > 0.1) { const push = vmul(vunit(d), p.PushImpulse * 0.25); o.kart.pos = vadd(o.kart.pos, V3(push.x, 0, push.z)); o.kart.speed *= 0.85; if (p.SlowSeconds) { o.kart.slowScale = p.SlowScale; o.kart.slowUntil = now + p.SlowSeconds; } } } this.emit("Wave", { racer: r, radius: p.Radius, id: def.Id }); return true; }
      case "Warp": { const prog = r.prog, tr = this.track; let maxByFinish = tr.length - 20 - prog.progress; if (prog.progress > tr.length - 20) maxByFinish = 0; const warp = Math.min(p.WarpDistance, maxByFinish); if (warp < 15) return false; let target = prog.progress + warp, gain = 0; for (const o of this.racers) if (o !== r && o.prog.lap === prog.lap && o.prog.progress > prog.progress && o.prog.progress < target) gain++; if (gain > p.MaxPlacementGain) target = prog.progress + warp * (p.MaxPlacementGain / gain); for (let i = prog.checkpoint + 1; i <= tr.cpCount - 1; i++) if (tr.cpDists[i - 1] <= target) { prog.checkpoint = i; prog.lastCheckpointAt = now; prog.lastSafeProgress = tr.cpDists[i - 1]; } const pt = tr.spline.pointAt(target, 0, 4); const spd = k.speed; k.teleport(pt); k.speed = spd; k.progress = tr.spline.wrap(target); prog.progress = k.progress; r.respawnLockUntil = now + 0.6; this.emit("Blink", { racer: r }); return true; }
      case "Global": { if (now < this.stormAvailableAt) return false; this.stormAvailableAt = now + (def.GlobalCooldown || 45); const targets = this.racers.filter((o) => o !== r && o.position <= p.TargetsTop && o.prog.finishedAt === null); for (const t of targets) { t.effects.stormWarn = now + p.WarnSeconds; if (!t.isBot) this.emit("Incoming", { item: def.Id, seconds: p.WarnSeconds }); } this.stormStrikes.push({ at: now + p.WarnSeconds, owner: r }); this.emit("Storm", { racer: r }); return true; }
      case "Magnet": r.magnetUntil = now + p.DurationSeconds; r.effects.magnet = r.magnetUntil; return true;
      case "Phase": r.phaseUntil = now + p.DurationSeconds; r.effects.phase = r.phaseUntil; return true;
    }
    return false;
  }
  applyHit(attacker, target, itemId, level, now) {
    const def = itemById[itemId] || itemById.StaticPod;
    if (target.prog.finishedAt !== null || target.prog.eliminated) return "Finished";
    if (target.phaseUntil > now) return "Phased"; if (target.hitImmuneUntil > now) return "Immune";
    if (target.effects.shield && target.effects.shield > now && def.BlockedByShield !== false) { if (level >= 2) target.shieldStrong--; else target.shieldWeak--; if (target.shieldStrong <= 0 || target.shieldWeak <= 0) target.effects.shield = 0; this.emit("Shielded", { racer: target }); return "Shielded"; }
    const drop = Math.min(level >= 2 ? C.Shards.DropOnHeavyHit : C.Shards.DropOnLightHit, target.shards || 0); target.shards = (target.shards || 0) - drop;
    for (let i = 0; i < drop; i++) this.shards.push({ id: "drop" + Math.random(), pos: vadd(target.kart.pos, V3(this.rng.range(-6, 6), 2, this.rng.range(-6, 6))), active: true, respawnAt: Infinity, dropped: true });
    target.hitsTaken++; if (level >= 2) { target.strongHits++; target.cleanRace = false; }
    const stun = hitStunParams(level, target.stats); target.kart.stunUntil = now + stun.sec; target.kart.stunScale = stun.scale; target.kart.boosts = []; target.kart.drifting = false; if (stun.spin) target.kart.spin = 9;
    target.hitImmuneUntil = now + P.HitStun.ImmunitySeconds + stun.sec;
    this.emit("Hit", { racer: target, level, item: itemId, attacker }); return "Hit";
  }
  tickProjectiles(dt, now) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; if (now >= p.expiresAt) { this.projectiles.splice(i, 1); continue; }
      const def = itemById[p.item];
      if (p.kind === "Homing") { const t = p.target; if (!t || t.prog.finishedAt !== null) { this.projectiles.splice(i, 1); continue; } const desired = vsub(vadd(t.kart.pos, V3(0, 1, 0)), p.pos); if (vlen(desired) > 1e-3) p.vel = vlerp(p.vel, vmul(vunit(desired), def.Params.Speed), clamp(def.Params.TurnRate * dt, 0, 1)); }
      if (p.kind !== "Trap") {
        const next = vadd(p.pos, vmul(p.vel, dt)); const loc = this.track.locate(next, p.progress); p.progress = loc.progress;
        if (!loc.inCorridor || Math.abs(loc.lateral) > loc.width * 0.5) { if (p.kind === "Projectile" && p.bounces < (def.Params.MaxBounces || 0)) { p.bounces++; const rt = this.track.spline.pointAt(loc.progress, 0, 0); const n = vmul(rt.right, -sign(loc.lateral)); p.vel = vsub(p.vel, vmul(n, 2 * vdot(p.vel, n))); p.pos = vadd(p.pos, vmul(p.vel, dt)); this.emit("Bounce", { pos: p.pos }); } else { this.projectiles.splice(i, 1); continue; } }
        else { const rt = this.track.spline.pointAt(loc.progress, 0, 0); p.pos = V3(next.x, rt.pos.y + 1.5, next.z); }
      }
      for (const r of this.racers) {
        if (r.prog.finishedAt !== null || r.prog.eliminated) continue; if (r === p.owner && (now - p.spawnedAt < 0.4 || p.kind !== "Trap")) continue;
        if (vlen(vsub(r.kart.pos, p.pos)) <= p.radius + 3) { this.projectiles.splice(i, 1); this.applyHit(p.owner, r, p.item, p.stun, now); break; }
      }
    }
  }
  tickHazards(dt, now) {
    for (const r of this.racers) {
      if (r.prog.finishedAt !== null || r.hitImmuneUntil > now || !r.kart.loc || r.kart.loc.shortcut) continue;
      for (const h of this.track.hazardsAt(r.kart.loc.progress, r.kart.loc.lateral)) {
        let active = true; if (h.Period && h.Duration) active = (now % h.Period) < h.Duration;
        if (h.Kind === "Collapse") active = (now % h.Period) > h.Period - 4;
        if (active && h.StunLevel && r.phaseUntil <= now) this.applyHit(null, r, "StaticPod", h.StunLevel, now);
        if (active && h.Force) { const f = arr3(h.Force); r.kart.pos = vadd(r.kart.pos, vmul(f, dt * 0.35)); }
        if (h.Kind === "Collapse" && active) this.respawn(r, "Fell", now);
      }
    }
    for (const sc of this.track.shortcuts) if (sc.def.Gate) { const cyc = sc.def.Gate.OpenSeconds + sc.def.Gate.ClosedSeconds; const open = (now % cyc) < sc.def.Gate.OpenSeconds; if (open !== sc.gateOpen) { sc.gateOpen = open; this.emit("Gate", { id: sc.def.Id, open }); } }
  }
  tickEffects(dt, now) {
    for (let i = this.stormStrikes.length - 1; i >= 0; i--) { const s = this.stormStrikes[i]; if (now >= s.at) { this.stormStrikes.splice(i, 1); const def = itemById.StormCrown; for (const o of this.racers) if (o.effects.stormWarn) { o.effects.stormWarn = 0; if (this.applyHit(s.owner, o, "StormCrown", def.Params.StunLevel, now) === "Hit") { o.kart.slowScale = def.Params.SlowScale; o.kart.slowUntil = now + def.Params.SlowSeconds; } } } }
    for (const r of this.racers) {
      if (r.overcharge > 0 && now >= r.nextOvercharge) { const d = itemById.OverchargePack; r.overcharge--; r.nextOvercharge = now + d.Params.PulseSeconds + d.Params.GapSeconds; r.kart.boosts.push(makeBoost("Overcharge", d.Params.PulseSeconds, d.Params.SpeedBonus, r.stats, now)); }
      // gated shortcut closed: push racers out of it
      if (r.kart.loc && r.kart.loc.shortcut && !r.kart.loc.shortcut.gateOpen && r.kart.loc.scProgress < 20) { r.kart.speed *= 0.5; r.kart.pos = vsub(r.kart.pos, vmul(r.kart.forward(), 4)); }
    }
  }
  tickSlipstream(now) {
    const s = P.Slipstream;
    for (const r of this.racers) {
      if (r.prog.finishedAt !== null || now - (r.lastSlip || -100) < s.CooldownSeconds) continue; let inCone = false;
      for (const o of this.racers) { if (o === r) continue; const d = vsub(o.kart.pos, r.kart.pos), dist = vlen(d); if (dist < s.MinDistance || dist > s.MaxDistance) continue; const ang = Math.acos(clamp(vdot(vunit(d), r.kart.forward()), -1, 1)) * 180 / Math.PI; if (ang <= s.ConeDegrees) { inCone = true; break; } }
      if (inCone) { r.slipSince = r.slipSince || now; const charge = s.ChargeSeconds * (r.magnetUntil > now ? 0.8 : 1); if (now - r.slipSince >= charge) { const bonus = s.SpeedBonus + (r.magnetUntil > now ? 0.05 : 0); r.kart.boosts.push(makeBoost("Slipstream", s.BoostSeconds, bonus, r.stats, now)); r.lastSlip = now; r.slipSince = null; if (!r.isBot) this.emit("Slipstream", {}); } }
      else r.slipSince = null;
    }
  }
  tickKnockout(now) {
    const stages = 3; if (this.knockoutStage >= stages) return; const gateLap = this.knockoutStage + 1;
    const act = this.active(); const reached = act.filter((r) => r.prog.lap >= gateLap).length; const n = act.length;
    const cut = n <= 2 ? 0 : Math.min(Math.max(1, Math.round(n * 0.25)), n - Math.max(2, stages - this.knockoutStage));
    if (cut <= 0) { this.knockoutStage++; return; }
    if (reached >= n - cut) { const ranked = rankRacers(act, this.shape); ranked.forEach((r, i) => { if (i >= n - cut) { r.prog.eliminated = true; r.prog.stage = this.knockoutStage; if (!r.isBot) this.emit("Eliminated", { stage: this.knockoutStage + 1 }); } else r.prog.stage = this.knockoutStage + 1; }); this.knockoutStage++; this.emit("KnockoutStage", { stage: this.knockoutStage, stages, cut }); }
  }
  safePosition() { const n = this.active().length; const stagesLeft = 3 - this.knockoutStage; const cut = n <= 2 ? 0 : Math.min(Math.max(1, Math.round(n * 0.25)), n - Math.max(2, stagesLeft)); return n - cut; }
}
