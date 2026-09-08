#!/usr/bin/env node
'use strict';
/*
 * Отбор главы из кандидатов охотника (tools/hunt-duo.js). Берёт десять уровней
 * так, чтобы они были разными: по длине решения — от коротких к длинным, а
 * внутри каждой полки — самые резкие. Пишет levels/NNN.txt и эталоны.
 *
 *   node tools/pick-duo.js <семейство> <кандидаты.json> <первый номер>
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var lib = require(path.join(__dirname, 'lib.js'));
var X = require(path.join(__dirname, 'exact.js'));

var family = process.argv[2], src = process.argv[3], first = +process.argv[4];
if (!family || !src || !first) { console.error('нужно: семейство кандидаты.json первый-номер'); process.exit(2); }
var cands = JSON.parse(fs.readFileSync(src, 'utf8'));
var COUNT = 10;

var NAMES = {
  chambers: ['Соседи', 'Зеркало', 'Перегородка', 'Чужой поворот', 'Эхо', 'Два ключа', 'Смежные комнаты', 'Разные окна', 'Тонкая стена', 'Переговоры'],
  gravity: ['Первый ярус', 'Колодцы', 'Ступени', 'Дыры вразнобой', 'Обрыв', 'Два колодца', 'Провал', 'Лестница без перил', 'Дно', 'Последний ярус'],
  bugs: ['Метроном', 'Вспышки', 'Пульс', 'Мигалки', 'Двойной ритм', 'Искры', 'Сбитый такт', 'Часовой', 'Два ритма', 'Синкопа'],
  guards: ['Обход', 'Патруль', 'Караул', 'Дозор', 'Кольцо', 'Вахта', 'Смена караула', 'Тихий час', 'Ночной обход', 'По кругу'],
  pillar: ['Под камнем', 'Держи', 'Четыре такта', 'Шахта', 'Не вниз', 'Опора', 'Камень следом', 'Столб', 'Груз', 'Отпусти']
};

function pc(x) { return Math.round(x * 100) + '%'; }
function waits(moves) { return moves.split('').filter(function (c) { return c === '.'; }).length; }

function hint(c) {
  var park = 'на ' + c.park + ' из ' + c.len + ' тактов шагает только один';
  var danger = c.dead > 0 ? 'Смертельных отклонений ' + pc(c.dead) + '.' : 'Погибнуть здесь нельзя — можно только не найти дорогу.';
  var stuck = c.stuck > 0.02 ? ' А ' + pc(c.stuck) + ' отклонений заводят в тупик: жив, но уровень уже не пройти.' : '';
  switch (family) {
    case 'chambers':
      return 'Слева и справа разные лабиринты, а клавиша одна: ' + park + '. ' + danger + stuck;
    case 'gravity': {
      var tiers = (c.h - 2) / 2;
      return 'Тяжесть: наверх не поднимается никто. Ярусов ' + tiers + ', и всё на ярусе надо взять до падения — а падают двое сразу и в разные дыры. ' +
             'Здесь ' + park + '.' + (c.stuck > 0.02 ? ' ' + pc(c.stuck) + ' отклонений заводят в тупик: провалился не там — уровень потерян.' : '') +
             (c.dead > 0 ? ' Смертельных ' + pc(c.dead) + '.' : '');
    }
    case 'bugs':
      return 'Жуки в перемычке горят по своим фазам, а часы одни на двоих. Из ' + c.len + ' тактов ждать приходится ' + waits(c.moves) +
             ': момент должен годиться обоим сразу. ' + danger + stuck;
    case 'guards': {
      var e = c.map.join('').indexOf('e') >= 0;
      return (e ? 'Электрон идёт правой рукой' : 'Снипснак идёт левой рукой') + ' и обходит кольцо целиком, так что в опасности оба: ' +
             park + '. ' + danger + stuck;
    }
    case 'pillar': {
      var depth = c.h - 4;
      return 'Напарник держит камень своим телом. Ниша открыта только вниз, и первое же «вниз» роняет камень — дальше он идёт следом, отставая на четыре такта. ' +
             'Шахта в ' + depth + ' клеток, ' + park + '. ' + danger + stuck;
    }
  }
  return '';
}

/* Отбор: по полкам длины, внутри полки — самый резкий, и без повторов формы. */
var ok = cands.filter(function (c) { return c.moves && c.len; });
ok.sort(function (a, b) { return a.len - b.len; });
var picked = [], shapes = {};
function score(c) { return c.dead * 40 + c.stuck * 30 + c.park * 2 + c.len * 0.3; }
for (var shelf = 0; shelf < COUNT && ok.length; shelf++) {
  var lo = Math.floor(shelf * ok.length / COUNT), hi = Math.max(lo + 1, Math.floor((shelf + 1) * ok.length / COUNT));
  var pool = ok.slice(lo, hi).filter(function (c) { return !shapes[c.w + 'x' + c.h + ':' + c.len]; });
  if (!pool.length) pool = ok.slice(lo, hi);
  pool.sort(function (a, b) { return score(b) - score(a); });
  var c = pool[0];
  shapes[c.w + 'x' + c.h + ':' + c.len] = 1;
  picked.push(c);
}
// если полок вышло меньше десяти (мало кандидатов) — добираем лучшими из остатка
if (picked.length < COUNT) {
  ok.filter(function (c) { return picked.indexOf(c) < 0; }).sort(function (a, b) { return score(b) - score(a); })
    .slice(0, COUNT - picked.length).forEach(function (c) { picked.push(c); });
}
picked.sort(function (a, b) { return score(a) - score(b); });

var solPath = path.join(root, 'levels', 'solutions.json');
var sol = JSON.parse(fs.readFileSync(solPath, 'utf8'));
picked.forEach(function (c, i) {
  var id = first + i, name = NAMES[family][i] || (family + ' ' + (i + 1));
  var lv = { map: c.map, needed: c.needed, gravity: c.gravity };
  var r = lib.replay(lv, c.moves.split('').join(' '));
  if (!r.ok) { console.log('#' + id + ' решение НЕ проходит — пропускаю'); return; }
  var head = 'name: ' + name + '\n' + (c.gravity ? 'gravity: on\n' : '') + 'needed: ' + c.needed + '\nhint: ' + hint(c) + '\n---\n';
  fs.writeFileSync(path.join(root, 'levels', id + '.txt'), head + c.map.join('\n') + '\n');
  sol[String(id)] = lib.formatMoves(lib.parseMoves(c.moves.split('').join(' ')));
  console.log('#' + id + ' ' + name + ': ' + c.w + 'x' + c.h + ', ' + c.len + ' тактов, парковок ' + c.park +
              ', гибель ' + pc(c.dead) + ', тупик ' + pc(c.stuck));
});
fs.writeFileSync(solPath, JSON.stringify(sol, null, 2) + '\n');
console.log('Записано ' + picked.length + ' уровней из ' + ok.length + ' кандидатов.');
