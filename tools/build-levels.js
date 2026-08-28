#!/usr/bin/env node
'use strict';
/*
 * Собирает js/levels.js из levels/*.txt.
 * Формат файла:
 *   name: Название
 *   needed: 5           (необязательно — по умолчанию все инфотроны)
 *   hint: Подсказка
 *   ---
 *   <карта>
 */
var fs = require('fs');
var path = require('path');

var dir = path.join(__dirname, '..', 'levels');
var plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'plan-100.json'), 'utf8'));
var files = fs.readdirSync(dir).filter(function (f) { return /\.txt$/.test(f); }).sort();

var levels = files.map(function (file) {
  var raw = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r/g, '');
  var parts = raw.split(/^---\s*$/m);
  if (parts.length < 2) throw new Error(file + ': нет разделителя "---"');
  var meta = {};
  parts[0].split('\n').forEach(function (line) {
    if (!line.trim()) return;
    var m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) throw new Error(file + ': непонятная строка заголовка: ' + line);
    meta[m[1]] = m[2];
  });
  var map = parts.slice(1).join('---').split('\n');
  while (map.length && map[0].trim() === '') map.shift();
  while (map.length && map[map.length - 1].trim() === '') map.pop();

  var w = map.reduce(function (a, r) { return Math.max(a, r.length); }, 0);
  var ragged = map.filter(function (r) { return r.length !== w; }).length;
  if (ragged) console.warn('  ! ' + file + ': ' + ragged + ' строк(и) короче ' + w + ' — дополняю пустотой');
  map = map.map(function (r) { return r + ' '.repeat(w - r.length); });

  var counts = {};
  map.join('').split('').forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
  if (counts['M'] !== 1) throw new Error(file + ': Мёрфи должен быть ровно один (найдено ' + (counts['M'] || 0) + ')');
  if (!counts['E']) throw new Error(file + ': нет выхода');
  var total = counts['*'] || 0;
  var needed = meta.needed ? parseInt(meta.needed, 10) : total;

  return {
    id: parseInt(file, 10) || levels.length + 1,
    chapter: Math.ceil((parseInt(file, 10) || 1) / 10),
    name: meta.name || file.replace(/\.txt$/, ''),
    hint: meta.hint || '',
    needed: needed,
    gravity: /^(on|1|yes|да)$/i.test(meta.gravity || '') || undefined,
    map: map,
    _file: file,
    _total: total,
    _w: w,
    _h: map.length
  };
});

var out = [];
out.push('/* СГЕНЕРИРОВАНО tools/build-levels.js из levels/*.txt — правь .txt, а не этот файл. */');
out.push('(function (global) {');
out.push("  'use strict';");
out.push('  var LEVELS = [');
levels.forEach(function (lv, n) {
  out.push('    {');
  out.push('      id: ' + lv.id + ',');
  out.push('      chapter: ' + lv.chapter + ',');
  out.push('      name: ' + JSON.stringify(lv.name) + ',');
  out.push('      hint: ' + JSON.stringify(lv.hint) + ',');
  out.push('      needed: ' + lv.needed + ',');
  if (lv.gravity) out.push('      gravity: true,');
  out.push('      map: [');
  out.push(lv.map.map(function (r) { return '        ' + JSON.stringify(r); }).join(',\n'));
  out.push('      ]');
  out.push('    }' + (n < levels.length - 1 ? ',' : ''));
});
out.push('  ];');
var chapterDefs = plan.chapters.map(function (c) {
  return { n: c.n, title: c.title, planned: c.levels.length };
});
// уровни за пределами плана (например, вариант главы от внешней модели) получают свою главу
levels.forEach(function (l) {
  if (l.chapter > chapterDefs.length && !chapterDefs.some(function (c) { return c.n === l.chapter; })) {
    chapterDefs.push({ n: l.chapter, title: 'Проба · вариант ChatGPT', planned: 10 });
  }
});
out.push('  var CHAPTERS = [');
out.push(chapterDefs.map(function (c) {
  return '    { n: ' + c.n + ', title: ' + JSON.stringify(c.title) + ', planned: ' + c.planned + ' }';
}).join(',\n'));
out.push('  ];');
out.push('  var api = { LEVELS: LEVELS, CHAPTERS: CHAPTERS };');
out.push("  if (typeof module === 'object' && module.exports) module.exports = api;");
out.push('  else global.SP = Object.assign(global.SP || {}, api);');
out.push("})(typeof globalThis !== 'undefined' ? globalThis : this);");

fs.writeFileSync(path.join(__dirname, '..', 'js', 'levels.js'), out.join('\n') + '\n');
levels.forEach(function (l) {
  console.log('  ' + l._file + '  гл.' + l.chapter + '  ' + l._w + 'x' + l._h +
    '  инфотронов ' + l._total + ', нужно ' + l.needed + '  — ' + l.name);
});
var built = {};
levels.forEach(function (l) { built[l.chapter] = (built[l.chapter] || 0) + 1; });
console.log('Собрано уровней: ' + levels.length + ' из 100 → js/levels.js');
console.log('По главам: ' + plan.chapters.map(function (c) {
  return c.n + ':' + (built[c.n] || 0) + '/' + c.levels.length;
}).join('  '));
