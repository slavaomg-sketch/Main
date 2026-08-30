/*
 * Советчик. Работает не от начала уровня, а от того положения, в котором
 * игрок сейчас стоит, — потому и умеет то, чего обычная подсказка не умеет.
 *
 * Три слоя, и каждый честно знает, насколько он уверен:
 *
 *  1. ПРОВАЛ — доказанный. Считаем, до чего Мёрфи вообще может добраться,
 *     нарочно завышая его возможности: сквозь грунт и валуны, через порты
 *     в обе стороны, не считаясь с тяжестью. Если даже при таких поблажках
 *     оставшихся инфотронов не хватает на норму или выход недостижим —
 *     уровень уже проигран, и это не догадка. Ошибиться в другую сторону
 *     оценка не может: она щедрая.
 *  2. СМЕРТЬ — доказанная в пределах горизонта. Для каждого хода ищем, есть
 *     ли хоть какое-то продолжение, при котором Мёрфи проживёт HORIZON тактов.
 *     Нет ни одного — ход смертелен. Обход в глубину: удачное продолжение
 *     находится сразу, а безнадёжное дерево само себя обрубает гибелью.
 *  3. СОВЕТ — догадка. Ближайшая невзятая добыча по карте, и первый шаг к ней.
 */
(function (global) {
  'use strict';
  var SP = global.SP || {};
  var T = SP.Tiles || (typeof require === 'function' ? require('./tiles.js').Tiles : null);
  var DIRS = SP.DIRS || (typeof require === 'function' ? require('./tiles.js').DIRS : null);
  var PORT_DIR = SP.PORT_DIR || (typeof require === 'function' ? require('./tiles.js').PORT_DIR : null);

  var HORIZON = 14;          // на столько тактов вперёд доказываем выживание
  var NODES = 12000;         // потолок обхода, чтобы игра не подвисала

  var ACTIONS = [{ dir: -1, snap: false }];
  for (var d = 0; d < 4; d++) { ACTIONS.push({ dir: d, snap: false }); ACTIONS.push({ dir: d, snap: true }); }

  /* Есть ли на карте чем взрывать: от этого зависит, считать ли чип стеной. */
  function canBlast(e) {
    for (var i = 0; i < e.tiles.length; i++) {
      var t = e.tiles[i];
      if (t === T.ORANGE || t === T.RED || t === T.YELLOW || t === T.TERMINAL || t === T.ELECTRON) return true;
    }
    return false;
  }

  /*
   * Куда Мёрфи мог бы добраться, если ему во всём подыграть: сквозь грунт,
   * валуны и заряды, через порты в обе стороны. Чип и жука считаем проходимыми
   * только там, где на карте вообще есть чем взрывать. Под тяжестью не пускаем
   * вверх — это не поблажка, а закон: наверх оттуда хода нет.
   */
  function optimisticReach(e) {
    var blast = canBlast(e);
    // Рубильник тяжести отменяет запрет на подъём: выключил — и полез вверх.
    var canFly = false;
    for (var g = 0; g < e.tiles.length; g++) if (e.tiles[g] === T.GRAV_OFF) { canFly = true; break; }
    var noUp = e.gravity && !canFly;
    var seen = new Uint8Array(e.w * e.h);
    // разлив идёт от всех героев сразу: добыча, до которой дотянется только
    // напарник, тоже считается достижимой — иначе советчик соврёт «не пройти»
    var q = [];
    for (var hh = 0; hh < e.heroes.length; hh++) {
      var hm = e.heroes[hh];
      if (!hm.out && hm.alive) q.push(hm.y * e.w + hm.x);
    }
    if (!q.length) q.push(e.murphy.y * e.w + e.murphy.x);
    for (var s0 = 0; s0 < q.length; s0++) seen[q[s0]] = 1;
    var info = 0, elec = 0, exit = false;
    for (var h = 0; h < q.length; h++) {
      var i = q[h], x = i % e.w, y = (i - x) / e.w;
      var t = e.tiles[i];
      // Горящий инфотронный взрыв — это будущие инфотроны, их тоже считаем
      if (t === T.INFOTRON || t === T.EXPLOSION_INFO) info++;
      if (t === T.ELECTRON) elec++;
      if (t === T.EXIT) { exit = true; continue; }
      for (var k = 0; k < 4; k++) {
        if (noUp && DIRS[k][1] < 0) continue;                // под тяжестью вверх никак
        var nx = x + DIRS[k][0], ny = y + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= e.w || ny >= e.h) continue;
        var j = ny * e.w + nx;
        if (seen[j]) continue;
        var tt = e.tiles[j];
        if (tt === T.WALL) continue;                         // стену не берёт ничто
        if (!blast && (tt === T.CHIP || tt === T.BUG)) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    // каждый достижимый электрон при удаче даёт до девяти инфотронов
    return { infotrons: info + (blast ? elec * 9 : 0), exit: exit };
  }

  /** Доказано ли, что уровень уже не пройти. */
  function lost(e) {
    if (e.status === 'dead' || e.status === 'dying') return 'Мёрфи погиб';
    var r = optimisticReach(e);
    if (e.collected + r.infotrons < e.needed) {
      return 'инфотронов больше не набрать: нужно ' + e.needed +
        ', собрано ' + e.collected + ', а достать можно самое большее ещё ' + r.infotrons;
    }
    if (!r.exit) return 'до выхода уже не добраться';
    return null;
  }

  /* Есть ли продолжение, при котором Мёрфи проживёт ещё depth тактов. */
  function survives(e, depth, budget) {
    if (e.status === 'won') return true;
    if (e.status !== 'playing') return false;
    if (depth <= 0) return true;
    var seen = budget.seen;
    for (var a = 0; a < ACTIONS.length; a++) {
      if (budget.left <= 0) return true;          // упёрлись в потолок — не врём, считаем живым
      var n = e.clone();
      n.step(ACTIONS[a]);
      budget.left--;
      if (n.status === 'dead' || n.status === 'dying') continue;
      if (n.status === 'won') return true;
      var key = n.key() + '|' + (n.ticks % 12) + '|' + depth;
      if (seen[key]) continue;
      seen[key] = 1;
      if (survives(n, depth - 1, budget)) return true;
    }
    return false;
  }

  /* Ходы, после которых заведомо не прожить горизонт. */
  function fatalMoves(e, horizon) {
    var out = [];
    for (var d = 0; d < 4; d++) {
      var n = e.clone();
      var before = n.key();
      n.step({ dir: d, snap: false });
      if (n.key() === before) continue;           // ход невозможен — о нём и говорить нечего
      var bad = n.status === 'dead' || n.status === 'dying';
      if (!bad) bad = !survives(n, (horizon || HORIZON) - 1, { seen: {}, left: NODES, });
      if (bad) out.push(d);
    }
    return out;
  }

  /*
   * Первый шаг к ближайшей невзятой добыче (или к выходу, если норма набрана).
   * Считается для первого героя. Когда героев двое, один и тот же ход ведёт
   * обоих, и «ближайшая добыча одного» ничего не говорит про второго — такой
   * совет был бы не догадкой, а обманом, поэтому вдвоём он не выдаётся вовсе.
   */
  function stepToward(e) {
    if (e.heroes.length > 1) return -1;
    var goalExit = e.collected >= e.needed;
    var prev = new Int32Array(e.w * e.h).fill(-1);
    var seen = new Uint8Array(e.w * e.h);
    var start = e.murphy.y * e.w + e.murphy.x;
    var q = [start];
    seen[start] = 1;
    for (var h = 0; h < q.length; h++) {
      var i = q[h], x = i % e.w, y = (i - x) / e.w, t = e.tiles[i];
      if (i !== start && ((goalExit && t === T.EXIT) || (!goalExit && t === T.INFOTRON))) {
        var cur = i;
        while (prev[cur] !== start) cur = prev[cur];
        var cx = cur % e.w, cy = (cur - cx) / e.w;
        for (var k = 0; k < 4; k++) if (e.murphy.x + DIRS[k][0] === cx && e.murphy.y + DIRS[k][1] === cy) return k;
        return -1;
      }
      for (var d2 = 0; d2 < 4; d2++) {
        var nx = x + DIRS[d2][0], ny = y + DIRS[d2][1];
        if (nx < 0 || ny < 0 || nx >= e.w || ny >= e.h) continue;
        var j = ny * e.w + nx;
        if (seen[j]) continue;
        var tt = e.tiles[j];
        var pass = tt === T.EMPTY || tt === T.BASE || tt === T.INFOTRON ||
          (tt === T.EXIT && goalExit) || (PORT_DIR && PORT_DIR[tt] === d2);
        if (!pass) continue;
        seen[j] = 1; prev[j] = i; q.push(j);
      }
    }
    return -1;
  }

  /** Полный совет для текущего положения. */
  function advise(e, opts) {
    opts = opts || {};
    var why = lost(e);
    if (why) return { verdict: 'lost', reason: why };
    var fatal = fatalMoves(e, opts.horizon || HORIZON);
    // Откуда взялся совет — важнее самого совета. 'goal' — ход к ближайшей
    // добыче; 'safe' — просто ход, который не убивает. Раньше запасной 'safe'
    // выдавался за 'goal', и на уровнях вдвоём (где дороги советчик не знает
    // вовсе) выходило прямое враньё.
    var source = 'goal';
    var dir = stepToward(e);
    if (dir >= 0 && fatal.indexOf(dir) >= 0) dir = -1;
    if (dir < 0) {
      source = 'safe';
      for (var d = 0; d < 4; d++) {
        if (fatal.indexOf(d) >= 0) continue;
        var n = e.clone(), before = n.key();
        n.step({ dir: d, snap: false });
        if (n.key() !== before) { dir = d; break; }
      }
    }
    return { verdict: 'ok', fatal: fatal, dir: dir, source: dir >= 0 ? source : null };
  }

  var api = { advise: advise, lost: lost, fatalMoves: fatalMoves, stepToward: stepToward,
              optimisticReach: optimisticReach, HORIZON: HORIZON };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.SP = Object.assign(global.SP || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
