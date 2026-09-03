#!/usr/bin/env node
'use strict';
/*
 * Укорачивает эталонные решения. Зачем: треть эталонов записал автопилот, а он
 * петляет, и вся мерка резкости (длина, теснота, опасность) считается вдоль
 * эталона — то есть меряет блуждания, а не уровень.
 *
 * Два приёма, от сильного к слабому:
 *
 *   1. Точный перебор (tools/exact.js) — кратчайшее решение целиком. Берёт
 *      только уровни без грунта и с малым числом состояний; остальным честно
 *      говорит «не по зубам».
 *   2. Вырезание окон. Из решения пробуем выбросить кусок [i, i+len) и
 *      проигрываем остаток в настоящем движке: если по-прежнему победа, кусок
 *      был лишним. Детерминированно, без бюджета времени, работает на любом
 *      уровне — но находит только те петли, которые можно выкинуть целиком.
 *
 * Каждая правка проверяется проигрыванием, так что испортить эталон нельзя:
 * хуже, чем «не укоротилось», не бывает.
 *
 *   node tools/shorten.js            все уровни, только отчёт
 *   node tools/shorten.js 24 135     выбранные
 *   node tools/shorten.js --save     записать в levels/solutions.json
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var lib = require(path.join(__dirname, 'lib.js'));
var X = require(path.join(__dirname, 'exact.js'));
var LEVELS = require(path.join(root, 'js', 'levels.js')).LEVELS;
var solPath = path.join(root, 'levels', 'solutions.json');
var solutions = JSON.parse(fs.readFileSync(solPath, 'utf8'));

var MAX_WIN = 48;          // самое длинное окно, которое пробуем вырезать

function wins(level, acts) {
  var e = new lib.Engine(level);
  for (var i = 0; i < acts.length; i++) {
    e.step(acts[i]);
    if (e.status === 'won') return true;
    if (e.status !== 'playing') return false;
  }
  return false;
}

/* Жадное вырезание: от длинных окон к коротким, слева направо, до сходимости. */
function trim(level, acts) {
  var cut = 0, changed = true;
  while (changed) {
    changed = false;
    for (var len = Math.min(MAX_WIN, acts.length - 1); len >= 1; len--) {
      for (var i = 0; i + len <= acts.length; i++) {
        var trial = acts.slice(0, i).concat(acts.slice(i + len));
        if (!trial.length || !wins(level, trial)) continue;
        acts = trial; cut += len; changed = true;
        i--;                                    // на том же месте может быть ещё петля
      }
    }
  }
  // хвост после победы не нужен: движок дальше не идёт, но строка чище
  var e = new lib.Engine(level);
  for (var k = 0; k < acts.length; k++) { e.step(acts[k]); if (e.status === 'won') { acts = acts.slice(0, k + 1); break; } }
  return { acts: acts, cut: cut };
}

var args = process.argv.slice(2);
var save = args.indexOf('--save') >= 0;
// --out файл: писать только изменённые эталоны в отдельный JSON — так несколько
// воркеров на разных уровнях не затирают друг другу solutions.json.
var outAt = args.indexOf('--out');
var outPath = outAt >= 0 ? args[outAt + 1] : null;
var changedOnly = {};
var only = args.filter(function (a) { return /^\d+$/.test(a); }).map(Number);
var total = { before: 0, after: 0, exact: 0, trimmed: 0, same: 0 };

LEVELS.forEach(function (lv) {
  if (only.length && only.indexOf(lv.id) < 0) return;
  var rec = solutions[String(lv.id)];
  if (!rec) return;
  var acts = lib.parseMoves(rec);
  if (!wins(lv, acts)) { console.log('#' + lv.id + ' эталон не проходит — пропускаю'); return; }
  var before = acts.length, how = '';
  total.before += before;

  // 1. точный перебор — только если уровень ему по зубам
  var ex = X.solve(lv, { depth: before + 5, nodes: 250000, ms: 12000 });
  if (ex.ok && ex.len < before) {
    acts = lib.parseMoves(ex.moves.split('').join(' '));
    how = 'перебор';
    total.exact++;
  }

  // 2. вырезание окон — и после перебора тоже: перебор не запускался или не добрался
  var t = trim(lv, acts);
  if (t.cut) { acts = t.acts; how = how ? how + '+вырезание' : 'вырезание'; if (!ex.ok) total.trimmed++; }

  total.after += acts.length;
  if (acts.length < before) {
    console.log('#' + lv.id + ' ' + lv.name + ': ' + before + ' → ' + acts.length + ' (' + how + ')');
    if (save) solutions[String(lv.id)] = lib.formatMoves(acts);
    if (outPath) { changedOnly[String(lv.id)] = lib.formatMoves(acts); fs.writeFileSync(outPath, JSON.stringify(changedOnly, null, 2) + '\n'); }
  } else total.same++;
});

console.log('\nБыло тактов ' + total.before + ', стало ' + total.after +
            ' · перебором ' + total.exact + ' · вырезанием ' + total.trimmed + ' · без перемен ' + total.same);
if (save) {
  fs.writeFileSync(solPath, JSON.stringify(solutions, null, 2) + '\n');
  console.log('Записано в levels/solutions.json');
}
