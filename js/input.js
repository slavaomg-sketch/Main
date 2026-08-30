/* Ввод: клавиатура + экранный крестовина для тача. */
(function (global) {
  'use strict';

  var KEYS = {
    ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3,
    KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3
  };

  function Input(target) {
    var self = this;
    this.held = [];         // очередь зажатых направлений: последнее нажатие важнее
    this.snap = false;
    this.rewind = false;    // зажатая отмотка: пока держат, время идёт назад
    this.onCommand = function () {};

    function press(dir) {
      if (self.held.indexOf(dir) < 0) self.held.push(dir);
    }
    function release(dir) {
      var i = self.held.indexOf(dir);
      if (i >= 0) self.held.splice(i, 1);
    }
    this.press = press;
    this.release = release;

    target.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { self.snap = true; e.preventDefault(); return; }
      if (e.code === 'Backspace' || e.code === 'KeyZ') { self.rewind = true; e.preventDefault(); return; }
      var d = KEYS[e.code];
      if (d !== undefined) { press(d); e.preventDefault(); return; }
      if (e.code === 'KeyH') self.onCommand('hint');
      else if (e.code === 'KeyR') self.onCommand('restart');
      else if (e.code === 'KeyP' || e.code === 'Escape') self.onCommand('pause');
      else if (e.code === 'Enter') self.onCommand('enter');
    });
    target.addEventListener('keyup', function (e) {
      if (e.code === 'Space') { self.snap = false; return; }
      if (e.code === 'Backspace' || e.code === 'KeyZ') { self.rewind = false; return; }
      var d = KEYS[e.code];
      if (d !== undefined) release(d);
    });
    global.addEventListener('blur', function () { self.held.length = 0; self.snap = false; self.rewind = false; });
  }

  Input.prototype.current = function () {
    return { dir: this.held.length ? this.held[this.held.length - 1] : -1, snap: this.snap };
  };

  /** Привязывает экранные кнопки: data-dir="0..3" и data-act="snap". */
  Input.prototype.bindTouch = function (root) {
    var self = this;
    Array.prototype.forEach.call(root.querySelectorAll('[data-dir]'), function (el) {
      var dir = parseInt(el.getAttribute('data-dir'), 10);
      var down = function (e) { e.preventDefault(); self.press(dir); el.classList.add('active'); };
      var up = function (e) { e.preventDefault(); self.release(dir); el.classList.remove('active'); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    });
    var snapEl = root.querySelector('[data-act="snap"]');
    if (snapEl) {
      snapEl.addEventListener('pointerdown', function (e) { e.preventDefault(); self.snap = true; snapEl.classList.add('active'); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        snapEl.addEventListener(ev, function () { self.snap = false; snapEl.classList.remove('active'); });
      });
    }
  };

  /** Кнопка «держать»: пока прижата, поле self[prop] остаётся true. */
  Input.prototype.bindHold = function (el, prop) {
    if (!el) return;
    var self = this;
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); self[prop] = true; el.classList.add('active'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      el.addEventListener(ev, function () { self[prop] = false; el.classList.remove('active'); });
    });
  };

  /**
   * Джойстик по всему полю: палец ведёт в сторону — Мёрфи идёт туда,
   * пока палец не отпущен. Удобнее крестовины и не закрывает экран.
   */
  Input.prototype.bindJoystick = function (el) {
    var self = this, origin = null, cur = -1;
    var DEAD = 16;

    function set(dir) {
      if (dir === cur) return;
      if (cur >= 0) self.release(cur);
      cur = dir;
      if (cur >= 0) self.press(cur);
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      origin = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (!origin) return;
      var dx = e.clientX - origin.x, dy = e.clientY - origin.y;
      if (Math.abs(dx) < DEAD && Math.abs(dy) < DEAD) { set(-1); return; }
      if (Math.abs(dx) > Math.abs(dy)) set(dx > 0 ? 1 : 3);
      else set(dy > 0 ? 2 : 0);
      // палец «переносим» следом, чтобы смена направления была лёгкой
      var far = 44;
      if (dx > far) origin.x = e.clientX - far; else if (dx < -far) origin.x = e.clientX + far;
      if (dy > far) origin.y = e.clientY - far; else if (dy < -far) origin.y = e.clientY + far;
      e.preventDefault();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      el.addEventListener(ev, function () { set(-1); origin = null; });
    });
  };

  global.SP = Object.assign(global.SP, { Input: Input });
})(typeof globalThis !== 'undefined' ? globalThis : this);
