#!/usr/bin/env node
'use strict';
/*
 * Сторож игроницы. Главное, что проверяется, — что игра не лезет с помощью
 * без повода: предложения появляются только тогда, когда для них есть
 * основание, и никогда не ведут на закрытый, пройденный или более резкий
 * уровень.
 */
var path = require('path');
var P = require(path.join(__dirname, '..', 'js', 'player.js')).Player;
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;

function mem() { var d = {}; return { getItem: function (k) { return d[k] || null; }, setItem: function (k, v) { d[k] = String(v); } }; }
var bad = 0, n = 0;
function ok(cond, what) { n++; if (!cond) { bad++; console.log('ИГРОНИЦА: ' + what); } }

// 1. Совет после гибели — только с третьего раза в одном месте.
var p = new P(mem());
ok(!p.offerHint(p.noteDeath(5, 4, 4)), 'совет предложен после первой гибели');
ok(!p.offerHint(p.noteDeath(5, 5, 3)), 'совет предложен после второй');
ok(p.offerHint(p.noteDeath(5, 3, 5)), 'три гибели в одном квадрате, а совета нет');
ok(!p.offerHint(p.noteDeath(5, 12, 12)), 'гибель в другом месте засчитана как та же');
ok(!p.offerHint(p.noteDeath(6, 4, 4)), 'гибели на другом уровне смешались');

// 2. Память переживает перезапуск, а испорченная запись её не роняет.
var s = mem();
new P(s).noteDeath(9, 1, 1); new P(s).noteDeath(9, 1, 1);
ok(new P(s).noteDeath(9, 1, 1) === 3, 'счёт гибелей не пережил перезапуска');
s.setItem('infotron.player.v1', '{сломано');
ok(new P(s).noteDeath(9, 1, 1) === 1, 'испорченная запись не сброшена');
ok(new P(null).noteDeath(1, 0, 0) === 1, 'без хранилища игроница падает');

// 3. Передышка: только в тяжёлой полосе и только перед резким скачком.
function trial(hard, levels, cur, openAll, doneIds) {
  var q = new P(mem());
  hard.forEach(function (h, i) { q.noteWin(1000 + i, h ? 5 : 0); });
  return q.easier(levels, cur, function () { return openAll; }, function (id) { return doneIds.indexOf(id) >= 0; });
}
var toy = [{ id: 1, rating: 3 }, { id: 2, rating: 7 }, { id: 3, rating: 2 }, { id: 4, rating: 5 }, { id: 5, rating: 1 }];
ok(trial([false, false], toy, 0, true, []) === -1, 'передышка без тяжёлой полосы');
ok(trial([true, false], toy, 0, true, []) === -1, 'одна тяжёлая победа уже считается полосой');
ok(trial([true, true], toy, 0, true, []) === 4, 'в тяжёлой полосе не предложен самый лёгкий открытый');
ok(trial([true, true], toy, 0, false, []) === -1, 'предложен закрытый уровень');
ok(trial([true, true], toy, 0, true, [5, 3]) === -1, 'предложен пройденный уровень');
ok(trial([true, true], toy, 3, true, []) === -1, 'передышка там, где скачка резкости нет');

// 4. На настоящих уровнях предложение никогда не резче только что взятого.
var worst = 0;
for (var cur = 0; cur < LEVELS.length - 1; cur++) {
  var r = trial([true, true], LEVELS, cur, true, []);
  if (r < 0) continue;
  ok(r !== cur && r !== cur + 1, 'на #' + LEVELS[cur].id + ' предложен тот же или следующий');
  if ((LEVELS[r].rating || 0) > (LEVELS[cur].rating || 0)) worst++;
}
ok(worst === 0, 'передышка оказалась резче взятого уровня ' + worst + ' раз');

if (bad) { console.log('Игроница нарушена: ' + bad + ' из ' + n); process.exit(1); }
console.log('Игроница: ' + n + ' проверок, предлагает только по делу и только полегче.');
