'use strict';
/*
 * Оснастка для сборки уровня по чертежу: точное ядро головоломки ставится штампом,
 * а вокруг машинально набивается плотная выработка. Так геометрия загадки остаётся
 * ровно такой, как задумано, а норма плотности выполняется без ручного труда.
 */
function field(w, h) {
  var g = [];
  for (var y = 0; y < h; y++) {
    var row = [];
    for (var x = 0; x < w; x++) row.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.');
    g.push(row);
  }
  return g;
}
/** Штамп: символ '~' означает «не трогать». */
function stamp(g, x0, y0, lines) {
  lines.forEach(function (line, dy) {
    for (var dx = 0; dx < line.length; dx++) {
      var c = line[dx];
      if (c === '~') continue;
      var y = y0 + dy, x = x0 + dx;
      if (g[y] && g[y][x] !== undefined) g[y][x] = c;
    }
  });
}
function rect(g, x0, y0, x1, y1, ch) {
  for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (g[y] && g[y][x] !== undefined) g[y][x] = ch;
}
function rng(seed) {
  var s = seed;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
/**
 * Набивка: в нетронутый грунт добавляем зонки рядами и инфотроны.
 * keepOut — список [x0,y0,x1,y1], куда не лезть (ядро головоломки).
 */
function scatter(g, seed, opts) {
  opts = opts || {};
  var rnd = rng(seed);
  var keep = opts.keepOut || [];
  var inKeep = function (x, y) {
    return keep.some(function (r) { return x >= r[0] - 1 && x <= r[2] + 1 && y >= r[1] - 1 && y <= r[3] + 1; });
  };
  var h = g.length, w = g[0].length;
  var zonks = 0, infos = 0;
  for (var y = 2; y < h - 2; y++) {
    for (var x = 2; x < w - 2; x++) {
      if (g[y][x] !== '.' || inKeep(x, y)) continue;
      var under = g[y + 1] && g[y + 1][x];
      if (under === ' ') continue;                               // не вешаем над пустотой
      var r = rnd();
      // камень кладём только на грунт: лежащий на стене съезжает с её края,
      // стоит рядом копнуть, и заваливает залы непредсказуемо
      if (r < (opts.zonk === undefined ? 0.16 : opts.zonk) && y % 2 === 1 && under === '.') { g[y][x] = 'O'; zonks++; }
      else if (r > 0.93) { g[y][x] = '*'; infos++; }
    }
  }
  return { zonks: zonks, infotrons: infos };
}
function pillars(g, x0, y0, x1, y1, step) {
  for (var x = x0; x <= x1; x += (step || 3)) for (var y = y0; y <= y1; y += 2) if (g[y] && g[y][x] === '.') g[y][x] = '#';
}
/**
 * Расчищает пятачок вокруг клетки, засыпая его грунтом: грунт не катится и
 * не даёт катиться другим, поэтому выход не запечатает раскатившимися камнями.
 */
function clearAround(g, cx, cy, rx, ry) {
  for (var y = cy - (ry || 1); y <= cy + (ry || 1); y++) {
    for (var x = cx - (rx || 2); x <= cx + (rx || 2); x++) {
      if (!g[y] || g[y][x] === undefined) continue;
      if (g[y][x] === 'O' || g[y][x] === '#') g[y][x] = '.';
    }
  }
}

function toMap(g) { return g.map(function (r) { return r.join(''); }); }
function count(map, c) { return map.join('').split(c).length - 1; }

module.exports = { field: field, stamp: stamp, rect: rect, rng: rng, scatter: scatter, pillars: pillars, clearAround: clearAround, toMap: toMap, count: count };
