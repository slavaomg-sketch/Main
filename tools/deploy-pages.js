#!/usr/bin/env node
'use strict';
/*
 * Обновляет ветку gh-pages свежей сборкой игры.
 * Ветка обслуживает GitHub Pages: в ней лежит единственный index.html — вся игра.
 *
 *   npm run deploy
 */
var { execSync } = require('child_process');
var fs = require('fs');
var path = require('path');
var os = require('os');

var root = path.join(__dirname, '..');
var run = function (cmd, cwd) {
  return execSync(cmd, { cwd: cwd || root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
};

execSync('node ' + path.join(__dirname, 'bundle.js'), { cwd: root, stdio: 'inherit' });

var wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ghp-'));
try {
  run('git worktree add --force "' + wt + '" gh-pages 2>&1 || git worktree add --force "' + wt + '" origin/gh-pages');
  fs.copyFileSync(path.join(root, 'dist', 'infotron.html'), path.join(wt, 'index.html'));
  fs.writeFileSync(path.join(wt, '.nojekyll'), '');
  run('git add -A', wt);
  var dirty = run('git status --porcelain', wt);
  if (!dirty) {
    console.log('Онлайн-версия уже свежая — публиковать нечего.');
  } else {
    run('git -c user.email=deploy@local -c user.name=deploy commit -m "Онлайн-версия: свежая сборка"', wt);
    run('git push origin HEAD:gh-pages', wt);
    console.log('Опубликовано: https://slavaomg-sketch.github.io/Main/');
  }
} finally {
  try { run('git worktree remove --force "' + wt + '"'); } catch (e) { /* уже убрано */ }
}
