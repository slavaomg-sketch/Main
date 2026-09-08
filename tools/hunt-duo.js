#!/usr/bin/env node
'use strict';
/*
 * Охотник за уровнями на двоих. Пять семейств — пять глав, у каждой своя
 * логика. Карты случайные, но маленькие и без грунта, поэтому проверка честная:
 * кратчайшее решение ищет полный перебор (tools/exact.js), а резкость меряется
 * по всем отклонениям от него.
 *
 *   node tools/hunt-duo.js <семейство> <попыток> <зерно> <куда.json>
 *
 * Семейства:
 *   chambers — две палаты, в каждой свой герой, клавиша общая;
 *   gravity  — ярусы под тяжестью: наверх не поднимается никто;
 *   bugs     — жуки в перемычке между двумя коридорами, часы общие;
 *   guards   — снипснак или электрон обходит кольцо коридоров;
 *   pillar   — напарник держит камень своим телом, первое «вниз» его роняет.
 *
 * Результат — JSON со всеми найденными кандидатами и их мерками; отбор в главу
 * делает tools/pick-duo.js.
 */
var fs = require('fs');
var path = require('path');
var X = require(path.join(__dirname, 'exact.js'));

var family = process.argv[2];
var TRIES = +(process.argv[3] || 200);
var SEED = +(process.argv[4] || 1);
var OUT = process.argv[5];
if (!family || !OUT) { console.error('нужно: семейство попыток зерно куда.json'); process.exit(2); }

var seed = SEED;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

function grid(w, h, fill) {
  var g = [];
  for (var y = 0; y < h; y++) { var r = []; for (var x = 0; x < w; x++) r.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : fill); g.push(r); }
  return g;
}
function reach(g, sx, sy, pass) {
  var W = g[0].length, H = g.length, seen = {}, q = [[sx, sy]];
  seen[sx + ',' + sy] = 1;
  for (var i = 0; i < q.length; i++) {
    var p = q[i];
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (d) {
      var nx = p[0] + d[0], ny = p[1] + d[1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
      if (!pass(g[ny][nx])) return;
      var k = nx + ',' + ny;
      if (seen[k]) return;
      seen[k] = 1; q.push([nx, ny]);
    });
  }
  return seen;
}
function open(c) { return c !== '#' && c !== 'O'; }
function cells(g, test) {
  var out = [];
  for (var y = 1; y < g.length - 1; y++) for (var x = 1; x < g[0].length - 1; x++) if (test(g[y][x], x, y)) out.push([x, y]);
  return out;
}
function take(arr) { return arr.splice(Math.floor(rnd() * arr.length), 1)[0]; }
function done(g, extra) {
  var lv = { map: g.map(function (r) { return r.join(''); }) };
  var loot = lv.map.join('').split('*').length - 1;
  lv.needed = loot;
  if (extra) Object.keys(extra).forEach(function (k) { lv[k] = extra[k]; });
  return lv;
}

/* ---------- семейства ---------- */

var GEN = {};

// Две палаты: у каждого героя свой лабиринт, внизу общий коридор с выходом.
GEN.chambers = function () {
  var cw = ri(4, 6), chh = ri(4, 5), W = 2 * cw + 3, H = chh + 4;
  var g = grid(W, H, '#');
  var A = [1, cw], B = [cw + 2, 2 * cw + 1];
  for (var y = 1; y <= chh; y++) for (var x = 1; x < W - 1; x++) if (x !== cw + 1) g[y][x] = ' ';
  for (var x2 = 1; x2 < W - 1; x2++) g[H - 2][x2] = ' ';
  var ga = ri(A[0], A[1]), gb = ri(B[0], B[1]);
  g[chh + 1][ga] = ' '; g[chh + 1][gb] = ' ';
  var p = 0.2 + rnd() * 0.15;
  for (var y2 = 1; y2 <= chh; y2++) for (var x3 = 1; x3 < W - 1; x3++) if (g[y2][x3] === ' ' && rnd() < p) g[y2][x3] = '#';
  var ra = reach(g, ga, chh + 1, open), rb = reach(g, gb, chh + 1, open);
  var ca = cells(g, function (c, x, y) { return c === ' ' && y <= chh && x <= A[1] && ra[x + ',' + y]; });
  var cb = cells(g, function (c, x, y) { return c === ' ' && y <= chh && x >= B[0] && rb[x + ',' + y]; });
  var la = ri(1, 2), lb = ri(1, 2);
  if (ca.length < la + 2 || cb.length < lb + 2) return null;
  var m = take(ca), n = take(cb);
  g[m[1]][m[0]] = 'M'; g[n[1]][n[0]] = 'N';
  for (var k = 0; k < la; k++) { var a = take(ca); g[a[1]][a[0]] = '*'; }
  for (var k2 = 0; k2 < lb; k2++) { var b = take(cb); g[b[1]][b[0]] = '*'; }
  g[H - 2][ri(2, W - 3)] = 'E';
  return done(g);
};

// Ярусы под тяжестью.
GEN.gravity = function () {
  var tiers = ri(3, 5), W = ri(12, 20), H = 2 * tiers + 2;
  var g = grid(W, H, ' ');
  for (var t = 1; t < tiers; t++) {
    var y = 2 * t;
    for (var x = 1; x < W - 1; x++) g[y][x] = '#';
    var holes = ri(2, 3);
    for (var k = 0; k < holes; k++) { var hx = ri(1, W - 2); g[y][hx] = ' '; if (rnd() < 0.5 && hx + 1 < W - 1) g[y][hx + 1] = ' '; }
  }
  // случайные тумбы на ярусах — заставляют выбирать сторону
  for (var t2 = 0; t2 < tiers; t2++) for (var x2 = 1; x2 < W - 1; x2++) if (rnd() < 0.08) g[2 * t2 + 1][x2] = '#';
  var top = cells(g, function (c, x, y) { return c === ' ' && y === 1; });
  if (top.length < 4) return null;
  var m = take(top), n = take(top);
  g[m[1]][m[0]] = 'M'; g[n[1]][n[0]] = 'N';
  var loot = 0;
  for (var t3 = 1; t3 < tiers; t3++) {
    var cnt = ri(1, 2), row = cells(g, function (c, x, y) { return c === ' ' && y === 2 * t3 + 1; });
    for (var k2 = 0; k2 < cnt && row.length; k2++) { var c2 = take(row); g[c2[1]][c2[0]] = '*'; loot++; }
  }
  if (loot < 2) return null;
  var bottom = cells(g, function (c, x, y) { return c === ' ' && y === H - 2; });
  if (!bottom.length) return null;
  var e = take(bottom); g[e[1]][e[0]] = 'E';
  return done(g, { gravity: true });
};

// Жуки в перемычке.
GEN.bugs = function () {
  var W = ri(13, 19), PH = 'B123456789';
  var g = grid(W, 5, ' ');
  for (var x = 1; x < W - 1; x++) g[2][x] = rnd() < 0.62 ? PH[Math.floor(rnd() * 10)] : '#';
  g[1][1] = 'M'; g[3][1] = 'N';
  g[2][W - 3 - ri(0, 2)] = ' ';
  if (rnd() < 0.3) g[2][ri(3, 6)] = ' ';
  var cnt = ri(2, 4), placed = 0;
  for (var k = 0; k < cnt; k++) { var lx = ri(2, W - 4), row = rnd() < 0.5 ? 1 : 3; if (g[row][lx] === ' ') { g[row][lx] = '*'; placed++; } }
  if (placed < 2) return null;
  g[rnd() < 0.5 ? 1 : 3][W - 2] = 'E';
  return done(g);
};

// Сторож на кольце: два-три коридора, перемычки, монстр.
GEN.guards = function () {
  var W = ri(11, 15), rows = rnd() < 0.15 ? 3 : 2, H = 2 * rows + 1;
  var g = grid(W, H, '#');
  for (var r = 0; r < rows; r++) for (var x = 1; x < W - 1; x++) g[2 * r + 1][x] = ' ';
  for (var r2 = 1; r2 < rows; r2++) {
    var n = ri(2, 4);
    for (var k = 0; k < n; k++) g[2 * r2][ri(1, W - 2)] = ' ';
    g[2 * r2][1] = ' ';
  }
  g[1][1] = 'M'; g[H - 2][1] = 'N';
  var mon = rnd() < 0.7 ? 'S' : 'e';
  g[2 * ri(0, rows - 1) + 1][ri(5, W - 3)] = mon;
  var cnt = ri(2, 5), placed = 0;
  for (var k2 = 0; k2 < cnt; k2++) { var x2 = ri(3, W - 3), y2 = 2 * ri(0, rows - 1) + 1; if (g[y2][x2] === ' ') { g[y2][x2] = '*'; placed++; } }
  if (placed < 2) return null;
  g[2 * ri(0, rows - 1) + 1][W - 2] = 'E';
  return done(g);
};

// Подпорка: справа шахта с камнем на напарнике, слева лабиринт Мёрфи.
GEN.pillar = function () {
  var lw = ri(8, 11), depth = ri(4, 6), H = depth + 4, W = lw + 4;
  var g = grid(W, H, ' ');
  var sx = W - 2;                              // колонка шахты
  for (var y = 1; y < H - 1; y++) g[y][sx - 1] = '#';
  g[1][sx] = 'O'; g[2][sx] = 'N';
  for (var y2 = 3; y2 < H - 1; y2++) g[y2][sx] = ' ';
  g[H - 2][sx - 1] = ' ';                     // выход из шахты вбок, у самого дна
  // левая часть: случайные стены, но нижний коридор общий
  for (var y3 = 1; y3 < H - 2; y3++) for (var x = 1; x < sx - 1; x++) if (rnd() < 0.38) g[y3][x] = '#';
  for (var x2 = 1; x2 < sx - 1; x2++) g[H - 2][x2] = ' ';
  var left = cells(g, function (c, x, y) { return c === ' ' && x < sx - 1 && y < H - 2; });
  if (left.length < 5) return null;
  var m = take(left); g[m[1]][m[0]] = 'M';
  var rm = reach(g, m[0], m[1], open);
  left = left.filter(function (c) { return rm[c[0] + ',' + c[1]]; });
  var cnt = ri(2, 3);
  if (left.length < cnt + 1) return null;
  for (var k = 0; k < cnt; k++) { var c2 = take(left); g[c2[1]][c2[0]] = '*'; }
  g[H - 2][ri(1, 4)] = 'E';
  return done(g);
};

var MIN = { chambers: [18, 4], gravity: [16, 4], bugs: [14, 2], guards: [14, 2], pillar: [15, 3] };
// Бюджет перебора по семействам: живность и камни раздувают ключ состояния.
var BUDGET = { chambers: [150000, 8000], gravity: [60000, 4000], bugs: [120000, 6000], guards: [250000, 15000], pillar: [150000, 10000] };

/* ---------- охота ---------- */
var gen = GEN[family];
if (!gen) { console.error('нет семейства ' + family); process.exit(2); }
var found = [], seenMaps = {};
var t0 = Date.now();
for (var i = 0; i < TRIES; i++) {
  var lv = gen();
  if (!lv) { if (process.env.DEBUG) console.log('  пусто'); continue; }
  var key = lv.map.join('\n');
  if (seenMaps[key]) continue;
  seenMaps[key] = 1;
  if (lv.map.join('').indexOf('E') < 0) continue;
  var r;
  var ts = Date.now();
  try { r = X.solve(lv, { depth: 90, nodes: BUDGET[family][0], ms: BUDGET[family][1] }); } catch (e) { continue; }
  if (process.env.DEBUG) console.log('  перебор ' + ((Date.now() - ts) / 1000).toFixed(1) + ' с');
  if (!r.ok || r.len < MIN[family][0]) { if (process.env.DEBUG) console.log('  ' + (r.ok ? 'коротко ' + r.len : (r.exhausted ? 'нет решения' : 'потолок')) + ' · ' + r.seen + ' сост.'); continue; }
  var pk = X.parking(lv, r.moves);
  if (pk.n < MIN[family][1]) { if (process.env.DEBUG) console.log('  мало парковок ' + pk.n); continue; }
  var heavy = family === 'guards' || family === 'pillar';       // живность и камни: ключ тяжёлый, бюджет меньше
  var loose = heavy || family === 'chambers';                    // где перебор отклонений часто не добирается до ответа
  var d = X.deadEnds(lv, r.moves, heavy
    ? { depth: 90, nodes: 4000, ms: 120, stride: Math.max(1, Math.ceil(r.len / 12)) }
    : { depth: 90, nodes: 12000, ms: 350, stride: Math.max(1, Math.ceil(r.len / 20)) });
  if (d.unknown > d.all * (loose ? 0.6 : 0.1)) { if (process.env.DEBUG) console.log('  неизвестно ' + d.unknown + '/' + d.all); continue; }
  var cand = { map: lv.map, needed: lv.needed, gravity: lv.gravity || undefined, moves: r.moves, len: r.len,
               park: pk.n, changes: X.changes(r.moves), dead: +(d.dead / d.all).toFixed(3),
               stuck: +(d.stuck / d.all).toFixed(3), seen: r.seen,
               w: lv.map[0].length, h: lv.map.length };
  found.push(cand);
  fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
  console.log('[' + family + '] ' + found.length + ': ' + cand.len + ' тактов, парковок ' + cand.park +
              ', гибель ' + Math.round(cand.dead * 100) + '%, тупик ' + Math.round(cand.stuck * 100) + '% (' + i + '/' + TRIES + ')');
}
console.log('[' + family + '] найдено ' + found.length + ' за ' + Math.round((Date.now() - t0) / 60000) + ' мин → ' + OUT);
