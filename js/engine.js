/*
 * Engine — вся логика мира. Никакого DOM: этот же файл гоняется в Node
 * решателем и верификатором уровней (tools/solve.js, tools/verify.js).
 *
 * Мир пошаговый: один step() = один "тик". Всё двигается ровно на клетку,
 * а отрисовка интерполирует переход по fx/fy.
 */
(function (global) {
  'use strict';

  var base = (typeof module === 'object' && module.exports) ? require('./tiles.js') : global.SP;
  var T = base.Tiles, DIRS = base.DIRS, CHARS = base.CHARS, PORT_DIR = base.PORT_DIR;

  var EXPLOSION_TICKS = 5;
  var DEATH_TICKS = 14;

  function isRounded(t) {
    return t === T.ZONK || t === T.INFOTRON || t === T.CHIP || t === T.ORANGE;
  }
  function isFaller(t) {
    return t === T.ZONK || t === T.INFOTRON || t === T.ORANGE;
  }
  function isMonster(t) {
    return t === T.SNIKSNAK || t === T.ELECTRON;
  }
  function isBlast(t) {
    return t === T.EXPLOSION || t === T.EXPLOSION_INFO;
  }

  function Engine(level) {
    this.level = level;
    this.reset();
  }

  Engine.prototype.reset = function () {
    var rows = this.level.map;
    var w = 0;
    for (var r = 0; r < rows.length; r++) w = Math.max(w, rows[r].length);
    this.w = w;
    this.h = rows.length;
    var n = this.w * this.h;

    this.tiles = new Uint8Array(n);
    this.falling = new Uint8Array(n);
    this.dir = new Uint8Array(n);
    this.timer = new Uint8Array(n);
    this.moved = new Uint8Array(n);
    this.fx = new Int8Array(n);
    this.fy = new Int8Array(n);

    var total = 0;
    this.murphy = { x: 0, y: 0, facing: 2, alive: true, pushing: 0, digging: 0 };
    for (var y = 0; y < this.h; y++) {
      var line = rows[y];
      for (var x = 0; x < this.w; x++) {
        var ch = x < line.length ? line[x] : ' ';
        var t = CHARS[ch];
        if (t === undefined) throw new Error('Неизвестный символ карты: "' + ch + '" в строке ' + (y + 1));
        var i = y * this.w + x;
        this.tiles[i] = t;
        if (t === T.INFOTRON) total++;
        if (t === T.MURPHY) { this.murphy.x = x; this.murphy.y = y; }
        if (t === T.SNIKSNAK) this.dir[i] = 1;
        if (t === T.ELECTRON) this.dir[i] = 3;
      }
    }

    this.totalInfotrons = total;
    // needed может быть больше, чем инфотронов на карте: недостающие
    // добываются взрывами электронов.
    this.needed = (this.level.needed === undefined || this.level.needed === null)
      ? total : this.level.needed;
    this.collected = 0;
    this.status = 'playing';   // playing | dying | dead | won
    this.deathTimer = 0;
    this.ticks = 0;
    this.moves = 0;
    return this;
  };

  Engine.prototype.idx = function (x, y) { return y * this.w + x; };

  Engine.prototype.get = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.WALL;
    return this.tiles[y * this.w + x];
  };

  Engine.prototype.set = function (x, y, t) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    var i = y * this.w + x;
    this.tiles[i] = t;
    this.falling[i] = 0;
  };

  Engine.prototype.exitOpen = function () { return this.collected >= this.needed; };

  Engine.prototype.clone = function () {
    var e = Object.create(Engine.prototype);
    e.level = this.level;
    e.w = this.w; e.h = this.h;
    e.tiles = this.tiles.slice();
    e.falling = this.falling.slice();
    e.dir = this.dir.slice();
    e.timer = this.timer.slice();
    e.moved = this.moved.slice();
    e.fx = this.fx.slice();
    e.fy = this.fy.slice();
    e.murphy = { x: this.murphy.x, y: this.murphy.y, facing: this.murphy.facing,
                 alive: this.murphy.alive, pushing: this.murphy.pushing, digging: this.murphy.digging };
    e.totalInfotrons = this.totalInfotrons;
    e.needed = this.needed;
    e.collected = this.collected;
    e.status = this.status;
    e.deathTimer = this.deathTimer;
    e.ticks = this.ticks;
    e.moves = this.moves;
    return e;
  };

  // Компактный ключ состояния — для поиска решения и детекции зацикливания.
  Engine.prototype.key = function () {
    var s = '';
    for (var i = 0; i < this.tiles.length; i++) {
      s += String.fromCharCode(48 + this.tiles[i] + (this.falling[i] ? 32 : 0));
    }
    return s + '|' + this.collected + '|' + this.status;
  };

  Engine.prototype.moveObj = function (x, y, nx, ny) {
    var i = this.idx(x, y), j = this.idx(nx, ny);
    this.tiles[j] = this.tiles[i];
    this.falling[j] = this.falling[i];
    this.dir[j] = this.dir[i];
    this.tiles[i] = T.EMPTY;
    this.falling[i] = 0;
    this.dir[i] = 0;
    this.fx[j] = x - nx;
    this.fy[j] = y - ny;
    this.fx[i] = 0;
    this.fy[i] = 0;
    this.moved[j] = 1;
  };

  Engine.prototype.explodeAt = function (cx, cy, kind) {
    var blast = kind === 'info' ? T.EXPLOSION_INFO : T.EXPLOSION;
    var chain = [];
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        var i = this.idx(x, y);
        var t = this.tiles[i];
        if (t === T.WALL || t === T.EXIT || isBlast(t)) continue;
        if (t === T.ORANGE) chain.push([x, y, 'normal']);
        if (t === T.ELECTRON) chain.push([x, y, 'info']);
        if (t === T.MURPHY) this.killMurphy(true);
        this.tiles[i] = blast;
        this.falling[i] = 0;
        this.dir[i] = 0;
        this.timer[i] = EXPLOSION_TICKS;
        this.fx[i] = 0;
        this.fy[i] = 0;
        this.moved[i] = 1;
      }
    }
    for (var k = 0; k < chain.length; k++) {
      this.explodeAt(chain[k][0], chain[k][1], chain[k][2]);
    }
  };

  Engine.prototype.killMurphy = function (alreadyInBlast) {
    if (!this.murphy.alive) return;
    this.murphy.alive = false;
    this.status = 'dying';
    this.deathTimer = DEATH_TICKS;
    if (!alreadyInBlast) this.explodeAt(this.murphy.x, this.murphy.y, 'normal');
  };

  Engine.prototype.updateExplosions = function () {
    for (var i = 0; i < this.tiles.length; i++) {
      if (!isBlast(this.tiles[i])) continue;
      if (this.timer[i] > 0) this.timer[i]--;
      if (this.timer[i] === 0) {
        this.tiles[i] = this.tiles[i] === T.EXPLOSION_INFO ? T.INFOTRON : T.EMPTY;
        this.moved[i] = 1;
      }
    }
  };

  // enterable — куда Мёрфи может шагнуть "просто так"
  Engine.prototype.enterable = function (t) {
    return t === T.EMPTY || t === T.BASE || t === T.INFOTRON;
  };

  Engine.prototype.updateMurphy = function (input) {
    var m = this.murphy;
    m.pushing = 0;
    m.digging = 0;
    var d = input && input.dir !== undefined ? input.dir : -1;
    if (d < 0 || d > 3) return;
    m.facing = d;

    var dx = DIRS[d][0], dy = DIRS[d][1];
    var nx = m.x + dx, ny = m.y + dy;
    var t = this.get(nx, ny);

    // "Снап": Space + направление — выесть грунт/инфотрон, не сходя с места.
    if (input.snap) {
      if (t === T.BASE) { this.set(nx, ny, T.EMPTY); m.digging = 1; }
      else if (t === T.INFOTRON) { this.set(nx, ny, T.EMPTY); this.collected++; m.digging = 1; }
      return;
    }

    if (t === T.BASE) { m.digging = 1; this.stepMurphyTo(nx, ny); this.moves++; return; }
    if (t === T.EMPTY) { this.stepMurphyTo(nx, ny); this.moves++; return; }
    if (t === T.INFOTRON) { this.collected++; this.stepMurphyTo(nx, ny); this.moves++; return; }
    if (t === T.EXIT) {
      if (this.exitOpen()) {
        this.set(m.x, m.y, T.EMPTY);
        m.x = nx; m.y = ny;
        this.status = 'won';
        this.moves++;
      }
      return;
    }
    if (isMonster(t)) { this.killMurphy(); return; }
    if ((t === T.ZONK || t === T.ORANGE) && dy === 0) {
      var bi = this.idx(nx, ny);
      if (this.falling[bi]) return;                    // падающий зонк не толкнуть
      if (this.get(nx + dx, ny) !== T.EMPTY) return;
      this.moveObj(nx, ny, nx + dx, ny);
      m.pushing = 1;
      this.stepMurphyTo(nx, ny);
      this.moves++;
      return;
    }
    if (PORT_DIR[t] !== undefined) {
      if (PORT_DIR[t] !== d) return;                   // порт односторонний
      var fx2 = nx + dx, fy2 = ny + dy;
      var ft = this.get(fx2, fy2);
      if (!this.enterable(ft)) return;
      if (ft === T.INFOTRON) this.collected++;
      this.set(m.x, m.y, T.EMPTY);
      var j = this.idx(fx2, fy2);
      this.tiles[j] = T.MURPHY;
      this.falling[j] = 0;
      this.fx[j] = m.x - fx2;
      this.fy[j] = m.y - fy2;
      this.moved[j] = 1;
      m.x = fx2; m.y = fy2;
      this.moves++;
      return;
    }
  };

  Engine.prototype.stepMurphyTo = function (nx, ny) {
    var m = this.murphy;
    var i = this.idx(m.x, m.y), j = this.idx(nx, ny);
    this.tiles[i] = T.EMPTY;
    this.falling[i] = 0;
    this.tiles[j] = T.MURPHY;
    this.falling[j] = 0;
    this.dir[j] = 0;
    this.fx[j] = m.x - nx;
    this.fy[j] = m.y - ny;
    this.fx[i] = 0;
    this.fy[i] = 0;
    this.moved[j] = 1;
    m.x = nx; m.y = ny;
  };

  Engine.prototype.updateGravity = function () {
    // Флаг "уже двигался" — свой для каждой фазы: толкнутый Мёрфи зонк
    // обязан в этот же тик провалиться, если под ним оказалась пустота.
    this.moved.fill(0);
    for (var y = this.h - 2; y >= 0; y--) {
      for (var x = 0; x < this.w; x++) {
        var i = this.idx(x, y);
        var t = this.tiles[i];
        if (!isFaller(t) || this.moved[i]) continue;

        var b = this.get(x, y + 1);
        if (b === T.EMPTY) {
          this.moveObj(x, y, x, y + 1);
          this.falling[this.idx(x, y + 1)] = 1;
          continue;
        }
        if (this.falling[i]) {
          if (b === T.MURPHY) { this.killMurphy(); continue; }
          if (isMonster(b)) { this.explodeAt(x, y + 1, b === T.ELECTRON ? 'info' : 'normal'); continue; }
          if (b === T.ORANGE) { this.explodeAt(x, y + 1, 'normal'); continue; }
          if (t === T.ORANGE) { this.explodeAt(x, y, 'normal'); continue; }
        }
        if (isRounded(b)) {
          if (this.get(x - 1, y) === T.EMPTY && this.get(x - 1, y + 1) === T.EMPTY) {
            this.moveObj(x, y, x - 1, y);
            this.falling[this.idx(x - 1, y)] = 1;
            continue;
          }
          if (this.get(x + 1, y) === T.EMPTY && this.get(x + 1, y + 1) === T.EMPTY) {
            this.moveObj(x, y, x + 1, y);
            this.falling[this.idx(x + 1, y)] = 1;
            continue;
          }
        }
        this.falling[i] = 0;
      }
    }
  };

  Engine.prototype.updateMonsters = function () {
    this.moved.fill(0);
    for (var y = 0; y < this.h; y++) {
      for (var x = 0; x < this.w; x++) {
        var i = this.idx(x, y);
        var t = this.tiles[i];
        if (!isMonster(t) || this.moved[i]) continue;

        var hand = t === T.SNIKSNAK ? 3 : 1;     // снипснак ведёт левой рукой, электрон правой
        var d = this.dir[i];
        var order = [(d + hand) % 4, d, (d + hand * 3) % 4, (d + 2) % 4];
        for (var k = 0; k < order.length; k++) {
          var nd = order[k];
          var nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
          var tt = this.get(nx, ny);
          if (tt === T.MURPHY) { this.dir[i] = nd; this.killMurphy(); k = 99; break; }
          if (tt === T.EMPTY) {
            this.dir[i] = nd;
            this.moveObj(x, y, nx, ny);
            this.dir[this.idx(nx, ny)] = nd;
            break;
          }
        }
        if (this.status === 'dying') return;
      }
    }
  };

  /**
   * Один шаг мира.
   * input: { dir: -1..3, snap: bool }
   */
  Engine.prototype.step = function (input) {
    if (this.status === 'won' || this.status === 'dead') return this.status;
    this.moved.fill(0);
    this.fx.fill(0);
    this.fy.fill(0);
    this.ticks++;

    this.updateExplosions();
    if (this.status === 'playing') this.updateMurphy(input || { dir: -1 });
    this.updateGravity();
    this.updateMonsters();

    if (this.status === 'dying') {
      this.deathTimer--;
      if (this.deathTimer <= 0) this.status = 'dead';
    }
    return this.status;
  };

  Engine.prototype.toText = function () {
    var TO_CHAR = base.TO_CHAR, out = [];
    for (var y = 0; y < this.h; y++) {
      var s = '';
      for (var x = 0; x < this.w; x++) s += TO_CHAR[this.tiles[this.idx(x, y)]] || '?';
      out.push(s);
    }
    return out.join('\n');
  };

  var api = { Engine: Engine, isRounded: isRounded, isFaller: isFaller, isMonster: isMonster, isBlast: isBlast };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.SP = Object.assign(global.SP || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
