/* Верхняя полоса: в каком контексте владелец находится.

   Раньше сверху стояли действия вперемешку с фильтрами: обновить, тема,
   входящие, ключи, настроить, период, площадки, магазины — восемь рядов
   управления над данными. Теперь наверху остаётся только контекст:
   где я, чей кабинет открыт, когда данные обновлялись.

   Всё, что относится к самому разделу, раздел рисует у себя. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Scope = global.Scope;
  var Menu = global.Menu;

  var host = null;
  var состояние = {
    title: '',        // название раздела
    note: '',         // строка контекста от раздела (например, период)
    updated: null,    // Date последнего обновления данных
    onRefresh: null,  // что делать по нажатию «обновить»
    scoped: false     // показывать ли выбор площадки и кабинета
  };

  function минутыНазад(когда) {
    if (!когда) return '';
    var прошло = Math.round((Date.now() - когда.getTime()) / 60000);
    if (прошло < 1) return 'обновлено только что';
    if (прошло < 60) return 'обновлено ' + прошло + ' ' +
      Fmt.plural(прошло, ['минуту', 'минуты', 'минут']) + ' назад';
    var часы = Math.round(прошло / 60);
    return 'обновлено ' + часы + ' ' + Fmt.plural(часы, ['час', 'часа', 'часов']) + ' назад';
  }

  function выборПлощадки() {
    var площадки = Scope.marketplaces();
    if (!площадки.length) return null;
    var сейчас = Scope.current();

    return Menu.picker({
      empty: 'Все площадки',
      value: сейчас.marketplace,
      items: [{ key: '', title: 'Все площадки' }].concat(
        площадки.map(function (item) {
          return { key: item.code, title: item.title, count: item.stores };
        })
      ),
      onPick: function (код) { Scope.set(код, ''); }
    });
  }

  function выборКабинета() {
    var сейчас = Scope.current();
    var кабинеты = Scope.storesOf(сейчас.marketplace);
    if (кабинеты.length < 2) return null;

    return Menu.picker({
      empty: 'Все кабинеты',
      value: сейчас.account,
      items: [{ key: '', title: 'Все кабинеты' }].concat(
        кабинеты.map(function (store) {
          return { key: store.id, title: store.title };
        })
      ),
      onPick: function (id) { Scope.set(сейчас.marketplace, id); }
    });
  }

  function render() {
    if (!host) return;
    Fmt.clear(host);

    var слева = Fmt.el('div', 'context__left');

    var заголовок = Fmt.el('div', 'context__where');
    заголовок.appendChild(Fmt.el('h1', 'context__title', состояние.title));
    if (состояние.note) {
      заголовок.appendChild(Fmt.el('span', 'context__note', состояние.note));
    }
    слева.appendChild(заголовок);

    if (состояние.scoped) {
      var выбор = Fmt.el('div', 'context__scope');
      var площадка = выборПлощадки();
      if (площадка) выбор.appendChild(площадка);
      var кабинет = выборКабинета();
      if (кабинет) выбор.appendChild(кабинет);
      if (выбор.childNodes.length) слева.appendChild(выбор);
    }
    host.appendChild(слева);

    var справа = Fmt.el('div', 'context__right');

    // Не отдельная большая кнопка, а строка состояния, по которой можно
    // нажать: сколько времени назад данные и «обновить» в одном месте.
    if (состояние.onRefresh) {
      var свежесть = Fmt.el('button', 'freshness');
      свежесть.type = 'button';
      свежесть.title = 'Обновить данные';
      свежесть.appendChild(Fmt.el('span', 'freshness__text',
        минутыНазад(состояние.updated) || 'обновить'));
      var круг = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      круг.setAttribute('viewBox', '0 0 24 24');
      круг.setAttribute('class', 'freshness__icon');
      круг.setAttribute('aria-hidden', 'true');
      var путь = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      путь.setAttribute('d', 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5');
      круг.appendChild(путь);
      свежесть.appendChild(круг);
      свежесть.addEventListener('click', function () { состояние.onRefresh(); });
      справа.appendChild(свежесть);
    }

    var поиск = Fmt.el('button', 'searchbtn');
    поиск.type = 'button';
    поиск.title = 'Поиск по панели — Cmd/Ctrl + K';
    поиск.appendChild(Fmt.el('span', null, 'Поиск'));
    поиск.appendChild(Fmt.el('kbd', 'searchbtn__key', '⌘K'));
    поиск.addEventListener('click', function () { global.Palette.open(); });
    справа.appendChild(поиск);

    host.appendChild(справа);
  }

  function mount(node) { host = node; }

  /* Раздел говорит о себе: как называется, что показать в строке
     контекста, нужен ли выбор площадки, что делать по «обновить». */
  function set(patch) {
    Object.keys(patch).forEach(function (ключ) { состояние[ключ] = patch[ключ]; });
    render();
  }

  function reset() {
    состояние = { title: '', note: '', updated: null, onRefresh: null, scoped: false };
  }

  global.Topbar = { mount: mount, render: render, set: set, reset: reset };
})(window);
