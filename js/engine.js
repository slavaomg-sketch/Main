/*
 * Engine — вся логика мира. Никакого DOM: этот же файл гоняется в Node
 * решателем и верификатором уровней (tools/solve.js, tools/verify.js).
 *
 * Мир пошаговый: один step() = один "тик". Всё двигается ровно на клетку,
 * а отрисовка интерполирует переход по fx/fy.
 *
 * Героев может быть двое ('M' и 'N' на карте), и клавиши у них общие: одна
 * стрелка — идут оба. Отсюда главное правило движка, от которого зависит
 * вообще всё:
 *
 *   ОЧЕРЁДНОСТЬ ХОДА ФИКСИРОВАНА. Сначала полностью ходит 'M', потом 'N'.
 *
 * Порядок виден невооружённым глазом: если 'M' освободил клетку, 'N' в неё
 * входит в тот же тик, а наоборот — уже нет. Менять очередь нельзя: на ней
 * держатся все записанные решения.
 *
 * Гибель любого героя — поражение. Выход требует, чтобы вышли все: вышедший
 * убирается с поля и больше не мешает, так что порядок выхода — тоже задача.
 */
(function (global) {
  'use strict';

  var base = (typeof module === 'object' && module.exports) ? require('./tiles.js') : global.SP;
  var T = base.Tiles, DIRS = base.DIRS, CHARS = base.CHARS, PORT_DIR = base.PORT_DIR;
  var BUG_PHASE = base.BUG_PHASE;

  var EXPLOSION_TICKS = 5;
  var DEATH_TICKS = 14;
  // Сколько тиков зонк качается на краю, прежде чем сорваться. Это фора игроку:
  // без неё камень трогается в тот же тик, когда из-под него ушла опора,
  // и убежать физически невозможно.
  var SHAKE_TICKS = 4;
  // Жук: цикл «тлеет — вспыхивает». Вспышка бьёт соседа по стороне, но окно
  // покоя длиннее вспышки втрое — этого хватает, чтобы пройти мимо.
  var BUG_PERIOD = 12;
  var BUG_HOT = 4;
  // Терминал не рвёт заряды мгновенно: после нажатия горит запал, и это время —
  // весь запас хода на то, чтобы уйти из-под воронок.
  var FUSE_TICKS = 14;

  // С чего предмет может скатиться вбок. Стена сюда входит: камень, лежащий
  // на ровной твёрдой поверхности, съезжает с её края, если сбоку и наискось пусто.
  function isRounded(t) {
    return t === T.ZONK || t === T.INFOTRON || t === T.CHIP || t === T.ORANGE || t === T.WALL;
  }
  function isFaller(t) {
    return t === T.ZONK || t === T.INFOTRON || t === T.ORANGE;
  }
  /** Заряды, которые слушают терминал: сами не падают, ждут сигнала. */
  function isCharge(t) {
    return t === T.YELLOW || t === T.RED;
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
    this.shake = new Uint8Array(n);
    this.dir = new Uint8Array(n);
    this.timer = new Uint8Array(n);
    this.moved = new Uint8Array(n);
    this.fx = new Int8Array(n);
    this.fy = new Int8Array(n);

    var total = 0;
    var found = [];
    for (var y = 0; y < this.h; y++) {
      var line = rows[y];
      for (var x = 0; x < this.w; x++) {
        var ch = x < line.length ? line[x] : ' ';
        var t = CHARS[ch];
        if (t === undefined) throw new Error('Неизвестный символ карты: "' + ch + '" в строке ' + (y + 1));
        var i = y * this.w + x;
        this.tiles[i] = t;
        if (t === T.INFOTRON) total++;
        if (t === T.MURPHY) found.push({ ch: ch, x: x, y: y });
        if (t === T.SNIKSNAK) this.dir[i] = 1;
        if (t === T.ELECTRON) this.dir[i] = 3;
        if (t === T.BUG) this.dir[i] = BUG_PHASE[ch] || 0;   // жук хранит в dir сдвиг фазы
      }
    }

    // 'M' ходит первым, 'N' — вторым; несколько 'N' идут в порядке чтения карты
    found.sort(function (a, b) { return (a.ch === 'M' ? 0 : 1) - (b.ch === 'M' ? 0 : 1); });
    this.heroes = found.map(function (f) {
      return { x: f.x, y: f.y, facing: 2, alive: true, pushing: 0, digging: 0,
               carry: 0, falling: 0, out: 0, acted: 0 };
    });
    if (!this.heroes.length) this.heroes.push({ x: 0, y: 0, facing: 2, alive: true, pushing: 0,
                                                digging: 0, carry: 0, falling: 0, out: 0, acted: 0 });
    // Совместимость: весь остальной код (камера, звук, советчик) читает .murphy —
    // это тот же объект, что heroes[0], а не копия.
    this.murphy = this.heroes[0];

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
    this.fuse = 0;             // 0 — терминал не нажат; иначе тики до подрыва
    this.gravity = !!this.level.gravity;   // тяжесть уровня: под ней Мёрфи не поднимается
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
    this.shake[i] = 0;
  };

  Engine.prototype.exitOpen = function () { return this.collected >= this.needed; };

  /** Горит ли жук в этом тике. Фаза детерминирована — уровень воспроизводим. */
  Engine.prototype.bugHot = function (i) {
    return (this.ticks + this.dir[i]) % BUG_PERIOD < BUG_HOT;
  };

  Engine.prototype.clone = function () {
    var e = Object.create(Engine.prototype);
    e.level = this.level;
    e.w = this.w; e.h = this.h;
    e.tiles = this.tiles.slice();
    e.falling = this.falling.slice();
    e.shake = this.shake.slice();
    e.dir = this.dir.slice();
    e.timer = this.timer.slice();
    e.moved = this.moved.slice();
    e.fx = this.fx.slice();
    e.fy = this.fy.slice();
    e.heroes = this.heroes.map(function (m) {
      return { x: m.x, y: m.y, facing: m.facing, alive: m.alive, pushing: m.pushing,
               digging: m.digging, carry: m.carry, falling: m.falling, out: m.out, acted: m.acted };
    });
    e.murphy = e.heroes[0];
    e.totalInfotrons = this.totalInfotrons;
    e.needed = this.needed;
    e.collected = this.collected;
    e.status = this.status;
    e.deathTimer = this.deathTimer;
    e.ticks = this.ticks;
    e.moves = this.moves;
    e.fuse = this.fuse;
    e.gravity = this.gravity;
    return e;
  };

  // Компактный ключ состояния — для поиска решения и детекции зацикливания.
  Engine.prototype.key = function () {
    var s = '';
    for (var i = 0; i < this.tiles.length; i++) {
      s += String.fromCharCode(48 + this.tiles[i] + (this.falling[i] ? 32 : 0) + (this.shake[i] ? 64 : 0));
    }
    s += '|' + this.collected + '|' + this.status + '|' + this.fuse + '|' + (this.gravity ? 'g' : '0');
    for (var k = 0; k < this.heroes.length; k++) {
      var m = this.heroes[k];
      s += '|' + m.carry + m.falling + m.out;
    }
    return s;
  };

  Engine.prototype.moveObj = function (x, y, nx, ny) {
    var i = this.idx(x, y), j = this.idx(nx, ny);
    this.tiles[j] = this.tiles[i];
    this.falling[j] = this.falling[i];
    this.dir[j] = this.dir[i];
    this.shake[j] = 0;
    this.tiles[i] = T.EMPTY;
    this.falling[i] = 0;
    this.shake[i] = 0;
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
        if (t === T.WALL || t === T.EXIT) continue;
        // инфотронный взрыв перекрывает обычный: иначе цепочка «диск → электрон»
        // съедала бы собственную добычу
        if (isBlast(t) && !(blast === T.EXPLOSION_INFO && t === T.EXPLOSION)) continue;
        if (t === T.ORANGE || isCharge(t)) chain.push([x, y, 'normal']);
        if (t === T.ELECTRON) chain.push([x, y, 'info']);
        if (t === T.MURPHY) this.killAt(x, y, true);
        this.tiles[i] = blast;
        this.falling[i] = 0;
        this.shake[i] = 0;
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

  /** Кто из героев стоит в клетке. Вышедшие и погибшие не считаются. */
  Engine.prototype.heroAt = function (x, y) {
    for (var k = 0; k < this.heroes.length; k++) {
      var m = this.heroes[k];
      if (m.alive && !m.out && m.x === x && m.y === y) return m;
    }
    return null;
  };

  /** Гибель любого героя — поражение: напарник не «остаётся за старшего». */
  Engine.prototype.killHero = function (m, alreadyInBlast) {
    if (!m || !m.alive || m.out) return;
    m.alive = false;
    this.status = 'dying';
    this.deathTimer = DEATH_TICKS;
    if (!alreadyInBlast) this.explodeAt(m.x, m.y, 'normal');
  };

  Engine.prototype.killAt = function (x, y, alreadyInBlast) {
    this.killHero(this.heroAt(x, y), alreadyInBlast);
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

  Engine.prototype.updateHero = function (m, input) {
    m.pushing = 0;
    m.digging = 0;
    m.acted = 0;
    if (m.out || !m.alive) return;
    if (m.falling) return;                       // в падении Мёрфи не управляется
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
      else if (t === T.EMPTY && m.carry) { this.set(nx, ny, T.RED); m.carry = 0; }  // выложили заряд
      else if (t === T.TERMINAL) this.pressTerminal();
      return;
    }

    if (t === T.BASE) { m.digging = 1; this.stepHeroTo(m, nx, ny); m.acted = 1; return; }
    if (t === T.EMPTY) { this.stepHeroTo(m, nx, ny); m.acted = 1; return; }
    if (t === T.INFOTRON) { this.collected++; this.stepHeroTo(m, nx, ny); m.acted = 1; return; }
    if (t === T.EXIT) {
      // Вышедший убирается с поля: он больше не стоит на дороге у напарника.
      // Победа — когда вышли все, поэтому порядок выхода тоже приходится считать.
      if (this.exitOpen()) {
        this.set(m.x, m.y, T.EMPTY);
        m.x = nx; m.y = ny;
        m.out = 1;
        m.falling = 0;
        m.acted = 1;
        if (this.allOut()) this.status = 'won';
      }
      return;
    }
    if (isMonster(t)) { this.killHero(m); return; }
    // Красный заряд Мёрфи забирает с собой — но только один за раз.
    if (t === T.RED && !m.carry) { m.carry = 1; this.set(nx, ny, T.EMPTY); this.stepHeroTo(m, nx, ny); m.acted = 1; return; }
    // Жёлтый двигается в любую сторону: он не круглый и никуда не скатывается.
    if (t === T.YELLOW) {
      if (this.get(nx + dx, ny + dy) !== T.EMPTY) return;
      this.moveObj(nx, ny, nx + dx, ny + dy);
      m.pushing = 1;
      this.stepHeroTo(m, nx, ny);
      m.acted = 1;
      return;
    }
    if (t === T.TERMINAL) { this.pressTerminal(); return; }
    // Гравипереключатели вмурованы в породу: в них упираются, а не входят.
    if (t === T.GRAV_ON) { this.gravity = true; return; }
    if (t === T.GRAV_OFF) { this.gravity = false; return; }
    if ((t === T.ZONK || t === T.ORANGE) && dy === 0) {
      var bi = this.idx(nx, ny);
      if (this.falling[bi]) return;                    // падающий зонк не толкнуть
      if (this.get(nx + dx, ny) !== T.EMPTY) return;
      this.moveObj(nx, ny, nx + dx, ny);
      // толчок — осознанное действие игрока: раскачка тут не нужна,
      // иначе камень проезжает мимо дыры, пока не отпустишь клавишу
      this.shake[this.idx(nx + dx, ny)] = SHAKE_TICKS;
      m.pushing = 1;
      this.stepHeroTo(m, nx, ny);
      m.acted = 1;
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
      m.acted = 1;
      return;
    }
  };

  Engine.prototype.stepHeroTo = function (m, nx, ny) {
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
          // раз уже летит — летит дальше без раскачки; с места трогается не сразу
          if (this.falling[i] || this.shake[i] >= SHAKE_TICKS) {
            this.moveObj(x, y, x, y + 1);
            this.falling[this.idx(x, y + 1)] = 1;
          } else {
            this.shake[i]++;
          }
          continue;
        }
        if (this.falling[i]) {
          if (b === T.MURPHY) { this.killAt(x, y + 1); continue; }
          if (isMonster(b) || b === T.BUG) { this.explodeAt(x, y + 1, b === T.ELECTRON ? 'info' : 'normal'); continue; }
          if (b === T.ORANGE) { this.explodeAt(x, y + 1, 'normal'); continue; }
          if (t === T.ORANGE) { this.explodeAt(x, y, 'normal'); continue; }
        }
        if (isRounded(b)) {
          var left = this.get(x - 1, y) === T.EMPTY && this.get(x - 1, y + 1) === T.EMPTY;
          var right = this.get(x + 1, y) === T.EMPTY && this.get(x + 1, y + 1) === T.EMPTY;
          if (left || right) {
            if (this.shake[i] < SHAKE_TICKS) { this.shake[i]++; continue; }
            var nx = left ? x - 1 : x + 1;
            this.moveObj(x, y, nx, y);
            this.falling[this.idx(nx, y)] = 1;
            continue;
          }
        }
        this.shake[i] = 0;
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
          if (tt === T.MURPHY) { this.dir[i] = nd; this.killAt(nx, ny); k = 99; break; }
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

  /** Под тяжестью Мёрфи падает сам — и вверх ему уже не подняться. */
  Engine.prototype.updateMurphyFall = function () {
    for (var k = 0; k < this.heroes.length; k++) {
      var m = this.heroes[k];
      if (!this.gravity || !m.alive || m.out) { m.falling = 0; continue; }
      if (this.get(m.x, m.y + 1) === T.EMPTY) { this.stepHeroTo(m, m.x, m.y + 1); m.falling = 1; }
      else m.falling = 0;
    }
  };

  /** Все ли вышли: пока хоть один в шахте, выход не засчитан. */
  Engine.prototype.allOut = function () {
    for (var k = 0; k < this.heroes.length; k++) if (!this.heroes[k].out) return false;
    return true;
  };

  /** Живы ли все герои — лента отмотки помечает такт безопасным по этому. */
  Engine.prototype.allAlive = function () {
    for (var k = 0; k < this.heroes.length; k++) if (!this.heroes[k].alive) return false;
    return true;
  };

  /** Нажатие терминала поджигает запал. Повторное нажатие ничего не меняет. */
  Engine.prototype.pressTerminal = function () {
    if (this.fuse === 0) this.fuse = FUSE_TICKS;
  };

  /** Запал догорел — рвёт все заряды разом, где бы они ни лежали. */
  Engine.prototype.updateFuse = function () {
    if (this.fuse === 0) return;
    this.fuse--;
    if (this.fuse > 0) return;
    // Заряд в руках слушает тот же сигнал: с бомбой в кармане кнопку не жмут.
    for (var h = 0; h < this.heroes.length; h++) {
      var hero = this.heroes[h];
      if (hero.carry && hero.alive && !hero.out) {
        hero.carry = 0;
        this.explodeAt(hero.x, hero.y, 'normal');
      }
    }
    var spots = [];
    for (var i = 0; i < this.tiles.length; i++) if (isCharge(this.tiles[i])) spots.push(i);
    for (var k = 0; k < spots.length; k++) {
      if (!isCharge(this.tiles[spots[k]])) continue;    // соседний заряд мог уже сдетонировать по цепочке
      this.explodeAt(spots[k] % this.w, Math.floor(spots[k] / this.w), 'normal');
    }
  };

  /** Вспышка жука бьёт Мёрфи, если тот стоит с ним бок о бок. */
  Engine.prototype.updateBugs = function () {
    for (var h = 0; h < this.heroes.length; h++) {
      var m = this.heroes[h];
      if (!m.alive || m.out) continue;
      for (var k = 0; k < 4; k++) {
        var x = m.x + DIRS[k][0], y = m.y + DIRS[k][1];
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        var i = this.idx(x, y);
        if (this.tiles[i] === T.BUG && this.bugHot(i)) { this.killHero(m); return; }
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
    // Очередь хода: сначала 'M', потом 'N'. Каждый ходит целиком, поэтому
    // освобождённая первым клетка достаётся второму в этом же тике.
    if (this.status === 'playing') {
      var act = input || { dir: -1 };
      for (var h = 0; h < this.heroes.length; h++) {
        if (this.status !== 'playing') break;
        this.updateHero(this.heroes[h], act);
      }
      var any = false;
      for (var h2 = 0; h2 < this.heroes.length; h2++) if (this.heroes[h2].acted) any = true;
      if (any) this.moves++;                    // один такт — не больше одного хода в счётчике
    }
    if (this.status === 'playing') this.updateMurphyFall();
    this.updateFuse();
    this.updateGravity();
    this.updateMonsters();
    if (this.status === 'playing') this.updateBugs();

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
      for (var x = 0; x < this.w; x++) {
        var ch = TO_CHAR[this.tiles[this.idx(x, y)]] || '?';
        // напарника в дампе видно отдельно, иначе двух героев не различить
        if (ch === 'M' && this.heroes.length > 1 && this.heroAt(x, y) !== this.heroes[0]) ch = 'N';
        s += ch;
      }
      out.push(s);
    }
    return out.join('\n');
  };

  var api = { Engine: Engine, isRounded: isRounded, isFaller: isFaller, isCharge: isCharge,
              isMonster: isMonster, isBlast: isBlast };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.SP = Object.assign(global.SP || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
