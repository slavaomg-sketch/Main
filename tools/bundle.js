#!/usr/bin/env node
'use strict';
/*
 * Собирает игру в один самодостаточный файл.
 *   dist/infotron.html  — полноценная страница: скачал, кликнул, играешь (в том числе офлайн)
 *   dist/artifact.html  — тот же контент без обёртки <html>/<head>/<body>, для публикации Артефактом
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (_, href) {
  return '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8').trim() + '\n</style>';
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) {
  var code = fs.readFileSync(path.join(root, src), 'utf8').trim();
  if (code.indexOf('</script') >= 0) throw new Error(src + ': в коде есть "</script" — сборка сломается');
  return '<script>\n' + code + '\n</script>';
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'infotron.html'), html);

// версия для Артефакта: без doctype/html/head/body, но с <title> и мета для телефона
var head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
var body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
// в галерее артефактов имя должно быть коротким — без пояснения после тире
var title = '<title>ИНФОТРОН</title>';
var style = head.match(/<style>[\s\S]*?<\/style>/)[0];
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), title + '\n' + style + '\n' + body.trim() + '\n');

function kb(p) { return (fs.statSync(p).size / 1024).toFixed(0) + ' КБ'; }
console.log('dist/infotron.html  ' + kb(path.join(root, 'dist', 'infotron.html')));
console.log('dist/artifact.html  ' + kb(path.join(root, 'dist', 'artifact.html')));
