#!/usr/bin/env node
'use strict';
/*
 * Отладка уровня в консоли.
 *   node tools/play.js 4                 — показать стартовую карту
 *   node tools/play.js 4 "R5 D3 l2"      — проиграть ходы и показать результат
 *   node tools/play.js 4 --auto          — прогнать автопилотом и показать, где он встал
 *   добавь --trace, чтобы печатать карту после каждого тика
 */
var path = require('path');
var lib = require(path.join(__dirname, 'lib.js'));
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;

var args = process.argv.slice(2);
var id = parseInt(args[0], 10);
var lv = LEVELS.filter(function (l) { return l.id === id; })[0];
if (!lv) { console.error('Нет уровня ' + args[0]); process.exit(1); }
var trace = args.indexOf('--trace') >= 0;
var auto = args.indexOf('--auto') >= 0;
var moves = args.slice(1).filter(function (a) { return a.indexOf('--') !== 0; })[0];

console.log('#' + lv.id + ' ' + lv.name + '  (нужно ' + lv.needed + ')');
if (auto) {
  var a = lib.autopilot(lv, { limit: 2000 });
  console.log(a.ok ? 'пройден' : 'не пройден: ' + a.reason);
  console.log('ходы: ' + a.moves);
  moves = a.moves;
}
if (!moves) { console.log(new lib.Engine(lv).toText()); process.exit(0); }
var r = lib.replay(lv, moves, { trace: trace });
console.log(r.engine.toText());
console.log((r.ok ? 'ПРОЙДЕН' : 'НЕ пройден: ' + r.reason) + ' — собрано ' + r.engine.collected + '/' + r.engine.needed + ', тиков ' + r.steps);
