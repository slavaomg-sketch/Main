/* Склейка: игровой цикл, экраны, прогресс. */
(function (global) {
  'use strict';
  var SP = global.SP;
  var TICK_MS = 135;
  var REWIND_MS = 60;                       // отмотка идёт вдвое быстрее хода
  var DEATH_REWIND = 12;                    // на сколько отматывает кнопка после гибели
  var STORE_KEY = 'infotron.progress.v2';   // v2: стоуровневая нумерация, прогресс начинается заново

  var el = {};
  ['hud-level', 'hud-info', 'hud-need', 'hud-moves', 'hud-time', 'btn-menu', 'btn-restart', 'btn-hint',
   'screen', 'overlay', 'ov-title', 'ov-text', 'ov-buttons', 'menu', 'level-grid', 'hint', 'btn-full', 'btn-unlock',
   'welcome', 'welcome-canvas', 'btn-play', 'skin-welcome', 'skin-menu', 'hud-carry', 'hud-fuse', 'hud-fuse-n', 'hud-grav'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var renderer = new SP.Renderer(el.screen);
  var input = new SP.Input(global);
  input.bindTouch(document.getElementById('pad'));
  input.bindHold(document.getElementById('btn-rewind'), 'rewind');
  input.bindJoystick(document.getElementById('stage'));

  var hello = null;

  /* ---------- облик героя ---------- */
  var SKIN_KEY = 'infotron.skin';
  var skinId = 'murphy';
  try { skinId = SP.Sprites.skin(global.localStorage.getItem(SKIN_KEY)).id; } catch (e) { /* приватный режим */ }
  renderer.setSkin(skinId);

  function drawSkinPreview(canvas, id) {
    var box = 56, dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box * dpr);
    canvas.height = Math.round(box * dpr);
    canvas.style.width = box + 'px';
    canvas.style.height = box + 'px';
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, box, box);
    SP.Sprites.drawHero(g, box, 2, id);
  }

  function renderSkinPickers() {
    ['skin-welcome', 'skin-menu'].forEach(function (key) {
      var host = el[key];
      if (!host) return;
      var row = host.querySelector('.skins-row');
      row.innerHTML = '';
      SP.Sprites.skins.forEach(function (sk) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'skin' + (sk.id === skinId ? ' on' : '');
        b.setAttribute('aria-pressed', sk.id === skinId ? 'true' : 'false');
        var c = document.createElement('canvas');
        b.appendChild(c);
        var cap = document.createElement('span');
        cap.className = 'skin-name';
        cap.textContent = sk.name;
        b.appendChild(cap);
        var note = document.createElement('span');
        note.className = 'skin-note';
        note.textContent = sk.note;
        b.appendChild(note);
        // на заставке любой тык по фону её закрывает — выбор героя не должен её ронять
        b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
        b.addEventListener('click', function (ev) { ev.stopPropagation(); setSkin(sk.id); });
        row.appendChild(b);
        drawSkinPreview(c, sk.id);
      });
    });
  }

  function heroName() { return SP.Sprites.skin(skinId).name; }

  function setSkin(id) {
    skinId = SP.Sprites.skin(id).id;
    try { global.localStorage.setItem(SKIN_KEY, skinId); } catch (e) { /* приватный режим */ }
    renderer.setSkin(skinId);
    if (hello) hello.setSkin(skinId);
    renderSkinPickers();
  }

  var engine = null;
  var history = null;
  var usedHelp = false;                     // отматывал или спрашивал совета
  var levelIndex = 0;
  var state = 'menu';        // menu | playing | rewinding | paused | won | dead
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

  // Пробные главы (за пределами основного плана) открыты всегда: они не часть
  // прохождения, а площадка для сравнения вариантов.
  var PLAN_CHAPTERS = 10;
  function isTrial(ch) { return ch > PLAN_CHAPTERS; }

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
    var grid = el['level-grid'];
    grid.innerHTML = '';

    (SP.CHAPTERS || []).forEach(function (ch) {
      var mine = [];
      SP.LEVELS.forEach(function (lv, i) { if (lv.chapter === ch.n) mine.push({ lv: lv, i: i }); });
      // Первые десять глав — выстроенная лесенка обучения, её порядок трогать нельзя.
      // Дальше уровни лежали по дате постройки; там сортируем по измеренной резкости.
      if (ch.n > PLAN_CHAPTERS) {
        mine.sort(function (a, b) { return (a.lv.rating || 0) - (b.lv.rating || 0) || a.lv.id - b.lv.id; });
      }
      var done = mine.filter(function (m) { return progress.done[m.lv.id]; }).length;

      var head = document.createElement('div');
      head.className = 'chapter-head' + (mine.length ? '' : ' pending');
      head.innerHTML = '<span class="cn">Глава ' + ch.n + '</span>' +
        '<span class="ct">' + ch.title + '</span>' +
        '<span class="cp">' + (mine.length
          ? (isTrial(ch.n) ? 'открыта · ' : '') + 'пройдено ' + done + ' из ' + ch.planned +
            (mine.length < ch.planned ? ' · в игре ' + mine.length : '')
          : 'в работе') + '</span>';
      grid.appendChild(head);

      if (!mine.length) return;
      var row = document.createElement('div');
      row.className = 'chapter-levels';
      mine.forEach(function (m) {
        var b = document.createElement('button');
        b.className = 'lv' + (progress.done[m.lv.id] ? ' done' : '');
        b.disabled = !progress.all && !isTrial(ch.n) && m.i + 1 > limit;
        var rec = progress.done[m.lv.id];
        var r = m.lv.rating || 0;
        var tier = r >= 9 ? 'top' : r >= 7 ? 'high' : r >= 4 ? 'mid' : 'low';
        if (m.lv.why) b.title = 'Резкость ' + r + ' из 10: ' + m.lv.why;
        b.innerHTML = '<span class="n">№' + m.lv.id + (b.disabled ? ' 🔒' : '') +
            (rec && rec.clean ? '<i class="clean" title="Пройден без отмотки и подсказок">★</i>' : '') + '</span>' +
          '<span class="t">' + m.lv.name + '</span>' +
          (r ? '<span class="d ' + tier + '">' + r + '</span>' : '');
        b.addEventListener('click', function () { startLevel(m.i); });
        row.appendChild(b);
      });
      grid.appendChild(row);
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
    history = new SP.History(engine);
    usedHelp = false;
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
    // заряды седьмой главы: что в руках и сколько тиков до подрыва
    el['hud-carry'].hidden = !engine.murphy.carry;
    el['hud-fuse'].hidden = !engine.fuse;
    if (engine.fuse) el['hud-fuse-n'].textContent = engine.fuse;
    el['hud-grav'].hidden = !engine.gravity;
  }

  function onWin() {
    state = 'won';
    var lv = SP.LEVELS[levelIndex];
    var prev = progress.done[lv.id];
    var clean = !usedHelp || !!(prev && prev.clean);
    var rec = { moves: engine.moves, ticks: engine.ticks, clean: clean };
    if (!prev || rec.moves < prev.moves) progress.done[lv.id] = rec;
    else { prev.clean = clean; progress.done[lv.id] = prev; }
    saveProgress(progress);

    var best = progress.done[lv.id];
    var isLast = levelIndex >= SP.LEVELS.length - 1;
    overlay(isLast ? 'Игра пройдена!' : 'Уровень пройден',
      'Ходов: <b>' + engine.moves + '</b> · время: <b>' + (engine.ticks * TICK_MS / 1000).toFixed(1) + ' с</b>' +
      (best && best.moves < engine.moves ? '<br>Лучший результат: ' + best.moves + ' ходов' : '') +
      (isLast ? '<br><br>Все уровни позади. ' + heroName() + ' благодарит.' : ''),
      isLast
        ? [{ label: 'К списку уровней', primary: true, action: showMenu }]
        : [{ label: 'Следующий уровень →', primary: true, action: function () { startLevel(levelIndex + 1); } },
           { label: 'Заново', action: function () { startLevel(levelIndex); } },
           { label: 'К списку', action: showMenu }]);
  }

  function onDead() {
    state = 'dead';
    overlay(heroName() + ' погиб',
      'Зонк, монстр или взрыв — но результат один.<br>' +
      'Можно не начинать заново: отмотай время назад и попробуй иначе.',
      [{ label: 'Отмотать назад', primary: true, action: function () { rewindBy(DEATH_REWIND); } },
       { label: 'Заново (R)', action: function () { startLevel(levelIndex); } },
       { label: 'К списку', action: showMenu }]);
  }

  /* ---------- советчик ---------- */
  var hintTimer = null;
  function sayHint(text, bad) {
    el.hint.textContent = text;
    el.hint.classList.toggle('warn', !!bad);
    if (hintTimer) global.clearTimeout(hintTimer);
    hintTimer = global.setTimeout(function () {
      el.hint.textContent = SP.LEVELS[levelIndex].hint || '';
      el.hint.classList.remove('warn');
    }, 7000);
  }
  var ARROW = ['вверх', 'вправо', 'вниз', 'влево'];
  function showHint() {
    if (!engine || (state !== 'playing' && state !== 'dead' && state !== 'paused')) return;
    usedHelp = true;
    if (engine.status !== 'playing') { sayHint('Мёрфи погиб — отмотай время назад (Backspace) и попробуй иначе.', true); return; }
    var a = SP.advise(engine);
    if (a.verdict === 'lost') {
      renderer.setMarks([], global.performance.now());
      sayHint('Отсюда уровень уже не пройти: ' + a.reason + '. Отмотай назад.', true);
      return;
    }
    var cells = [];
    a.fatal.forEach(function (d) {
      cells.push({ x: engine.murphy.x + SP.DIRS[d][0], y: engine.murphy.y + SP.DIRS[d][1], bad: true });
    });
    if (a.dir >= 0) cells.push({ x: engine.murphy.x + SP.DIRS[a.dir][0], y: engine.murphy.y + SP.DIRS[a.dir][1], bad: false });
    renderer.setMarks(cells, global.performance.now());
    var parts = [];
    if (a.fatal.length) parts.push('красным — ходы, после которых уже не выжить (' + a.fatal.map(function (d) { return ARROW[d]; }).join(', ') + ')');
    if (a.dir >= 0) parts.push('зелёным — куда, пожалуй, стоит идти');
    sayHint(parts.length ? parts.join('; ') + '.' : 'Сейчас ни один ход не смертелен — иди куда задумал.', false);
  }

  /* ---------- отмотка ---------- */
  function canRewind() {
    return history && history.length() > 0 &&
      (state === 'playing' || state === 'dead' || state === 'paused' || state === 'rewinding');
  }
  /**
   * Шагнуть назад и вернуться к игре. Отматываем не меньше чем на n тактов и
   * непременно за черту гибели: возвращать игрока в предсмертную судорогу
   * бессмысленно, он тут же умрёт снова.
   */
  function rewindBy(n) {
    if (!history || !history.length()) return;
    var target = Math.max(0, Math.min(history.length() - n, history.lastSafe() - 4));
    engine = history.seek(target);
    usedHelp = true;
    state = 'playing';
    acc = 0;
    input.held.length = 0;
    el.overlay.classList.add('hidden');
    updateHud();
  }
  function enterRewind() {
    if (state === 'rewinding') return;
    state = 'rewinding';
    acc = 0;
    input.held.length = 0;
    el.overlay.classList.add('hidden');
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      overlay('Пауза', (SP.LEVELS[levelIndex].hint || '') +
        '<br><br><i>Backspace (или кнопка ↶) отматывает время назад — держи, чтобы отмотать дальше.</i>',
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
    if (cmd === 'hint') showHint();
    else if (cmd === 'restart' && (state === 'playing' || state === 'dead' || state === 'paused')) startLevel(levelIndex);
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
  if (el['btn-unlock']) {
    var syncUnlock = function () {
      el['btn-unlock'].textContent = progress.all ? 'Вернуть порядок прохождения' : 'Открыть все уровни';
    };
    syncUnlock();
    el['btn-unlock'].addEventListener('click', function () {
      progress.all = !progress.all;
      saveProgress(progress);
      syncUnlock();
      renderGrid();
    });
  }
  if (el['btn-full'] && !document.fullscreenEnabled) el['btn-full'].style.display = 'none';
  if (el['btn-full']) el['btn-full'].addEventListener('click', function () {
    var root = document.documentElement;
    if (document.fullscreenElement) (document.exitFullscreen || function () {}).call(document);
    else if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
  });
  if (el['btn-hint']) el['btn-hint'].addEventListener('click', showHint);
  el['btn-restart'].addEventListener('click', function () { if (engine) startLevel(levelIndex); });
  global.addEventListener('resize', function () { if (engine) renderer.resize(engine); });

  /* ---------- цикл ---------- */
  function frame(ts) {
    global.requestAnimationFrame(frame);
    if (!engine) return;
    var dt = Math.min(250, ts - (last || ts));
    last = ts;

    if (input.rewind && canRewind()) enterRewind();

    if (state === 'rewinding') {
      if (!input.rewind) {
        // отпустили посреди гибели — доматываем до живого места
        if (engine.status !== 'playing' || !engine.murphy.alive) engine = history.seek(Math.max(0, history.lastSafe() - 2));
        state = 'playing'; acc = 0; updateHud();
      }
      else {
        acc += dt;
        var rg = 0;
        while (acc >= REWIND_MS && rg++ < 8 && history.length() > 0) {
          acc -= REWIND_MS;
          engine = history.back(1);
          usedHelp = true;
        }
        updateHud();
      }
    } else if (state === 'playing') {
      acc += dt;
      var guard = 0;
      while (acc >= TICK_MS && guard++ < 8) {
        acc -= TICK_MS;
        var act = input.current();
        var status = engine.step(act);
        history.record(act, engine);
        updateHud();
        if (status === 'won') { onWin(); break; }
        if (status === 'dead') { onDead(); break; }
      }
    }
    renderer.draw(engine, state === 'playing' ? Math.min(1, acc / TICK_MS) : 1, ts);
  }

  // отладочный вход: SP.game.start(индекс) — удобно смотреть уровни без прохождения
  SP.game = { start: startLevel, get engine() { return engine; } };

  // старт: сперва приветствие, потом список уровней
  startLevel(0);
  showMenu();
  global.requestAnimationFrame(frame);

  hello = new SP.Welcome(el['welcome'], el['welcome-canvas']);
  hello.skin = skinId;
  hello.start();
  renderSkinPickers();
  var greeted = false;
  function dismissWelcome() {
    if (greeted) return;
    greeted = true;
    el['welcome'].classList.add('leaving');
    global.setTimeout(function () {
      el['welcome'].classList.add('hidden');
      hello.stop();
    }, 450);
  }
  el['btn-play'].addEventListener('click', dismissWelcome);
  el['welcome'].addEventListener('pointerdown', dismissWelcome);
  global.addEventListener('keydown', function (e) { if (!greeted) { dismissWelcome(); e.preventDefault(); } }, true);
})(typeof globalThis !== 'undefined' ? globalThis : this);
