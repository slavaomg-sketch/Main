// ===== Profile (localStorage), audio synth, UI screens, HUD, touch controls, leaderboard ==========================
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const STORE_KEY = "riftracers.profile.v1";
const Profile = {
  data: null,
  defaults() { const heroes = {}, vehicles = {}; for (const h of C.Heroes) if (h.Unlock.Kind === "Default") heroes[h.Id] = true; for (const v of C.Vehicles) if (v.Unlock.Kind === "Default") vehicles[v.Id] = true; return { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), name: "", currency: 0, xp: 0, level: 1, heroes, vehicles, hero: "NovaVale", vehicle: "CometMk1", records: {}, ghosts: {}, stats: { races: 0, wins: 0, podiums: 0, laps: 0, tricks: 0, driftBoosts: 0, itemsUsed: 0, shards: 0, tourWins: 0 }, achievements: {}, settings: { locale: Locale.lang, autoAccelerate: null, sensitivity: 1, reducedMotion: false, sound: true, speedFov: 0.7, cameraShake: 0.6, layout: "Right", controlScale: 1, trackAssist: true, quality: "auto" }, tutorial: 0 }; },
  load() { try { const raw = localStorage.getItem(STORE_KEY); this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults(); } catch (e) { this.data = this.defaults(); } this.data.settings = Object.assign(this.defaults().settings, this.data.settings || {}); if (this.data.settings.locale) Locale.lang = this.data.settings.locale; return this.data; },
  save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ } },
  levelCurve(l) { return l <= 1 ? 0 : Math.floor(C.Rewards.LevelBaseXP * Math.pow(l - 1, C.Rewards.LevelExponent)); },
  levelFor(xp) { let l = 1; while (l < C.Rewards.MaxLevel && xp >= this.levelCurve(l + 1)) l++; return l; },
  evaluateUnlocks() { const d = this.data, out = []; for (const h of C.Heroes) if (!d.heroes[h.Id] && ((h.Unlock.Kind === "Level" && d.level >= h.Unlock.Level) || (h.Unlock.Kind === "Achievement" && d.achievements[h.Unlock.Id]))) { d.heroes[h.Id] = true; out.push(T(h.NameKey)); } for (const v of C.Vehicles) if (!d.vehicles[v.Id] && ((v.Unlock.Kind === "Level" && d.level >= v.Unlock.Level) || (v.Unlock.Kind === "Achievement" && d.achievements[v.Unlock.Id]))) { d.vehicles[v.Id] = true; out.push(T(v.NameKey)); } return out; },
  // Rewards (port of RewardService.Compute / Apply)
  applyRace(res, ctx) {
    const d = this.data, c = C.Rewards.Currency, x = C.Rewards.XP, lines = []; let currency = 0, xp = 0; const add = (k, a) => { if (a) { lines.push([k, a]); currency += a; } };
    if (ctx.mode === "TimeTrial") { add("REWARD.FINISH", c.TimeTrialFinish); xp += x.Participation; }
    else { if (res.finished) { add("REWARD.FINISH", c.Finish); add("REWARD.POSITION", c.PositionBonus[res.position - 1] || 0); if (res.position === 1) xp += x.Win; xp += x.PositionBonus[res.position - 1] || 0; } if (ctx.mode === "Knockout") add("REWARD.STAGE", c.KnockoutStageBonus * res.stage); xp += x.Participation + x.PerLap * ctx.laps; if (res.finished && res.cleanRace) add("REWARD.CLEAN", c.CleanRaceBonus); }
    if (res.shards > 0) add("REWARD.SHARDS", res.shards * c.ShardConversion);
    if (ctx.tourFinal && ctx.tourPosition) add("REWARD.TOUR", c.GrandTourFinalBonus[ctx.tourPosition - 1] || 0);
    let newRecord = false; if (res.finished && res.time !== null && ctx.mode !== "Knockout") { const ex = d.records[ctx.trackId]; if (!ex || res.time < ex.time) { newRecord = true; if (!ex) add("REWARD.RECORD", c.FirstPersonalRecordBonus); d.records[ctx.trackId] = { time: res.time, bestLap: res.bestLap || res.time, hero: ctx.heroId, vehicle: ctx.vehicleId, assist: !!ctx.assist, at: Date.now(), laps: ctx.laps }; } }
    d.currency += currency; d.xp += xp; const newLevel = this.levelFor(d.xp); const leveled = newLevel > d.level; d.level = newLevel;
    const s = d.stats; if (res.finished) { s.races++; if (res.position === 1) s.wins++; if (res.position <= 3) s.podiums++; } s.laps += ctx.laps; s.tricks += res.tricks; s.driftBoosts += res.driftBoosts; s.itemsUsed += res.itemsUsed; s.shards += res.shards; if (res.tricks >= 3) d.achievements.FirstTrickTriple = (d.achievements.FirstTrickTriple || 0) + 1; if (ctx.tourFinal && ctx.tourPosition === 1) s.tourWins++;
    const unlocks = this.evaluateUnlocks(); this.save();
    return { currency, xp, lines, newLevel: leveled ? newLevel : null, newRecord, unlocks };
  },
  buy(kind, id) { const d = this.data; const def = kind === "Hero" ? heroById[id] : vehicleById[id]; if (!def || def.Unlock.Kind !== "Currency" || d.currency < def.Unlock.Cost) return false; d.currency -= def.Unlock.Cost; (kind === "Hero" ? d.heroes : d.vehicles)[id] = true; this.save(); return true; },
};

// --- Tiny original synth: engine hum + blips. No external audio assets. ----------------------------------------------
const Audio = {
  ctx: null, engine: null, gain: null, enabled: true,
  init() { if (this.ctx) return; try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ctx.createGain(); this.master.gain.value = 0.35; this.master.connect(this.ctx.destination); } catch (e) { this.ctx = null; } },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  startEngine() { if (!this.ctx || this.engine) return; const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter(); o.type = "sawtooth"; o2.type = "square"; o2.detune.value = 8; f.type = "lowpass"; f.frequency.value = 600; g.gain.value = 0; o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master); o.start(); o2.start(); this.engine = { o, o2, g, f }; },
  engineUpdate(speedFrac, boosting) { if (!this.engine || !this.enabled) return; const e = this.engine, t = this.ctx.currentTime; const hz = 55 + speedFrac * 160 + (boosting ? 40 : 0); e.o.frequency.setTargetAtTime(hz, t, 0.05); e.o2.frequency.setTargetAtTime(hz * 1.5, t, 0.05); e.f.frequency.setTargetAtTime(400 + speedFrac * 1400, t, 0.05); e.g.gain.setTargetAtTime(0.08 + speedFrac * 0.1, t, 0.1); },
  stopEngine() { if (this.engine) { this.engine.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); const e = this.engine; setTimeout(() => { try { e.o.stop(); e.o2.stop(); } catch (x) {} }, 400); this.engine = null; } },
  blip(freq, dur = 0.12, type = "sine", vol = 0.25, slide = 0) { if (!this.ctx || !this.enabled) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02); },
  sfx(name) { switch (name) { case "pickup": this.blip(880, 0.1, "triangle", 0.2, 400); break; case "boost": this.blip(220, 0.35, "sawtooth", 0.25, 500); break; case "drift": this.blip(660, 0.08, "square", 0.12, 200); break; case "hit": this.blip(160, 0.4, "sawtooth", 0.3, -120); break; case "tick": this.blip(600, 0.1, "square", 0.2); break; case "go": this.blip(900, 0.35, "square", 0.3, 300); break; case "finish": this.blip(523, 0.2, "triangle", 0.3, 400); setTimeout(() => this.blip(784, 0.4, "triangle", 0.3, 300), 180); break; case "ui": this.blip(500, 0.06, "sine", 0.12); break; case "shard": this.blip(1200, 0.08, "sine", 0.15, 300); break; case "warn": this.blip(300, 0.15, "square", 0.2); setTimeout(() => this.blip(300, 0.15, "square", 0.2), 200); break; case "trick": this.blip(700, 0.25, "triangle", 0.25, 700); break; case "use": this.blip(400, 0.12, "sawtooth", 0.2, 200); break; } },
};

// --- Leaderboard (artifact db, optional) ----------------------------------------------------------------------------
const Leaderboard = {
  db: null, cache: {}, ready: false,
  async init() { try { if (window.claude && window.claude.use) this.db = await window.claude.use("db"); } catch (e) { this.db = null; } this.ready = true; },
  async top(trackId, n = 10) { if (!this.db) return this.cache[trackId] || []; try { const snap = await this.db.collection("records/" + trackId + "/times").orderBy("time", "asc").limit(n).get(); const rows = snap.docs.map((d) => d.data()).filter((r) => r && typeof r.time === "number"); this.cache[trackId] = rows; return rows; } catch (e) { return this.cache[trackId] || []; } },
  async submit(trackId, rec) { if (!this.db) return false; try { const ref = this.db.doc("records/" + trackId + "/times/" + Profile.data.id); const ex = await ref.get(); const old = ex.exists ? ex.data() : null; if (old && typeof old.time === "number" && old.time <= rec.time) return false; await ref.set({ ...rec, at: Date.now() }); delete this.cache[trackId]; return true; } catch (e) { return false; } },
};

// --- UI --------------------------------------------------------------------------------------------------------------
const STAT_KEYS = ["TopSpeed", "Acceleration", "Handling", "Grip", "DriftControl", "Weight", "OffroadEfficiency", "BoostEfficiency", "AirControl", "Recovery"];
const STAT_LABELS = { en: { TopSpeed: "Top speed", Acceleration: "Acceleration", Handling: "Handling", Grip: "Grip", DriftControl: "Drift", Weight: "Weight", OffroadEfficiency: "Off-road", BoostEfficiency: "Boost", AirControl: "Air", Recovery: "Recovery" }, ru: { TopSpeed: "Скорость", Acceleration: "Разгон", Handling: "Управление", Grip: "Сцепление", DriftControl: "Дрифт", Weight: "Вес", OffroadEfficiency: "Бездорожье", BoostEfficiency: "Ускорения", AirControl: "Воздух", Recovery: "Восстановление" } };
const UX = { en: { play: "Race", tour: "Grand Tour", tt: "Time Trial", ko: "Knockout", garage: "Garage", settings: "Settings", records: "Records", name: "Your name", start: "Start race", back: "Back", next: "Next race", lobby: "Main menu", laps: "Laps", bots: "Bots", diff: "Bot skill", track: "Track", random: "Random", mirror: "Mirror", items: "Gadgets", hero: "Hero", vehicle: "Vehicle", equip: "Select", equipped: "Selected", buy: "Unlock", locked: "Locked", credits: "Rift Energy", level: "Level", stats: "Stats", autogas: "Auto accelerate", sens: "Steering sensitivity", motion: "Reduce motion", sound: "Sound", lang: "Language", layout: "Left-handed touch layout", fov: "Speed FOV", shake: "Camera shake", assist: "Track Assist", best: "Best", global: "Global top 10", yours: "Your best", tapToStart: "Tap to race", drive: "Drive", results: "Results", standings: "Grand Tour standings", continueTour: "Continue tour", finalStandings: "Champion", controls: "W/↑ gas · S/↓ brake · A/D steer · Space/Shift drift & trick · E gadget · Q look back · R reset · Esc menu", touchHint: "Drag the wheel to steer · hold GAS · DRIFT in corners, release for a boost · tap in the air for a trick", pause: "Paused", resume: "Resume", quit: "Quit race", speedClass: "Speed class", nolb: "Leaderboard unavailable here", stage: "Stage", tutorial: "How to play", ghost: "Ghost of your best run", ready: "Ready", quick: "Quick race", custom: "Custom race", rank: "Rank", of: "of" }, ru: { play: "Гонка", tour: "Гранд-тур", tt: "Тайм-триал", ko: "Выбывание", garage: "Гараж", settings: "Настройки", records: "Рекорды", name: "Ваше имя", start: "Начать гонку", back: "Назад", next: "Следующая гонка", lobby: "Главное меню", laps: "Круги", bots: "Боты", diff: "Уровень ботов", track: "Трасса", random: "Случайная", mirror: "Зеркало", items: "Гаджеты", hero: "Герой", vehicle: "Транспорт", equip: "Выбрать", equipped: "Выбрано", buy: "Открыть", locked: "Закрыто", credits: "Энергия разлома", level: "Уровень", stats: "Характеристики", autogas: "Автогаз", sens: "Чувствительность руля", motion: "Меньше движения", sound: "Звук", lang: "Язык", layout: "Кнопки слева", fov: "Эффект скорости", shake: "Тряска камеры", assist: "Помощь на трассе", best: "Лучшее", global: "Общий топ-10", yours: "Ваш рекорд", tapToStart: "Нажмите, чтобы гонять", drive: "Поехали", results: "Результаты", standings: "Таблица кубка", continueTour: "Продолжить кубок", finalStandings: "Чемпион", controls: "W/↑ газ · S/↓ тормоз · A/D руль · Пробел/Shift дрифт и трюк · E гаджет · Q назад · R сброс · Esc меню", touchHint: "Тяните руль · держите ГАЗ · ДРИФТ в повороте, отпустите для буста · в прыжке нажмите для трюка", pause: "Пауза", resume: "Продолжить", quit: "Выйти из гонки", speedClass: "Класс скорости", nolb: "Общий рейтинг здесь недоступен", stage: "Этап", tutorial: "Как играть", ghost: "Призрак вашего лучшего заезда", ready: "Готов", quick: "Быстрая гонка", custom: "Своя гонка", rank: "Место", of: "из" } };
const U = (k) => (UX[Locale.lang] || UX.en)[k] || UX.en[k] || k;

class UI {
  constructor(game) {
    this.game = game; this.root = $("#ui"); this.hud = $("#hud"); this.touch = $("#touch"); this.screen = null; this.isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    this.buildHud(); this.buildTouch(); this.toastTimer = null;
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.game.race) this.game.togglePause(); if (e.key === "F3") { this.diag = !this.diag; $("#diag").style.display = this.diag ? "block" : "none"; } });
  }
  show(html, cls = "") { this.root.innerHTML = ""; const s = el("div", "screen " + cls, html); this.root.appendChild(s); this.root.style.display = "flex"; this.screen = s; return s; }
  hide() { this.root.style.display = "none"; this.root.innerHTML = ""; this.screen = null; }
  bind(sel, fn) { for (const b of this.root.querySelectorAll(sel)) b.addEventListener("click", (e) => { Audio.init(); Audio.resume(); Audio.sfx("ui"); fn(b, e); }); }
  // --- Home ------------------------------------------------------------------------------------------------------------
  home() {
    const p = Profile.data, rec = Object.keys(p.records).length;
    const s = this.show(`<div class="hero"><div class="eyebrow">${T("UI.TAGLINE")}</div><h1 class="title">${C.ProjectName}</h1></div>
      <div class="card profile"><input id="name" class="name" maxlength="16" placeholder="${U("name")}" value="${p.name.replace(/"/g, "")}"><div class="prow"><span>${U("level")} ${p.level}</span><span class="cy">${Locale.num(p.currency)} ⚡</span><span>${p.stats.wins} 🏆 · ${rec} ⏱</span></div></div>
      <div class="grid2">
        <button class="btn big" data-go="quick">${U("play")}<small>${T("MODE.QUICK_RACE_DESC")}</small></button>
        <button class="btn" data-go="tour">${U("tour")}<small>${T("MODE.GRAND_TOUR_DESC")}</small></button>
        <button class="btn" data-go="tt">${U("tt")}<small>${T("MODE.TIME_TRIAL_DESC")}</small></button>
        <button class="btn" data-go="ko">${U("ko")}<small>${T("MODE.KNOCKOUT_DESC")}</small></button>
        <button class="btn alt" data-go="garage">${U("garage")}</button>
        <button class="btn alt" data-go="records">${U("records")}</button>
        <button class="btn alt" data-go="settings">${U("settings")}</button>
        <button class="btn alt" data-go="tutorial">${U("tutorial")}</button>
      </div><div class="hint">${this.isTouch ? U("touchHint") : U("controls")}</div>`, "home");
    s.querySelector("#name").addEventListener("change", (e) => { p.name = e.target.value.trim().slice(0, 16); Profile.save(); });
    this.bind("[data-go]", (b) => { p.name = s.querySelector("#name").value.trim().slice(0, 16); Profile.save(); const g = b.dataset.go; if (g === "garage") this.garage(); else if (g === "records") this.records(); else if (g === "settings") this.settings(); else if (g === "tutorial") this.tutorial(); else this.setup(g); });
  }
  tutorial() { const steps = ["TUTORIAL.STEP_1", "TUTORIAL.STEP_2", "TUTORIAL.STEP_3", "TUTORIAL.STEP_4", "TUTORIAL.STEP_5", "TUTORIAL.DONE"]; this.show(`<h2>${U("tutorial")}</h2><ol class="tut">${steps.map((k) => `<li>${T(k)}</li>`).join("")}</ol><div class="hint">${this.isTouch ? U("touchHint") : U("controls")}</div><div class="row"><button class="btn alt" data-back>${U("back")}</button><button class="btn" data-practice>${U("drive")}</button></div>`); this.bind("[data-back]", () => this.home()); this.bind("[data-practice]", () => this.game.startRace({ mode: "TimeTrial", trackId: "NeonHarborCircuit", laps: 3, bots: 0, tutorial: true })); }
  // --- Setup -----------------------------------------------------------------------------------------------------------
  setup(kind) {
    const p = Profile.data; const st = this.setupState = this.setupState || { trackId: "random", laps: 3, bots: 7, diff: "Normal", mirror: false, items: true, speed: 1 };
    const title = kind === "quick" ? U("quick") : kind === "tour" ? U("tour") : kind === "tt" ? U("tt") : U("ko");
    const trackOpts = [`<option value="random">${U("random")}</option>`, ...C.Tracks.map((t) => `<option value="${t.Id}" ${st.trackId === t.Id ? "selected" : ""}>${T(t.NameKey)}</option>`)].join("");
    const isTT = kind === "tt", isKO = kind === "ko", isTour = kind === "tour";
    this.show(`<h2>${title}</h2><div class="card setup">
      <label>${U("hero")}<b>${T(heroById[p.hero].NameKey)}</b> · ${U("vehicle")}<b>${T(vehicleById[p.vehicle].NameKey)}</b> <button class="btn mini alt" data-garage>${U("garage")}</button></label>
      ${isTour ? "" : `<label>${U("track")}<select id="track">${trackOpts}</select></label>`}
      ${isTT || isKO ? "" : `<label>${U("laps")}<select id="laps">${[1, 2, 3, 4, 5].map((n) => `<option ${st.laps === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>`}
      ${isTT ? "" : `<label>${U("bots")}<select id="bots">${[1, 3, 5, 7, 9, 11].map((n) => `<option ${st.bots === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>${U("diff")}<select id="diff">${["Easy", "Normal", "Hard"].map((d) => `<option ${st.diff === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>`}
      ${isTT ? "" : `<label>${U("items")}<input type="checkbox" id="items" ${st.items ? "checked" : ""}></label>`}
      <label>${U("mirror")}<input type="checkbox" id="mirror" ${st.mirror ? "checked" : ""}></label>
      <label>${U("speedClass")}<select id="speed"><option value="1" ${st.speed === 1 ? "selected" : ""}>Standard</option><option value="1.12" ${st.speed === 1.12 ? "selected" : ""}>Swift</option><option value="1.25" ${st.speed === 1.25 ? "selected" : ""}>Rift</option></select></label>
      <div id="lb" class="lb"></div></div>
      <div class="row"><button class="btn alt" data-back>${U("back")}</button><button class="btn big" data-start>${U("start")}</button></div>`);
    const read = () => { const g = (id) => this.screen.querySelector("#" + id); st.trackId = g("track") ? g("track").value : "random"; st.laps = g("laps") ? +g("laps").value : isKO ? 4 : 3; st.bots = g("bots") ? +g("bots").value : 0; st.diff = g("diff") ? g("diff").value : "Normal"; st.items = g("items") ? g("items").checked : false; st.mirror = g("mirror").checked; st.speed = +g("speed").value; };
    const lb = async () => { read(); const box = this.screen && this.screen.querySelector("#lb"); if (!box) return; if (st.trackId === "random" || isTour) { box.innerHTML = ""; return; } const mine = p.records[st.trackId]; let html = mine ? `<div>${U("yours")}: <b>${fmtTime(mine.time)}</b> (${mine.laps || 3} ${Locale.plural(mine.laps || 3, "lap", "laps", "laps")})</div>` : ""; const rows = await Leaderboard.top(st.trackId); if (rows.length) html += `<div class="lbt">${U("global")}</div>` + rows.map((r, i) => `<div class="lbr"><span>${i + 1}. ${(r.name || "?").replace(/</g, "")}</span><span>${fmtTime(r.time)}</span></div>`).join(""); else if (!Leaderboard.db) html += `<div class="dim">${U("nolb")}</div>`; box.innerHTML = html; };
    for (const sel of this.screen.querySelectorAll("select,input")) sel.addEventListener("change", lb); lb();
    this.bind("[data-back]", () => this.home()); this.bind("[data-garage]", () => this.garage(() => this.setup(kind)));
    this.bind("[data-start]", () => { read(); const mode = isTT ? "TimeTrial" : isKO ? "Knockout" : isTour ? "GrandTour" : "QuickRace"; this.game.startRace({ mode, trackId: st.trackId, laps: st.laps, bots: st.bots, difficulty: st.diff, mirror: st.mirror, itemsEnabled: st.items, speedClass: st.speed }); });
  }
  // --- Garage ----------------------------------------------------------------------------------------------------------
  garage(back) {
    const p = Profile.data; this.garageTab = this.garageTab || "hero"; const tab = this.garageTab; const list = tab === "hero" ? C.Heroes : C.Vehicles; const sel = tab === "hero" ? p.hero : p.vehicle; const owned = tab === "hero" ? p.heroes : p.vehicles; this.garageFocus = this.garageFocus && list.find((x) => x.Id === this.garageFocus) ? this.garageFocus : sel;
    const f = list.find((x) => x.Id === this.garageFocus); const stats = displayStats(tab === "hero" ? f.Id : p.hero, tab === "hero" ? p.vehicle : f.Id); const un = owned[f.Id];
    const unlockText = un ? "" : f.Unlock.Kind === "Level" ? T("UI.UNLOCK_LEVEL", f.Unlock.Level) : f.Unlock.Kind === "Currency" ? T("UI.UNLOCK_COST", f.Unlock.Cost) : T("UI.UNLOCK_ACHIEVEMENT", T("ACHIEVEMENT." + f.Unlock.Id));
    const color = tab === "hero" ? f.Cosmetics.PrimaryColor : f.Visual.PrimaryColor;
    this.show(`<h2>${U("garage")} <span class="cy">${Locale.num(p.currency)} ⚡</span></h2>
      <div class="tabs"><button class="tab ${tab === "hero" ? "on" : ""}" data-tab="hero">${U("hero")}</button><button class="tab ${tab === "vehicle" ? "on" : ""}" data-tab="vehicle">${U("vehicle")}</button></div>
      <div class="cards">${list.map((x) => { const c = tab === "hero" ? x.Cosmetics.PrimaryColor : x.Visual.PrimaryColor; return `<button class="pick ${x.Id === this.garageFocus ? "focus" : ""} ${owned[x.Id] ? "" : "lock"}" data-pick="${x.Id}" style="--c:${c}"><i></i>${T(x.NameKey)}${x.Id === sel ? " ✓" : ""}</button>`; }).join("")}</div>
      <div class="card info" style="--c:${color}"><h3>${T(f.NameKey)}</h3><p class="dim">${T(tab === "hero" ? f.TaglineKey : f.DescriptionKey)} ${unlockText ? "<br><b>" + unlockText + "</b>" : ""}</p>
      <div class="stats">${STAT_KEYS.map((k) => `<div class="stat"><span>${STAT_LABELS[Locale.lang][k]}</span><i><b style="width:${stats[k]}%"></b></i></div>`).join("")}</div>
      <button class="btn ${un ? "" : f.Unlock.Kind === "Currency" ? "warn" : "alt"}" data-action>${un ? (f.Id === sel ? U("equipped") : U("equip")) : f.Unlock.Kind === "Currency" ? U("buy") : U("locked")}</button></div>
      <div class="row"><button class="btn alt" data-back>${U("back")}</button></div>`, "garage");
    this.bind("[data-tab]", (b) => { this.garageTab = b.dataset.tab; this.garageFocus = null; this.garage(back); });
    this.bind("[data-pick]", (b) => { this.garageFocus = b.dataset.pick; this.garage(back); });
    this.bind("[data-action]", () => { if (un) { if (tab === "hero") p.hero = f.Id; else p.vehicle = f.Id; Profile.save(); } else if (f.Unlock.Kind === "Currency") Profile.buy(tab === "hero" ? "Hero" : "Vehicle", f.Id); this.garage(back); });
    this.bind("[data-back]", () => (back ? back() : this.home()));
    this.game.previewLoadout(tab === "hero" ? f.Id : p.hero, tab === "hero" ? p.vehicle : f.Id);
  }
  records() {
    const p = Profile.data;
    this.show(`<h2>${U("records")}</h2><div class="card">${C.Tracks.map((t) => { const r = p.records[t.Id]; return `<div class="lbr"><span>${T(t.NameKey)}</span><span>${r ? fmtTime(r.time) + (r.assist ? " (assist)" : "") : "--:--.---"}</span></div>`; }).join("")}</div><div class="row"><button class="btn alt" data-back>${U("back")}</button></div>`);
    this.bind("[data-back]", () => this.home());
  }
  settings() {
    const s = Profile.data.settings; const tog = (id, label, v) => `<label>${label}<input type="checkbox" id="${id}" ${v ? "checked" : ""}></label>`;
    this.show(`<h2>${U("settings")}</h2><div class="card setup">
      <label>${U("lang")}<select id="locale"><option value="en" ${Locale.lang === "en" ? "selected" : ""}>English</option><option value="ru" ${Locale.lang === "ru" ? "selected" : ""}>Русский</option></select></label>
      ${tog("autogas", U("autogas"), s.autoAccelerate === null ? this.isTouch : s.autoAccelerate)}
      <label>${U("sens")}<input type="range" id="sens" min="0.4" max="2" step="0.1" value="${s.sensitivity}"></label>
      <label>${U("fov")}<input type="range" id="fov" min="0" max="1" step="0.1" value="${s.speedFov}"></label>
      <label>${U("shake")}<input type="range" id="shake" min="0" max="1" step="0.1" value="${s.cameraShake}"></label>
      ${tog("assist", U("assist"), s.trackAssist)}${tog("motion", U("motion"), s.reducedMotion)}${tog("sound", U("sound"), s.sound)}${tog("layout", U("layout"), s.layout === "Left")}
      <label>${U("stats")}: ${Profile.data.stats.races} 🏁 · ${Profile.data.stats.wins} 🏆 · ${Profile.data.stats.driftBoosts} drift · ${Profile.data.stats.tricks} trick</label>
      </div><div class="row"><button class="btn" data-back>${U("back")}</button></div>`);
    const g = (id) => this.screen.querySelector("#" + id);
    const apply = () => { s.locale = g("locale").value; Locale.lang = s.locale; s.autoAccelerate = g("autogas").checked; s.sensitivity = +g("sens").value; s.speedFov = +g("fov").value; s.cameraShake = +g("shake").value; s.trackAssist = g("assist").checked; s.reducedMotion = g("motion").checked; s.sound = g("sound").checked; Audio.enabled = s.sound; s.layout = g("layout").checked ? "Left" : "Right"; Profile.save(); this.applyTouchLayout(); };
    for (const x of this.screen.querySelectorAll("select,input")) x.addEventListener("change", () => { apply(); if (x.id === "locale") this.settings(); });
    this.bind("[data-back]", () => { apply(); this.home(); });
  }
  // --- Results ---------------------------------------------------------------------------------------------------------
  results(race, reward, tour) {
    const me = race.results.find((r) => r.key === "me");
    const rows = race.results.map((r) => `<div class="lbr ${r.key === "me" ? "me" : ""}"><span>${Locale.ordinal(r.position)} ${r.name.replace(/</g, "")}${r.isBot ? "" : ""}</span><span>${r.time !== null ? fmtTime(r.time) : r.eliminated ? T("RACE.ELIMINATED") : T("RACE.DNF")}${tour ? ` <b class="cy">+${r.points}</b> (${tour.points[r.key] || 0})` : ""}</span></div>`).join("");
    const rw = reward ? `<div class="card reward">${reward.lines.map(([k, a]) => `<div class="lbr"><span>${T(k)}</span><span class="cy">+${a}</span></div>`).join("")}<div class="lbr"><span>${T("REWARD.XP")}</span><span class="cy">+${reward.xp}</span></div>${reward.newLevel ? `<div class="good">${T("REWARD.LEVEL_UP", reward.newLevel)}</div>` : ""}${reward.newRecord ? `<div class="good">${T("REWARD.RECORD")}</div>` : ""}${reward.unlocks.map((u) => `<div class="warnt">${T("REWARD.UNLOCK", u)}</div>`).join("")}</div>` : "";
    const tourDone = tour && tour.index >= 4;
    this.show(`<h2>${tour ? U("standings") + " " + tour.index + "/4" : U("results")} · ${Locale.ordinal(me.position)}</h2><div class="two"><div class="card">${rows}</div>${rw}</div>
      <div class="row"><button class="btn alt" data-lobby>${U("lobby")}</button>${tour && !tourDone ? `<button class="btn big" data-next>${U("continueTour")}</button>` : tour ? "" : `<button class="btn big" data-next>${U("next")}</button>`}</div>`, "results");
    this.bind("[data-lobby]", () => this.game.toLobby()); this.bind("[data-next]", () => this.game.nextRace());
  }
  pause() { this.show(`<h2>${U("pause")}</h2><div class="row col"><button class="btn big" data-resume>${U("resume")}</button><button class="btn alt" data-settings>${U("settings")}</button><button class="btn warn" data-quit>${U("quit")}</button></div>`); this.bind("[data-resume]", () => this.game.togglePause()); this.bind("[data-quit]", () => this.game.toLobby()); this.bind("[data-settings]", () => { this.settings(); this.bind("[data-back]", () => this.pause()); }); }
  // --- HUD -------------------------------------------------------------------------------------------------------------
  buildHud() {
    this.hud.innerHTML = `<div class="tl"><div id="pos">1<small>/8</small></div><div id="lap"></div></div><div class="tc"><div id="time">00:00.000</div><div id="gap"></div></div><div class="tr"><div id="ko"></div><div id="tourpts"></div></div>
      <div id="countdown"></div><div id="toast"></div><div id="wrong">${T("RACE.WRONG_WAY")}</div><div id="incoming">${T("RACE.INCOMING")}</div>
      <canvas id="minimap" width="200" height="200"></canvas><div class="br"><div class="items"><div id="reserve" class="item small"></div><div id="active" class="item"></div></div><div id="shards"></div><div class="drift"><i id="driftfill"></i></div><div id="speed">0</div></div><div id="diag"></div><button id="pausebtn">II</button>`;
    this.hud.querySelector("#pausebtn").addEventListener("click", () => this.game.togglePause());
    this.mm = { c: $("#minimap"), ctx: $("#minimap").getContext("2d"), path: null, bounds: null };
  }
  setMinimap(track) { const pts = []; let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity; for (let i = 0; i <= track.def.MinimapDetail; i++) { const p = track.spline.posAt(track.length * i / track.def.MinimapDetail); pts.push(p); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); } const span = Math.max(maxX - minX, maxZ - minZ, 1); this.mm.path = pts; this.mm.bounds = { minX, minZ, span }; }
  drawMinimap(race) {
    const { c, ctx, path, bounds } = this.mm; if (!path) return; ctx.clearRect(0, 0, c.width, c.height); const m = (p) => [((p.x - bounds.minX) / bounds.span) * 180 + 10, ((p.z - bounds.minZ) / bounds.span) * 180 + 10];
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(94,230,255,0.55)"; ctx.lineCap = "round"; ctx.beginPath(); path.forEach((p, i) => { const [x, y] = m(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke();
    for (const r of race.racers) { if (r.prog.eliminated) continue; const [x, y] = m(r.kart.pos); ctx.beginPath(); ctx.arc(x, y, r.key === "me" ? 6 : 4, 0, Math.PI * 2); ctx.fillStyle = r.key === "me" ? "#FFB347" : "#F2F1FF"; ctx.fill(); }
  }
  toast(text, cls = "") { const t = $("#toast"); t.textContent = text; t.className = "show " + cls; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => (t.className = ""), 1500); }
  updateHud(game, race, now) {
    const me = race.me, k = me.kart, hud = this.hud; const total = race.racers.filter((r) => !r.prog.eliminated).length;
    $("#pos").innerHTML = `${me.position}<small>/${total}</small>`;
    $("#lap").textContent = race.mode === "Knockout" ? `${U("stage")} ${race.knockoutStage + 1}/3 · ${T("RACE.LAP", Math.min(me.prog.lap + 1, race.laps), race.laps)}` : T("RACE.LAP", Math.min(me.prog.lap + 1, race.laps), race.laps);
    $("#time").textContent = race.state === "Countdown" || race.state === "Grid" ? "00:00.000" : fmtTime(Math.max(0, (me.prog.finishedAt !== null ? me.prog.finishedAt : now) - race.goAt));
    const rec = Profile.data.records[race.track.def.Id]; $("#gap").textContent = race.mode === "TimeTrial" && rec ? `${U("best")} ${fmtTime(rec.time)}` : me.prog.lap >= race.laps - 1 && race.state !== "Countdown" && me.prog.finishedAt === null ? T("RACE.FINAL_LAP") : "";
    $("#ko").textContent = race.mode === "Knockout" && race.knockoutStage < 3 ? T("RACE.SAFE_POSITION", race.safePosition()) : "";
    $("#tourpts").textContent = game.tour ? `${U("tour")} ${game.tour.index}/4 · ${game.tour.points.me || 0} pts` : "";
    $("#speed").textContent = T("RACE.SPEED", Math.round(Math.abs(k.speed)));
    const tiers = P.DriftTiers; const charge = k.drifting ? clamp(k.driftCharge / tiers[tiers.length - 1].Seconds, 0, 1) : 0; const fill = $("#driftfill"); fill.style.width = charge * 100 + "%"; fill.style.background = k.driftCharge >= tiers[2].Seconds ? "#c878ff" : k.driftCharge >= tiers[1].Seconds ? "#FFB347" : "#5EE6FF";
    const nm = (id) => (id ? T(itemById[id].NameKey) : ""); const a = $("#active"), rs = $("#reserve"); a.textContent = nm(me.items.active); a.style.borderColor = me.items.active ? itemById[me.items.active].Color : "rgba(255,255,255,0.15)"; rs.textContent = nm(me.items.reserve);
    $("#shards").textContent = me.shards ? T("RACE.SHARDS", me.shards) : "";
    $("#wrong").style.display = me.wrongWay ? "block" : "none";
    const cd = $("#countdown"); if (race.state === "Countdown") { const rem = race.goAt - now; cd.textContent = rem > 0 && rem <= C.Race.CountdownSeconds ? Math.ceil(rem) : rem <= 0 ? T("RACE.GO") : ""; } else if (race.state === "Racing" && now - race.goAt < 0.8) cd.textContent = T("RACE.GO"); else cd.textContent = "";
    if (this.diag) $("#diag").textContent = `fps ${game.fps.toFixed(0)} · dt ${(game.lastDt * 1000).toFixed(1)}ms · surf ${k.surface} · prog ${k.progress.toFixed(0)} · cp ${me.prog.checkpoint} · boosts ${k.boosts.length} · proj ${race.projectiles.length}`;
    if (game.frame % 6 === 0) this.drawMinimap(race);
  }
  // --- Touch ------------------------------------------------------------------------------------------------------------
  buildTouch() {
    this.touch.innerHTML = `<div id="steer"><div id="knob"></div><span class="l">◀</span><span class="r">▶</span></div><button id="gas">▲</button><button id="brake">▼</button><button id="drift">DRIFT</button><button id="item">ITEM</button><button id="look">◀▶</button><button id="reset">⟲</button>`;
    const inp = this.game.input; const hold = (id, on, off) => { const b = this.touch.querySelector("#" + id); const down = (e) => { e.preventDefault(); on(); b.classList.add("down"); }; const up = (e) => { e.preventDefault(); off(); b.classList.remove("down"); }; b.addEventListener("touchstart", down, { passive: false }); b.addEventListener("touchend", up); b.addEventListener("touchcancel", up); b.addEventListener("mousedown", down); b.addEventListener("mouseup", up); b.addEventListener("mouseleave", up); };
    hold("gas", () => (inp.tThrottle = 1), () => (inp.tThrottle = 0)); hold("brake", () => (inp.tBrake = 1), () => (inp.tBrake = 0)); hold("drift", () => inp.driftDown(), () => inp.driftUp()); hold("look", () => (inp.lookBack = true), () => (inp.lookBack = false));
    this.touch.querySelector("#item").addEventListener("touchstart", (e) => { e.preventDefault(); inp.itemPressed = true; }, { passive: false }); this.touch.querySelector("#item").addEventListener("mousedown", () => (inp.itemPressed = true));
    this.touch.querySelector("#reset").addEventListener("touchstart", (e) => { e.preventDefault(); inp.resetPressed = true; }, { passive: false });
    const zone = this.touch.querySelector("#steer"), knob = this.touch.querySelector("#knob"); let active = null;
    const upd = (t) => { const r = zone.getBoundingClientRect(); const x = clamp((t.clientX - r.left) / r.width, 0, 1); knob.style.left = x * 100 + "%"; inp.tSteer = (x - 0.5) * 2; };
    zone.addEventListener("touchstart", (e) => { e.preventDefault(); active = e.changedTouches[0].identifier; upd(e.changedTouches[0]); }, { passive: false });
    window.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === active) upd(t); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === active) { active = null; knob.style.left = "50%"; inp.tSteer = 0; } }; window.addEventListener("touchend", end); window.addEventListener("touchcancel", end);
    this.applyTouchLayout();
  }
  applyTouchLayout() { const s = Profile.data ? Profile.data.settings : { layout: "Right" }; this.touch.classList.toggle("left", s.layout === "Left"); const auto = s.autoAccelerate === null ? this.isTouch : s.autoAccelerate; this.touch.querySelector("#gas").style.display = auto ? "none" : "block"; }
  showTouch(v) { this.touch.style.display = v && this.isTouch ? "block" : "none"; }
}
