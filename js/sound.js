/*
 * Звук. Ни одного файла с записью: всё синтезируется на месте через WebAudio,
 * иначе однофайловая офлайн-сборка распухла бы на мегабайты base64.
 *
 * Файл делится надвое, и это не случайно:
 *   - probe/events — чистые функции без DOM и без звука. Они смотрят на движок
 *     до и после такта и говорят, что произошло. Их гоняет Node в
 *     tools/verify-sound.js, поэтому «зазвучало не то» ловится тестом.
 *   - Sound — собственно голос: осцилляторы, шум, огибающие.
 */
(function (global) {
  'use strict';

  var base = (typeof module === 'object' && module.exports) ? require('./tiles.js') : global.SP;
  var T = base.Tiles;

  /* ---------- что случилось за такт ---------- */

  /** Слепок мира, по которому видно событие. Дешевле полного клона. */
  function probe(e) {
    var fall = 0, blast = 0;
    for (var i = 0; i < e.tiles.length; i++) {
      var t = e.tiles[i];
      if (t === T.EXPLOSION || t === T.EXPLOSION_INFO) blast++;
      else if (e.falling[i]) fall++;
    }
    return {
      c: e.collected, st: e.status, fuse: e.fuse, carry: e.murphy.carry,
      grav: !!e.gravity, fall: fall, blast: blast,
      x: e.murphy.x, y: e.murphy.y,
      dig: !!e.murphy.digging, push: !!e.murphy.pushing
    };
  }

  /**
   * Список событий такта. Порядок — по важности: первое событие громче всех,
   * остальные подмешиваются тише.
   */
  function events(a, b) {
    var out = [];
    if (b.st === 'won' && a.st !== 'won') out.push('win');
    if (b.st === 'dying' && a.st !== 'dying') out.push('die');
    if (b.blast > a.blast) out.push('boom');
    if (b.c > a.c) out.push('take');
    if (b.fuse > 0 && a.fuse === 0) out.push('terminal');
    else if (b.fuse > 0 && b.fuse !== a.fuse) out.push('fuse');
    if (b.grav !== a.grav) out.push('grav');
    if (b.carry > a.carry) out.push('pick');
    else if (b.carry < a.carry) out.push('drop');
    if (b.fall < a.fall && b.blast <= a.blast) out.push('land');
    if (b.dig) out.push('dig');
    else if (b.push) out.push('push');
    else if (b.x !== a.x || b.y !== a.y) {
      var d = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      out.push(d > 1 ? 'port' : 'step');
    }
    return out;
  }

  /* ---------- голос ---------- */

  var MUTE_KEY = 'infotron.sound';

  function Sound(win) {
    this.win = win || global;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.on = true;
    this.combo = 0;          // подряд собранные инфотроны — тон ползёт вверх
    this.comboAt = -999;
    this.voices = 0;         // страховка от каши, когда рвётся десяток зарядов
    try {
      var saved = this.win.localStorage.getItem(MUTE_KEY);
      if (saved === 'off') this.on = false;
    } catch (err) { /* приватный режим */ }
  }

  /** Звук заводится только по жесту игрока — так требует браузер. */
  Sound.prototype.unlock = function () {
    if (!this.on) return;
    if (!this.ctx) {
      var Ctx = this.win.AudioContext || this.win.webkitAudioContext;
      if (!Ctx) return;
      try { this.ctx = new Ctx(); } catch (err) { this.ctx = null; return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      var n = this.ctx.sampleRate * 0.6, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
  };

  Sound.prototype.setOn = function (v) {
    this.on = !!v;
    try { this.win.localStorage.setItem(MUTE_KEY, this.on ? 'on' : 'off'); } catch (err) { /* приватный режим */ }
    if (this.on) this.unlock();
  };

  Sound.prototype.toggle = function () { this.setOn(!this.on); return this.on; };

  Sound.prototype.ready = function () { return !!(this.on && this.ctx && this.master); };

  /** Тон с огибающей. slide — куда уехать по частоте к концу. */
  Sound.prototype.tone = function (freq, dur, type, gain, slide, delay) {
    if (!this.ready() || this.voices > 12) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    this.voices++;
    var self = this;
    o.onended = function () { self.voices--; };
  };

  /** Шумовой удар: грунт, толчок, приземление, взрыв. */
  Sound.prototype.noise = function (dur, gain, from, to, delay) {
    if (!this.ready() || this.voices > 12) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    var f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.02);
    this.voices++;
    var self = this;
    s.onended = function () { self.voices--; };
  };

  /** Один именованный звук. quiet — подмешиваемое событие, не главное в такте. */
  Sound.prototype.play = function (name, quiet, ticks) {
    if (!this.ready()) return;
    var v = quiet ? 0.45 : 1;
    switch (name) {
      case 'step':  this.tone(150, 0.05, 'triangle', 0.035 * v); break;
      case 'dig':   this.noise(0.07, 0.10 * v, 1400, 300); break;
      case 'push':  this.noise(0.16, 0.16 * v, 700, 120);
                    this.tone(70, 0.16, 'square', 0.05 * v, 55); break;
      case 'land':  this.noise(0.10, 0.20 * v, 420, 90);
                    this.tone(90, 0.09, 'sine', 0.09 * v, 60); break;
      case 'take':
        // подряд собранные инфотроны звучат всё выше: маленькая награда за темп
        if (ticks - this.comboAt > 26) this.combo = 0; else this.combo = Math.min(this.combo + 1, 7);
        this.comboAt = ticks;
        var f = 784 * Math.pow(1.0595, this.combo * 2);
        this.tone(f, 0.09, 'sine', 0.13 * v);
        this.tone(f * 1.5, 0.11, 'sine', 0.07 * v, f * 1.5, 0.045);
        break;
      case 'pick':  this.tone(300, 0.08, 'square', 0.07 * v, 460); break;
      case 'drop':  this.tone(460, 0.08, 'square', 0.07 * v, 300); break;
      case 'port':  this.tone(520, 0.14, 'sawtooth', 0.06 * v, 1400); break;
      case 'grav':  this.tone(220, 0.30, 'triangle', 0.10 * v, 110); break;
      case 'terminal':
        this.tone(1100, 0.10, 'square', 0.10 * v);
        this.tone(700, 0.16, 'square', 0.10 * v, 520, 0.10);
        break;
      case 'fuse':  this.tone(1500, 0.03, 'square', 0.045 * v); break;
      case 'boom':
        this.noise(0.42, 0.34 * v, 1800, 70);
        this.tone(120, 0.34, 'sawtooth', 0.13 * v, 38);
        break;
      case 'die':
        this.tone(420, 0.75, 'sawtooth', 0.16, 60);
        this.noise(0.5, 0.14, 900, 80);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach(function (hz, i) {
          this.tone(hz, 0.24, 'sine', 0.13, hz, i * 0.09);
        }, this);
        break;
      case 'rewind': this.tone(900, 0.05, 'triangle', 0.05, 1500); break;
      case 'ui':     this.tone(660, 0.05, 'sine', 0.06); break;
      case 'level':  this.tone(392, 0.14, 'sine', 0.09);
                     this.tone(587, 0.18, 'sine', 0.08, 587, 0.09); break;
      default: break;
    }
  };

  /** Озвучить такт: главное событие в полный голос, остальные — вполсилы. */
  Sound.prototype.tick = function (before, after, ticks) {
    if (!this.ready()) return;
    var ev = events(before, after);
    for (var i = 0; i < ev.length; i++) {
      if (i > 0 && ev[i] === 'step') continue;      // шаг под взрывом не слышен
      this.play(ev[i], i > 0, ticks);
    }
  };

  var api = { Sound: Sound, probe: probe, events: events };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.SP = Object.assign(global.SP || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
