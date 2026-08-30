#!/usr/bin/env node
'use strict';
/*
 * Мерка сложности: считается по записанному решению и работает на любом
 * уровне, без всяких точных решателей.
 *
 *   длина    — сколько тактов занимает эталонное решение;
 *   крюк     — во сколько раз путь длиннее прямой дороги от входа к выходу;
 *   опасность— доля одиночных отклонений, после которых Мёрфи гибнет,
 *              если дальше продолжать по плану;
 *   теснота  — сколько в среднем ходов на такте не убивают на месте;
 *   жадность — берёт ли уровень жадный автопилот.
 *
 * Чего мерка НЕ ловит: глубины одной догадки. Толкательный уровень может быть
 * очень трудным и совершенно безопасным, поэтому опасность и теснота идут в
 * оценку не одни, а вместе с длиной и крюком, а безопасный уровень, на котором
 * буксует жадный автопилот, получает надбавку за замысел.
 */
var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, 'lib.js'));
var solutions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'solutions.json'), 'utf8'));

var HORIZON = 24;          // сколько тактов смотрим вперёд после отклонения
var AUTOPILOT_LIMIT = 6000;

/* Прямая дорога от входа к выходу по клеткам, которые в принципе проходимы. */
function straight(lv) {
  var map = lv.map, h = map.length, w = 0;
  map.forEach(function (r) { w = Math.max(w, r.length); });
  function at(x, y) { return (map[y] || '')[x] || ' '; }
  var from = null, to = null;
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    if (at(x, y) === 'M') from = [x, y];
    if (at(x, y) === 'E') to = [x, y];
  }
  if (!from || !to) return Math.max(w, h);
  var HARD = { '#': 1, '=': 1, 'B': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1 };
  var dist = {}, q = [from];
  dist[from[1] * w + from[0]] = 0;
  for (var i = 0; i < q.length; i++) {
    var c = q[i], d = dist[c[1] * w + c[0]];
    if (c[0] === to[0] && c[1] === to[1]) return Math.max(1, d);
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (s) {
      var nx = c[0] + s[0], ny = c[1] + s[1], k = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      if (dist[k] !== undefined) return;
      var ch = at(nx, ny);
      if (HARD[ch] && !(nx === to[0] && ny === to[1])) return;
      dist[k] = d + 1;
      q.push([nx, ny]);
    });
  }
  return Math.max(1, Math.round((w + h) / 2));
}

/* Опасность и теснота: пробуем на каждом такте все другие ходы. */
function probe(lv, acts) {
  var e = new lib.Engine(lv);
  var states = [e.clone()];
  for (var i = 0; i < acts.length; i++) {
    var st = e.step(acts[i]);
    states.push(e.clone());
    if (st === 'won' || st === 'dead') { acts = acts.slice(0, i + 1); break; }
  }
  var tried = 0, killed = 0, alive = 0, ticks = 0;
  var ALL = [{ dir: -1, snap: false }];
  for (var d = 0; d < 4; d++) { ALL.push({ dir: d, snap: false }); ALL.push({ dir: d, snap: true }); }

  for (var t = 0; t < acts.length; t++) {
    ticks++;
    var base = states[t];
    var here = 0, safe = 0;
    for (var a = 0; a < ALL.length; a++) {
      var act = ALL[a];
      if (act.dir === acts[t].dir && !!act.snap === !!acts[t].snap) continue;
      var probeE = base.clone();
      var before = probeE.key();
      probeE.step(act);
      if (probeE.key() === before) continue;             // ход невозможен — не считаем
      here++;
      var dead = probeE.status === 'dead' || probeE.status === 'dying';
      for (var k = 1; k <= HORIZON && !dead && probeE.status === 'playing'; k++) {
        var nxt = acts[t + k];
        probeE.step(nxt || { dir: -1, snap: false });
        if (probeE.status === 'dead' || probeE.status === 'dying') dead = true;
      }
      if (dead) killed++; else safe++;
    }
    tried += here;
    alive += safe;
  }
  return { tried: tried, killed: killed, width: ticks ? alive / ticks : 0, ticks: ticks };
}

/*
 * Оценка 1..10 складывается из трёх разных по природе вещей, и их не стоит
 * путать.
 *
 * ИЗМЕРЕНО: опасность и теснота — их мерка видит прямо и без искажений.
 *   Длина берётся с малым весом, потому что часть эталонных решений записана
 *   автопилотом, а он петляет; крюк по той же причине в оценку не идёт вовсе
 *   и остаётся справочным числом.
 * ОБЪЯВЛЕНО: односторонние порты и заряды с терминалом. Это не измерение,
 *   а признание устройства: там, где ход только в одну сторону или где надо
 *   выложить заряд и лишь потом нажать, ошибиться порядком можно всегда.
 * ВЫВЕДЕНО: надбавка «за замысел» безопасному уровню, на котором буксует
 *   жадный автопилот. Она не даётся уровням на зарядах — там автопилот
 *   бессилен не от глубины, а оттого, что попросту не умеет их брать.
 *
 * Чего мерка не умеет и уметь не может: заглянуть в глубину одной догадки.
 * Поэтому рядом с оценкой всегда идёт строка «почему» — она честнее числа.
 */
function hasPorts(lv) { return /[\^v<>]/.test(lv.map.join('')); }
function hasCharges(lv) { return /[RYT]/.test(lv.map.join('')); }

function rate(m, lv) {
  var s = 1, why = [];
  var d = m.lethal < 0.02 ? 0 : m.lethal < 0.10 ? 1 : m.lethal < 0.25 ? 2 : m.lethal < 0.45 ? 3 : 4;
  s += d;
  if (d >= 3) why.push('гибель на каждом шагу');
  else if (d >= 1) why.push('есть где погибнуть');

  var w = m.width > 4 ? 0 : m.width > 3 ? 1 : m.width > 2 ? 2 : 3;
  s += w;
  if (w >= 2) why.push('ходов на такте почти нет');

  var t = m.ticks < 100 ? 0 : m.ticks < 220 ? 1 : 2;
  s += t;
  if (t >= 2) why.push('длинный');

  if (hasPorts(lv)) { s += 1; why.push('дорога в один конец'); }
  if (hasCharges(lv)) { s += 1; why.push('на зарядах и терминале'); }
  if (!m.greedy && m.lethal < 0.1 && !hasCharges(lv)) { s += 3; why.push('берётся только расчётом'); }
  if (m.greedy) { s -= 2; why.push('проходится и напролом'); }

  m.why = why.join(', ') || 'спокойный';
  return Math.max(1, Math.min(10, s));
}

function measure(lv, opts) {
  var moves = solutions[String(lv.id)];
  if (!moves) return null;
  var acts = lib.parseMoves(moves);
  var p = probe(lv, acts);
  var e = new lib.Engine(lv);
  acts.forEach(function (a) { if (e.status === 'playing') e.step(a); });
  var waits = acts.filter(function (a) { return a.dir < 0; }).length;
  var greedy = opts && opts.skipGreedy ? false : lib.autopilot(lv, { limit: AUTOPILOT_LIMIT }).ok;
  var m = {
    ticks: p.ticks,
    moves: e.moves,
    waits: waits,
    detour: +(p.ticks / straight(lv)).toFixed(2),
    lethal: p.tried ? +(p.killed / p.tried).toFixed(3) : 0,
    width: +p.width.toFixed(2),
    greedy: greedy
  };
  m.rating = rate(m, lv);
  return m;
}


module.exports = { measure: measure, rate: rate, straight: straight };
