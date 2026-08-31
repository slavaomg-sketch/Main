/* Оболочка панели: слева навигация, сверху контекст, внутри — раздел.

   До этого каждая страница была сама себе хозяйкой: свой вход по паролю,
   своя тема, свои тосты, свой набор кнопок сверху. Три почти одинаковых
   файла-загрузчика и никакого общего представления о панели.

   Теперь всё общее живёт здесь и ровно в одном экземпляре, а разделы
   стали сменными: каждый умеет `mount(node, ctx)` и `unmount()`. Внутри
   самих разделов ничего не переписано — они как работали, так и работают.

   Какой раздел показать, решает адрес строки браузера. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;
  var Router = global.Router;
  var Scope = global.Scope;

  var dom = {};
  var текущий = null;      // {name, module}
  var маршрут = null;

  function $(id) { return document.getElementById(id); }

  /* --- мелочи, которыми пользуются все разделы ------------------------------ */

  function toast(message) {
    var node = Fmt.el('div', 'toast', message);
    dom.toasts.appendChild(node);
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 320);
    }, 2400);
  }

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

  /* --- тема ----------------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var dark = theme === 'dark' ||
      (theme === 'auto' && global.matchMedia &&
       global.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-preferred', dark);
    writeStorage('dashboard.theme', theme);
  }

  function cycleTheme() {
    var order = ['auto', 'light', 'dark'];
    var now = readStorage('dashboard.theme', 'auto');
    var next = order[(order.indexOf(now) + 1) % order.length];
    applyTheme(next);
    toast(next === 'auto' ? 'Тема — как в системе'
      : next === 'light' ? 'Светлая тема' : 'Тёмная тема');
  }

  /* --- вход ----------------------------------------------------------------- */

  function showGate() {
    dom.gate.hidden = false;
    dom.shell.hidden = true;
    dom['gate-password'].focus();
  }

  function hideGate() {
    dom.gate.hidden = true;
    dom.shell.hidden = false;
  }

  /* --- разделы -------------------------------------------------------------- */

  var РАЗДЕЛЫ = {};

  /* Разделы, которые действительно читают общий контекст площадки и
     кабинета из адреса. Только у них он появляется в верхней полосе и
     только у них имеет право находиться в адресе.

     Главная в этот список не входит намеренно: у доски свои фильтры
     площадок и магазинов, и они остаются единственным источником её
     контекста до отдельного этапа. Пока это так, адрес главной не должен
     носить `mp` и `account`: иначе панель показывала бы один контекст, а
     считала другой — и ссылка закрепляла бы это расхождение. */
  var ЧИТАЮТ_КОНТЕКСТ = { catalog: 1, knowledge: 1 };

  function register(name, module) { РАЗДЕЛЫ[name] = module; }

  /* Какой раздел отвечает за этот адрес. Старые адреса переводим на новые
     здесь же: на них есть закладки и ссылки в переписке. */
  function разобрать(route) {
    var части = route.parts;
    var первая = части[0] || '';

    if (первая === 'products') return { redirect: '/catalog' };
    if (первая === 'knowledge') return { redirect: '/catalog/knowledge' };
    if (первая === 'tasks') return { redirect: '/actions' };

    if (!первая) return { name: 'dashboard' };
    if (первая === 'actions') return { name: 'actions' };
    if (первая === 'customers') return { name: 'customers' };
    // Рабочее место площадки — следующий этап. Пока адрес /mp/{код}
    // просто ведёт на главную. Контекст площадки при этом не проставляем:
    // доска его не читает, а обещать применённый фильтр, которого нет,
    // нельзя.
    if (первая === 'mp') return { redirect: '/', params: {} };
    if (первая === 'catalog') {
      return { name: части[1] === 'knowledge' ? 'knowledge' : 'catalog' };
    }
    if (первая === 'settings') return { name: 'settings' };
    return { name: 'missing' };
  }

  function показать(route) {
    маршрут = route;
    var решение = разобрать(route);

    if (решение.redirect) {
      // Старый адрес: переводим на новый, не оставляя следа в истории —
      // иначе «назад» вернуло бы на тот же старый адрес.
      var params = решение.params || route.params;
      Router.go(решение.redirect, params, { replace: true });
      return;
    }

    var модуль = РАЗДЕЛЫ[решение.name];
    if (!модуль) { решение.name = 'missing'; модуль = РАЗДЕЛЫ.missing; }

    // Адрес обязан говорить правду о применённом контексте. Убираем из
    // него площадку и кабинет в двух случаях, не оставляя следа в истории:
    //
    //   * раздел контекста не читает — например, ушли из каталога на
    //     главную по ссылке с кабинетом;
    //   * кабинета с таким номером нет — ссылка устарела или в ней опечатка,
    //     и панель показывает все кабинеты, а не тот, что написан в адресе.
    var применено = Scope.current();
    var лишний =
      (!ЧИТАЮТ_КОНТЕКСТ[решение.name] && (route.params.mp || route.params.account)) ||
      (route.params.account && !применено.account) ||
      (route.params.mp && !применено.marketplace);

    if (лишний) {
      var чистые = {};
      Object.keys(route.params).forEach(function (ключ) {
        if (ключ !== 'mp' && ключ !== 'account') чистые[ключ] = route.params[ключ];
      });
      if (ЧИТАЮТ_КОНТЕКСТ[решение.name]) {
        // В читающем разделе сохраняем то, что панель действительно приняла.
        if (применено.marketplace) чистые.mp = применено.marketplace;
        if (применено.account) чистые.account = применено.account;
      }
      Router.go(route.path, чистые, { replace: true });
      return;
    }

    // Смена раздела: прежний убираем целиком, чтобы его таймеры и
    // подписки не жили в фоне.
    if (текущий && текущий.name !== решение.name) {
      if (текущий.module.unmount) текущий.module.unmount();
      текущий = null;
    }

    var ctx = { route: route, scope: Scope.current(), shell: global.Shell };

    if (!текущий) {
      Fmt.clear(dom.outlet);
      global.Topbar.reset();
      текущий = { name: решение.name, module: модуль };
      модуль.mount(dom.outlet, ctx);
    } else {
      // Тот же раздел, изменился адрес внутри него — например, выбрали
      // другой кабинет. Перерисовываем без пересборки с нуля.
      //
      // Полосу контекста перерисовываем обязательно: иначе подпись в ней
      // осталась бы от прошлого выбора, и владелец видел бы одно, а данные
      // показывали другое. Расхождение между шапкой и содержимым — худшее,
      // что панель может себе позволить.
      global.Topbar.render();
      if (модуль.update) модуль.update(ctx);
    }

    global.Sidebar.render(route);
    закрытьЯщик();
  }

  /* --- узкий экран: навигация становится выдвижным ящиком ------------------- */

  function открытьЯщик() {
    dom.shell.classList.add('is-drawer-open');
  }

  function закрытьЯщик() {
    dom.shell.classList.remove('is-drawer-open');
  }

  /* --- запуск --------------------------------------------------------------- */

  function start() {
    Scope.load()
      .then(function () {
        global.Sidebar.render(Router.read());
        показать(Router.read());
      })
      .catch(function (error) {
        if (error && error.status === 401) { showGate(); return; }
        // Список площадок не пришёл — панель всё равно должна открыться.
        показать(Router.read());
      });
  }

  function init() {
    ['gate', 'gate-form', 'gate-password', 'gate-error', 'shell', 'sidebar',
     'context', 'outlet', 'toasts', 'btn-theme', 'btn-menu', 'drawer-backdrop']
      .forEach(function (id) { dom[id] = $(id); });

    applyTheme(readStorage('dashboard.theme', 'auto'));
    global.Sidebar.mount(dom.sidebar);
    global.Topbar.mount(dom.context);

    dom['btn-theme'].addEventListener('click', cycleTheme);
    dom['btn-menu'].addEventListener('click', открытьЯщик);
    dom['drawer-backdrop'].addEventListener('click', закрытьЯщик);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') закрытьЯщик();
    });

    Router.subscribe(показать);

    dom['gate-form'].addEventListener('submit', function (event) {
      event.preventDefault();
      dom['gate-error'].hidden = true;
      Api.login(dom['gate-password'].value).then(function () {
        hideGate();
        start();
      }).catch(function (error) {
        dom['gate-error'].textContent = error.message;
        dom['gate-error'].hidden = false;
      });
    });

    Api.session().then(function (session) {
      if (session.authEnabled && !session.authenticated) { showGate(); return; }
      hideGate();
      start();
    }).catch(function () {
      hideGate();
      start();
    });
  }

  global.Shell = {
    register: register,
    toast: toast,
    read: readStorage,
    write: writeStorage,
    showGate: showGate,
    route: function () { return маршрут; },
    reloadScope: function () {
      Scope.all().loaded = false;
      return Scope.load().then(function () { global.Sidebar.render(Router.read()); });
    }
  };

  // Разделы зовут уведомления через общее имя — так было и раньше.
  global.Toast = toast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
