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
      var d = KEYS[e.code];
      if (d !== undefined) { press(d); e.preventDefault(); return; }
      if (e.code === 'KeyR') self.onCommand('restart');
      else if (e.code === 'KeyP' || e.code === 'Escape') self.onCommand('pause');
      else if (e.code === 'Enter') self.onCommand('enter');
    });
    target.addEventListener('keyup', function (e) {
      if (e.code === 'Space') { self.snap = false; return; }
      var d = KEYS[e.code];
      if (d !== undefined) release(d);
    });
    global.addEventListener('blur', function () { self.held.length = 0; self.snap = false; });
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

  global.SP = Object.assign(global.SP, { Input: Input });
})(typeof globalThis !== 'undefined' ? globalThis : this);
