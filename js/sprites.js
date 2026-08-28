/*
 * Спрайты рисуются процедурно в offscreen-канвасы — никаких внешних картинок,
 * игра остаётся одним самодостаточным набором файлов.
 */
(function (global) {
  'use strict';
  var T = global.SP.Tiles;

  function cv(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  // предсказуемый «шум» для крапа на грунте
  function noise(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawBase(g, s) {
    var grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#6b5238');
    grad.addColorStop(1, '#4a3626');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    for (var i = 0; i < 26; i++) {
      var x = noise(i) * s, y = noise(i + 50) * s, r = 0.02 * s + noise(i + 90) * 0.035 * s;
      g.fillStyle = noise(i + 7) > 0.5 ? 'rgba(255,225,190,0.18)' : 'rgba(30,18,10,0.30)';
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = Math.max(1, s * 0.03);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, s - g.lineWidth, s - g.lineWidth);
  }

  function drawWall(g, s) {
    g.fillStyle = '#20293f';
    g.fillRect(0, 0, s, s);
    var b = s * 0.09;
    rr(g, b, b, s - 2 * b, s - 2 * b, s * 0.13);
    var grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#46557e');
    grad.addColorStop(0.5, '#334062');
    grad.addColorStop(1, '#232c45');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(150,180,255,0.22)';
    g.lineWidth = Math.max(1, s * 0.05);
    g.stroke();
  }

  function drawChip(g, s) {
    g.fillStyle = '#0d2a1c';
    g.fillRect(0, 0, s, s);
    var b = s * 0.1;
    rr(g, b, b, s - 2 * b, s - 2 * b, s * 0.08);
    g.fillStyle = '#1d6b45';
    g.fill();
    g.strokeStyle = '#4ee39a';
    g.lineWidth = Math.max(1, s * 0.04);
    g.stroke();
    g.strokeStyle = 'rgba(120,255,190,0.55)';
    g.lineWidth = Math.max(1, s * 0.045);
    for (var i = 0; i < 3; i++) {
      var y = s * (0.32 + i * 0.18);
      g.beginPath(); g.moveTo(s * 0.24, y); g.lineTo(s * 0.5, y); g.lineTo(s * 0.5, y + s * 0.1); g.lineTo(s * 0.76, y + s * 0.1);
      g.stroke();
    }
  }

  function sphere(g, s, cx, cy, r, c1, c2, c3) {
    var grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    grad.addColorStop(0, c1);
    grad.addColorStop(0.55, c2);
    grad.addColorStop(1, c3);
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
  }

  function drawZonk(g, s) {
    var r = s * 0.44;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(s / 2, s * 0.86, r * 0.8, r * 0.18, 0, 0, 6.2832); g.fill();
    sphere(g, s, s / 2, s / 2, r, '#cfd8e6', '#8792a6', '#3b4457');
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = Math.max(1, s * 0.03);
    g.beginPath(); g.arc(s / 2, s / 2, r * 0.98, Math.PI * 1.15, Math.PI * 1.75); g.stroke();
  }

  function drawInfotron(g, s) {
    var r = s * 0.4;
    g.save();
    g.shadowColor = 'rgba(255,170,40,0.9)';
    g.shadowBlur = s * 0.35;
    sphere(g, s, s / 2, s / 2, r, '#fff0c0', '#ffb02e', '#a04a00');
    g.restore();
    g.strokeStyle = 'rgba(255,240,200,0.85)';
    g.lineWidth = Math.max(1, s * 0.055);
    g.beginPath(); g.arc(s / 2, s / 2, r * 0.55, 0, 6.2832); g.stroke();
  }

  function drawOrange(g, s) {
    var r = s * 0.42;
    sphere(g, s, s / 2, s / 2, r, '#ffd9a0', '#ff7a18', '#7a2b00');
    g.strokeStyle = 'rgba(60,20,0,0.75)';
    g.lineWidth = Math.max(1, s * 0.07);
    g.beginPath(); g.moveTo(s / 2 - r * 0.75, s / 2 - r * 0.25); g.lineTo(s / 2 + r * 0.75, s / 2 - r * 0.25); g.stroke();
    g.beginPath(); g.moveTo(s / 2 - r * 0.75, s / 2 + r * 0.3); g.lineTo(s / 2 + r * 0.75, s / 2 + r * 0.3); g.stroke();
  }

  function drawExit(g, s, open) {
    g.fillStyle = '#0a0d14';
    g.fillRect(0, 0, s, s);
    var cx = s / 2, cy = s / 2, r = s * 0.4;
    // корпус шлюза
    var grad = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    grad.addColorStop(0, open ? '#0e5c3c' : '#161b28');
    grad.addColorStop(1, open ? '#04160f' : '#0b0e17');
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
    // внешнее кольцо с болтами
    g.strokeStyle = open ? '#4dff9f' : '#5b6478';
    g.lineWidth = Math.max(2, s * 0.09);
    g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.stroke();
    g.fillStyle = open ? '#a9ffd2' : '#7d88a8';
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4 + Math.PI / 8;
      g.beginPath(); g.arc(cx + Math.cos(a) * r * 0.99, cy + Math.sin(a) * r * 0.99, s * 0.035, 0, 6.2832); g.fill();
    }
    // створки
    g.strokeStyle = open ? 'rgba(169,255,210,0.85)' : 'rgba(125,136,168,0.7)';
    g.lineWidth = Math.max(1, s * 0.06);
    g.beginPath();
    g.moveTo(cx - r * 0.55, cy); g.lineTo(cx + r * 0.55, cy);
    g.moveTo(cx, cy - r * 0.55); g.lineTo(cx, cy + r * 0.55);
    g.stroke();
    if (open) {
      g.save();
      g.globalAlpha = 0.5;
      g.fillStyle = '#4dff9f';
      g.beginPath(); g.arc(cx, cy, r * 0.42, 0, 6.2832); g.fill();
      g.restore();
    }
  }

  function drawPort(g, s, dir) {
    g.fillStyle = '#0c1120';
    g.fillRect(0, 0, s, s);
    var b = s * 0.12;
    rr(g, b, b, s - 2 * b, s - 2 * b, s * 0.1);
    g.fillStyle = '#141c33';
    g.fill();
    g.strokeStyle = '#3d63c9';
    g.lineWidth = Math.max(1, s * 0.05);
    g.stroke();
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate([Math.PI, -Math.PI / 2, 0, Math.PI / 2][dir]);   // стрелка по направлению прохода
    g.strokeStyle = '#8fb4ff';
    g.lineWidth = Math.max(1, s * 0.1);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(0, -s * 0.2); g.lineTo(0, s * 0.2);
    g.moveTo(-s * 0.15, s * 0.05); g.lineTo(0, s * 0.2); g.lineTo(s * 0.15, s * 0.05);
    g.stroke();
    g.restore();
  }

  /* ---------- герои: два облика на выбор ---------- */

  // Мёрфи: зелёный шарик в скафандре — облик в духе Supaplex
  function drawMurphy(g, s, facing) {
    var r = s * 0.42;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.ellipse(s / 2, s * 0.9, r * 0.75, r * 0.15, 0, 0, 6.2832); g.fill();
    sphere(g, s, s / 2, s / 2, r, '#d8ffe9', '#37d18a', '#0d6b46');
    var dx = [0, 0.1, 0, -0.1][facing] * s;
    var dy = [-0.09, 0, 0.09, 0][facing] * s;
    g.fillStyle = '#07231a';
    g.beginPath(); g.arc(s / 2 - s * 0.13 + dx, s / 2 - s * 0.05 + dy, s * 0.075, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(s / 2 + s * 0.13 + dx, s / 2 - s * 0.05 + dy, s * 0.075, 0, 6.2832); g.fill();
    g.strokeStyle = '#07231a';
    g.lineWidth = Math.max(1, s * 0.05);
    g.lineCap = 'round';
    g.beginPath();
    g.arc(s / 2 + dx * 0.5, s / 2 + s * 0.1 + dy * 0.5, s * 0.16, 0.25 * Math.PI, 0.75 * Math.PI);
    g.stroke();
  }

  // Копатель: мальчишка в каске — облик в духе Boulder Dash
  function drawDigger(g, s, facing) {
    var cx = s / 2;
    var dx = [0, 0.05, 0, -0.05][facing] * s;
    var dy = [-0.045, 0, 0.045, 0][facing] * s;
    var ink = 'rgba(8,12,24,0.85)';

    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(cx, s * 0.94, s * 0.32, s * 0.055, 0, 0, 6.2832); g.fill();

    // башмаки
    g.fillStyle = '#1b1410';
    rr(g, cx - s * 0.3, s * 0.82, s * 0.24, s * 0.11, s * 0.045); g.fill();
    rr(g, cx + s * 0.06, s * 0.82, s * 0.24, s * 0.11, s * 0.045); g.fill();

    // руки
    g.strokeStyle = ink;
    g.lineWidth = Math.max(2, s * 0.115);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - s * 0.26, s * 0.56); g.lineTo(cx - s * 0.4, s * 0.72);
    g.moveTo(cx + s * 0.26, s * 0.56); g.lineTo(cx + s * 0.4, s * 0.72);
    g.stroke();
    g.strokeStyle = '#f0bd8c';
    g.lineWidth = Math.max(1, s * 0.075);
    g.beginPath();
    g.moveTo(cx - s * 0.26, s * 0.56); g.lineTo(cx - s * 0.4, s * 0.72);
    g.moveTo(cx + s * 0.26, s * 0.56); g.lineTo(cx + s * 0.4, s * 0.72);
    g.stroke();

    // комбинезон
    var body = g.createLinearGradient(0, s * 0.42, 0, s * 0.88);
    body.addColorStop(0, '#6f9dfb');
    body.addColorStop(1, '#22409a');
    g.fillStyle = body;
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1.5, s * 0.06);
    rr(g, cx - s * 0.3, s * 0.42, s * 0.6, s * 0.46, s * 0.14);
    g.fill(); g.stroke();

    // лямки
    g.strokeStyle = '#ffd36b';
    g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath();
    g.moveTo(cx - s * 0.14, s * 0.44); g.lineTo(cx - s * 0.12, s * 0.66);
    g.moveTo(cx + s * 0.14, s * 0.44); g.lineTo(cx + s * 0.12, s * 0.66);
    g.stroke();

    // голова
    var head = g.createRadialGradient(cx - s * 0.07 + dx, s * 0.28 + dy, s * 0.03, cx + dx, s * 0.31 + dy, s * 0.27);
    head.addColorStop(0, '#ffeed3');
    head.addColorStop(1, '#d8935a');
    g.fillStyle = head;
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1.5, s * 0.055);
    g.beginPath(); g.arc(cx + dx, s * 0.33 + dy, s * 0.25, 0, 6.2832);
    g.fill(); g.stroke();

    // каска с фонарём
    g.fillStyle = '#ef4b3c';
    g.beginPath();
    g.arc(cx + dx, s * 0.31 + dy, s * 0.27, Math.PI * 1.0, Math.PI * 2.0);
    g.closePath(); g.fill();
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1, s * 0.045);
    g.stroke();
    g.fillStyle = '#b32f24';
    rr(g, cx - s * 0.32 + dx, s * 0.28 + dy, s * 0.64, s * 0.065, s * 0.03);
    g.fill();
    g.fillStyle = '#fff0a0';
    g.beginPath(); g.arc(cx + dx, s * 0.155 + dy, s * 0.06, 0, 6.2832); g.fill();
    g.strokeStyle = ink; g.lineWidth = Math.max(1, s * 0.03); g.stroke();

    // глаза — смотрят туда же, куда идём
    var ex = [0, 0.035, 0, -0.035][facing] * s;
    var ey = [-0.025, 0, 0.03, 0][facing] * s;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(cx - s * 0.095 + dx, s * 0.385 + dy, s * 0.075, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(cx + s * 0.095 + dx, s * 0.385 + dy, s * 0.075, 0, 6.2832); g.fill();
    g.fillStyle = '#141b2c';
    g.beginPath(); g.arc(cx - s * 0.095 + dx + ex, s * 0.385 + dy + ey, s * 0.04, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(cx + s * 0.095 + dx + ex, s * 0.385 + dy + ey, s * 0.04, 0, 6.2832); g.fill();
  }

  var SKINS = [
    { id: 'murphy', name: 'Мёрфи', note: 'зелёный шарик в скафандре', draw: drawMurphy },
    { id: 'digger', name: 'Копатель', note: 'мальчишка в каске', draw: drawDigger }
  ];
  function skinById(id) {
    for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
    return SKINS[0];
  }

  function drawSnik(g, s) {
    var b = s * 0.14;
    rr(g, b, b, s - 2 * b, s - 2 * b, s * 0.22);
    var grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#e05bff');
    grad.addColorStop(1, '#6c1a8c');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = '#ffd0ff';
    g.lineWidth = Math.max(1, s * 0.04);
    g.stroke();
    g.fillStyle = '#1b0620';
    g.beginPath(); g.arc(s * 0.37, s * 0.42, s * 0.07, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(s * 0.63, s * 0.42, s * 0.07, 0, 6.2832); g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    for (var i = 0; i < 4; i++) {
      var x = s * (0.3 + i * 0.14);
      g.moveTo(x, s * 0.62); g.lineTo(x + s * 0.07, s * 0.74); g.lineTo(x + s * 0.14, s * 0.62);
    }
    g.fill();
  }

  function drawElectron(g, s, phase) {
    var r = s * 0.34;
    g.save();
    g.shadowColor = 'rgba(120,220,255,0.9)';
    g.shadowBlur = s * 0.4;
    sphere(g, s, s / 2, s / 2, r, '#ffffff', '#66d9ff', '#0b4a7a');
    g.restore();
    g.strokeStyle = 'rgba(180,240,255,0.9)';
    g.lineWidth = Math.max(1, s * 0.04);
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(phase);
    g.beginPath(); g.ellipse(0, 0, r * 1.35, r * 0.45, 0, 0, 6.2832); g.stroke();
    g.rotate(2.1);
    g.beginPath(); g.ellipse(0, 0, r * 1.35, r * 0.45, 0, 0, 6.2832); g.stroke();
    g.restore();
  }

  function drawBlast(g, s, k, info) {
    var r = s * (0.2 + 0.32 * k);
    var grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, info ? '#ffd166' : '#ffb02e');
    grad.addColorStop(1, info ? 'rgba(255,140,0,0)' : 'rgba(255,60,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(s / 2, s / 2, r, 0, 6.2832); g.fill();
  }

  /** Готовит статические спрайты под текущий размер клетки. */
  function build(size, skinId) {
    var skin = skinById(skinId);
    var pack = { size: size, skin: skin.id, tile: {}, murphy: [], port: [], exitOpen: null };
    function make(fn) {
      var c = cv(size);
      fn(c.getContext('2d'), size);
      return c;
    }
    pack.tile[T.BASE] = make(drawBase);
    pack.tile[T.WALL] = make(drawWall);
    pack.tile[T.CHIP] = make(drawChip);
    pack.tile[T.ZONK] = make(drawZonk);
    pack.tile[T.INFOTRON] = make(drawInfotron);
    pack.tile[T.ORANGE] = make(drawOrange);
    pack.tile[T.SNIKSNAK] = make(drawSnik);
    pack.tile[T.EXIT] = make(function (g, s) { drawExit(g, s, false); });
    pack.exitOpen = make(function (g, s) { drawExit(g, s, true); });
    for (var d = 0; d < 4; d++) {
      (function (dd) {
        pack.murphy[dd] = make(function (g, s) { skin.draw(g, s, dd); });
        pack.port[dd] = make(function (g, s) { drawPort(g, s, dd); });
      })(d);
    }
    return pack;
  }

  global.SP = Object.assign(global.SP, {
    Sprites: {
      build: build, drawElectron: drawElectron, drawBlast: drawBlast,
      skins: SKINS, skin: skinById,
      drawHero: function (g, size, facing, id) { skinById(id).draw(g, size, facing); }
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
