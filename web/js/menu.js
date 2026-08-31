/* Выпадающий выбор — одна кнопка вместо длинного ряда.

   Двадцать шесть категорий, выложенных плитками, занимали семь строк: первый
   экран уходил на фильтры, а товаров не было видно вовсе. Список, который
   открывается по нажатию, занимает одну строку и вмещает сколько угодно
   пунктов. Внутри — поиск, если пунктов много. */
(function (global) {
  'use strict';

  var ПОРОГ_ПОИСКА = 12;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function chevron() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'picker__chevron');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8 10l4 4 4-4');
    svg.appendChild(path);
    return svg;
  }

  /* options: { items: [{key, title, count}], value, onPick, empty } */
  function picker(options) {
    var items = options.items || [];
    var текущий = null;
    items.forEach(function (item) { if (item.key === options.value) текущий = item; });

    var обёртка = el('div', 'picker');
    var кнопка = el('button', 'picker__button' + (options.value ? ' is-set' : ''));
    кнопка.type = 'button';
    кнопка.setAttribute('aria-haspopup', 'listbox');
    кнопка.setAttribute('aria-expanded', 'false');
    кнопка.appendChild(el('span', 'picker__label',
      текущий ? текущий.title : (options.empty || 'Все')));
    if (текущий && текущий.count !== undefined) {
      кнопка.appendChild(el('span', 'picker__count', String(текущий.count)));
    }
    кнопка.appendChild(chevron());

    var меню = el('div', 'picker__menu');
    меню.setAttribute('role', 'listbox');
    меню.hidden = true;

    var строка = null;
    if (items.length > ПОРОГ_ПОИСКА) {
      строка = document.createElement('input');
      строка.className = 'picker__search';
      строка.type = 'search';
      строка.placeholder = 'Найти';
      меню.appendChild(строка);
    }

    var список = el('div', 'picker__list');
    меню.appendChild(список);

    function нарисовать() {
      var игла = (строка && строка.value || '').trim().toLowerCase();
      список.textContent = '';
      items
        .filter(function (item) {
          return !игла || item.title.toLowerCase().indexOf(игла) !== -1;
        })
        .forEach(function (item) {
          var пункт = el('button',
            'picker__item' + (item.key === options.value ? ' is-current' : ''));
          пункт.type = 'button';
          пункт.setAttribute('role', 'option');
          пункт.appendChild(el('span', 'picker__itemtitle', item.title));
          if (item.count !== undefined) {
            пункт.appendChild(el('span', 'picker__itemcount', String(item.count)));
          }
          пункт.addEventListener('click', function () {
            закрыть();
            options.onPick(item.key);
          });
          список.appendChild(пункт);
        });
    }

    function закрыть() {
      меню.hidden = true;
      кнопка.setAttribute('aria-expanded', 'false');
    }

    кнопка.addEventListener('click', function (event) {
      event.stopPropagation();
      var было = меню.hidden;
      закрытьВсе();
      меню.hidden = !было;
      кнопка.setAttribute('aria-expanded', меню.hidden ? 'false' : 'true');
      if (!меню.hidden) {
        нарисовать();
        if (строка) { строка.value = ''; строка.focus(); }
      }
    });
    меню.addEventListener('click', function (event) { event.stopPropagation(); });
    if (строка) строка.addEventListener('input', нарисовать);

    обёртка.appendChild(кнопка);
    обёртка.appendChild(меню);
    return обёртка;
  }

  function закрытьВсе() {
    var открытые = document.querySelectorAll('.picker__menu:not([hidden])');
    for (var i = 0; i < открытые.length; i += 1) {
      открытые[i].hidden = true;
      var кнопка = открытые[i].previousSibling;
      if (кнопка && кнопка.setAttribute) кнопка.setAttribute('aria-expanded', 'false');
    }
  }

  document.addEventListener('click', закрытьВсе);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') закрытьВсе();
  });

  global.Menu = { picker: picker, closeAll: закрытьВсе };
})(window);
