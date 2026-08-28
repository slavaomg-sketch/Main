/*
 * Приветствие: тёплая заставка с летящими инфотронами. Показывается при запуске,
 * ждёт нажатия — чтобы было время прочитать, а не мелькнуло и исчезло.
 */
(function (global) {
  'use strict';
  var SP = global.SP;

  function Welcome(root, canvas) {
    this.root = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.sparks = [];
    this.raf = 0;
    this.t0 = 0;
  }

  Welcome.prototype.resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = this.root.clientWidth, h = this.root.clientHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  };

  Welcome.prototype.seed = function () {
    var size = Math.max(26, Math.min(52, Math.round(this.w / 22)));
    this.pack = SP.Sprites.build(size);
    this.size = size;
    this.parts = [];
    var n = Math.max(14, Math.min(30, Math.round(this.w / 44)));
    for (var i = 0; i < n; i++) {
      this.parts.push({
        x: Math.random() * this.w,
        y: -Math.random() * this.h - size,
        vy: 60 + Math.random() * 90,
        vx: (Math.random() - 0.5) * 40,
        spin: (Math.random() - 0.5) * 2,
        a: Math.random() * 6.28,
        bounce: 0.55 + Math.random() * 0.2,
        delay: Math.random() * 1.2
      });
    }
    this.sparks = [];
    for (var k = 0; k < 90; k++) {
      var ang = Math.random() * 6.2832, sp = 90 + Math.random() * 320;
      this.sparks.push({
        x: this.w / 2, y: this.h * 0.42,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 60,
        life: 1, hue: [42, 28, 150, 8][k % 4], size: 2 + Math.random() * 4
      });
    }
  };

  Welcome.prototype.frame = function (ts) {
    var self = this;
    if (!this.t0) this.t0 = ts;
    var t = (ts - this.t0) / 1000;
    var dt = Math.min(0.05, (ts - (this.last || ts)) / 1000);
    this.last = ts;
    var g = this.ctx;

    g.clearRect(0, 0, this.w, this.h);

    // тёплое сияние из центра
    var glow = g.createRadialGradient(this.w / 2, this.h * 0.42, 10, this.w / 2, this.h * 0.42, Math.max(this.w, this.h) * 0.7);
    var pulse = 0.28 + 0.06 * Math.sin(t * 2);
    glow.addColorStop(0, 'rgba(255,190,90,' + pulse + ')');
    glow.addColorStop(0.45, 'rgba(255,130,60,0.10)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, this.w, this.h);

    // конфетти-вспышка первых секунд
    this.sparks.forEach(function (s) {
      if (s.life <= 0) return;
      s.life -= dt * 0.55;
      s.vy += 420 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      g.globalAlpha = Math.max(0, s.life);
      g.fillStyle = 'hsl(' + s.hue + ' 95% 62%)';
      g.beginPath();
      g.arc(s.x, s.y, s.size, 0, 6.2832);
      g.fill();
    });
    g.globalAlpha = 1;

    // падающие инфотроны, подпрыгивающие у нижнего края
    var floor = this.h - this.size * 0.6;
    this.parts.forEach(function (p) {
      if (t < p.delay) return;
      p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.a += p.spin * dt;
      if (p.y > floor) { p.y = floor; p.vy = -Math.abs(p.vy) * p.bounce; p.vx *= 0.86; }
      if (p.x < -self.size) p.x = self.w + self.size;
      if (p.x > self.w + self.size) p.x = -self.size;
      g.save();
      g.translate(p.x, p.y);
      // мягкий ореол, чтобы шарики светились, а не лежали тёмными кружками
      var halo = g.createRadialGradient(0, 0, self.size * 0.15, 0, 0, self.size * 0.85);
      halo.addColorStop(0, 'rgba(255,190,90,0.45)');
      halo.addColorStop(1, 'rgba(255,150,50,0)');
      g.fillStyle = halo;
      g.beginPath(); g.arc(0, 0, self.size * 0.85, 0, 6.2832); g.fill();
      g.rotate(Math.sin(p.a) * 0.25);
      g.drawImage(self.pack.tile[SP.Tiles.INFOTRON], -self.size / 2, -self.size / 2, self.size, self.size);
      g.restore();
    });

    // Мёрфи машет рукой внизу
    var mx = this.w / 2, my = this.h - this.size * 1.1 + Math.sin(t * 3) * this.size * 0.12;
    g.save();
    g.translate(mx, my);
    g.rotate(Math.sin(t * 3) * 0.12);
    g.drawImage(this.pack.murphy[2], -this.size * 0.9, -this.size * 0.9, this.size * 1.8, this.size * 1.8);
    g.restore();

    this.raf = global.requestAnimationFrame(function (n) { self.frame(n); });
  };

  Welcome.prototype.start = function () {
    var self = this;
    this.resize();
    this.seed();
    this.t0 = 0;
    this.last = 0;
    this.onResize = function () { self.resize(); self.seed(); };
    global.addEventListener('resize', this.onResize);
    this.raf = global.requestAnimationFrame(function (n) { self.frame(n); });
  };

  Welcome.prototype.stop = function () {
    global.cancelAnimationFrame(this.raf);
    if (this.onResize) global.removeEventListener('resize', this.onResize);
  };

  SP.Welcome = Welcome;
})(typeof globalThis !== 'undefined' ? globalThis : this);
