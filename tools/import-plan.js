#!/usr/bin/env node
'use strict';
/*
 * Приём чертежей уровней от внешней модели (формат из docs/prompt-for-level-designer.md).
 *
 *   node tools/import-plan.js blueprint.json           — проверить и показать вердикт
 *   node tools/import-plan.js blueprint.json --write    — записать чертежи и обновить план
 *
 * Проверяем то, что делает чертёж непригодным для сборки: расплывчатость, механики,
 * которых ещё нет, несходящаяся арифметика инфотронов, нарушенная норма плотности.
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

var NOT_READY = ['жёлтый диск', 'красный диск', 'терминал', 'жук', 'гравитация', 'гравипорт'];
var READY_CH = { 'жук': 4, 'жёлтый диск': 7, 'красный диск': 7, 'терминал': 7, 'гравитация': 8, 'гравипорт': 8 };
var REQUIRED = ['id', 'name', 'idea', 'insight', 'why_not_obvious', 'naive_failure',
                'solution_steps', 'layout', 'mechanics', 'size', 'infotrons', 'needed'];

var args = process.argv.slice(2);
var file = args[0];
var write = args.indexOf('--write') >= 0;
if (!file) { console.error('нужен путь к json с чертежами'); process.exit(1); }

var data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(data)) data = [data];

var planPath = path.join(root, 'docs', 'plan-100.json');
var plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

var ok = [], rejected = 0;
data.forEach(function (b) {
  var label = '#' + (b.id || '?') + ' ' + (b.name || 'без имени');
  var bad = [], notes = [];

  REQUIRED.forEach(function (f) {
    if (b[f] === undefined || b[f] === null || b[f] === '') bad.push('нет поля ' + f);
  });
  if (bad.length) { console.log('ОТКАЗ ' + label + ': ' + bad.join('; ')); rejected++; return; }

  if (!(b.id >= 1 && b.id <= 100)) bad.push('id вне 1..100');
  var chapter = Math.ceil(b.id / 10);
  if (b.chapter && b.chapter !== chapter) bad.push('глава ' + b.chapter + ' не сходится с номером (должна быть ' + chapter + ')');

  if (!Array.isArray(b.solution_steps) || b.solution_steps.length < 2)
    bad.push('порядок решения должен быть расписан хотя бы двумя шагами');
  if (String(b.layout).length < 80)
    bad.push('устройство карты описано слишком коротко — из этого не собрать уровень');

  (b.mechanics || []).forEach(function (m) {
    if (NOT_READY.indexOf(m) >= 0 && chapter < (READY_CH[m] || 99))
      bad.push('механика «' + m + '» появится только в главе ' + READY_CH[m]);
  });

  var m = /^(\d+)\s*[xх×]\s*(\d+)$/i.exec(String(b.size).trim());
  if (!m) bad.push('размер должен быть вида 44x22');
  else {
    var w = +m[1], h = +m[2];
    if (b.id > 3 && (w < 40 || h < 20)) notes.push('мелковат: ' + w + 'x' + h + ' при норме от 40x20');
    if (w > 60 || h > 24) notes.push('крупнее оригинала: ' + w + 'x' + h);
  }
  if (b.needed > b.infotrons && (b.mechanics || []).indexOf('электрон') < 0)
    bad.push('нужно ' + b.needed + ' инфотронов при ' + b.infotrons + ' на карте, и электронов в механиках нет');
  if (b.id > 3 && b.infotrons < 20) notes.push('мало инфотронов: ' + b.infotrons + ' при норме 20–40');
  if (b.needed && b.infotrons && b.needed / b.infotrons > 0.95) notes.push('нет запаса: собрать нужно почти всё');

  if (bad.length) { console.log('ОТКАЗ ' + label + ': ' + bad.join('; ')); rejected++; return; }
  console.log('ОК    ' + label + ' — ' + b.idea + (notes.length ? '\n      замечания: ' + notes.join('; ') : ''));
  ok.push(b);
});

if (write && ok.length) {
  var dir = path.join(root, 'docs', 'blueprints');
  fs.mkdirSync(dir, { recursive: true });
  ok.forEach(function (b) {
    fs.writeFileSync(path.join(dir, String(b.id).padStart(3, '0') + '.json'),
      JSON.stringify(b, null, 2) + '\n');
    var ch = plan.chapters[Math.ceil(b.id / 10) - 1];
    var i = (b.id - 1) % 10;
    if (ch && ch.levels[i]) ch.levels[i] = [b.name, b.idea, b.mechanics];
  });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  console.log('Чертежи → docs/blueprints/, план обновлён. Дальше: npm run plan');
}
console.log('Принято ' + ok.length + ', отклонено ' + rejected +
  (write ? '' : '. Запусти с --write, чтобы записать.'));
