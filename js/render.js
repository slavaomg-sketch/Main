/* Отрисовка: камера, интерполяция движения между тиками, свечение. */
(function (global) {
  'use strict';
  var SP = global.SP, T = SP.Tiles;
  var PORT_INDEX = {};
  PORT_INDEX[T.PORT_U] = 0; PORT_INDEX[T.PORT_R] = 1; PORT_INDEX[T.PORT_D] = 2; PORT_INDEX[T.PORT_L] = 3;

  var MAX_TILE = 46;
  // На узком экране лучше приблизить и дать камере скроллить, чем показать
  // весь уровень нечитаемыми точками: держим в кадре не меньше ~12 клеток.
  function minTile(viewW) {
    return Math.max(18, Math.min(30, Math.floor(viewW / 12)));
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pack = null;
    this.tile = 32;
    this.camX = 0;
    this.camY = 0;
    this.marks = null;          // метки советчика: куда нельзя и куда стоит
    this.skin = 'murphy';
    this.pack2 = null;          // облик напарника: всегда не такой, как у первого
  }

  /** Смена облика героя: спрайты пересобираются под новый скин. */
  Renderer.prototype.setSkin = function (id) {
    if (this.skin === id) return;
    this.skin = id;
    this.pack = null;
    this.pack2 = null;
  };

  /** Облик напарника — следующий скин по кругу, чтобы двоих не путать. */
  Renderer.prototype.mateSkin = function () {
    var all = SP.Sprites.skins, i = 0;
    for (var k = 0; k < all.length; k++) if (all[k].id === this.skin) i = k;
    return all[(i + 1) % all.length].id;
  };

  Renderer.prototype.resize = function (engine) {
    var host = this.canvas.parentNode;
    var box = host.getBoundingClientRect();
    // на телефоне снизу лежит крестовина — вычитаем её полосу, чтобы поле не пряталось под пальцами
    var cs = global.getComputedStyle ? global.getComputedStyle(host) : null;
    var padY = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.max(240, Math.floor(box.width));
    var h = Math.max(200, Math.floor(box.height - padY));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;

    var fit = Math.floor(Math.min(w / engine.w, h / engine.h));
    var tile = Math.max(minTile(w), Math.min(MAX_TILE, fit));
    if (!this.pack || this.pack.size !== tile || this.pack.skin !== this.skin) {
      this.pack = SP.Sprites.build(tile, this.skin);
      this.pack2 = null;
    }
    if (engine.heroes && engine.heroes.length > 1 &&
        (!this.pack2 || this.pack2.size !== tile)) {
      this.pack2 = SP.Sprites.build(tile, this.mateSkin());
    }
    this.tile = tile;
  };

  Renderer.prototype.camera = function (engine, alpha) {
    var s = this.tile;
    // камера смотрит в середину между героями: одного из двоих терять нельзя
    var sx = 0, sy = 0, n = 0;
    for (var k = 0; k < engine.heroes.length; k++) {
      var m = engine.heroes[k];
      if (m.out) continue;
      var i = engine.idx(m.x, m.y);
      sx += m.x + engine.fx[i] * (1 - alpha);
      sy += m.y + engine.fy[i] * (1 - alpha);
      n++;
    }
    if (!n) { var m0 = engine.murphy; sx = m0.x; sy = m0.y; n = 1; }
    var mx = (sx / n + 0.5) * s;
    var my = (sy / n + 0.5) * s;
    var fullW = engine.w * s, fullH = engine.h * s;
    this.camX = fullW <= this.viewW ? (fullW - this.viewW) / 2 : Math.max(0, Math.min(fullW - this.viewW, mx - this.viewW / 2));
    this.camY = fullH <= this.viewH ? (fullH - this.viewH) / 2 : Math.max(0, Math.min(fullH - this.viewH, my - this.viewH / 2));
  };

  Renderer.prototype.draw = function (engine, alpha, timeMs) {
    if (!this.pack || this.pack.skin !== this.skin) this.pack = SP.Sprites.build(this.tile, this.skin);
    var g = this.ctx, s = this.tile, pack = this.pack;
    g.fillStyle = '#070910';
    g.fillRect(0, 0, this.viewW, this.viewH);
    this.camera(engine, alpha);

    var x0 = Math.max(0, Math.floor(this.camX / s) - 1);
    var y0 = Math.max(0, Math.floor(this.camY / s) - 1);
    var x1 = Math.min(engine.w - 1, Math.ceil((this.camX + this.viewW) / s) + 1);
    var y1 = Math.min(engine.h - 1, Math.ceil((this.camY + this.viewH) / s) + 1);
    var open = engine.exitOpen();

    // «пол» пещеры под пустыми клетками
    var fw = engine.w * s, fh = engine.h * s;
    g.fillStyle = '#0d111c';
    g.fillRect(-this.camX, -this.camY, fw, fh);
    g.save();
    g.globalAlpha = 0.5;
    g.strokeStyle = '#05070d';
    g.lineWidth = 1;
    for (var gx = 0; gx <= engine.w; gx++) {
      g.beginPath(); g.moveTo(gx * s - this.camX, -this.camY); g.lineTo(gx * s - this.camX, fh - this.camY); g.stroke();
    }
    for (var gy = 0; gy <= engine.h; gy++) {
      g.beginPath(); g.moveTo(-this.camX, gy * s - this.camY); g.lineTo(fw - this.camX, gy * s - this.camY); g.stroke();
    }
    g.restore();

    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var i = engine.idx(x, y);
        var t = engine.tiles[i];
        if (t === T.EMPTY) continue;
        var px = (x + engine.fx[i] * (1 - alpha)) * s - this.camX;
        var py = (y + engine.fy[i] * (1 - alpha)) * s - this.camY;
        // качание перед срывом — единственное предупреждение игроку, его видно
        if (engine.shake[i]) {
          px += Math.sin(timeMs / 24) * s * 0.05 * engine.shake[i];
          py += Math.sin(timeMs / 15) * s * 0.018 * engine.shake[i];
        }

        if (t === T.MURPHY) {
          var who = engine.heroAt(x, y) || engine.murphy;
          var p = (who === engine.heroes[0] || !this.pack2) ? pack : this.pack2;
          g.drawImage(p.murphy[who.facing], px, py, s, s);
          continue;
        }
        if (t === T.EXIT) { g.drawImage(open ? pack.exitOpen : pack.tile[T.EXIT], px, py, s, s); continue; }
        if (PORT_INDEX[t] !== undefined) { g.drawImage(pack.port[PORT_INDEX[t]], px, py, s, s); continue; }
        if (t === T.GRAV_ON || t === T.GRAV_OFF) {
          // включённый рубильник подсвечен: по нему видно, какая физика сейчас в силе
          var live = engine.gravity === (t === T.GRAV_ON);
          g.save(); g.translate(px, py);
          SP.Sprites.drawGrav(g, s, t === T.GRAV_ON, live);
          g.restore();
          continue;
        }
        if (t === T.TERMINAL) {
          g.save(); g.translate(px, py);
          SP.Sprites.drawTerminal(g, s, engine.fuse > 0, timeMs);
          g.restore();
          continue;
        }
        if (t === T.YELLOW || t === T.RED) {
          // пока горит запал, заряды мигают — иначе не понять, что счёт пошёл
          g.save(); g.translate(px, py);
          if (t === T.YELLOW) SP.Sprites.drawYellow(g, s, engine.fuse > 0 && Math.sin(timeMs / 90) > 0);
          else SP.Sprites.drawRed(g, s, engine.fuse > 0 && Math.sin(timeMs / 90) > 0);
          g.restore();
          continue;
        }
        if (t === T.BUG) {
          g.save(); g.translate(px, py);
          SP.Sprites.drawBug(g, s, engine.bugHot(i), timeMs);
          g.restore();
          continue;
        }
        if (t === T.ELECTRON) {
          g.save(); g.translate(px, py);
          SP.Sprites.drawElectron(g, s, timeMs / 260 + x);
          g.restore();
          continue;
        }
        if (t === T.EXPLOSION || t === T.EXPLOSION_INFO) {
          var k = 1 - engine.timer[i] / 5;
          g.save(); g.translate(px, py);
          SP.Sprites.drawBlast(g, s, k, t === T.EXPLOSION_INFO);
          g.restore();
          continue;
        }
        var sprite = pack.tile[t];
        if (sprite) g.drawImage(sprite, px, py, s, s);
      }
    }

    if (open) {   // подсветка открытого выхода
      var pulse = 0.35 + 0.25 * Math.sin(timeMs / 300);
      for (var j = 0; j < engine.tiles.length; j++) {
        if (engine.tiles[j] !== T.EXIT) continue;
        var ex = (j % engine.w) * s - this.camX, ey = Math.floor(j / engine.w) * s - this.camY;
        g.save();
        g.globalAlpha = pulse;
        g.strokeStyle = '#7dffc0';
        g.lineWidth = Math.max(2, s * 0.08);
        g.strokeRect(ex + s * 0.06, ey + s * 0.06, s * 0.88, s * 0.88);
        g.restore();
      }
    }

    // Метки советчика поверх всего: красным — доказанно смертельные ходы,
    // зелёным — предложенный. Гаснут сами через несколько секунд.
    if (this.marks && timeMs < this.marks.until) {
      var fade = Math.min(1, (this.marks.until - timeMs) / 600);
      var beat = 0.55 + 0.35 * Math.sin(timeMs / 220);
      var self = this;
      this.marks.cells.forEach(function (m) {
        var mx = m.x * s - self.camX, my = m.y * s - self.camY;
        g.save();
        g.globalAlpha = fade * beat;
        g.strokeStyle = m.bad ? '#ff6b6b' : '#7dffc0';
        g.lineWidth = Math.max(2, s * 0.1);
        g.strokeRect(mx + s * 0.1, my + s * 0.1, s * 0.8, s * 0.8);
        if (m.bad) {
          g.beginPath();
          g.moveTo(mx + s * 0.28, my + s * 0.28); g.lineTo(mx + s * 0.72, my + s * 0.72);
          g.moveTo(mx + s * 0.72, my + s * 0.28); g.lineTo(mx + s * 0.28, my + s * 0.72);
          g.stroke();
        }
        g.restore();
      });
    }
  };

  /** Показать метки на несколько секунд. */
  Renderer.prototype.setMarks = function (cells, timeMs, ms) {
    this.marks = cells && cells.length ? { cells: cells, until: timeMs + (ms || 3500) } : null;
  };

  global.SP = Object.assign(global.SP, { Renderer: Renderer });
})(typeof globalThis !== 'undefined' ? globalThis : this);
