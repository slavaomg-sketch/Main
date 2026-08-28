#!/usr/bin/env node
'use strict';
/*
 * Генератор «выработки» — плотного уровня в духе оригинального Supaplex:
 * сетка залов, разделённых стенами с узкими проходами, залы забиты грунтом,
 * зонками и инфотронами. Карта генерируется, автопилот доказывает проходимость,
 * фильтры отсеивают короткое и пустое. Готовую карту кладём в levels/ как обычные данные.
 *
 *   node tools/gen-mine.js <файл> [--seed N] [--w 44] [--h 22] [--min-ticks 400] [--min-info 20]
 */
var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, 'lib.js'));

var args = process.argv.slice(2);
var outFile = args[0];
var opt = function (name, dflt) {
  var i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
var W = opt('w', 44), H = opt('h', 22);
var MIN_TICKS = opt('min-ticks', 400), MIN_INFO = opt('min-info', 20);
var SEED0 = opt('seed', 1);

function build(seed) {
  var s = seed;
  var rnd = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  var pick = function (a) { return a[Math.floor(rnd() * a.length) % a.length]; };

  var g = [];
  for (var y = 0; y < H; y++) g.push(new Array(W).fill('.'));
  var set = function (x, y, c) { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) g[y][x] = c; };

  for (var x = 0; x < W; x++) { g[0][x] = '#'; g[H - 1][x] = '#'; }
  for (y = 0; y < H; y++) { g[y][0] = '#'; g[y][W - 1] = '#'; }

  // сетка залов
  var vx = [], hy = [];
  var cols = Math.max(2, Math.round((W - 2) / 11));
  var rows = Math.max(2, Math.round((H - 2) / 7));
  for (var i = 1; i < cols; i++) vx.push(Math.round(i * (W - 1) / cols));
  for (i = 1; i < rows; i++) hy.push(Math.round(i * (H - 1) / rows));
  vx.forEach(function (X) { for (var yy = 1; yy < H - 1; yy++) g[yy][X] = '#'; });
  hy.forEach(function (Y) { for (var xx = 1; xx < W - 1; xx++) g[Y][xx] = '#'; });

  // проходы: по одному-два на каждую перегородку между соседними залами
  var bounds = function (list, max) {
    var b = [0].concat(list, [max]);
    var seg = [];
    for (var k = 0; k < b.length - 1; k++) seg.push([b[k] + 1, b[k + 1] - 1]);
    return seg;
  };
  var colSeg = bounds(vx, W - 1), rowSeg = bounds(hy, H - 1);
  vx.forEach(function (X) {
    rowSeg.forEach(function (r) {
      var n = 1 + (rnd() < 0.35 ? 1 : 0);
      for (var k = 0; k < n; k++) g[r[0] + Math.floor(rnd() * (r[1] - r[0] + 1))][X] = '.';
    });
  });
  hy.forEach(function (Y) {
    colSeg.forEach(function (c) {
      var n = 1 + (rnd() < 0.35 ? 1 : 0);
      for (var k = 0; k < n; k++) g[Y][c[0] + Math.floor(rnd() * (c[1] - c[0] + 1))] = '.';
    });
  });

  // начинка залов
  var rooms = [];
  rowSeg.forEach(function (r) { colSeg.forEach(function (c) { rooms.push({ x0: c[0], x1: c[1], y0: r[0], y1: r[1] }); }); });

  rooms.forEach(function (R, idx) {
    var kind = pick(['zonks', 'zonks', 'niches', 'pillars', 'stacks', 'plain']);
    var w = R.x1 - R.x0 + 1, h = R.y1 - R.y0 + 1;
    if (kind === 'zonks') {                       // ряды зонков поперёк зала
      for (var yy = R.y0 + 1; yy <= R.y1 - 1; yy += 2) {
        for (var xx = R.x0; xx <= R.x1; xx++) if (rnd() < 0.45) set(xx, yy, 'O');
      }
    } else if (kind === 'niches') {               // ниши: инфотрон под зонком
      for (var k = 0; k < Math.floor(w / 3); k++) {
        var nx = R.x0 + 1 + Math.floor(rnd() * (w - 2));
        var ny = R.y0 + 1 + Math.floor(rnd() * (h - 3));
        set(nx - 1, ny, '#'); set(nx + 1, ny, '#');
        set(nx - 1, ny + 1, '#'); set(nx + 1, ny + 1, '#');
        set(nx, ny, 'O'); set(nx, ny + 1, '.'); set(nx, ny + 2, '*');
      }
    } else if (kind === 'pillars') {              // колонны и зонки на них
      for (var px = R.x0 + 1; px <= R.x1 - 1; px += 3) {
        for (var py = R.y0 + 1; py <= R.y1 - 1; py += 2) { set(px, py, '#'); set(px, py - 1, 'O'); }
      }
    } else if (kind === 'stacks') {               // штабеля зонков
      for (var sx = R.x0 + 1; sx <= R.x1 - 1; sx += 2) {
        if (rnd() < 0.6) for (var sy = R.y0; sy < R.y0 + 2 + Math.floor(rnd() * 3); sy++) set(sx, sy, 'O');
      }
    }
    // инфотроны в каждый зал
    var want = 2 + Math.floor(rnd() * 3);
    for (var t = 0; t < want * 4 && want > 0; t++) {
      var ix = R.x0 + Math.floor(rnd() * w), iy = R.y0 + Math.floor(rnd() * h);
      if (g[iy][ix] === '.') { g[iy][ix] = '*'; want--; }
    }
    R.kind = kind;
  });

  // Мёрфи в первом зале, выход в последнем
  var first = rooms[0], lastR = rooms[rooms.length - 1];
  for (var yy2 = first.y0; yy2 <= first.y1; yy2++) for (var xx2 = first.x0; xx2 <= first.x1; xx2++) g[yy2][xx2] = '.';
  g[first.y0][first.x0] = 'M';
  g[lastR.y1][lastR.x1] = 'E';
  g[lastR.y1][lastR.x1 - 1] = '.';
  g[lastR.y1 - 1][lastR.x1] = '.';

  return g.map(function (r) { return r.join(''); });
}

var found = null;
for (var seed = SEED0; seed < SEED0 + 400 && !found; seed++) {
  var map = build(seed * 7919 + 13);
  var info = map.join('').split('*').length - 1;
  if (info < MIN_INFO) continue;
  var lv = { id: 0, name: 'x', needed: info, map: map };
  var a = lib.autopilot(lv, { limit: 6000 });
  if (!a.ok || a.steps < MIN_TICKS) continue;
  found = { map: map, info: info, seed: seed, steps: a.steps, moves: a.moves };
}

if (!found) { console.error('не нашёл подходящей карты — ослабь фильтры'); process.exit(1); }
console.log('seed #' + found.seed + ' · ' + W + 'x' + H + ' · инфотронов ' + found.info +
            ' · автопилот за ' + found.steps + ' тиков');
console.log(found.map.join('\n'));
if (outFile) {
  fs.writeFileSync(outFile, found.map.join('\n') + '\n');
  fs.writeFileSync(outFile.replace(/\.[^.]+$/, '') + '.moves.txt', found.moves + '\n');
  console.log('карта → ' + outFile);
}
