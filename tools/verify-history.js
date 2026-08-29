#!/usr/bin/env node
'use strict';
/*
 * Проверка отмотки: состояние, к которому вернулись, обязано совпасть с тем,
 * что было на этом такте на самом деле. Иначе отмотка не «шаг назад», а
 * тихая подмена уровня.
 *
 *   node tools/verify-history.js        выборка уровней
 *   node tools/verify-history.js 117    только этот уровень
 */
var path = require('path');
var lib = require(path.join(__dirname, 'lib.js'));
var History = require(path.join(__dirname, '..', 'js', 'history.js')).History;
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;
var solutions = require(path.join(__dirname, '..', 'levels', 'solutions.json'));

var only = process.argv.slice(2).filter(function (a) { return /^\d+$/.test(a); }).map(Number);
var picked = LEVELS.filter(function (lv, i) {
  if (only.length) return only.indexOf(lv.id) >= 0;
  return i % 7 === 0 || lv.id >= 111;          // каждый седьмой плюс все трудные
});

var fails = 0;
picked.forEach(function (lv) {
  var moves = solutions[String(lv.id)];
  if (!moves) return;
  var e = new lib.Engine(lv);
  var h = new History(e);
  var marks = [{ key: e.key(), ticks: e.ticks }];   // marks[n] — состояние после n тактов
  var acts = lib.parseMoves(moves);
  for (var i = 0; i < acts.length; i++) {
    var st = e.step(acts[i]);
    h.record(acts[i], e);
    marks.push({ key: e.key(), ticks: e.ticks });
    if (st === 'won' || st === 'dead') break;
  }
  // отматываем по одному такту до самого начала и сверяемся
  var bad = null;
  for (var n = h.length() - 1; n >= 0 && !bad; n--) {
    var back = h.back(1);
    if (back.key() !== marks[n].key) bad = 'состояние на такте ' + n;
    else if (back.ticks !== marks[n].ticks) bad = 'счётчик тактов на ' + n;
  }
  if (bad) { console.log('FAIL #' + lv.id + ' ' + lv.name + ' — ' + bad); fails++; }
  else console.log('OK   #' + lv.id + ' ' + lv.name + ' — отмотка сходится на ' + marks.length + ' тактах');
});

if (fails) { console.log('\nОтмотка расходится на ' + fails + ' уровне(ях).'); process.exit(1); }
console.log('\nОтмотка проверена на ' + picked.length + ' уровнях: расхождений нет.');
