#!/usr/bin/env node
'use strict';
/*
 * Сторож советчика. Главная его обязанность — не соврать: приговор «отсюда
 * уже не пройти» обязан быть доказанным. Поэтому прогоняем все записанные
 * решения и убеждаемся, что по дороге к победе советчик не объявляет провал
 * ни разу. Заодно проверяем, что верный ход ни разу не попал в список
 * смертельных: советчик не должен отговаривать от правильного.
 */
var path = require('path');
global.SP = require(path.join(__dirname, '..', 'js', 'tiles.js'));
var S = require(path.join(__dirname, '..', 'js', 'solver.js'));
var lib = require(path.join(__dirname, 'lib.js'));
var fs = require('fs');
var LEVELS = require(path.join(__dirname, '..', 'js', 'levels.js')).LEVELS;
var solutions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'solutions.json'), 'utf8'));

var STRIDE = 9;            // как часто проверять список смертельных ходов
var lies = 0, scolds = 0, brags = 0, checked = 0;

LEVELS.forEach(function (lv) {
  var moves = solutions[String(lv.id)];
  if (!moves) return;
  checked++;
  var e = new lib.Engine(lv);
  var acts = lib.parseMoves(moves);
  for (var t = 0; t < acts.length; t++) {
    if (e.status !== 'playing') break;
    var why = S.lost(e);
    if (why) {
      console.log('ЛОЖЬ #' + lv.id + ' ' + lv.name + ' — на такте ' + t + ' объявлен провал: ' + why);
      lies++;
      break;
    }
    if (t % STRIDE === 0 && acts[t].dir >= 0 && !acts[t].snap) {
      var fatal = S.fatalMoves(e);
      if (fatal.indexOf(acts[t].dir) >= 0) {
        console.log('ЗРЯ  #' + lv.id + ' ' + lv.name + ' — на такте ' + t + ' верный ход назван смертельным');
        scolds++;
      }
      if (e.heroes.length > 1 && S.advise(e).source === 'goal') {
        console.log('ХВАСТ #' + lv.id + ' ' + lv.name + ' — на такте ' + t +
                    ' совет вдвоём выдан за дорогу к добыче, хотя дороги советчик не знает');
        brags++;
      }
    }
    e.step(acts[t]);
  }
});

console.log('\nСоветчик проверен на ' + checked + ' уровнях.');
console.log('Ложных приговоров «не пройти»: ' + lies + ' · зря объявленных смертельными ходов: ' + scolds +
            ' · советов, выданных не за то, чем они есть: ' + brags);
if (lies || scolds || brags) process.exit(1);
