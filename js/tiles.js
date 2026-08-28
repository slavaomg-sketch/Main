/*
 * Tiles — базовый словарь элементов мира.
 * Файл работает и в браузере (global SP), и в Node (module.exports).
 */
(function (global) {
  'use strict';

  var Tiles = {
    EMPTY: 0,
    BASE: 1,        // грунт, который Мёрфи прогрызает
    MURPHY: 2,
    INFOTRON: 3,    // то, что собираем
    ZONK: 4,        // валун
    WALL: 5,        // hardware — неразрушим
    CHIP: 6,        // чип — разрушается взрывом, зонки с него скатываются
    EXIT: 7,
    SNIKSNAK: 8,    // монстр, идёт вдоль стен левой рукой
    ELECTRON: 9,    // монстр, идёт правой рукой, взрывается инфотронами
    ORANGE: 10,     // оранжевый диск: падает как зонк и детонирует при ударе
    PORT_U: 11,     // порт пропускает только в свою сторону
    PORT_R: 12,
    PORT_D: 13,
    PORT_L: 14,
    EXPLOSION: 15,
    EXPLOSION_INFO: 16,
    BUG: 17          // жук: с места не сходит, но раз в цикл вспыхивает и бьёт соседа
  };

  var NAMES = {};
  Object.keys(Tiles).forEach(function (k) { NAMES[Tiles[k]] = k; });

  // Символы для текстовых карт уровней.
  var CHARS = {
    ' ': Tiles.EMPTY,
    '.': Tiles.BASE,
    '#': Tiles.WALL,
    '=': Tiles.CHIP,
    'O': Tiles.ZONK,
    '*': Tiles.INFOTRON,
    'M': Tiles.MURPHY,
    'E': Tiles.EXIT,
    'S': Tiles.SNIKSNAK,
    'e': Tiles.ELECTRON,
    'o': Tiles.ORANGE,
    '^': Tiles.PORT_U,
    '>': Tiles.PORT_R,
    'v': Tiles.PORT_D,
    '<': Tiles.PORT_L,
    // Жук. Цифра — сдвиг фазы в тиках: так в коридоре набирается бегущая волна.
    'B': Tiles.BUG,
    '1': Tiles.BUG, '2': Tiles.BUG, '3': Tiles.BUG, '4': Tiles.BUG,
    '5': Tiles.BUG, '6': Tiles.BUG, '7': Tiles.BUG, '8': Tiles.BUG, '9': Tiles.BUG
  };

  // Сдвиг фазы жука по символу карты ('B' — нулевая фаза).
  var BUG_PHASE = { B: 0 };
  for (var d = 1; d <= 9; d++) BUG_PHASE[String(d)] = d;

  var TO_CHAR = {};
  Object.keys(CHARS).forEach(function (c) { if (TO_CHAR[CHARS[c]] === undefined) TO_CHAR[CHARS[c]] = c; });
  TO_CHAR[Tiles.BUG] = 'B';        // фаза в текстовый дамп не попадает — она нужна только карте
  TO_CHAR[Tiles.EXPLOSION] = '!';
  TO_CHAR[Tiles.EXPLOSION_INFO] = '!';

  // Направления: 0 вверх, 1 вправо, 2 вниз, 3 влево.
  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  var PORT_DIR = {};
  PORT_DIR[Tiles.PORT_U] = 0;
  PORT_DIR[Tiles.PORT_R] = 1;
  PORT_DIR[Tiles.PORT_D] = 2;
  PORT_DIR[Tiles.PORT_L] = 3;

  var api = { Tiles: Tiles, NAMES: NAMES, CHARS: CHARS, TO_CHAR: TO_CHAR, DIRS: DIRS,
              PORT_DIR: PORT_DIR, BUG_PHASE: BUG_PHASE };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.SP = Object.assign(global.SP || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
