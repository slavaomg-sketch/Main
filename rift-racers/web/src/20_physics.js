// ===== Vehicle stats, kart physics (port of KartPhysicsModel + KartSim), items, bots ===============================
const P = C.Physics;
const heroById = Object.fromEntries(C.Heroes.map((h) => [h.Id, h]));
const vehicleById = Object.fromEntries(C.Vehicles.map((v) => [v.Id, v]));
const itemById = Object.fromEntries(C.ItemDefs.map((i) => [i.Id, i]));
const trackById = Object.fromEntries(C.Tracks.map((t) => [t.Id, t]));

function computeStats(heroId, vehicleId, speedClass = 1) {
  const h = heroById[heroId] || C.Heroes[0], v = vehicleById[vehicleId] || C.Vehicles[0], p = v.Physics, m = h.Modifier;
  return { heroId: h.Id, vehicleId: v.Id, topSpeed: p.TopSpeed * speedClass, accel: p.Acceleration * m.Acceleration * speedClass, steerRate: p.SteerRate, grip: p.Grip * m.Stability, driftControl: p.DriftControl, mass: p.Mass * m.Weight, offroad: p.OffroadEfficiency, boostEff: p.BoostEfficiency, airControl: p.AirControl, recovery: p.Recovery * m.Recovery, trickEff: m.TrickEfficiency };
}
function displayStats(heroId, vehicleId) {
  const h = heroById[heroId], v = vehicleById[vehicleId], d = v.Display, m = h.Modifier, n = (x, k) => clamp(Math.round(x * k), 0, 100);
  return { TopSpeed: n(d.TopSpeed, 1), Acceleration: n(d.Acceleration, m.Acceleration), Handling: n(d.Handling, 1), Grip: n(d.Grip, m.Stability), DriftControl: n(d.DriftControl, 1), Weight: n(d.Weight, m.Weight), OffroadEfficiency: n(d.OffroadEfficiency, 1), BoostEfficiency: n(d.BoostEfficiency, 1), AirControl: n(d.AirControl, m.TrickEfficiency), Recovery: n(d.Recovery, m.Recovery) };
}
function surfaceMult(surfaceId, stats) {
  const s = C.Surfaces[surfaceId] || C.Surfaces.Asphalt; let g = s.Grip, a = s.Acceleration, t = s.TopSpeed, h = s.Handling;
  if (s.OffroadForVehicles) { const e = clamp(stats.offroad, 0, 1); g = lerp(g, 1, e); a = lerp(a, 1, e); t = lerp(t, 1, e); h = lerp(h, 1, e); }
  return { grip: g, accel: a, top: t, handling: h };
}
const boostBonus = (boosts, now) => boosts.reduce((b, x) => (x.endsAt > now ? Math.max(b, x.bonus) : b), 0);
const pruneBoosts = (boosts, now) => { for (let i = boosts.length - 1; i >= 0; i--) if (boosts[i].endsAt <= now) boosts.splice(i, 1); };
const shardBonus = (n) => Math.min(C.Shards.MaxSpeedBonus, Math.max(0, n) * C.Shards.SpeedBonusPerShard);
function effectiveTop(stats, surface, boosts, shards, now, slow = 1) { return stats.topSpeed * surfaceMult(surface, stats).top * (1 + boostBonus(boosts, now) + shardBonus(shards)) * slow; }
function makeBoost(source, seconds, bonus, stats, now) { return { source, endsAt: now + seconds * stats.boostEff, bonus }; }
function steerRate(speedFrac, stats, surface, drifting) {
  const sm = surfaceMult(surface, stats), f = clamp(speedFrac, 0, 1.5);
  let rate = lerp(P.MaxSteerRateLowSpeed, P.MaxSteerRateHighSpeed, invLerp(P.SteerSpeedBlendStart, 1, f));
  rate *= invLerp(0, 0.06, f) * stats.steerRate * sm.handling * Math.pow(clamp(100 / stats.mass, 0.75, 1.15), 0.5);
  if (drifting) rate *= P.DriftYawBonus; return rate;
}
const canStartDrift = (speedFrac, steer, grounded) => grounded && speedFrac >= P.DriftMinSpeedFraction && Math.abs(steer) >= P.DriftMinSteer;
const driftChargeRate = (angleFactor, speedFrac) => (angleFactor < P.DriftChargeAngleFactorMin || speedFrac < P.DriftChargeSpeedFactorMin ? 0 : clamp(angleFactor, 0.5, 1.25) * clamp(speedFrac, 0.6, 1.2));
const driftTier = (charge) => { let t = 0; P.DriftTiers.forEach((d, i) => { if (charge >= d.Seconds) t = i + 1; }); return t; };
function evalStartBoost(offset) { const s = P.StartBoost; if (offset < s.TooEarlyBefore) return "None"; if (offset < s.OkayBefore) return "Early"; if (offset < s.GoodBefore) return "Okay"; if (offset < s.PerfectBefore) return "Good"; if (offset <= s.PerfectAfter) return "Perfect"; if (offset <= s.GoodAfter) return "Good"; if (offset <= s.OkayAfter) return "Okay"; return "None"; }
function startBoostParams(r) { const s = P.StartBoost; if (r === "Perfect") return { sec: s.Perfect.BoostSeconds, bonus: s.Perfect.SpeedBonus, stall: 0 }; if (r === "Good") return { sec: s.Good.BoostSeconds, bonus: s.Good.SpeedBonus, stall: 0 }; if (r === "Okay") return { sec: s.Okay.BoostSeconds, bonus: s.Okay.SpeedBonus, stall: 0 }; if (r === "Early") return { sec: 0, bonus: 0, stall: s.Penalty.StallSeconds }; return { sec: 0, bonus: 0, stall: 0 }; }
function hitStunParams(level, stats) { const h = P.HitStun, rec = clamp(stats.recovery, 0.5, 1.5); return level >= 2 ? { sec: h.HeavySeconds / rec, scale: h.HeavySpeedScale, spin: true } : { sec: h.LightSeconds / rec, scale: h.LightSpeedScale, spin: false }; }

// --- Kart simulation ---------------------------------------------------------------------------------------------
class Kart {
  constructor(stats, point) {
    this.stats = stats; this.pos = { ...point.pos }; this.yaw = Math.atan2(-point.tan.x, -point.tan.z); this.speed = 0; this.boosts = []; this.shards = 0;
    this.drifting = false; this.driftDir = 0; this.driftCharge = 0; this.stunUntil = -1; this.stunScale = 1; this.stallUntil = -1; this.surface = "Asphalt";
    this.progress = 0; this.airborne = false; this.airUntil = -1; this.airT = 0; this.slowScale = 1; this.slowUntil = -1; this.lastTier = 0; this.spin = 0; this.grounded = true;
    this.effects = {}; this.pendingTrick = false; this.trickDone = false; this.onJump = null; this.roll = 0; this.pitch = 0; this.lateral = 0; this.wallHit = 0; this.heightOffset = 0;
  }
  forward() { return V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { const f = this.forward(); return V3(-f.z, 0, f.x); }
  velocity() { return vmul(this.forward(), this.speed); }
  teleport(point) { this.pos = { ...point.pos }; this.yaw = Math.atan2(-point.tan.x, -point.tan.z); this.speed = 0; this.drifting = false; this.driftCharge = 0; this.boosts = []; this.airborne = false; this.heightOffset = 0; this.spin = 0; }
  step(input, dt, now, track) {
    const st = this.stats; pruneBoosts(this.boosts, now); if (now > this.slowUntil) this.slowScale = 1;
    const stunned = now < this.stunUntil, stalled = now < this.stallUntil;
    const sm = surfaceMult(this.surface, st);
    let top = effectiveTop(st, this.surface, this.boosts, this.shards, now, this.slowScale); if (stunned) top *= this.stunScale;
    const speedFrac = Math.abs(this.speed) / Math.max(1, st.topSpeed); const grounded = !this.airborne; this.grounded = grounded;
    let steer = clamp(input.steer, -1, 1); if (stunned) steer *= 0.15;
    let rate = steerRate(speedFrac, st, this.surface, this.drifting); if (!grounded) rate *= st.airControl * P.AirControlTorque;
    let yawDelta = steer * rate * dt * (this.speed < 0 ? -1 : 1);
    if (this.drifting) yawDelta = (this.driftDir * 0.55 + steer * 0.45 * st.driftControl) * rate * dt;
    this.yaw -= yawDelta;
    if (stunned && this.spin > 0) { this.yaw += this.spin * dt; this.spin = Math.max(0, this.spin - 6 * dt); }
    // drift
    if (grounded && !stunned) {
      if (!this.drifting && input.drift && canStartDrift(speedFrac, steer, true)) { this.drifting = true; this.driftDir = sign(steer); this.driftCharge = 0; }
      else if (this.drifting) {
        if (!input.drift || speedFrac < P.DriftMinSpeedFraction * 0.8) { const tier = driftTier(this.driftCharge); this.lastTier = tier; const t = P.DriftTiers[tier - 1]; if (t) this.boosts.push(makeBoost("Drift" + tier, t.BoostSeconds, t.SpeedBonus, st, now)); this.drifting = false; this.driftCharge = 0; }
        else { const angleFactor = Math.abs(steer * 0.5 + this.driftDir * 0.5); this.driftCharge += driftChargeRate(angleFactor, speedFrac) * dt; }
      }
    } else if (this.drifting) { this.drifting = false; this.driftCharge = 0; }
    // longitudinal
    const accel = st.accel * sm.accel;
    if (stalled) this.speed = moveToward(this.speed, 0, accel * dt);
    else if (input.brake > 0 && this.speed > 1) this.speed = moveToward(this.speed, 0, accel * P.BrakeDecel * input.brake * dt);
    else if (input.brake > 0) this.speed = moveToward(this.speed, -st.topSpeed * P.ReverseSpeedFraction, accel * 0.6 * dt);
    else if (input.throttle > 0) { const target = top * clamp(input.throttle, 0, 1); if (this.speed < target) { const taper = clamp(1 - Math.pow(Math.max(0, this.speed) / target, 2), 0.15, 1); this.speed = Math.min(target, this.speed + accel * taper * dt); } else this.speed = moveToward(this.speed, target, accel * 0.5 * dt); }
    else this.speed = moveToward(this.speed, 0, this.speed * P.CoastDrag * dt + 2 * dt);
    if (this.drifting) this.speed *= 1 - 0.06 * dt;
    // integrate
    const f = this.forward(); let move = vmul(f, this.speed * dt);
    if (this.drifting) move = vadd(move, vmul(this.right(), -this.driftDir * this.speed * 0.25 * dt));
    this.pos = vadd(this.pos, move);
    // constraints
    const loc = track.locate(this.pos, this.progress); this.progress = loc.progress; this.surface = loc.surface; this.lateral = loc.lateral; this.loc = loc;
    let roadPt; this.wallHit = 0;
    if (loc.shortcut) { roadPt = loc.shortcut.spline.pointAt(loc.scProgress, 0, 0); const half = loc.width * 0.5 - 1.5; if (Math.abs(loc.lateral) > half) { const cl = clamp(loc.lateral, -half, half); this.pos = vadd(vadd(roadPt.pos, vmul(roadPt.right, cl)), V3(0, this.pos.y - roadPt.pos.y, 0)); this.speed *= Math.max(0, 1 - 1.5 * dt); this.drifting = false; this.wallHit = sign(loc.lateral); } }
    else { roadPt = track.spline.pointAt(loc.progress, 0, 0); const half = loc.width * 0.5 - 1.5; if (Math.abs(loc.lateral) > half) { const cl = clamp(loc.lateral, -half, half); this.pos = vadd(vadd(roadPt.pos, vmul(roadPt.right, cl)), V3(0, this.pos.y - roadPt.pos.y, 0)); this.speed *= Math.max(0, 1 - 1.5 * dt); this.drifting = false; this.wallHit = sign(loc.lateral); } }
    // jumps
    const jump = track.jumpAt(loc.progress);
    if (jump && grounded && this.speed > 20 && !this.airborne && !loc.shortcut) { this.airborne = true; this.airT = 0; this.airUntil = now + clamp(jump.GapLength / Math.max(20, this.speed), 0.45, 1.6); this.onJump = jump; this.trickDone = false; this.pendingTrick = false; }
    if (this.airborne) {
      this.airT += dt;
      if (input.trick && !this.trickDone && this.airT >= 0.15) { this.trickDone = true; this.pendingTrick = true; }
      if (now >= this.airUntil) { this.airborne = false; if (this.pendingTrick) { const t = P.Trick; this.boosts.push(makeBoost("Trick", t.BoostSeconds * st.trickEff, t.SpeedBonus, st, now)); this.landedTrick = true; } this.landed = true; this.pendingTrick = false; }
    }
    const air = this.airborne ? Math.sin(Math.PI * clamp((now - (this.airUntil - (this.airUntil - now) - this.airT)) / Math.max(0.01, this.airT + (this.airUntil - now)), 0, 1)) : 0;
    const arc = this.airborne ? 4 + 5 * Math.sin(Math.PI * clamp(this.airT / Math.max(0.05, this.airT + (this.airUntil - now)), 0, 1)) : 0;
    const targetY = roadPt.pos.y + 1.2 + arc;
    this.pos.y = this.airborne ? targetY : damp(this.pos.y, targetY, 14, dt);
    // visual lean
    const targetRoll = this.drifting ? -this.driftDir * 0.18 : -steer * 0.08 * speedFrac; this.roll = damp(this.roll, targetRoll, 8, dt);
    this.pitch = damp(this.pitch, this.airborne ? -0.12 : 0, 6, dt);
    void air;
  }
}

// --- Bot brain (port of BotBrain) ---------------------------------------------------------------------------------
const BotProfiles = {
  Easy: { reaction: 0.45, lookAhead: 34, noise: 5, mistake: 0.08, drift: 0.15, item: 0.4, brake: 1.3, shortcut: 0.05, speed: 0.86 },
  Normal: { reaction: 0.25, lookAhead: 44, noise: 2.5, mistake: 0.03, drift: 0.5, item: 0.65, brake: 1.0, shortcut: 0.3, speed: 0.95 },
  Hard: { reaction: 0.12, lookAhead: 56, noise: 1, mistake: 0.008, drift: 0.85, item: 0.85, brake: 0.8, shortcut: 0.6, speed: 1.0 },
};
class BotBrain {
  constructor(difficulty, seed) { this.prof = BotProfiles[difficulty] || BotProfiles.Normal; this.rng = new RNG(seed); this.lineOffset = 0; this.nextLine = 0; this.mistakeUntil = 0; this.mistakeSteer = 0; this.shortcut = null; this.driftingSince = null; this.lastItemAt = -100; this.lastDecision = -100; this.last = { steer: 0, throttle: 1, brake: 0, drift: false, trick: false, useItem: false }; }
  think(track, kart, obs) {
    const prof = this.prof, now = obs.now; if (now - this.lastDecision < prof.reaction) return this.last; this.lastDecision = now;
    if (now >= this.nextLine) { this.nextLine = now + this.rng.range(2, 5); const w = track.widthAt(kart.progress); this.lineOffset = this.rng.pick([-w * 0.3, 0, w * 0.3]) + (this.rng.next() * 2 - 1) * prof.noise; this.shortcut = null; for (const sc of track.shortcuts) { const ahead = track.spline.delta(kart.progress, sc.entryDist); if (ahead > 0 && ahead < 200 && sc.gateOpen && this.rng.next() < prof.shortcut) this.shortcut = sc; } }
    const lookAhead = prof.lookAhead * clamp(kart.speed / Math.max(1, kart.stats.topSpeed), 0.5, 1.3);
    let target = null, onSc = false;
    if (this.shortcut) { const sc = this.shortcut; const sp = sc.spline.closest(kart.pos, null); const aheadOnMain = track.spline.delta(kart.progress, sc.entryDist); if (sp.offset < sc.def.Width && sp.progress < sc.spline.length - 5) { target = sc.spline.posAt(sp.progress + lookAhead); onSc = true; } else if (aheadOnMain > 0 && aheadOnMain < lookAhead * 1.5) { target = sc.spline.posAt(Math.min(sc.spline.length, 12 + lookAhead * 0.5)); onSc = true; } else if (aheadOnMain < -20) this.shortcut = null; }
    if (!onSc) target = track.spline.pointAt(kart.progress + lookAhead, this.lineOffset, 0).pos;
    for (const ob of obs.obstacles) { const rel = vsub(ob, kart.pos); if (vlen(rel) < 30 && vdot(rel, kart.forward()) > 0) { const r = kart.right(); let side = sign(vdot(rel, r)) || 1; target = vsub(target, vmul(r, side * 8)); } }
    const to = vsub(target, kart.pos); to.y = 0; const f = kart.forward(); let steer = 0;
    if (vlen(to) > 1e-3) { const r = kart.right(); const tu = vunit(to); steer = clamp(Math.atan2(vdot(tu, r), vdot(tu, f)) / (35 * Math.PI / 180), -1, 1); }
    if (now < this.mistakeUntil) steer = clamp(steer + this.mistakeSteer, -1, 1); else if (this.rng.next() < prof.mistake * prof.reaction) { this.mistakeUntil = now + 0.35; this.mistakeSteer = (this.rng.next() * 2 - 1) * 0.6; }
    const curvature = track.spline.curvature(kart.progress + lookAhead * 0.8);
    const desired = clamp(1 - curvature * 28 * prof.brake, 0.45, 1) * prof.speed * obs.rubber;
    const speedFrac = kart.speed / Math.max(1, kart.stats.topSpeed);
    const throttle = speedFrac < desired ? 1 : 0.2, brake = speedFrac > desired + 0.18 ? 1 : 0;
    let drift = false;
    if (kart.grounded && Math.abs(steer) > 0.45 && speedFrac > P.DriftMinSpeedFraction) { if (this.driftingSince !== null) { drift = true; if (now - this.driftingSince > 3.2 || Math.abs(steer) < 0.25) { drift = false; this.driftingSince = null; } } else if (this.rng.next() < prof.drift) { drift = true; this.driftingSince = now; } }
    else if (this.driftingSince !== null && Math.abs(steer) < 0.2) this.driftingSince = null;
    let useItem = false;
    if (obs.itemKind && now - this.lastItemAt > 1.5 && this.rng.next() < prof.item) {
      const k = obs.itemKind;
      if (k === "Boost" || k === "Multi" || k === "Warp") useItem = curvature < 0.01;
      else if (k === "Projectile" || k === "Homing") useItem = obs.rivalAhead !== null && obs.rivalAhead < 120;
      else if (k === "Trap") useItem = obs.rivalBehind !== null && obs.rivalBehind < 60;
      else if (k === "Shield" || k === "Phase") useItem = obs.rivalBehind !== null && obs.rivalBehind < 40;
      else useItem = (obs.rivalAhead !== null && obs.rivalAhead < 30) || (obs.rivalBehind !== null && obs.rivalBehind < 20);
      if (useItem) this.lastItemAt = now;
    }
    const trick = kart.airborne && this.rng.next() < prof.drift;
    this.last = { steer, throttle, brake, drift, trick, useItem }; return this.last;
  }
}
function rubberBand(distToLeader, distToLastHuman) { const rb = C.Bots.RubberBand; const behind = clamp(distToLeader / rb.DistanceRange, 0, 1), ahead = clamp(-distToLastHuman / rb.DistanceRange, 0, 1); return clamp(1 + (rb.MaxSpeedScaleBehind - 1) * behind - (1 - rb.MinSpeedScaleAhead) * ahead, rb.MinSpeedScaleAhead, rb.MaxSpeedScaleBehind); }

// --- Item roll (port of ItemRoll) ------------------------------------------------------------------------------------
function rollItem(ctx, rng) {
  const weights = new Map();
  for (const def of C.ItemDefs) {
    if (ctx.allowed && !ctx.allowed.includes(def.Id)) continue;
    let w = def.Weights[ctx.bucket]; if (w <= 0) continue;
    if (def.CatchUp) { w *= 0.4 + clamp(ctx.distToLeader / 400, 0, 1.5); if (ctx.total <= 3) w *= 0.5; }
    if ((def.Kind === "Projectile" || def.Kind === "Homing") && ctx.distToNearest > 250) w *= 0.5;
    if (def.Kind === "Boost" && ctx.distToNearest > 250) w *= 1.3;
    if (ctx.lapsRemaining <= 1 && def.Kind === "Global") w *= 0.5;
    if (def.Strength === "Strong" && ctx.activeStrong >= C.Items.MaxActiveStrongEffects) w = 0;
    if (def.Id === "StormCrown" && !ctx.stormAvailable) w = 0;
    if (def.Strength === "Strong" && ctx.held.includes(def.Id)) w = 0;
    if (w > 0) weights.set(def.Id, w);
  }
  const ids = [...weights.keys()].sort(); if (!ids.length) return null;
  return rng.weighted(ids, (id) => weights.get(id));
}
