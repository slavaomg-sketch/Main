'use strict';
/* Общие утилиты для консольных инструментов (проигрывание решений, автопилот). */

var path = require('path');
var Engine = require(path.join(__dirname, '..', 'js', 'engine.js')).Engine;
var base = require(path.join(__dirname, '..', 'js', 'tiles.js'));
var T = base.Tiles, DIRS = base.DIRS, PORT_DIR = base.PORT_DIR;

var CODE = { U: 0, R: 1, D: 2, L: 3 };

/**
 * Решение — строка вида "R3 D2 . l U".
 *  U/R/D/L — шаг, u/r/d/l — "снап" (выесть, не сходя с места), "." — ждать.
 *  Цифра после буквы = повтор.
 */
function parseMoves(str) {
  var out = [], i = 0;
  while (i < str.length) {
    var ch = str[i++];
    if (/\s/.test(ch)) continue;
    var act;
    if (ch === '.') act = { dir: -1, snap: false };
    else if (CODE[ch.toUpperCase()] !== undefined) act = { dir: CODE[ch.toUpperCase()], snap: ch === ch.toLowerCase() };
    else throw new Error('Непонятный символ решения: ' + ch);
    var num = '';
    while (i < str.length && /[0-9]/.test(str[i])) num += str[i++];
    var times = num ? parseInt(num, 10) : 1;
    for (var k = 0; k < times; k++) out.push(act);
  }
  return out;
}

function formatMoves(actions) {
  var letters = ['U', 'R', 'D', 'L'];
  var parts = [], run = null, count = 0;
  function flush() {
    if (run === null) return;
    parts.push(count > 1 ? run + count : run);
  }
  actions.forEach(function (a) {
    var ch = a.dir < 0 ? '.' : (a.snap ? letters[a.dir].toLowerCase() : letters[a.dir]);
    if (ch === run) { count++; return; }
    flush();
    run = ch; count = 1;
  });
  flush();
  return parts.join(' ');
}

function replay(level, movesStr, opts) {
  opts = opts || {};
  var e = new Engine(level);
  var actions = parseMoves(movesStr);
  for (var i = 0; i < actions.length; i++) {
    e.step(actions[i]);
    if (opts.trace) {
      console.log('--- шаг ' + (i + 1) + ' (' + JSON.stringify(actions[i]) + ') собрано ' +
        e.collected + '/' + e.needed + ' статус ' + e.status);
      console.log(e.toText());
    }
    if (e.status === 'won') return { ok: true, engine: e, steps: i + 1 };
    if (e.status === 'dead' || e.status === 'dying') return { ok: false, engine: e, steps: i + 1, reason: 'Мёрфи погиб' };
  }
  return { ok: e.status === 'won', engine: e, steps: actions.length, reason: 'решение закончилось, выход не достигнут' };
}

/* ---------- Автопилот: доказывает проходимость, находя реальную последовательность ходов ---------- */

/* Клетки, в которые нельзя загонять камень при поиске эталонного решения:
   так автопилот не наступает на ловушку, ради которой уровень и сделан. */
var NO_PUSH = null;
/* Клетки, куда эталонному решению вообще нельзя соваться: приманка,
   за которой сидит монстр, — её игрок должен опознать по карте, а не проверить собой. */
var NO_GO = null;

function walkableForPath(e, x, y, fromDir) {
  if (NO_GO && NO_GO.indexOf(y * e.w + x) >= 0) return false;
  var t = e.get(x, y);
  if (t === T.EMPTY || t === T.BASE || t === T.INFOTRON) return true;
  if (t === T.EXIT) return e.exitOpen();
  if (PORT_DIR[t] !== undefined) return PORT_DIR[t] === fromDir;
  if (t === T.ZONK || t === T.ORANGE) {
    if (DIRS[fromDir][1] !== 0) return false;             // валун толкается только вбок
    if (e.falling[e.idx(x, y)]) return false;
    var dx = x + DIRS[fromDir][0];
    if (NO_PUSH && NO_PUSH.indexOf(y * e.w + dx) >= 0) return false;
    return e.get(dx, y) === T.EMPTY;
  }
  return false;
}

/** BFS по текущей карте: путь к ближайшей цели. allowPorts=false — не соваться в односторонние порты. */
function planStep(e, targets, allowPorts) {
  var start = e.murphy.y * e.w + e.murphy.x;
  var goal = {};
  targets.forEach(function (i) { goal[i] = true; });
  var prev = new Int32Array(e.w * e.h).fill(-1);
  var firstDir = new Int8Array(e.w * e.h).fill(-1);
  var seen = new Uint8Array(e.w * e.h);
  var queue = [start];
  seen[start] = 1;
  var head = 0;
  while (head < queue.length) {
    var cur = queue[head++];
    if (goal[cur] && cur !== start) {
      var path = [], node = cur;
      while (node !== start) { path.push(firstDir[node]); node = prev[node]; }
      path.reverse();
      return path;
    }
    var cx = cur % e.w, cy = (cur - cx) / e.w;
    for (var d = 0; d < 4; d++) {
      var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= e.w || ny >= e.h) continue;
      // порт переносит на две клетки
      var t = e.get(nx, ny);
      var tx = nx, ty = ny;
      if (PORT_DIR[t] !== undefined) {
        if (!allowPorts || PORT_DIR[t] !== d) continue;
        tx = nx + DIRS[d][0]; ty = ny + DIRS[d][1];
        var ft = e.get(tx, ty);
        if (!(ft === T.EMPTY || ft === T.BASE || ft === T.INFOTRON)) continue;
      } else if (!walkableForPath(e, nx, ny, d)) continue;
      var ni = ty * e.w + tx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      firstDir[ni] = d;
      queue.push(ni);
    }
  }
  return null;
}

/**
 * Клетки, которые стоит расчистить, когда путь к цели не находится:
 * грунт с той стороны зонка, куда его надо будет толкнуть. Выев такую клетку,
 * Мёрфи делает камень подвижным — и обычное планирование снова находит дорогу.
 */
function unblockTargets(e) {
  var res = [];
  for (var i = 0; i < e.tiles.length; i++) {
    if (e.tiles[i] !== T.ZONK && e.tiles[i] !== T.ORANGE) continue;
    var x = i % e.w, y = (i - x) / e.w;
    [1, 3].forEach(function (d) {
      var bx = x + DIRS[d][0];
      if (e.get(bx, y) === T.BASE) res.push(y * e.w + bx);
    });
  }
  return res;
}

/** Переживает ли Мёрфи заданную цепочку ходов (хвост добивается ожиданием). */
function survives(engine, plan, ticks) {
  var c = engine.clone();
  for (var i = 0; i < ticks; i++) {
    c.step(i < plan.length ? plan[i] : { dir: -1 });
    if (c.status === 'won') return true;
    if (c.status === 'dying' || c.status === 'dead') return false;
  }
  return true;
}

/**
 * Безопасен ли ход. Проверяем два поведения: замереть на месте и идти дальше
 * задуманным маршрутом. Хватает любого — живой игрок тоже не обязан
 * останавливаться там, где остановка смертельна (под качающимся зонком,
 * посреди гнезда жуков), если ходом дальше он оттуда выходит.
 */
function isSafe(e, action, lookahead, cont) {
  var c = e.clone();
  c.step(action);
  if (c.status === 'dying' || c.status === 'dead') return false;
  if (c.status === 'won') return true;
  if (survives(c, [], lookahead)) return true;
  return !!(cont && cont.length && survives(c, cont, lookahead));
}

function autopilot(level, opts) {
  opts = opts || {};
  var limit = opts.limit || 1200;
  var lookahead = opts.lookahead === undefined ? 3 : opts.lookahead;
  var e = new Engine(level);
  NO_PUSH = (opts.noPushInto || []).map(function (p) { return p[1] * e.w + p[0]; });
  NO_GO = (opts.avoid || []).map(function (p) { return p[1] * e.w + p[0]; });
  var actions = [];
  var stuck = 0;

  // Зачин: жадный автопилот не умеет готовить дорогу заранее, поэтому
  // такие ходы задаются вручную, а дальше он доигрывает уровень сам.
  if (opts.prefix) {
    parseMoves(opts.prefix).forEach(function (act) { e.step(act); actions.push(act); });
    if (e.status !== 'playing' && e.status !== 'won') {
      return { ok: false, moves: formatMoves(actions), reason: 'зачин губит Мёрфи' };
    }
  }

  for (var step = 0; step < limit; step++) {
    if (e.status === 'won') return { ok: true, moves: formatMoves(actions), steps: actions.length };
    if (e.status !== 'playing') return { ok: false, moves: formatMoves(actions), reason: 'погиб' };

    var targets = [];
    if (!e.exitOpen()) {
      for (var i = 0; i < e.tiles.length; i++) if (e.tiles[i] === T.INFOTRON) targets.push(i);
    } else {
      for (var j = 0; j < e.tiles.length; j++) if (e.tiles[j] === T.EXIT) targets.push(j);
    }
    // Порт — дорога в один конец: сначала пробуем добраться без него.
    var path = planStep(e, targets, false) || planStep(e, targets, true);
    if (!path) {                       // цель недостижима — попробуем освободить место за камнем
      var unblock = unblockTargets(e);
      if (unblock.length) path = planStep(e, unblock, false) || planStep(e, unblock, true);
    }
    var order = [];
    if (path && path.length) {
      // продолжение задуманного маршрута — оно и есть «бежать дальше»
      var tail = [];
      for (var p = 1; p < path.length && p <= lookahead; p++) tail.push({ dir: path[p], snap: false });
      order.push({ act: { dir: path[0], snap: false }, cont: tail });
    }
    order.push({ act: { dir: -1, snap: false }, cont: null });
    for (var d = 0; d < 4; d++) {
      var same = [];
      for (var q = 0; q < lookahead; q++) same.push({ dir: d, snap: false });
      order.push({ act: { dir: d, snap: false }, cont: same });   // рывок в одну сторону
    }

    var chosen = null;
    for (var k = 0; k < order.length; k++) {
      if (isSafe(e, order[k].act, lookahead, order[k].cont)) { chosen = order[k].act; break; }
    }
    if (!chosen) chosen = { dir: -1, snap: false };

    var before = e.key();
    e.step(chosen);
    actions.push(chosen);
    if (e.key() === before) { stuck++; if (stuck > 40) return { ok: false, moves: formatMoves(actions), reason: 'застрял' }; }
    else stuck = 0;
  }
  return { ok: e.status === 'won', moves: formatMoves(actions), reason: 'лимит ходов' };
}

module.exports = { Engine: Engine, parseMoves: parseMoves, formatMoves: formatMoves, replay: replay, autopilot: autopilot };
