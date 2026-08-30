/*
 * Лента ходов: позволяет отматывать уровень назад по одному такту.
 *
 * Движок детерминированный, поэтому хранить полное состояние на каждый такт не
 * нужно: держим опорные снимки через каждые KEY тактов, а остаток доигрываем
 * заново. На карте 50×22 снимок весит около девяти килобайт, так что даже
 * на самом длинном решении лента укладывается в неполный мегабайт.
 */
(function (global) {
  'use strict';
  var KEY = 24;

  function History(engine) {
    this.tape = [];                 // что игрок нажал на каждом такте
    this.keys = [engine.clone()];   // keys[k] — состояние после k*KEY тактов
    this.safe = [true];             // safe[n] — на такте n Мёрфи был жив и игра шла
  }

  /** Запомнить такт. Вызывается сразу после engine.step(action). */
  History.prototype.record = function (action, engine) {
    this.tape.push({ dir: action.dir, snap: !!action.snap });
    this.safe.push(engine.status === 'playing' && engine.allAlive());
    if (this.tape.length % KEY === 0) this.keys.push(engine.clone());
  };

  History.prototype.length = function () { return this.tape.length; };

  /**
   * Вернуть состояние на такте n (0 — начало уровня) и обрезать ленту:
   * всё, что было после n, считается отменённым.
   */
  History.prototype.seek = function (n) {
    n = Math.max(0, Math.min(n, this.tape.length));
    var k = Math.floor(n / KEY);
    var e = this.keys[k].clone();
    for (var i = k * KEY; i < n; i++) e.step(this.tape[i]);
    this.tape.length = n;
    this.safe.length = n + 1;
    this.keys.length = k + 1;
    return e;
  };

  /** Последний такт, на котором Мёрфи был ещё жив. */
  History.prototype.lastSafe = function () {
    for (var n = this.safe.length - 1; n > 0; n--) if (this.safe[n]) return n;
    return 0;
  };

  /** Отмотать на n тактов назад. */
  History.prototype.back = function (n) { return this.seek(this.tape.length - (n || 1)); };

  var api = { History: History };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.SP = Object.assign(global.SP || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
