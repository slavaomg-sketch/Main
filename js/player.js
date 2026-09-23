/*
 * Игроница. Игра помнит, где игрок гибнет и как ему даются уровни, — и только
 * ПРЕДЛАГАЕТ, никогда не решает за него. Два предложения, оба кнопкой:
 *
 *   - на экране гибели, если игрок гибнет в одном и том же месте уже в третий
 *     раз, — показать смертельные ходы (советчик уже умеет это честно);
 *   - на экране победы, если последние уровни дались тяжело, а следующий резче
 *     этого на два и больше, — открыть сперва что-нибудь полегче из открытых и
 *     непройденных.
 *
 * Ничего не пишется вслух, ничего не меняется без нажатия: игра, которая
 * жалеет игрока, оскорбительна. Модуль без DOM — его гоняет Node
 * (tools/verify-player.js), хранилище подаётся снаружи.
 */
(function (global) {
  'use strict';

  var KEY = 'infotron.player.v1';
  var SAME_PLACE = 3;        // клетки группируются квадратами 3×3: «то же место»
  var OFFER_AFTER = 3;       // с какой гибели в одном месте предлагать совет
  var HARD = 3;              // гибелей и отмоток за попытку — «далось тяжело»
  var STREAK = 2;            // сколько тяжёлых побед подряд — уже полоса
  var JUMP = 2;              // насколько следующий резче, чтобы предлагать передышку

  function Player(store) {
    this.store = store || null;
    this.data = { deaths: {}, wins: [] };
    try {
      var raw = this.store && this.store.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          this.data.deaths = d.deaths || {};
          this.data.wins = Array.isArray(d.wins) ? d.wins : [];
        }
      }
    } catch (e) { /* испорченная запись — начинаем с чистого листа */ }
  }

  Player.prototype.save = function () {
    try { if (this.store) this.store.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* приватный режим */ }
  };

  function place(x, y) { return Math.floor(x / SAME_PLACE) + ':' + Math.floor(y / SAME_PLACE); }

  /** Отметить гибель; вернуть, который это раз в этом месте этого уровня. */
  Player.prototype.noteDeath = function (id, x, y) {
    var lv = this.data.deaths[id] || (this.data.deaths[id] = {});
    var k = place(x, y);
    lv[k] = (lv[k] || 0) + 1;
    this.save();
    return lv[k];
  };

  /** Стоит ли предложить советчика после этой гибели. */
  Player.prototype.offerHint = function (timesHere) { return timesHere >= OFFER_AFTER; };

  /** Отметить победу: сколько гибелей и отмоток стоила эта попытка. */
  Player.prototype.noteWin = function (id, struggle) {
    this.data.wins.push({ id: id, hard: struggle >= HARD });
    if (this.data.wins.length > 10) this.data.wins = this.data.wins.slice(-10);
    // место гибели больше не нужно: уровень взят
    delete this.data.deaths[id];
    this.save();
  };

  /** Идёт ли тяжёлая полоса: последние STREAK побед дались тяжело. */
  Player.prototype.struggling = function () {
    var w = this.data.wins;
    if (w.length < STREAK) return false;
    for (var i = w.length - STREAK; i < w.length; i++) if (!w[i].hard) return false;
    return true;
  };

  /**
   * Что предложить вместо следующего уровня. levels — массив в порядке
   * прохождения, cur — индекс только что взятого, open(i) — открыт ли уровень,
   * done(id) — пройден ли. Возвращает индекс или -1.
   */
  Player.prototype.easier = function (levels, cur, open, done) {
    if (!this.struggling()) return -1;
    var next = levels[cur + 1];
    var here = levels[cur].rating || 0;
    if (!next || (next.rating || 0) < here + JUMP) return -1;
    var best = -1;
    for (var i = 0; i < levels.length; i++) {
      if (i === cur || i === cur + 1 || done(levels[i].id) || !open(i)) continue;
      var r = levels[i].rating || 0;
      if (r > here) continue;
      if (best < 0 || r < (levels[best].rating || 0)) best = i;
    }
    return best;
  };

  var api = { Player: Player, PLAYER_KEY: KEY };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.SP = Object.assign(global.SP || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
