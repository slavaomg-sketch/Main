#!/usr/bin/env node
'use strict';
/*
 * Проверка физики на всех уровнях: проигрываем записанные прохождения и следим,
 * чтобы ни один предмет не «завис» — то есть не остался на месте, когда под ним пусто
 * и время качания уже вышло. Заодно считаем камни, лежащие на стене со свободным боком:
 * это кандидаты на скатывание, если менять правило.
 */
var path = require('path');
var fs = require('fs');
var lib = require(path.join(__dirname, 'lib.js'));
var base = require(path.join(__dirname, '..', 'js', 'tiles.js'));
var T = base.Tiles;
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;
var sols = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'solutions.json'), 'utf8'));

var SHAKE = 4;
var faller = function (t) { return t === T.ZONK || t === T.INFOTRON || t === T.ORANGE; };
var rounded = function (t) { return t === T.ZONK || t === T.INFOTRON || t === T.CHIP || t === T.ORANGE; };

var stuck = 0, checked = 0, rollCandidates = 0;
LEVELS.forEach(function (lv) {
  var moves = sols[String(lv.id)];
  if (!moves) return;
  var e = new lib.Engine(lv);
  var acts = lib.parseMoves(moves);
  for (var i = 0; i <= acts.length; i++) {
    for (var j = 0; j < e.tiles.length; j++) {
      if (!faller(e.tiles[j])) continue;
      var x = j % e.w, y = (j - x) / e.w;
      if (e.get(x, y + 1) === T.EMPTY && !e.falling[j] && e.shake[j] > SHAKE) {
        console.log('ЗАВИС: уровень #' + lv.id + ' тик ' + i + ' клетка ' + x + ',' + y);
        stuck++;
      }
      if (i === 0) {
        var below = e.get(x, y + 1);
        var freeL = e.get(x - 1, y) === T.EMPTY && e.get(x - 1, y + 1) === T.EMPTY;
        var freeR = e.get(x + 1, y) === T.EMPTY && e.get(x + 1, y + 1) === T.EMPTY;
        if (below === T.WALL && (freeL || freeR)) rollCandidates++;
      }
    }
    checked++;
    if (i < acts.length) e.step(acts[i]);
  }
});
console.log('Проверено состояний: ' + checked + ' · зависших предметов: ' + stuck);
console.log('Камней на твёрдом (стена/грунт) со свободным боком и диагональю: ' + rollCandidates +
  ' — столько поехало бы, если разрешить скатывание с любой поверхности.');
process.exit(stuck ? 1 : 0);
