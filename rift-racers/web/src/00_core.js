// ===== Core: content, math, spline, RNG, locale =================================================================
"use strict";
const C = window.__RR_CONTENT__;
const V3 = (x, y, z) => ({ x, y, z });
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vmul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vlen = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
const vunit = (a) => { const l = vlen(a); return l > 1e-9 ? vmul(a, 1 / l) : V3(0, 0, -1); };
const vcross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const vlerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const arr3 = (a) => V3(a[0], a[1], a[2]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => (a === b ? 0 : clamp((v - a) / (b - a), 0, 1));
const damp = (cur, target, smoothing, dt) => lerp(cur, target, 1 - Math.exp(-smoothing * dt));
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const wrap = (v, len) => v - Math.floor(v / len) * len;
const loopDelta = (a, b, len) => { let d = wrap(b - a, len); if (d > len / 2) d -= len; return d; };
const moveToward = (cur, target, maxDelta) => (Math.abs(target - cur) <= maxDelta ? target : cur + sign(target - cur) * maxDelta);

class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() { let x = this.s; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.s = x; return x / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  weighted(entries, weightOf) {
    let total = 0; for (const e of entries) total += Math.max(0, weightOf(e));
    if (total <= 0) return null;
    let roll = this.next() * total, acc = 0;
    for (const e of entries) { acc += Math.max(0, weightOf(e)); if (roll <= acc) return e; }
    return entries[entries.length - 1];
  }
}

// --- Locale ----------------------------------------------------------------------------------------------------
const Locale = {
  lang: (navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en",
  t(key, ...args) {
    const e = C.Strings[key];
    let s = e ? (e[Locale.lang] || e.en) : key;
    return s.replace(/\{(\d+)\}/g, (_, i) => (args[+i] === undefined ? "" : String(args[+i])));
  },
  ordinal(n) {
    if (Locale.lang === "ru") return n + "-й";
    const n100 = n % 100; if (n100 >= 11 && n100 <= 13) return n + "th";
    const n10 = n % 10; return n + (n10 === 1 ? "st" : n10 === 2 ? "nd" : n10 === 3 ? "rd" : "th");
  },
  plural(n, one, few, many) {
    if (Locale.lang === "en") return n === 1 ? one : many;
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  },
  num(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, Locale.lang === "ru" ? " " : ","); },
};
const T = Locale.t;
const fmtTime = (s) => {
  if (!(s >= 0) || !isFinite(s)) return "--:--.---";
  const ms = Math.floor(s * 1000 + 0.5 + 1e-6);
  return String(Math.floor(ms / 60000)).padStart(2, "0") + ":" + String(Math.floor(ms / 1000) % 60).padStart(2, "0") + "." + String(ms % 1000).padStart(3, "0");
};

// --- Catmull-Rom spline with arc length (port of Shared/Utility/Spline) ---------------------------------------------
const WORLD_UP = V3(0, 1, 0);
function frameFor(tangent) {
  const t = vlen(tangent) > 1e-6 ? vunit(tangent) : V3(0, 0, -1);
  let right = vcross(t, WORLD_UP);
  right = vlen(right) < 1e-4 ? V3(1, 0, 0) : vunit(right);
  const up = vunit(vcross(right, t));
  return [t, right, up];
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return V3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}
class Spline {
  constructor(points, scale = 1, closed = true, per = 16) {
    const pts = points.map((p) => vmul(p, scale));
    const n = pts.length; this.closed = closed;
    const pt = (i) => (closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)]);
    const segCount = closed ? n : n - 1;
    this.samples = []; let dist = 0, last = null;
    for (let seg = 0; seg < segCount; seg++) {
      const p0 = pt(seg - 1), p1 = pt(seg), p2 = pt(seg + 1), p3 = pt(seg + 2);
      const lastStep = !closed && seg === segCount - 1 ? per : per - 1;
      for (let k = 0; k <= lastStep; k++) {
        const t = k / per;
        const pos = catmull(p0, p1, p2, p3, t);
        const tangent = vsub(catmull(p0, p1, p2, p3, Math.min(t + 1 / per, 1)), catmull(p0, p1, p2, p3, Math.max(t - 1 / per, 0)));
        if (last) dist += vlen(vsub(pos, last));
        const [tan, right, up] = frameFor(tangent);
        this.samples.push({ pos, tan, right, up, dist });
        last = pos;
      }
    }
    this.length = closed && last ? dist + vlen(vsub(last, this.samples[0].pos)) : dist;
    this.count = this.samples.length;
  }
  wrap(d) { return this.closed ? wrap(d, this.length) : clamp(d, 0, this.length); }
  delta(from, to) { return this.closed ? loopDelta(from, to, this.length) : to - from; }
  index(d) { let lo = 0, hi = this.count - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.samples[mid].dist <= d) lo = mid; else hi = mid - 1; } return lo; }
  sampleAt(dist) {
    const d = this.wrap(dist); const i = this.index(d); const a = this.samples[i]; let b = this.samples[i + 1]; let segLen;
    if (!b) { if (!this.closed) return [a.pos, a.tan, a.right, a.up]; b = this.samples[0]; segLen = this.length - a.dist; } else segLen = b.dist - a.dist;
    const t = segLen > 1e-6 ? clamp((d - a.dist) / segLen, 0, 1) : 0;
    const [tan, right, up] = frameFor(vlerp(a.tan, b.tan, t));
    return [vlerp(a.pos, b.pos, t), tan, right, up];
  }
  posAt(d) { return this.sampleAt(d)[0]; }
  pointAt(d, lateral = 0, height = 0) { const [p, t, r, u] = this.sampleAt(d); return { pos: vadd(vadd(p, vmul(r, lateral)), vmul(u, height)), tan: t, right: r, up: u }; }
  closest(position, hint, window = 24) {
    let bestI = 0, bestD = Infinity, startI = 0, endI = this.count - 1;
    if (hint !== undefined && hint !== null) { const hi = this.index(this.wrap(hint)); startI = hi - window; endI = hi + window; }
    for (let k = startI; k <= endI; k++) {
      let i = k; if (this.closed) i = ((k % this.count) + this.count) % this.count; else if (i < 0 || i >= this.count) continue;
      const d = vlen(vsub(this.samples[i].pos, position)); if (d < bestD) { bestD = d; bestI = i; }
    }
    let bestDist = this.samples[bestI].dist, bestLat = 0, bestOff = bestD;
    for (const si of [bestI - 1, bestI]) {
      let i0 = si; if (this.closed) i0 = ((si % this.count) + this.count) % this.count; else if (i0 < 0 || i0 >= this.count - 1) continue;
      const s0 = this.samples[i0], s1 = this.samples[i0 + 1] || this.samples[0];
      const seg = vsub(s1.pos, s0.pos), segLen = vlen(seg); if (segLen < 1e-6) continue;
      const t = clamp(vdot(vsub(position, s0.pos), seg) / (segLen * segLen), 0, 1);
      const proj = vadd(s0.pos, vmul(seg, t)); const off = vlen(vsub(position, proj));
      if (off <= bestOff + 1e-6) { bestOff = off; const segDist = s1 === this.samples[0] && this.closed ? this.length - s0.dist : s1.dist - s0.dist; bestDist = s0.dist + segDist * t; bestLat = vdot(vsub(position, proj), vlerp(s0.right, s1.right, t)); }
    }
    return { progress: this.wrap(bestDist), lateral: bestLat, offset: bestOff };
  }
  curvature(d) { const step = 12; const t0 = this.sampleAt(d - step)[1], t1 = this.sampleAt(d + step)[1]; return Math.acos(clamp(vdot(t0, t1), -1, 1)) / (2 * step); }
}
