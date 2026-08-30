#!/usr/bin/env node
'use strict';
/*
 * Пересчитывает мерку сложности для всех уровней в levels/difficulty.json.
 * Сама мерка живёт в tools/measure-lib.js — её же читает сторож в тестах.
 *
 *   node tools/measure.js            пересчитать всё
 *   node tools/measure.js 117 118    только показать эти, ничего не записывая
 */
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, 'measure-lib.js'));
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;

var only = process.argv.slice(2).filter(function (a) { return /^\d+$/.test(a); }).map(Number);
var out = {}, t0 = Date.now();
LEVELS.forEach(function (lv) {
  if (only.length && only.indexOf(lv.id) < 0) return;
  var m = M.measure(lv);
  if (!m) return;
  out[lv.id] = m;
  if (only.length) {
    console.log('#' + lv.id + ' ' + lv.name + ' — оценка ' + m.rating +
      ' · тактов ' + m.ticks + ' · крюк ' + m.detour + ' · опасность ' + m.lethal +
      ' · теснота ' + m.width + (m.greedy ? ' · жадный автопилот проходит' : ''));
  }
});
if (!only.length) {
  fs.writeFileSync(path.join(__dirname, '..', 'levels', 'difficulty.json'),
    '{\n' + Object.keys(out).sort(function (a, b) { return a - b; })
      .map(function (k) { return ' ' + JSON.stringify(k) + ': ' + JSON.stringify(out[k]); }).join(',\n') + '\n}\n');
  console.log('Измерено уровней: ' + Object.keys(out).length + ' за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с → levels/difficulty.json');
}
