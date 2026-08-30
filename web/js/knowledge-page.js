/* Обвязка отдельной страницы «Справочник товаров».

   Справочник живёт целиком в базе панели: к площадкам страница не ходит
   вовсе и открывается мгновенно.

   Вход общий с панелью: тот же пароль и тот же ключ сеанса. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;

  var dom = {};

  function $(id) { return document.getElementById(id); }

  function toast(message) {
    var node = Fmt.el('div', 'toast', message);
    dom.toasts.appendChild(node);
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 320);
    }, 2400);
  }

  global.Toast = toast;

  /* --- тема ----------------------------------------------------------------- */

  function readStorage(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* приватный режим */ }
  }

  // Тема общая с панелью: хранится под тем же ключом.
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var dark = theme === 'dark' ||
      (theme === 'auto' && global.matchMedia &&
       global.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-preferred', dark);
  }

  function cycleTheme() {
    var order = ['auto', 'light', 'dark'];
    var now = readStorage('dashboard.theme', 'auto');
    var next = order[(order.indexOf(now) + 1) % order.length];
    writeStorage('dashboard.theme', next);
    applyTheme(next);
  }

  /* --- вход ----------------------------------------------------------------- */

  function showGate() {
    dom.gate.hidden = false;
    dom.page.hidden = true;
    dom['gate-password'].focus();
  }

  function openPage() {
    dom.gate.hidden = true;
    dom.page.hidden = false;

    global.Knowledge.mount(dom['knowledge-body']);
  }

  function init() {
    ['gate', 'gate-form', 'gate-password', 'gate-error', 'page', 'knowledge-body',
     'toasts', 'btn-reload', 'btn-theme'].forEach(function (id) {
      dom[id] = $(id);
    });

    applyTheme(readStorage('dashboard.theme', 'auto'));
    dom['btn-theme'].addEventListener('click', cycleTheme);
    dom['btn-reload'].addEventListener('click', function () { global.Knowledge.reload(); });

    dom['gate-form'].addEventListener('submit', function (event) {
      event.preventDefault();
      dom['gate-error'].hidden = true;
      Api.login(dom['gate-password'].value).then(function () {
        openPage();
      }).catch(function (error) {
        dom['gate-error'].textContent = error.message;
        dom['gate-error'].hidden = false;
      });
    });

    Api.session().then(function (session) {
      if (session.authEnabled && !session.authenticated) {
        showGate();
        return;
      }
      openPage();
    }).catch(function () {
      openPage();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
