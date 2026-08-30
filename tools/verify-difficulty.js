#!/usr/bin/env node
'use strict';
/*
 * Сторож сложности. Мерка из tools/measure.js детерминированная: при том же
 * уровне и том же записанном решении она обязана дать те же числа. Значит
 * расхождение означает ровно одно — уровень или решение изменились, и на них
 * надо посмотреть. Тест не судит, стало лучше или хуже; он не даёт правкам
 * пройти молча.
 *
 * Жадный автопилот перепроверяется только на трудных главах: там его
 * бессилие и есть замысел, и если он вдруг начнёт проходить — это поломка.
 */
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, 'measure-lib.js'));
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;
var stored = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'difficulty.json'), 'utf8'));

var HARD_FROM = 111;                 // с этого номера проверяем и жадный автопилот
var CHEAP = ['ticks', 'moves', 'waits', 'detour', 'lethal', 'width'];

var fails = 0, checked = 0, missing = 0, dist = {};
LEVELS.forEach(function (lv) {
  var want = stored[String(lv.id)];
  if (!want) { missing++; return; }
  checked++;
  dist[want.rating] = (dist[want.rating] || 0) + 1;
  var got = M.measure(lv, { skipGreedy: lv.id < HARD_FROM });
  if (!got) { console.log('FAIL #' + lv.id + ' ' + lv.name + ' — нет записанного решения'); fails++; return; }
  var bad = CHEAP.filter(function (k) { return got[k] !== want[k]; });
  if (lv.id >= HARD_FROM && got.greedy !== want.greedy) bad.push('greedy');
  if (bad.length) {
    console.log('FAIL #' + lv.id + ' ' + lv.name + ' — разошлось: ' +
      bad.map(function (k) { return k + ' ' + want[k] + ' → ' + got[k]; }).join(', '));
    fails++;
  }
});

console.log('\nСложность сверена на ' + checked + ' уровнях' + (missing ? ' (' + missing + ' без мерки)' : '') + '.');
console.log('Оценки: ' + Object.keys(dist).sort(function (a, b) { return a - b; })
  .map(function (r) { return r + ' — ' + dist[r]; }).join(' · '));
if (fails) {
  console.log('\nРасхождений: ' + fails + '. Если правка уровня была осознанной, пересчитай: node tools/measure.js');
  process.exit(1);
}
