/* Быстрый переход по Cmd/Ctrl + K.

   На первом шаге это навигация: разделы, площадки, кабинеты. Место для
   поиска товара и карточки заложено — список пунктов собирается из
   источников, и добавить туда товары можно, не трогая саму палитру. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Scope = global.Scope;
  var Router = global.Router;

  var источники = [];
  var корень = null;
  var поле = null;
  var список = null;
  var выбран = 0;
  var видимые = [];

  /* Источник — функция, возвращающая пункты вида
     {title, hint, href} или {title, hint, run}. */
  function addSource(кто) { источники.push(кто); }

  function разделы() {
    var пункты = [
      { title: 'Главная', hint: 'раздел', href: '/' },
      { title: 'Центр действий', hint: 'раздел', href: '/actions' },
      { title: 'Каталог', hint: 'раздел', href: '/catalog' },
      { title: 'Знания о товарах', hint: 'каталог', href: '/catalog/knowledge' },
      { title: 'Покупатели', hint: 'раздел', href: '/customers' },
      { title: 'Кабинеты и API', hint: 'настройки', href: '/settings/accounts' }
    ];
    Scope.marketplaces().forEach(function (item) {
      пункты.push({ title: item.title, hint: 'площадка', href: '/mp/' + item.code });
    });
    Scope.all().stores.forEach(function (store) {
      пункты.push({
        title: store.title,
        hint: 'кабинет · ' + Scope.titleOf(store.marketplace),
        href: Router.build('/mp/' + store.marketplace, { account: store.id })
      });
    });
    return пункты;
  }

  function собрать(запрос) {
    var игла = (запрос || '').trim().toLowerCase();
    var всё = разделы();
    источники.forEach(function (кто) {
      try { всё = всё.concat(кто(игла) || []); } catch (error) { /* источник молчит */ }
    });
    if (!игла) return всё.slice(0, 12);
    return всё.filter(function (пункт) {
      return (пункт.title + ' ' + (пункт.hint || '')).toLowerCase().indexOf(игла) !== -1;
    }).slice(0, 20);
  }

  function нарисовать() {
    Fmt.clear(список);
    видимые = собрать(поле.value);
    if (!видимые.length) {
      список.appendChild(Fmt.el('p', 'palette__empty', 'Ничего не нашлось.'));
      return;
    }
    видимые.forEach(function (пункт, номер) {
      var строка = Fmt.el('button', 'palette__item' + (номер === выбран ? ' is-active' : ''));
      строка.type = 'button';
      строка.appendChild(Fmt.el('span', 'palette__title', пункт.title));
      if (пункт.hint) строка.appendChild(Fmt.el('span', 'palette__hint', пункт.hint));
      строка.addEventListener('click', function () { выполнить(пункт); });
      список.appendChild(строка);
    });
  }

  function выполнить(пункт) {
    close();
    if (пункт.run) пункт.run();
    else if (пункт.href) {
      history.pushState({}, '', пункт.href);
      Router.notify();
    }
  }

  function open() {
    if (!корень) построить();
    корень.hidden = false;
    выбран = 0;
    поле.value = '';
    нарисовать();
    поле.focus();
  }

  function close() {
    if (корень) корень.hidden = true;
  }

  function построить() {
    корень = Fmt.el('div', 'palette');
    корень.hidden = true;

    var фон = Fmt.el('div', 'palette__backdrop');
    фон.addEventListener('click', close);
    корень.appendChild(фон);

    var окно = Fmt.el('div', 'palette__window');
    окно.setAttribute('role', 'dialog');
    окно.setAttribute('aria-label', 'Поиск по панели');

    поле = document.createElement('input');
    поле.className = 'palette__input';
    поле.type = 'text';
    поле.placeholder = 'Раздел, площадка, кабинет…';
    поле.addEventListener('input', function () { выбран = 0; нарисовать(); });
    окно.appendChild(поле);

    список = Fmt.el('div', 'palette__list');
    окно.appendChild(список);
    корень.appendChild(окно);
    document.body.appendChild(корень);
  }

  document.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      if (корень && !корень.hidden) close(); else open();
      return;
    }
    if (!корень || корень.hidden) return;

    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      выбран = Math.min(выбран + 1, видимые.length - 1);
      нарисовать();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      выбран = Math.max(выбран - 1, 0);
      нарисовать();
    } else if (event.key === 'Enter' && видимые[выбран]) {
      event.preventDefault();
      выполнить(видимые[выбран]);
    }
  });

  global.Palette = { open: open, close: close, addSource: addSource };
})(window);
