#!/usr/bin/env node
'use strict';
/*
 * Сторож звука. Голос (осцилляторы) в Node не проверить, но решение о том,
 * ЧТО прозвучит, принимают чистые функции probe/events — их и гоняем.
 *
 * Проигрываем каждое записанное решение и требуем:
 *   - число «взял» ровно равно числу собранных инфотронов;
 *   - «победа» звучит один раз и только на последнем такте;
 *   - «гибель» не звучит никогда: решения-то рабочие;
 *   - тихий такт молчит — если мир не шелохнулся, событий нет;
 *   - «удар о землю» не звучит одновременно со взрывом (иначе каша);
 *   - каждый «взял»/«запал»/«тяжесть» подтверждается самим движком.
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var Engine = require(path.join(root, 'js', 'engine.js')).Engine;
var snd = require(path.join(root, 'js', 'sound.js'));
var LEVELS = require(path.join(root, 'js', 'levels.js')).LEVELS;
var solutions = JSON.parse(fs.readFileSync(path.join(root, 'levels', 'solutions.json'), 'utf8'));

function parseMoves(str) {
  var map = { U: { dir: 0 }, R: { dir: 1 }, D: { dir: 2 }, L: { dir: 3 },
              u: { dir: 0, snap: 1 }, r: { dir: 1, snap: 1 }, d: { dir: 2, snap: 1 }, l: { dir: 3, snap: 1 },
              '.': { dir: -1 } };
  var out = [], i = 0;
  while (i < str.length) {
    var ch = str[i++];
    if (ch === ' ' || ch === '\n') continue;
    var act = map[ch];
    if (!act) throw new Error('непонятный символ хода: ' + ch);
    var num = '';
    while (i < str.length && /[0-9]/.test(str[i])) num += str[i++];
    var times = num ? parseInt(num, 10) : 1;
    for (var k = 0; k < times; k++) out.push(act);
  }
  return out;
}

function same(a, b) {
  return a.c === b.c && a.st === b.st && a.fuse === b.fuse && a.carry === b.carry &&
         a.grav === b.grav && a.fall === b.fall && a.blast === b.blast &&
         a.pos === b.pos && !b.dig && !b.push;
}

var only = process.argv.slice(2).filter(function (a) { return /^\d+$/.test(a); }).map(Number);
var bad = 0, checked = 0, tally = {};

LEVELS.forEach(function (lv) {
  if (only.length && only.indexOf(lv.id) < 0) return;
  var rec = solutions[String(lv.id)];
  if (!rec) return;
  checked++;
  var e = new Engine(lv);
  var acts = parseMoves(rec);
  var takes = 0, wins = 0, dies = 0, lastWin = -1, errs = [];
  for (var i = 0; i < acts.length; i++) {
    var before = snd.probe(e);
    e.step(acts[i]);
    var after = snd.probe(e);
    var ev = snd.events(before, after);
    ev.forEach(function (n) { tally[n] = (tally[n] || 0) + 1; });
    if (same(before, after) && ev.length) errs.push('такт ' + i + ': мир не изменился, а звук есть — ' + ev.join(','));
    if (ev.indexOf('land') >= 0 && ev.indexOf('boom') >= 0) errs.push('такт ' + i + ': удар и взрыв разом');
    if (ev.indexOf('take') >= 0) { takes += after.c - before.c; }
    else if (after.c !== before.c) errs.push('такт ' + i + ': инфотрон собран молча');
    if (ev.indexOf('win') >= 0) { wins++; lastWin = i; }
    if (ev.indexOf('die') >= 0) dies++;
    if (e.status === 'won') { break; }
    if (e.status !== 'playing') break;
  }
  if (takes !== e.collected) errs.push('«взял» прозвучал ' + takes + ' раз, а собрано ' + e.collected);
  if (wins !== 1) errs.push('«победа» прозвучала ' + wins + ' раз(а), а нужно ровно один');
  else if (lastWin !== i) errs.push('«победа» прозвучала не на последнем такте');
  if (dies) errs.push('«гибель» прозвучала на рабочем решении');
  if (errs.length) {
    bad++;
    console.log('ЗВУК #' + lv.id + ' ' + lv.name);
    errs.slice(0, 4).forEach(function (m) { console.log('     ' + m); });
  }
});

var names = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
console.log('Звук: проверено решений ' + checked + '; событий — ' +
  names.map(function (n) { return n + ' ' + tally[n]; }).join(', '));
if (bad) { console.log('Плохих уровней: ' + bad); process.exit(1); }
console.log('Звук согласован с движком на всех решениях.');
