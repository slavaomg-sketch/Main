// ===== Track runtime (port of Server/Systems/TrackRuntime) =======================================================
class TrackRuntime {
  constructor(def, mirror = false) {
    this.def = def; this.mirror = mirror && def.MirrorSupport;
    const mp = (p) => (this.mirror ? V3(-p[0], p[1], p[2]) : arr3(p));
    this.spline = new Spline(def.Path.map(mp), def.Scale, true, 18);
    this.length = this.spline.length;
    this.cpCount = def.CheckpointCount;
    this.cpDists = []; for (let i = 1; i <= this.cpCount; i++) this.cpDists.push(this.length * i / this.cpCount);
    this.shortcuts = def.Shortcuts.map((sc) => {
      const entryDist = this.spline.wrap(sc.EntryT * this.length), exitDist = this.spline.wrap(sc.ExitT * this.length);
      const pts = [vmul(this.spline.posAt(entryDist), 1 / def.Scale), ...sc.Path.map(mp), vmul(this.spline.posAt(exitDist), 1 / def.Scale)];
      return { def: sc, spline: new Spline(pts, def.Scale, false, 14), entryDist, exitDist, gateOpen: true };
    });
    this.surfaceCache = new Map();
  }
  widthAt(d) { const t = this.spline.wrap(d) / this.length; for (const o of this.def.WidthOverrides) if (t >= o.From && t < o.To) return o.Width; return this.def.Width; }
  surfaceAt(d) { const t = this.spline.wrap(d) / this.length; let r = "Asphalt"; for (const z of this.def.SurfaceZones) if (t >= z.From && t < z.To && C.Surfaces[z.Surface]) r = z.Surface; return r; }
  jumpAt(d) { const t = this.spline.wrap(d) / this.length; for (const j of this.def.Jumps) { const span = (j.GapLength + 20) / this.length; if (t >= j.At - 0.004 && t <= j.At + span) return j; } return null; }
  inGap(d) { const t = this.spline.wrap(d) / this.length; for (const j of this.def.Jumps) { if (t > j.At && t < j.At + j.GapLength / this.length) return j; } return null; }
  hazardsAt(d, lateral) {
    const t = this.spline.wrap(d) / this.length, out = [];
    for (const h of this.def.HazardZones) { const to = h.To !== undefined ? h.To : h.At + 18 / this.length; if (t >= h.At && t <= to) { if (h.Lateral !== undefined) { if (Math.abs(lateral - h.Lateral) <= 7) out.push(h); } else out.push(h); } }
    return out;
  }
  locate(position, hint) {
    const c = this.spline.closest(position, hint, 40);
    const width = this.widthAt(c.progress), corridor = width * C.Race.TrackCorridorWidthMultiplier;
    const vertical = Math.abs(position.y - this.spline.posAt(c.progress).y);
    const onMain = Math.abs(c.lateral) <= width * 0.75 + 4 && vertical < 90;
    if (!onMain) for (const sc of this.shortcuts) {
      const spanStart = sc.entryDist - 40, spanEnd = sc.exitDist + 40;
      const inSpan = spanStart <= spanEnd ? c.progress >= spanStart && c.progress <= spanEnd : c.progress >= spanStart || c.progress <= spanEnd;
      if (inSpan || hint !== undefined) {
        const sp = sc.spline.closest(position, null);
        if (Math.abs(sp.lateral) <= sc.def.Width * 0.75 + 4 && sp.offset < sc.def.Width * 1.5) {
          const frac = sp.progress / Math.max(1, sc.spline.length); let span = this.spline.delta(sc.entryDist, sc.exitDist); if (span < 0) span += this.length;
          return { progress: this.spline.wrap(sc.entryDist + span * frac), lateral: sp.lateral, offset: sp.offset, shortcut: sc, inCorridor: true, surface: sc.def.Surface, width: sc.def.Width, scProgress: sp.progress };
        }
      }
    }
    return { progress: c.progress, lateral: c.lateral, offset: c.offset, shortcut: null, inCorridor: Math.abs(c.lateral) <= corridor && vertical < 90, surface: onMain ? this.surfaceAt(c.progress) : "Dirt", width };
  }
  gridSlots(count) {
    const slots = [], cols = this.def.GridColumns, width = this.widthAt(0), spacing = Math.min(9, width / (cols + 1));
    for (let i = 0; i < count; i++) { const row = Math.floor(i / cols), col = i % cols; const lateral = (col - (cols - 1) / 2) * spacing * 1.6; const back = 14 + row * 11 + (col % 2) * 4; slots.push(this.spline.pointAt(-back, lateral, 3)); }
    return slots;
  }
  safeRespawn(progress) {
    let best = 0; for (const d of this.cpDists) if (d <= progress + 1 && d < this.length) best = Math.max(best, d);
    let rd = this.spline.wrap(best - 6); const j = this.jumpAt(rd); if (j) rd = this.spline.wrap(j.At * this.length - 30);
    return { point: this.spline.pointAt(rd, 0, 4), progress: rd };
  }
  itemPads() { const out = []; this.def.ItemSpawnGroups.forEach((g, gi) => { const d = g.At * this.length; for (const lat of g.Lateral) out.push({ pos: this.spline.pointAt(d, this.mirror ? -lat : lat, 2).pos, group: gi }); }); return out; }
  shardSpawns() { const out = []; for (const g of this.def.ShardGroups) { const d = g.At * this.length; for (let i = 0; i < g.Count; i++) out.push(this.spline.pointAt(d + i * g.Spacing, this.mirror ? -g.Lateral : g.Lateral, 2.5).pos); } return out; }
  setGate(id, open) { for (const sc of this.shortcuts) if (sc.def.Id === id) sc.gateOpen = open; }
}

// ===== Checkpoints / laps (port of CheckpointSystem) =============================================================
function newProgress(now, start = 0) { return { lap: 0, checkpoint: 0, progress: start, distanceToNext: 0, direction: 0, wrongWaySince: null, lastCheckpointAt: now, lapStartedAt: now, finishedAt: null, finishPosition: null, lastSafeProgress: 0, lapTimes: [], bestLap: null, eliminated: false, stage: 0 };
}
function crossedForward(a, b, dists, length) {
  const out = [], d = wrap(b - a, length);
  dists.forEach((cd, idx) => { let rel; if (cd >= length) { rel = wrap(-a, length); if (rel === 0) rel = length; } else rel = wrap(cd - a, length); if (rel > 0 && rel <= d) out.push(idx + 1); });
  out.sort((x, y) => { const rx = wrap((dists[x - 1] >= length ? 0 : dists[x - 1]) - a, length), ry = wrap((dists[y - 1] >= length ? 0 : dists[y - 1]) - a, length); return rx - ry; });
  return out;
}
function updateProgress(p, newProg, now, shape, dt) {
  const events = []; if (p.finishedAt !== null) { p.progress = newProg; return events; }
  const L = shape.length, delta = loopDelta(p.progress, newProg, L);
  const maxJump = Math.max(260 * Math.max(dt, 1 / 60), L / shape.cpCount * 0.9);
  if (Math.abs(delta) > maxJump) { events.push({ kind: "Teleport", value: delta }); return events; }
  if (delta > 0.05) {
    p.direction = 1; p.wrongWaySince = null; const n = shape.cpCount;
    for (const idx of crossedForward(p.progress, newProg, shape.cpDists, L)) {
      if (idx === n) {
        if (p.checkpoint === n - 1) {
          const lapTime = now - p.lapStartedAt; const sector = now - p.lastCheckpointAt;
          if (sector >= shape.minSector) { p.lap++; p.checkpoint = 0; p.lapTimes.push(lapTime); p.bestLap = p.bestLap === null ? lapTime : Math.min(p.bestLap, lapTime); p.lapStartedAt = now; p.lastCheckpointAt = now; p.lastSafeProgress = 0; if (p.lap >= shape.laps) { p.finishedAt = now; events.push({ kind: "Finish" }); } else events.push({ kind: "Lap", index: p.lap }); }
        } else events.push({ kind: "InvalidFinishCross" });
      } else if (idx === p.checkpoint + 1) { const sector = now - p.lastCheckpointAt; if (sector >= shape.minSector) { p.checkpoint = idx; p.lastCheckpointAt = now; p.lastSafeProgress = shape.cpDists[idx - 1]; events.push({ kind: "Checkpoint", index: idx }); } }
    }
  } else if (delta < -0.05) {
    p.direction = -1; if (p.wrongWaySince === null) p.wrongWaySince = now; else if (now - p.wrongWaySince >= C.Race.WrongWaySeconds) events.push({ kind: "WrongWay" });
    for (const idx of crossedForward(newProg, p.progress, shape.cpDists, L)) {
      if (idx === shape.cpCount) { if (p.checkpoint === 0 && p.lap > 0) { p.lap--; p.checkpoint = shape.cpCount - 1; p.lapTimes.pop(); } }
      else if (idx === p.checkpoint) p.checkpoint--;
    }
  } else p.direction = 0;
  p.progress = newProg;
  let nextDist = shape.cpDists[p.checkpoint] !== undefined ? shape.cpDists[p.checkpoint] : L; if (nextDist >= L) nextDist = 0;
  p.distanceToNext = wrap(nextDist - newProg, L);
  return events;
}
function effectiveProgress(p, shape) { const cap = shape.cpDists[p.checkpoint] !== undefined ? shape.cpDists[p.checkpoint] : shape.length; return p.lap * shape.length + Math.min(p.progress, cap); }
function rankRacers(racers, shape) {
  const list = racers.slice(); const eff = new Map(list.map((r) => [r, effectiveProgress(r.prog, shape)]));
  list.sort((a, b) => {
    const pa = a.prog, pb = b.prog; const fa = pa.finishedAt !== null, fb = pb.finishedAt !== null;
    if (fa !== fb) return fa ? -1 : 1; if (fa && fb) return (pa.finishPosition || 1e9) - (pb.finishPosition || 1e9);
    if (pa.eliminated !== pb.eliminated) return pa.eliminated ? 1 : -1;
    const ea = eff.get(a), eb = eff.get(b); if (Math.abs(ea - eb) > 0.01) return eb - ea;
    if (pa.distanceToNext !== pb.distanceToNext) return pa.distanceToNext - pb.distanceToNext;
    return pa.lastCheckpointAt - pb.lastCheckpointAt;
  });
  return list;
}
function bucketOf(position, total) { if (total <= 1) return "Front"; if (position === total) return "Last"; if (position <= Math.max(1, Math.floor(total * 0.25))) return "Front"; if (position >= Math.ceil(total * 0.67)) return "Back"; return "Mid"; }
