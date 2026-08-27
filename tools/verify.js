#!/usr/bin/env node
'use strict';
/*
 * Проверка уровней: у каждого должно существовать реальное решение.
 * Если в levels/solutions.json есть записанное решение — проигрываем его.
 * Иначе пробуем автопилот и, если он справился, печатаем найденное решение.
 *
 *   node tools/verify.js            все уровни
 *   node tools/verify.js 7          только уровень 7
 *   node tools/verify.js 7 --save   и записать найденное решение в solutions.json
 */
var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, 'lib.js'));
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;

var solPath = path.join(__dirname, '..', 'levels', 'solutions.json');
var solutions = fs.existsSync(solPath) ? JSON.parse(fs.readFileSync(solPath, 'utf8')) : {};

var args = process.argv.slice(2);
var save = args.indexOf('--save') >= 0;
var only = args.filter(function (a) { return /^\d+$/.test(a); }).map(Number);

var fails = 0, checked = 0;
LEVELS.forEach(function (lv) {
  if (only.length && only.indexOf(lv.id) < 0) return;
  checked++;
  var label = '#' + lv.id + ' ' + lv.name;
  var recorded = solutions[String(lv.id)];
  if (recorded) {
    var r = lib.replay(lv, recorded);
    if (r.ok) { console.log('OK   ' + label + ' — записанное решение, ' + r.steps + ' тиков'); return; }
    console.log('FAIL ' + label + ' — записанное решение не проходит: ' + r.reason);
    fails++;
    return;
  }
  var a = lib.autopilot(lv, { limit: 2000 });
  if (a.ok) {
    console.log('OK   ' + label + ' — автопилот прошёл за ' + a.steps + ' тиков');
    if (save) { solutions[String(lv.id)] = a.moves; }
  } else {
    console.log('FAIL ' + label + ' — автопилот не прошёл (' + a.reason + '). Нужно ручное решение.');
    fails++;
  }
});

if (save) {
  fs.writeFileSync(solPath, JSON.stringify(solutions, null, 2) + '\n');
  console.log('Решения сохранены в levels/solutions.json');
}
console.log(fails ? ('Провалено: ' + fails + ' из ' + checked) : ('Все ' + checked + ' уровня(ей) проходимы.'));
process.exit(fails ? 1 : 0);
