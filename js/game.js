/* Склейка: игровой цикл, экраны, прогресс. */
(function (global) {
  'use strict';
  var SP = global.SP;
  var TICK_MS = 135;
  var STORE_KEY = 'infotron.progress.v1';

  var el = {};
  ['hud-level', 'hud-info', 'hud-need', 'hud-moves', 'hud-time', 'btn-menu', 'btn-restart',
   'screen', 'overlay', 'ov-title', 'ov-text', 'ov-buttons', 'menu', 'level-grid', 'hint', 'btn-full'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var renderer = new SP.Renderer(el.screen);
  var input = new SP.Input(global);
  input.bindTouch(document.getElementById('pad'));
  input.bindJoystick(document.getElementById('stage'));

  var engine = null;
  var levelIndex = 0;
  var state = 'menu';        // menu | playing | paused | won | dead
  var acc = 0;
  var last = 0;

  /* ---------- прогресс ---------- */
  function loadProgress() {
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : { done: {} };
    } catch (e) { return { done: {} }; }
  }
  function saveProgress(p) {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* приватный режим — переживём */ }
  }
  var progress = loadProgress();

  function unlockedUpTo() {
    var n = 1;
    for (var i = 0; i < SP.LEVELS.length; i++) {
      if (progress.done[SP.LEVELS[i].id]) n = Math.max(n, i + 2);
    }
    return Math.min(n, SP.LEVELS.length);
  }

  /* ---------- экраны ---------- */
  function showMenu() {
    state = 'menu';
    el.menu.classList.remove('hidden');
    el.overlay.classList.add('hidden');
    document.body.classList.add('in-menu');
    el.hint.textContent = 'Выбери уровень.';
    el['hud-level'].textContent = '—';
    renderGrid();
  }

  function renderGrid() {
    var limit = unlockedUpTo();
    el['level-grid'].innerHTML = '';
    SP.LEVELS.forEach(function (lv, i) {
      var b = document.createElement('button');
      b.className = 'lv' + (progress.done[lv.id] ? ' done' : '');
      b.disabled = i + 1 > limit;
      b.innerHTML = '<span class="n">Уровень ' + lv.id + (b.disabled ? ' 🔒' : '') + '</span>' +
        '<span class="t">' + lv.name + '</span>';
      b.addEventListener('click', function () { startLevel(i); });
      el['level-grid'].appendChild(b);
    });
  }

  function overlay(title, text, buttons) {
    el['ov-title'].textContent = title;
    el['ov-text'].innerHTML = text;
    el['ov-buttons'].innerHTML = '';
    buttons.forEach(function (b) {
      var node = document.createElement('button');
      node.textContent = b.label;
      if (b.primary) node.className = 'primary';
      node.addEventListener('click', b.action);
      el['ov-buttons'].appendChild(node);
    });
    el.overlay.classList.remove('hidden');
  }

  /* ---------- игра ---------- */
  function startLevel(i) {
    levelIndex = Math.max(0, Math.min(SP.LEVELS.length - 1, i));
    var lv = SP.LEVELS[levelIndex];
    engine = new SP.Engine(lv);
    renderer.resize(engine);
    acc = 0;
    state = 'playing';
    input.held.length = 0;
    el.menu.classList.add('hidden');
    el.overlay.classList.add('hidden');
    document.body.classList.remove('in-menu');
    el['hud-level'].textContent = '#' + lv.id + ' ' + lv.name;
    el.hint.textContent = lv.hint || '';
    updateHud();
  }

  function updateHud() {
    if (!engine) return;
    el['hud-info'].textContent = engine.collected;
    el['hud-need'].textContent = engine.needed;
    el['hud-moves'].textContent = engine.moves;
    el['hud-time'].textContent = (engine.ticks * TICK_MS / 1000).toFixed(1);
  }

  function onWin() {
    state = 'won';
    var lv = SP.LEVELS[levelIndex];
    var prev = progress.done[lv.id];
    var rec = { moves: engine.moves, ticks: engine.ticks };
    if (!prev || rec.moves < prev.moves) progress.done[lv.id] = rec;
    else progress.done[lv.id] = prev;
    saveProgress(progress);

    var best = progress.done[lv.id];
    var isLast = levelIndex >= SP.LEVELS.length - 1;
    overlay(isLast ? 'Игра пройдена!' : 'Уровень пройден',
      'Ходов: <b>' + engine.moves + '</b> · время: <b>' + (engine.ticks * TICK_MS / 1000).toFixed(1) + ' с</b>' +
      (best && best.moves < engine.moves ? '<br>Лучший результат: ' + best.moves + ' ходов' : '') +
      (isLast ? '<br><br>Все двенадцать уровней позади. Мёрфи благодарит.' : ''),
      isLast
        ? [{ label: 'К списку уровней', primary: true, action: showMenu }]
        : [{ label: 'Следующий уровень →', primary: true, action: function () { startLevel(levelIndex + 1); } },
           { label: 'Заново', action: function () { startLevel(levelIndex); } },
           { label: 'К списку', action: showMenu }]);
  }

  function onDead() {
    state = 'dead';
    overlay('Мёрфи погиб', 'Зонк, монстр или взрыв — но результат один.',
      [{ label: 'Заново (R)', primary: true, action: function () { startLevel(levelIndex); } },
       { label: 'К списку', action: showMenu }]);
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      overlay('Пауза', SP.LEVELS[levelIndex].hint || '',
        [{ label: 'Продолжить', primary: true, action: resume },
         { label: 'Заново', action: function () { startLevel(levelIndex); } },
         { label: 'К списку уровней', action: showMenu }]);
    } else if (state === 'paused') {
      resume();
    }
  }
  function resume() {
    state = 'playing';
    acc = 0;
    el.overlay.classList.add('hidden');
  }

  input.onCommand = function (cmd) {
    if (cmd === 'restart' && (state === 'playing' || state === 'dead' || state === 'paused')) startLevel(levelIndex);
    else if (cmd === 'pause') {
      if (state === 'menu') return;
      if (state === 'won' || state === 'dead') showMenu();
      else togglePause();
    } else if (cmd === 'enter') {
      if (state === 'won' && levelIndex < SP.LEVELS.length - 1) startLevel(levelIndex + 1);
      else if (state === 'dead') startLevel(levelIndex);
    }
  };

  el['btn-menu'].addEventListener('click', showMenu);
  if (el['btn-full'] && !document.fullscreenEnabled) el['btn-full'].style.display = 'none';
  if (el['btn-full']) el['btn-full'].addEventListener('click', function () {
    var root = document.documentElement;
    if (document.fullscreenElement) (document.exitFullscreen || function () {}).call(document);
    else if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
  });
  el['btn-restart'].addEventListener('click', function () { if (engine) startLevel(levelIndex); });
  global.addEventListener('resize', function () { if (engine) renderer.resize(engine); });

  /* ---------- цикл ---------- */
  function frame(ts) {
    global.requestAnimationFrame(frame);
    if (!engine) return;
    var dt = Math.min(250, ts - (last || ts));
    last = ts;

    if (state === 'playing') {
      acc += dt;
      var guard = 0;
      while (acc >= TICK_MS && guard++ < 8) {
        acc -= TICK_MS;
        var status = engine.step(input.current());
        updateHud();
        if (status === 'won') { onWin(); break; }
        if (status === 'dead') { onDead(); break; }
      }
    }
    renderer.draw(engine, state === 'playing' ? Math.min(1, acc / TICK_MS) : 1, ts);
  }

  // отладочный вход: SP.game.start(индекс) — удобно смотреть уровни без прохождения
  SP.game = { start: startLevel, get engine() { return engine; } };

  // старт
  startLevel(0);
  showMenu();
  global.requestAnimationFrame(frame);
})(typeof globalThis !== 'undefined' ? globalThis : this);
