#!/usr/bin/env node
'use strict';
/*
 * Приём уровней от внешней модели (формат из docs/prompt-for-level-author.md).
 *
 *   node tools/import-levels.js levels.json          — проверить и показать вердикт
 *   node tools/import-levels.js levels.json --write   — записать прошедшие проверку в levels/
 *
 * Проверяем всё, во что модель обычно промахивается: рваная сетка, парящие в воздухе
 * зонки, монстр в грунте, недостижимые инфотроны, и главное — существует ли решение.
 */
var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, 'lib.js'));
var base = require(path.join(__dirname, '..', 'js', 'tiles.js'));
var T = base.Tiles, CHARS = base.CHARS;

var args = process.argv.slice(2);
var file = args[0];
var write = args.indexOf('--write') >= 0;
if (!file) { console.error('нужен путь к json'); process.exit(1); }

var data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(data)) data = [data];

var okCount = 0, bad = 0;
data.forEach(function (lv) {
  var label = '#' + (lv.id || '?') + ' ' + (lv.name || 'без имени');
  var problems = [];

  var map = lv.map || [];
  if (!map.length) problems.push('нет карты');
  var w = map.reduce(function (a, r) { return Math.max(a, r.length); }, 0);
  map = map.map(function (r) { return r + ' '.repeat(w - r.length); });
  var ragged = (lv.map || []).filter(function (r) { return r.length !== w; }).length;
  if (ragged) problems.push(ragged + ' строк(и) не той длины (ожидалось ' + w + ') — сетку надо выровнять');

  var joined = map.join('');
  var unknown = {};
  joined.split('').forEach(function (c) { if (CHARS[c] === undefined) unknown[c] = 1; });
  if (Object.keys(unknown).length) problems.push('неизвестные символы: ' + Object.keys(unknown).join(' '));
  var count = function (c) { return joined.split(c).length - 1; };
  if (count('M') !== 1) problems.push('Мёрфи должен быть ровно один (найдено ' + count('M') + ')');
  if (!count('E')) problems.push('нет шлюза');

  var info = count('*');
  var needed = lv.needed === undefined ? info : lv.needed;
  if (needed > info && !count('e')) problems.push('нужно ' + needed + ' инфотронов, а на карте ' + info + ' и нет электронов');

  // мягкие замечания по плотности
  var notes = [];
  if (w < 40 || map.length < 20) notes.push('мелковат: ' + w + 'x' + map.length + ', в оригинале не меньше 40x20');
  if (info < 20) notes.push('мало инфотронов: ' + info);
  if (count('O') < 25) notes.push('мало зонков: ' + count('O'));

  // монстр, замурованный в грунте, стоять будет вечно
  var idle = 0;
  for (var y = 0; y < map.length; y++) {
    for (var x = 0; x < w; x++) {
      var c = map[y][x];
      if (c !== 'S' && c !== 'e') continue;
      var free = [[0,-1],[1,0],[0,1],[-1,0]].some(function (d) {
        var ny = y + d[1], nx = x + d[0];
        return ny >= 0 && nx >= 0 && ny < map.length && nx < w && map[ny][nx] === ' ';
      });
      if (!free) idle++;
    }
  }
  if (idle) notes.push(idle + ' монстр(ов) стоят в грунте и не двигаются');

  if (problems.length) {
    console.log('ОТКАЗ ' + label + ': ' + problems.join('; '));
    bad++;
    return;
  }

  var level = { id: lv.id, name: lv.name, hint: lv.hint || '', needed: needed, map: map };
  var verdict, solution = null;
  if (lv.solution) {
    var r = lib.replay(level, lv.solution);
    if (r.ok) { verdict = 'решение автора проходит (' + r.steps + ' тиков)'; solution = lv.solution; }
    else verdict = 'решение автора НЕ проходит (' + r.reason + ')';
  }
  if (!solution) {
    var a = lib.autopilot(level, { limit: 6000 });
    if (a.ok) { verdict = (verdict ? verdict + '; ' : '') + 'автопилот прошёл за ' + a.steps + ' тиков'; solution = a.moves; }
    else verdict = (verdict ? verdict + '; ' : '') + 'автопилот не прошёл (' + a.reason + ') — нужно ручное решение';
  }

  if (!solution) {
    console.log('ОТКАЗ ' + label + ': ' + verdict);
    bad++;
    return;
  }

  console.log('ОК    ' + label + ' — ' + verdict + (notes.length ? '\n      замечания: ' + notes.join('; ') : ''));
  okCount++;

  if (write) {
    if (!lv.id) { console.log('      (не записан: нет id)'); return; }
    var name = String(lv.id).padStart(3, '0') + '.txt';
    fs.writeFileSync(path.join(__dirname, '..', 'levels', name),
      'name: ' + (lv.name || 'Без имени') + '\n' +
      (needed !== info ? 'needed: ' + needed + '\n' : '') +
      'hint: ' + (lv.hint || '') + '\n---\n' + map.join('\n') + '\n');
    var solPath = path.join(__dirname, '..', 'levels', 'solutions.json');
    var sols = fs.existsSync(solPath) ? JSON.parse(fs.readFileSync(solPath, 'utf8')) : {};
    sols[String(lv.id)] = solution;
    fs.writeFileSync(solPath, JSON.stringify(sols, null, 2) + '\n');
    console.log('      → levels/' + name);
  }
});

console.log('Принято ' + okCount + ', отклонено ' + bad +
  (write ? '. Не забудь: npm run levels && npm test' : '. Запусти с --write, чтобы записать.'));
