#!/usr/bin/env node
'use strict';
/*
 * Точный перебор. В отличие от автопилота из tools/lib.js, который ищет путь
 * жадно и доказывает лишь проходимость, здесь честный поиск в ширину: он
 * находит КРАТЧАЙШЕЕ решение и умеет отвечать на вопрос, который автопилоту
 * не по зубам, — «а не завёл ли этот ход в тупик?».
 *
 * Ради этого и сделан: мерка резкости (tools/measure.js) видит опасность —
 * долю ходов, после которых Мёрфи гибнет, — но не видит тупиков, после которых
 * он жив и уровень уже не пройти. Тупики видны только перебору.
 *
 * Цена: перебор возможен не везде. Каждая клетка грунта удваивает пространство
 * состояний, поэтому большие земляные уровни он не берёт и честно об этом
 * говорит, а не выдаёт «решения нет». Поэтому это инструмент проектировщика,
 * а не часть npm test.
 *
 *   node tools/exact.js 142            кратчайшее решение и тупики
 *   node tools/exact.js 142 --plain    только решение, без дорогой резкости
 *   node tools/exact.js --file карта.txt
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var Engine = require(path.join(root, 'js', 'engine.js')).Engine;
var T = require(path.join(root, 'js', 'tiles.js')).Tiles;

var ACTS = [{ dir: -1 }, { dir: 0 }, { dir: 1 }, { dir: 2 }, { dir: 3 },
            { dir: 0, snap: 1 }, { dir: 1, snap: 1 }, { dir: 2, snap: 1 }, { dir: 3, snap: 1 }];
var LET = ['.', 'U', 'R', 'D', 'L', 'u', 'r', 'd', 'l'];

/*
 * Ключ состояния. Engine.key() не хранит ни номер такта, ни направления
 * монстров — для поиска это неверно: жук горит по фазе, а снипснак помнит,
 * куда шёл. Дописываем и то и другое, но только когда живность на карте
 * действительно есть, иначе перебор раздувается на пустом месте.
 */
function keyFor(state) {
  var live = false, bugs = false;
  for (var i = 0; i < state.tiles.length; i++) {
    var t = state.tiles[i];
    if (t === T.SNIKSNAK || t === T.ELECTRON) live = true;
    if (t === T.BUG) bugs = true;
  }
  if (!live && !bugs) return function (e) { return e.key(); };
  if (!live) return function (e) { return e.key() + '|' + (e.ticks % 12); };
  return function (e) {
    var s = e.key() + '|' + (e.ticks % 12);
    for (var j = 0; j < e.tiles.length; j++) {
      var t2 = e.tiles[j];
      if (t2 === T.SNIKSNAK || t2 === T.ELECTRON) s += ';' + j + ':' + e.dir[j];
    }
    return s;
  };
}

/**
 * Поиск в ширину из состояния. Возвращает { ok, moves, len } либо
 * { ok: false, exhausted } — где exhausted говорит, доискали ли до конца
 * (значит, решения правда нет) или упёрлись в потолок (значит, не знаем).
 */
function solveFrom(state, opts) {
  opts = opts || {};
  var cap = opts.nodes || 400000, maxLen = opts.depth || 200;
  // Потолок по времени нужен не меньше потолка по состояниям: земляной уровень
  // раздувается так быстро, что счёт узлов ещё мал, а машина уже стоит.
  var until = Date.now() + (opts.ms || 20000);
  var key = keyFor(state);
  var seen = Object.create(null);
  seen[key(state)] = 1;
  var queue = [{ e: state, from: -1, act: -1, depth: 0 }];
  for (var qi = 0; qi < queue.length; qi++) {
    if (queue.length >= cap) return { ok: false, exhausted: false, seen: queue.length };
    if ((qi & 1023) === 0 && Date.now() > until) return { ok: false, exhausted: false, seen: queue.length };
    var cur = queue[qi];
    if (cur.depth >= maxLen) continue;
    for (var a = 0; a < ACTS.length; a++) {
      var n = cur.e.clone();
      var st = n.step(ACTS[a]);
      if (st === 'dying' || st === 'dead') continue;
      if (st === 'won') {
        var out = [LET[a]], q = cur;
        while (q.from >= 0) { out.push(LET[q.act]); q = queue[q.from]; }
        return { ok: true, moves: out.reverse().join(''), len: out.length, seen: queue.length };
      }
      var k = key(n);
      if (seen[k]) continue;
      seen[k] = 1;
      queue.push({ e: n, from: qi, act: a, depth: cur.depth + 1 });
    }
  }
  return { ok: false, exhausted: true, seen: queue.length };
}

function solve(level, opts) { return solveFrom(new Engine(level), opts); }

function parseMoves(str) {
  return str.split('').filter(function (c) { return LET.indexOf(c) >= 0; })
            .map(function (c) { return ACTS[LET.indexOf(c)]; });
}

/** Сколько тактов сдвинулся ровно один герой: это и есть парковка. */
function parking(level, moves) {
  var e = new Engine(level), a = parseMoves(moves), n = 0, at = [];
  function snap() { return e.heroes.map(function (m) { return m.out ? 'x' : m.x + ',' + m.y; }); }
  for (var i = 0; i < a.length; i++) {
    var was = snap();
    e.step(a[i]);
    var now = snap(), moved = 0;
    for (var k = 0; k < was.length; k++) if (was[k] !== now[k] && now[k] !== 'x' && was[k] !== 'x') moved++;
    if (moved === 1 && e.heroes.every(function (m) { return !m.out; })) { n++; at.push(i); }
  }
  return { n: n, at: at };
}

/**
 * Резкость по перебору: на каждом такте эталона пробуем все прочие ходы и
 * смотрим, что вышло — гибель, тупик (жив, но уровень уже не пройти) или
 * ничего страшного. Неизвестность считается отдельно и не приписывается
 * к тупикам: соврать здесь хуже, чем промолчать.
 */
function deadEnds(level, moves, opts) {
  opts = opts || {};
  var e = new Engine(level), a = parseMoves(moves);
  var dead = 0, stuck = 0, unknown = 0, all = 0;
  for (var i = 0; i < a.length; i++) {
    for (var k = 0; k < ACTS.length; k++) {
      if (ACTS[k] === a[i]) continue;
      all++;
      var n = e.clone(), st = n.step(ACTS[k]);
      if (st === 'dying' || st === 'dead') { dead++; continue; }
      if (st === 'won') continue;
      var r = solveFrom(n, { depth: opts.depth || 120, nodes: opts.nodes || 80000, ms: opts.ms || 6000 });
      if (r.ok) continue;
      if (r.exhausted) stuck++; else unknown++;
    }
    e.step(a[i]);
  }
  return { dead: dead, stuck: stuck, unknown: unknown, all: all };
}

module.exports = { solve: solve, solveFrom: solveFrom, deadEnds: deadEnds,
                   parking: parking, parseMoves: parseMoves, ACTS: ACTS, LET: LET };

/* ---------- запуск из командной строки ---------- */
if (require.main === module) {
  var args = process.argv.slice(2);
  var plain = args.indexOf('--plain') >= 0;
  var fileAt = args.indexOf('--file');
  var level, label;
  if (fileAt >= 0) {
    var raw = fs.readFileSync(args[fileAt + 1], 'utf8').replace(/\r/g, '');
    var parts = raw.split(/^---\s*$/m);
    var meta = {};
    (parts.length > 1 ? parts[0] : '').split('\n').forEach(function (line) {
      var m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2];
    });
    var map = (parts.length > 1 ? parts.slice(1).join('---') : raw).split('\n');
    while (map.length && !map[0].trim()) map.shift();
    while (map.length && !map[map.length - 1].trim()) map.pop();
    var w = map.reduce(function (a2, r2) { return Math.max(a2, r2.length); }, 0);
    map = map.map(function (r2) { return r2 + ' '.repeat(w - r2.length); });
    level = { map: map, needed: meta.needed ? parseInt(meta.needed, 10) : undefined,
              gravity: /^(on|1|yes|да)$/i.test(meta.gravity || '') || undefined };
    label = meta.name || args[fileAt + 1];
  } else {
    var id = parseInt(args.filter(function (x) { return /^\d+$/.test(x); })[0], 10);
    var LEVELS = require(path.join(root, 'js', 'levels.js')).LEVELS;
    level = LEVELS.filter(function (l) { return l.id === id; })[0];
    if (!level) { console.error('нет уровня #' + id); process.exit(2); }
    label = '#' + level.id + ' ' + level.name;
  }

  var t0 = Date.now();
  var r = solve(level, { depth: 160, nodes: 400000, ms: 60000 });
  console.log(label);
  console.log(level.map.join('\n'));
  if (!r.ok) {
    console.log(r.exhausted
      ? 'решения НЕТ — перебор доискал до конца (' + r.seen + ' состояний)'
      : 'перебор не по зубам: упёрся в потолок на ' + r.seen + ' состояниях. ' +
        'Скорее всего слишком много грунта — каждая выеденная клетка удваивает счёт.');
    process.exit(r.exhausted ? 1 : 3);
  }
  console.log('кратчайшее: ' + r.len + ' тактов за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с  ' + r.moves);
  var pk = parking(level, r.moves);
  if (level.map.join('').indexOf('N') >= 0) {
    console.log('парковок: ' + pk.n + ' из ' + r.len + ' тактов' + (pk.n ? ' (на тактах ' + pk.at.join(',') + ')' : ''));
  }
  if (plain) return;
  var d = deadEnds(level, r.moves);
  var pc = function (n) { return (n * 100 / d.all).toFixed(0) + '%'; };
  console.log('отклонений проверено ' + d.all + ': убивают ' + pc(d.dead) +
              ', заводят в тупик ' + pc(d.stuck) +
              (d.unknown ? ', неизвестно ' + pc(d.unknown) : ''));
}
