// ===== Rendering (three.js r128) ================================================================================
const T3 = window.THREE;
const col = (hex) => new T3.Color(hex);
function makeRenderer(canvas) {
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const r = new T3.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: "high-performance" });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2)); r.outputEncoding = T3.sRGBEncoding; r.shadowMap.enabled = false; return r;
}
const MAT = { cache: new Map(), get(hex, opts = {}) { const k = hex + JSON.stringify(opts); if (!this.cache.has(k)) this.cache.set(k, new T3.MeshLambertMaterial({ color: col(hex), emissive: opts.emissive ? col(opts.emissive) : col("#000000"), emissiveIntensity: opts.ei || 1, transparent: !!opts.opacity, opacity: opts.opacity || 1, side: opts.side || T3.FrontSide })); return this.cache.get(k); } };
const box = (w, h, d, hex, opts) => new T3.Mesh(new T3.BoxGeometry(w, h, d), MAT.get(hex, opts));
const cyl = (rt, rb, h, hex, opts, seg = 12) => new T3.Mesh(new T3.CylinderGeometry(rt, rb, h, seg), MAT.get(hex, opts));
const ball = (r, hex, opts) => new T3.Mesh(new T3.SphereGeometry(r, 12, 10), MAT.get(hex, opts));
const setPos = (m, p) => { m.position.set(p.x, p.y, p.z); return m; };

class Scene3D {
  constructor(canvas) {
    this.renderer = makeRenderer(canvas); this.scene = new T3.Scene(); this.camera = new T3.PerspectiveCamera(70, 1, 0.5, 4000);
    this.hemi = new T3.HemisphereLight(0xffffff, 0x223344, 0.9); this.sun = new T3.DirectionalLight(0xffffff, 0.8); this.sun.position.set(300, 500, 200);
    this.scene.add(this.hemi, this.sun); this.trackGroup = null; this.karts = new Map(); this.pickupMeshes = new Map(); this.projMeshes = new Map(); this.moving = []; this.gates = new Map();
    this.particles = new ParticlePool(this.scene, 400); this.camPos = new T3.Vector3(); this.camState = { yawOffset: 0, dip: 0, shake: 0, orbit: 0, fov: 70 };
    this.resize();
  }
  resize() { const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  applyAtmosphere(atm) {
    this.scene.background = col(atm.SkyColor); this.scene.fog = new T3.Fog(col(atm.FogColor), atm.FogEnd * 0.3, atm.FogEnd * 0.9);
    this.hemi.color = col("#ffffff"); this.hemi.groundColor = col(atm.Ambient); this.hemi.intensity = 0.55 + atm.Brightness * 0.25; this.sun.intensity = 0.35 + atm.Brightness * 0.3; this.sun.color = col(atm.Glow ? "#dcdcff" : "#fff4e0");
  }
  clearTrack() { if (this.trackGroup) { this.scene.remove(this.trackGroup); this.trackGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } this.trackGroup = null; this.moving = []; this.gates.clear(); for (const m of this.pickupMeshes.values()) this.scene.remove(m); this.pickupMeshes.clear(); for (const m of this.projMeshes.values()) this.scene.remove(m); this.projMeshes.clear(); for (const k of this.karts.values()) this.scene.remove(k.group); this.karts.clear(); }
  // --- track ---------------------------------------------------------------------------------------------------------
  buildTrack(track) {
    this.clearTrack(); const def = track.def, atm = def.Atmosphere, g = new T3.Group(); this.applyAtmosphere(atm);
    // ground plane
    const groundH = Math.min(...track.spline.samples.map((s) => s.pos.y)) - 12; const groundDecor = def.Decor.find((d) => /Plane$/.test(d.Kind));
    const groundColor = groundDecor && groundDecor.Kind === "LavaPlane" ? "#ff6e1e" : atm.GroundColor;
    const ground = new T3.Mesh(new T3.PlaneGeometry(6000, 6000), MAT.get(groundColor, groundDecor && groundDecor.Kind === "LavaPlane" ? { emissive: "#ff5a1e", ei: 0.6 } : {})); ground.rotation.x = -Math.PI / 2; ground.position.y = groundH + (groundDecor ? (groundDecor.Height || 0) + 12 : 0); g.add(ground);
    g.add(this.ribbon(track.spline, (d) => track.widthAt(d), (d) => track.surfaceAt(d), (d) => !!track.inGap(d), atm, true, track));
    for (const sc of track.shortcuts) g.add(this.ribbon(sc.spline, () => sc.def.Width, () => sc.def.Surface, () => false, atm, false, track, true));
    // ramps
    for (const j of def.Jumps) { const d = j.At * track.length; const w = track.widthAt(d); const rampLen = 16, rise = Math.tan(j.LaunchPitch * Math.PI / 180) * rampLen; const pt = track.spline.pointAt(d - rampLen / 2, 0, 0); const ramp = box(w, rise, rampLen, "#ffc83c", { emissive: "#ff9a1e", ei: 0.5 }); const ang = Math.atan2(-pt.tan.x, -pt.tan.z); ramp.position.set(pt.pos.x, pt.pos.y + rise / 2 - 0.3, pt.pos.z); ramp.rotation.set(0, ang, 0); ramp.rotateX(-Math.atan2(rise, rampLen)); g.add(ramp); }
    // finish arch + checkpoint lines
    const fin = track.spline.pointAt(0, 0, 0), fw = track.widthAt(0), fang = Math.atan2(-fin.tan.x, -fin.tan.z);
    for (const side of [-1, 1]) { const post = box(2, 16, 2, "#f0f0fa"); const p = vadd(fin.pos, vmul(fin.right, side * (fw / 2 + 2))); post.position.set(p.x, p.y + 8, p.z); post.rotation.y = fang; g.add(post); }
    const banner = box(fw + 6, 3, 1.5, "#50dcff", { emissive: "#50dcff", ei: 0.8 }); banner.position.set(fin.pos.x, fin.pos.y + 16, fin.pos.z); banner.rotation.y = fang; g.add(banner);
    track.cpDists.forEach((cd, i) => { if (i === track.cpDists.length - 1) return; const pt = track.spline.pointAt(cd, 0, 0); const line = box(track.widthAt(cd), 0.15, 1.5, "#50dcff", { emissive: "#50dcff", ei: 0.4, opacity: 0.5 }); line.position.set(pt.pos.x, pt.pos.y + 0.15, pt.pos.z); line.rotation.y = Math.atan2(-pt.tan.x, -pt.tan.z); g.add(line); });
    for (const t of def.KnockoutGates) { const d = t * track.length, pt = track.spline.pointAt(d, 0, 0); const line = box(track.widthAt(d), 0.15, 1.2, "#ff783c", { emissive: "#ff783c", ei: 0.5, opacity: 0.4 }); line.position.set(pt.pos.x, pt.pos.y + 0.16, pt.pos.z); line.rotation.y = Math.atan2(-pt.tan.x, -pt.tan.z); g.add(line); }
    // gates
    for (const sc of track.shortcuts) if (sc.def.Gate) { const pt = sc.spline.pointAt(6, 0, 0); const gate = box(sc.def.Width, 10, 2, "#ff5a28", { emissive: "#ff5a28", ei: 0.7, opacity: 0.55 }); gate.position.set(pt.pos.x, pt.pos.y + 4.5, pt.pos.z); gate.rotation.y = Math.atan2(-pt.tan.x, -pt.tan.z); g.add(gate); this.gates.set(sc.def.Id, gate); }
    // hazards & moving elements
    for (const h of def.HazardZones) { const d = h.At * track.length, pt = track.spline.pointAt(d, (track.mirror ? -1 : 1) * (h.Lateral || 0), 0); if (h.Kind === "Geyser") { const v = cyl(4, 4, 0.4, "#ff7828", { emissive: "#ff7828", ei: 0.8 }); setPos(v, vadd(pt.pos, V3(0, 0.2, 0))); g.add(v); const jet = cyl(2.5, 3.5, 14, "#ffb060", { emissive: "#ff8a30", ei: 0.9, opacity: 0.75 }); setPos(jet, vadd(pt.pos, V3(0, 7, 0))); jet.visible = false; g.add(jet); this.moving.push({ mesh: jet, kind: "Geyser", def: h, base: jet.position.clone() }); } else if (h.Kind === "LavaPool") { const to = (h.To || h.At) * track.length; const len = Math.abs(track.spline.delta(d, to)); const mid = track.spline.pointAt(d + len / 2, (track.mirror ? -1 : 1) * (h.Lateral || 0), 0); const pool = box(track.widthAt(d) * 0.4, 0.3, len, "#ff5a1e", { emissive: "#ff5a1e", ei: 0.9 }); pool.position.set(mid.pos.x, mid.pos.y + 0.1, mid.pos.z); pool.rotation.y = Math.atan2(-mid.tan.x, -mid.tan.z); g.add(pool); } else if (h.Kind === "Wind" || h.Kind === "Current" || h.Kind === "Conveyor") { const to = (h.To || h.At) * track.length; const len = Math.abs(track.spline.delta(d, to)); const mid = track.spline.pointAt(d + len / 2, 0, 0); const zone = box(track.widthAt(d), 5, len, h.Kind === "Conveyor" ? "#3c4660" : "#78dcff", { opacity: h.Kind === "Conveyor" ? 0.9 : 0.15, emissive: "#78dcff", ei: 0.2 }); zone.position.set(mid.pos.x, mid.pos.y + (h.Kind === "Conveyor" ? 0.2 : 3), mid.pos.z); zone.rotation.y = Math.atan2(-mid.tan.x, -mid.tan.z); if (h.Kind === "Conveyor") zone.scale.y = 0.06; g.add(zone); } }
    for (const m of def.MovingElements) { const d = m.At * track.length, pt = track.spline.pointAt(d, (track.mirror ? -1 : 1) * m.Lateral, m.Height); let mesh; if (m.Kind === "Crane") { const tower = box(6, m.Height, 6, "#e6aa28"); setPos(tower, vadd(pt.pos, V3(0, -m.Height / 2, 0))); g.add(tower); mesh = box(4, 4, 90, "#e6aa28"); } else if (m.Kind === "Ring") { mesh = new T3.Mesh(new T3.TorusGeometry(28 * m.Scale, 2, 8, 32), MAT.get("#b4dcff", { opacity: 0.6, emissive: "#6aa0ff", ei: 0.3 })); mesh.rotation.y = Math.atan2(-pt.tan.x, -pt.tan.z); } else if (m.Kind === "Press") { mesh = box(10, 6, 10, "#a0aabe"); const rod = box(3, m.Height + 6, 3, "#5a6478"); setPos(rod, vadd(pt.pos, V3(0, 6, 0))); g.add(rod); } else if (m.Kind === "Bridge") { mesh = box(track.widthAt(d) - 2, 1.2, m.Amplitude, "#785a46"); } else if (m.Kind === "Rail") { mesh = box(8, 8, 40, "#dcdcf0", { emissive: "#c878ff", ei: 0.3 }); mesh.rotation.y = Math.atan2(-pt.tan.x, -pt.tan.z); } else if (m.Kind === "Conveyor") { continue; } else mesh = box(6, 6, 6, "#c8c8c8"); setPos(mesh, pt.pos); if (m.Kind === "Press") mesh.rotation.y = Math.atan2(-pt.tan.x, -pt.tan.z); g.add(mesh); this.moving.push({ mesh, kind: m.Kind, def: m, base: mesh.position.clone(), tan: pt.tan }); }
    // decor
    for (const dcr of def.Decor) { if (/Plane$/.test(dcr.Kind)) continue; const d = dcr.At * track.length; const pt = track.spline.pointAt(d, (track.mirror ? -1 : 1) * dcr.Lateral, dcr.Height || 0); const yaw = Math.atan2(-pt.tan.x, -pt.tan.z); this.decor(dcr.Kind, pt.pos, yaw, dcr.Scale, dcr.Color, g, atm); }
    this.scene.add(g); this.trackGroup = g;
    // pickups
    return g;
  }
  ribbon(spline, widthAt, surfaceAt, inGap, atm, walls, track, isShortcut = false) {
    const group = new T3.Group(); const seg = 6; const n = Math.ceil(spline.length / seg);
    const pos = [], colors = [], idx = []; const wpos = [], wcol = [], widx = []; let vi = 0, wi = 0;
    const wallColor = col(atm.WallColor), glow = atm.Glow ? col("#50dcff") : wallColor;
    for (let i = 0; i <= n; i++) {
      const d = Math.min(spline.length, i * seg); const gap = inGap(d); const pt = spline.pointAt(d, 0, 0); const w = widthAt(d) / 2; const s = C.Surfaces[surfaceAt(d)] || C.Surfaces.Asphalt; const c = col(s.Color); if (isShortcut) c.offsetHSL(0, 0, 0.06);
      const l = vadd(pt.pos, vmul(pt.right, -w)), r = vadd(pt.pos, vmul(pt.right, w));
      pos.push(l.x, l.y - 0.05, l.z, r.x, r.y - 0.05, r.z); colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i > 0 && !gap && !inGap(d - seg)) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
      vi += 2;
      if (walls) { const hgt = 5; for (const side of [-1, 1]) { const b = vadd(pt.pos, vmul(pt.right, side * (w + 0.75))); const t = vadd(b, V3(0, hgt, 0)); wpos.push(b.x, b.y, b.z, t.x, t.y, t.z); const cc = wallColor; wcol.push(cc.r, cc.g, cc.b, glow.r, glow.g, glow.b); } if (i > 0 && !gap && !inGap(d - seg)) { for (const k of [0, 2]) { const a = wi - 4 + k, bb = wi + k; idx.length; widx.push(a, a + 1, bb, a + 1, bb + 1, bb, a, bb, a + 1, a + 1, bb, bb + 1); } } wi += 4; }
      else if (isShortcut) { const hgt = 2.5; for (const side of [-1, 1]) { const b = vadd(pt.pos, vmul(pt.right, side * (w + 0.5))); const t = vadd(b, V3(0, hgt, 0)); wpos.push(b.x, b.y, b.z, t.x, t.y, t.z); wcol.push(wallColor.r, wallColor.g, wallColor.b, wallColor.r, wallColor.g, wallColor.b); } if (i > 0) for (const k of [0, 2]) { const a = wi - 4 + k, bb = wi + k; widx.push(a, a + 1, bb, a + 1, bb + 1, bb, a, bb, a + 1, a + 1, bb, bb + 1); } wi += 4; }
    }
    const geo = new T3.BufferGeometry(); geo.setAttribute("position", new T3.Float32BufferAttribute(pos, 3)); geo.setAttribute("color", new T3.Float32BufferAttribute(colors, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    group.add(new T3.Mesh(geo, new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide })));
    if (wpos.length) { const wg = new T3.BufferGeometry(); wg.setAttribute("position", new T3.Float32BufferAttribute(wpos, 3)); wg.setAttribute("color", new T3.Float32BufferAttribute(wcol, 3)); wg.setIndex(widx); wg.computeVertexNormals(); group.add(new T3.Mesh(wg, new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide, emissive: atm.Glow ? col("#203040") : col("#000000") }))); }
    // lane dashes
    if (walls) { const dashPos = []; for (let d = 0; d < spline.length; d += 24) { if (inGap(d)) continue; const a = spline.pointAt(d, 0, 0.12).pos, b = spline.pointAt(d + 8, 0, 0.12).pos; dashPos.push(a.x, a.y, a.z, b.x, b.y, b.z); } const dg = new T3.BufferGeometry(); dg.setAttribute("position", new T3.Float32BufferAttribute(dashPos, 3)); group.add(new T3.LineSegments(dg, new T3.LineBasicMaterial({ color: 0xf0f0fa, transparent: true, opacity: 0.6 }))); }
    void track; return group;
  }
  decor(kind, p, yaw, s, color, g, atm) {
    const add = (m, dx, dy, dz) => { m.position.set(p.x, p.y, p.z); m.rotation.y = yaw; m.translateX(dx || 0); m.translateY(dy || 0); m.translateZ(dz || 0); g.add(m); return m; };
    const c = color || "#8c8ca0";
    switch (kind) {
      case "ContainerStack": for (let i = 0; i < 3; i++) add(box(16 * s, 8 * s, 8 * s, i === 1 ? "#f0a090" : c), (i % 2) * 6 * s, 4 * s + i * 8 * s, 0); break;
      case "NeonSign": add(box(1.2 * s, 24 * s, 1.2 * s, "#3c3c46"), 0, 12 * s, 0); add(box(14 * s, 6 * s, 1 * s, c, { emissive: c, ei: 1 }), 0, 26 * s, 0); break;
      case "Lighthouse": add(cyl(5 * s, 6 * s, 50 * s, "#f0f0eb"), 0, 25 * s, 0); add(box(8 * s, 5 * s, 8 * s, "#ffe678", { emissive: "#ffe678", ei: 1 }), 0, 52 * s, 0); break;
      case "Warehouse": add(box(60 * s, 20 * s, 30 * s, "#505a6e"), 0, 10 * s, 0); add(box(62 * s, 2 * s, 32 * s, "#3c4150"), 0, 21 * s, 0); break;
      case "FloatingIsland": add(box(60 * s, 6 * s, 50 * s, "#60aa5a"), 0, 0, 0); add(ball(22 * s, "#78645a"), 0, -16 * s, 0); break;
      case "GardenTree": add(cyl(1 * s, 1.2 * s, 10 * s, "#785032"), 0, 5 * s, 0); add(ball(6 * s, "#6ec878"), 0, 13 * s, 0); break;
      case "Windmill": add(box(8 * s, 30 * s, 8 * s, "#ebe6dc"), 0, 15 * s, 0); { const hub = new T3.Group(); for (let i = 0; i < 4; i++) { const b = box(2 * s, 24 * s, 0.6 * s, "#c8be aa".replace(" ", "")); b.rotation.z = (Math.PI / 2) * i; b.translateY(12 * s); hub.add(b); } hub.position.set(p.x, p.y + 30 * s, p.z); hub.rotation.y = yaw; hub.translateZ(5 * s); g.add(hub); this.moving.push({ mesh: hub, kind: "Spin", rate: 0.6 }); } break;
      case "Lantern": add(box(0.8 * s, 10 * s, 0.8 * s, "#50463c"), 0, 5 * s, 0); add(box(2 * s, 3 * s, 2 * s, c, { emissive: c, ei: 1 }), 0, 10 * s, 0); break;
      case "Volcano": add(new T3.Mesh(new T3.ConeGeometry(80 * s, 120 * s, 10), MAT.get("#321e1e")), 0, 60 * s, 0); add(cyl(20 * s, 20 * s, 6 * s, "#ff781e", { emissive: "#ff781e", ei: 1 }), 0, 118 * s, 0); break;
      case "ObsidianSpike": add(new T3.Mesh(new T3.ConeGeometry(4 * s, 26 * s, 5), MAT.get("#1e1923")), 0, 13 * s, 0); break;
      case "EmberVent": add(box(6 * s, 3 * s, 6 * s, c, { emissive: c, ei: 1 }), 0, 1.5 * s, 0); break;
      case "TunnelArch": add(box(3 * s, 20 * s, 6 * s, "#46465a"), -24 * s, 10 * s, 0); add(box(3 * s, 20 * s, 6 * s, "#46465a"), 24 * s, 10 * s, 0); add(box(51 * s, 3 * s, 6 * s, "#5a5a78"), 0, 21 * s, 0); break;
      case "GlassTunnel": { const ring = new T3.Mesh(new T3.TorusGeometry(24 * s, 2, 8, 24), MAT.get("#8cc8f0", { opacity: 0.4 })); add(ring, 0, 14 * s, 0); } break;
      case "Smokestack": add(cyl(5 * s, 5 * s, 50 * s, c), 0, 25 * s, 0); add(cyl(6 * s, 6 * s, 2 * s, "#c83c28"), 0, 51 * s, 0); break;
      case "IceSpire": add(new T3.Mesh(new T3.ConeGeometry(5 * s, 34 * s, 6), MAT.get("#c8ebff")), 0, 17 * s, 0); break;
      case "FurnaceGlow": add(box(14 * s, 12 * s, 10 * s, "#463c3c"), 0, 6 * s, 0); add(box(8 * s, 6 * s, 0.5 * s, c, { emissive: c, ei: 1 }), 0, 5 * s, 5.2 * s); break;
      case "PipeRun": for (let i = 0; i < 4; i++) { const pp = cyl(1.5 * s, 1.5 * s, 60 * s, "#828c96"); pp.rotation.z = Math.PI / 2; add(pp, 0, 12 * s + i * 4 * s, 0); } break;
      case "Dome": add(ball(60 * s, "#96d2f0", { opacity: 0.4 }), 0, 10 * s, 0); add(cyl(65 * s, 65 * s, 4 * s, "#505a6e"), 0, 2 * s, 0); break;
      case "Kelp": for (let i = 0; i < 5; i++) add(box(1 * s, 18 * s, 1 * s, "#3c8c5a"), i * 3 * s, 9 * s, (i % 2) * 3 * s); break;
      case "Telescope": { const t = cyl(3 * s, 3 * s, 30 * s, "#c8c8d2"); t.rotation.z = Math.PI / 2 + 0.6; add(t, 0, 0, 0); } break;
      case "Skyscraper": { const h = 60 * s; add(box(30, h, 30, "#282d46"), 0, h / 2, 0); for (let i = 1; i < h / 12; i++) add(box(26, 1.5, 0.4, "#78c8ff", { emissive: "#78c8ff", ei: 0.8 }), 0, i * 12 - 4, 15.2); } break;
      case "Billboard": add(box(1.5 * s, 28 * s, 1.5 * s, "#3c3c46"), 0, 14 * s, 0); add(box(24 * s, 10 * s, 1 * s, c, { emissive: c, ei: 0.9 }), 0, 30 * s, 0); break;
      case "RailPylon": add(box(3 * s, 30 * s, 3 * s, "#5a5a6e"), -30 * s, 15 * s, 0); add(box(3 * s, 30 * s, 3 * s, "#5a5a6e"), 30 * s, 15 * s, 0); add(box(63 * s, 2 * s, 4 * s, "#c878ff", { emissive: "#c878ff", ei: 0.8 }), 0, 31 * s, 0); break;
      case "MoonDisc": { const m = cyl(90 * s, 90 * s, 4 * s, "#e6e6c8", { emissive: "#e6e6c8", ei: 0.7 }); m.rotation.z = Math.PI / 2; add(m, 0, 0, 0); } break;
    }
    void atm;
  }
  // --- pickups / projectiles ---------------------------------------------------------------------------------------
  syncPickups(race) {
    for (const p of race.pads) { let m = this.pickupMeshes.get(p.id); if (!m) { m = new T3.Group(); const shell = new T3.Mesh(new T3.OctahedronGeometry(3.4), MAT.get("#50dcff", { emissive: "#50dcff", ei: 0.9, opacity: 0.8 })); const core = box(1.6, 1.6, 1.6, "#ffffff", { emissive: "#ffffff", ei: 1 }); m.add(shell, core); m.position.set(p.pos.x, p.pos.y + 3.5, p.pos.z); this.scene.add(m); this.pickupMeshes.set(p.id, m); } m.visible = p.active; }
    for (const s of race.shards) { let m = this.pickupMeshes.get(s.id); if (!m) { m = new T3.Mesh(new T3.OctahedronGeometry(1.2), MAT.get("#b48cff", { emissive: "#b48cff", ei: 0.9 })); m.scale.y = 1.6; m.position.set(s.pos.x, s.pos.y + 2, s.pos.z); this.scene.add(m); this.pickupMeshes.set(s.id, m); } m.visible = s.active; }
    const live = new Set(race.projectiles.map((p) => p.id));
    for (const [id, m] of this.projMeshes) if (!live.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }
    for (const p of race.projectiles) { let m = this.projMeshes.get(p.id); if (!m) { const def = itemById[p.item]; m = p.kind === "Homing" ? ball(1.3, def.Color, { emissive: def.Color, ei: 1 }) : p.kind === "Trap" ? cyl(1.6, 1.6, 1.2, def.Color, { emissive: def.Color, ei: 0.9 }) : cyl(1.6, 1.6, 0.5, def.Color, { emissive: def.Color, ei: 1 }); this.scene.add(m); this.projMeshes.set(p.id, m); } m.position.set(p.pos.x, p.pos.y, p.pos.z); m.rotation.y += 0.2; }
  }
  animateStatic(now) {
    for (const m of this.pickupMeshes.values()) { m.rotation.y = now * 1.5; m.position.y += Math.sin(now * 2 + m.position.x) * 0.004; }
    for (const m of this.moving) { const d = m.def; if (m.kind === "Spin") { m.mesh.rotation.z = now * m.rate; continue; } const phase = (now % d.Period) / d.Period; if (m.kind === "Crane") m.mesh.rotation.y = Math.sin(phase * Math.PI * 2) * (d.Amplitude * Math.PI / 180); else if (m.kind === "Ring") m.mesh.rotation.z = phase * Math.PI * 2; else if (m.kind === "Press") { const down = phase < 0.2 ? phase / 0.2 : phase < 0.4 ? 1 - (phase - 0.2) / 0.2 : 0; m.mesh.position.y = m.base.y - d.Amplitude * down; } else if (m.kind === "Bridge") { const collapsed = phase * d.Period > d.Period - 4; m.mesh.position.y = m.base.y + (collapsed ? -30 : 0.6); m.mesh.material.opacity = collapsed ? 0.3 : 1; m.mesh.material.transparent = true; } else if (m.kind === "Rail") { const off = (phase - 0.5) * d.Amplitude; m.mesh.position.set(m.base.x + m.tan.x * off, m.base.y, m.base.z + m.tan.z * off); } else if (m.kind === "Geyser") { const active = (now % d.Period) < d.Duration; m.mesh.visible = active; m.mesh.scale.y = active ? 0.5 + Math.sin(((now % d.Period) / d.Duration) * Math.PI) : 0.01; } }
    for (const [id, gate] of this.gates) { void id; }
  }
  setGate(id, open) { const g = this.gates.get(id); if (g) { g.material = MAT.get(open ? "#50ff96" : "#ff5a28", { emissive: open ? "#50ff96" : "#ff5a28", ei: 0.7, opacity: open ? 0.15 : 0.55 }); } }
  // --- karts -------------------------------------------------------------------------------------------------------
  buildKart(racer) {
    const v = vehicleById[racer.vehicleId].Visual, h = heroById[racer.heroId].Cosmetics, g = new T3.Group();
    const bs = arr3(v.BodySize), paint = racer.paint || v.PrimaryColor, y = -0.2;
    const body = (w, hh, d, c, dx, dy, dz, opts) => { const m = box(w, hh, d, c, opts); m.position.set(dx, dy, dz); g.add(m); return m; };
    if (v.Silhouette === "Wedge") { body(bs.x, bs.y, bs.z * 0.6, paint, 0, y, bs.z * 0.15); const nose = box(bs.x * 0.9, bs.y, bs.z * 0.4, paint); nose.position.set(0, y - 0.1, -bs.z * 0.35); nose.scale.y = 0.75; g.add(nose); }
    else if (v.Silhouette === "Pod") { const pod = ball(bs.x * 0.55, paint); pod.scale.set(1, bs.y * 1.6 / (bs.x * 1.1), bs.z * 0.8 / (bs.x * 1.1)); pod.position.set(0, y + 0.3, 0); g.add(pod); body(bs.x * 0.8, bs.y * 0.6, bs.z * 0.5, v.SecondaryColor, 0, y - 0.2, -bs.z * 0.3); }
    else if (v.Silhouette === "Long") { body(bs.x * 0.8, bs.y, bs.z, paint, 0, y, 0); body(bs.x, bs.y * 0.5, bs.z * 0.35, v.SecondaryColor, 0, y + 0.2, bs.z * 0.28); body(bs.x * 0.5, bs.y * 0.4, bs.z * 0.3, v.AccentColor, 0, y - 0.1, -bs.z * 0.38, { emissive: v.AccentColor, ei: 0.6 }); }
    else if (v.Silhouette === "Wide") { body(bs.x, bs.y, bs.z * 0.9, paint, 0, y, 0); body(bs.x * 1.05, bs.y * 0.3, bs.z * 0.2, v.AccentColor, 0, y + 0.5, -bs.z * 0.35); }
    else { body(bs.x, bs.y, bs.z, paint, 0, y, 0); body(bs.x * 0.9, bs.y * 0.4, bs.z * 0.3, v.SecondaryColor, 0, y + bs.y * 0.6, bs.z * 0.2); }
    const cs = arr3(v.CabinSize); body(cs.x, cs.y, cs.z, v.SecondaryColor, 0, y + bs.y / 2 + cs.y / 2 - 0.1, bs.z * 0.05);
    body(bs.x * 0.7, 0.3, 0.4, v.AccentColor, 0, y + 0.2, -bs.z / 2 + 0.2, { emissive: v.AccentColor, ei: 1 });
    body(bs.x * 0.6, 0.3, 0.3, "#ff3c3c", 0, y + 0.2, bs.z / 2 - 0.1, { emissive: "#ff3c3c", ei: 0.8 });
    // wheels
    const wheels = []; const wy = -0.6; const positions = v.WheelCount === 3 ? [[0, -bs.z * 0.42, true], [-bs.x * 0.5, bs.z * 0.35, false], [bs.x * 0.5, bs.z * 0.35, false]] : [[-bs.x * 0.5, -bs.z * 0.35, true], [bs.x * 0.5, -bs.z * 0.35, true], [-bs.x * 0.5, bs.z * 0.35, false], [bs.x * 0.5, bs.z * 0.35, false]];
    for (const [wx, wz, steer] of positions) { const pivot = new T3.Group(); pivot.position.set(wx, wy, wz); const w = cyl(v.WheelRadius, v.WheelRadius, v.WheelWidth, v.Kind === "Hover" ? v.AccentColor : "#232328", v.Kind === "Hover" ? { emissive: v.AccentColor, ei: 0.8 } : {}, 14); w.rotation.z = Math.PI / 2; pivot.add(w); g.add(pivot); wheels.push({ pivot, mesh: w, steer }); }
    // hero
    const hero = new T3.Group(); const seatY = y + bs.y / 2 + 0.2, seatZ = bs.z * 0.05;
    const torso = box(1.6, 1.6, 0.9, h.PrimaryColor); torso.position.set(0, seatY + 0.8, seatZ); hero.add(torso);
    let head; if (h.HeadShape === "Round" || h.HeadShape === "Dome") head = ball(0.6, h.SecondaryColor, h.HeadShape === "Dome" ? { opacity: 0.85 } : {}); else head = box(1.1, 1.15, 1.05, h.SecondaryColor); head.position.set(0, seatY + 2.3, seatZ); hero.add(head);
    const eyes = box(h.HeadShape === "Visor" ? 1.0 : 0.8, h.HeadShape === "Visor" ? 0.4 : 0.2, 0.15, h.AccentColor, { emissive: h.AccentColor, ei: 1 }); eyes.position.set(0, seatY + 2.38, seatZ - 0.55); hero.add(eyes);
    for (const side of [-1, 1]) { const arm = box(0.4, 1.2, 0.4, h.PrimaryColor); arm.position.set(side * 1.0, seatY + 1.1, seatZ - 0.3); arm.rotation.x = -0.9; hero.add(arm); }
    const acc = h.Accessory; if (acc === "Antenna") { const a = box(0.15, 0.9, 0.15, h.AccentColor, { emissive: h.AccentColor, ei: 1 }); a.position.set(0.3, seatY + 3.3, seatZ); hero.add(a); } else if (acc === "FeatherCap" || acc === "FurHood" || acc === "PilotScarf") { const a = box(1.3, 0.35, 1.3, h.AccentColor); a.position.set(0, seatY + 2.95, seatZ); hero.add(a); } else if (acc === "Goggles" || acc === "DiveMask") { const a = box(1.2, 0.35, 0.5, h.AccentColor, { opacity: 0.8 }); a.position.set(0, seatY + 2.7, seatZ - 0.35); hero.add(a); }
    g.add(hero);
    // shield bubble
    const shield = ball(5.5, "#78c8ff", { opacity: 0.25, emissive: "#78c8ff", ei: 0.6 }); shield.visible = false; g.add(shield);
    this.scene.add(g); const rec = { group: g, wheels, shield, spin: 0, hero }; this.karts.set(racer.key, rec); return rec;
  }
  syncKarts(race, dt) {
    for (const r of race.racers) {
      let k = this.karts.get(r.key); if (!k) k = this.buildKart(r); const kart = r.kart;
      k.group.position.set(kart.pos.x, kart.pos.y, kart.pos.z); k.group.rotation.set(kart.pitch, kart.yaw, kart.roll, "YXZ");
      k.spin += kart.speed * dt / Math.max(0.5, vehicleById[r.vehicleId].Visual.WheelRadius);
      for (const w of k.wheels) { w.mesh.rotation.x = k.spin; w.pivot.rotation.y = w.steer ? -r.input.steer * 0.38 : 0; }
      k.shield.visible = r.effects.shield > race.time; k.group.visible = !r.prog.eliminated;
      const phased = r.phaseUntil > race.time; k.group.traverse((o) => { if (o.material && o !== k.shield) { o.material.transparent = phased || o.material.opacity < 1; if (phased) o.material.opacity = 0.35; else if (!o.material.userData.baseOpacity) o.material.opacity = o.material.userData.baseOpacity = o.material.opacity < 1 && o.material.transparent ? o.material.opacity : 1; } });
      // particles
      if (kart.drifting && kart.grounded) this.particles.emit(vadd(kart.pos, vmul(kart.right(), kart.driftDir * 2.2)), kart.driftCharge >= P.DriftTiers[2].Seconds ? "#c878ff" : kart.driftCharge >= P.DriftTiers[1].Seconds ? "#ffc83c" : "#50dcff", 2, kart.velocity());
      if (boostBonus(kart.boosts, race.time) > 0) this.particles.emit(vsub(kart.pos, vmul(kart.forward(), 3.5)), "#50dcff", 3, vmul(kart.forward(), -20));
      const s = C.Surfaces[kart.surface]; if (s && (s.VFX === "Dust" || s.VFX === "Frost" || s.VFX === "Splash") && Math.abs(kart.speed) > 15 && kart.grounded) this.particles.emit(vsub(kart.pos, vmul(kart.forward(), 2)), s.VFX === "Frost" ? "#dcf0ff" : s.VFX === "Splash" ? "#78aadc" : "#b4a082", 1, V3(0, 3, 0));
    }
  }
  updateCamera(race, dt, opts) {
    const cam = this.camera, st = this.camState; const target = race ? (opts.spectate || race.me) : null;
    if (!target) { st.orbit += dt * 0.12; const p = opts.lobbyPivot || V3(0, 20, 0); cam.position.lerp(new T3.Vector3(p.x + Math.sin(st.orbit) * 90, p.y + 30, p.z + Math.cos(st.orbit) * 90), 1 - Math.exp(-2 * dt)); cam.lookAt(p.x, p.y + 6, p.z); cam.fov = damp(cam.fov, 62, 4, dt); cam.updateProjectionMatrix(); return; }
    const kart = target.kart, look = kart.forward(); const speedFrac = clamp(Math.abs(kart.speed) / 100, 0, 1.3); const cfg = C.Physics && window.__CAM__ || { Distance: 16, Height: 6.5, DistanceSpeedExtra: 5, FovBase: 70, FovSpeedExtra: 14, DriftYawDegrees: 9, Smoothing: 8 };
    const lookBack = opts.lookBack; let dist = lookBack ? 18 : cfg.Distance + cfg.DistanceSpeedExtra * speedFrac;
    const driftYaw = kart.drifting ? cfg.DriftYawDegrees * Math.PI / 180 * kart.driftDir * (opts.reduced ? 0.4 : 1) : 0; st.yawOffset = damp(st.yawOffset, driftYaw, 6, dt);
    let dir = V3(look.x * Math.cos(st.yawOffset) - look.z * Math.sin(st.yawOffset), 0, look.x * Math.sin(st.yawOffset) + look.z * Math.cos(st.yawOffset)); if (lookBack) dir = vmul(dir, -1);
    let height = cfg.Height; if (opts.results) { st.orbit += dt * 0.5; dir = V3(Math.sin(st.orbit), 0, Math.cos(st.orbit)); dist = 18; height = 7; }
    const desired = vadd(vsub(kart.pos, vmul(dir, dist)), V3(0, height, 0));
    const smoothing = opts.reduced ? 5 : cfg.Smoothing; this.camPos.lerp(new T3.Vector3(desired.x, desired.y, desired.z), 1 - Math.exp(-smoothing * dt));
    if (opts.snap) this.camPos.set(desired.x, desired.y, desired.z);
    st.dip = damp(st.dip, 0, 6, dt); st.shake = damp(st.shake, 0, 5, dt);
    const sh = st.shake * (opts.shakeAmt || 0.6) * (opts.reduced ? 0.3 : 1); const t = performance.now() / 1000;
    cam.position.set(this.camPos.x + Math.sin(t * 37) * sh, this.camPos.y - st.dip + Math.cos(t * 41) * sh, this.camPos.z);
    const focus = vadd(vadd(kart.pos, vmul(look, 8)), V3(0, 2 - st.dip * 2, 0)); cam.lookAt(focus.x, focus.y, focus.z);
    const fovTarget = cfg.FovBase + cfg.FovSpeedExtra * speedFrac * (opts.speedFov ?? 0.7) * (opts.reduced ? 0.4 : 1) + boostBonus(kart.boosts, race.time) * 30 * (opts.speedFov ?? 0.7);
    cam.fov = damp(cam.fov, fovTarget, 5, dt); cam.updateProjectionMatrix();
  }
  render(dt, now) { this.particles.update(dt); this.animateStatic(now); this.renderer.render(this.scene, this.camera); }
}

class ParticlePool {
  constructor(scene, n) {
    this.n = n; this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Array(n).fill(null).map(() => V3(0, 0, 0)); this.life = new Float32Array(n); this.head = 0;
    const geo = new T3.BufferGeometry(); geo.setAttribute("position", new T3.BufferAttribute(this.pos, 3)); geo.setAttribute("color", new T3.BufferAttribute(this.col, 3));
    this.points = new T3.Points(geo, new T3.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false, blending: T3.AdditiveBlending })); this.points.frustumCulled = false; scene.add(this.points); this.tmp = new T3.Color();
  }
  emit(p, hex, count, baseVel) { this.tmp.set(hex); for (let i = 0; i < count; i++) { const k = this.head; this.head = (this.head + 1) % this.n; this.pos[k * 3] = p.x + (Math.random() - 0.5); this.pos[k * 3 + 1] = p.y + Math.random() * 0.5; this.pos[k * 3 + 2] = p.z + (Math.random() - 0.5); this.col[k * 3] = this.tmp.r; this.col[k * 3 + 1] = this.tmp.g; this.col[k * 3 + 2] = this.tmp.b; this.vel[k] = vadd(vmul(baseVel, 0.15), V3((Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8)); this.life[k] = 0.5 + Math.random() * 0.3; } }
  update(dt) { for (let k = 0; k < this.n; k++) { if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -9999; continue; } this.life[k] -= dt; const v = this.vel[k]; this.pos[k * 3] += v.x * dt; this.pos[k * 3 + 1] += v.y * dt; this.pos[k * 3 + 2] += v.z * dt; v.y -= 20 * dt; } this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true; }
}
