/* Переключатель разделов панели.

   Раньше на каждой странице стоял свой набор кнопок: с «Товаров» можно было
   уйти в справочник и задачи, но не к показателям, а с задач — не к товарам.
   Человек не должен помнить, из какой двери куда попадёт.

   Теперь на всех страницах одно и то же место — название раздела рядом со
   значком панели. Нажатие открывает список всех разделов. Где вы сейчас,
   видно по галочке. */
(function (global) {
  'use strict';

  var РАЗДЕЛЫ = [
    { path: '/', title: 'Показатели', sub: 'деньги, заказы, остатки' },
    { path: '/tasks', title: 'Задачи', sub: 'что ждёт ответа в кабинетах' },
    { path: '/products', title: 'Товары', sub: 'карточки и фотографии' },
    { path: '/knowledge', title: 'Справочник', sub: 'что помощник знает о товаре' }
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function mount(host, current) {
    if (!host) return;

    var кнопка = el('button', 'navpick__button');
    кнопка.type = 'button';
    кнопка.setAttribute('aria-haspopup', 'menu');
    кнопка.setAttribute('aria-expanded', 'false');

    var сейчас = null;
    for (var i = 0; i < РАЗДЕЛЫ.length; i += 1) {
      if (РАЗДЕЛЫ[i].path === current) сейчас = РАЗДЕЛЫ[i];
    }

    var подпись = el('span', 'navpick__now');
    подпись.appendChild(el('span', 'navpick__title', сейчас ? сейчас.title : 'Панель'));

    // Подпись под названием раздела — место, где страница может сказать
    // о себе что-то живое: на показателях сюда пишется выбранный период.
    var мелко = el('span', 'navpick__sub', сейчас ? сейчас.sub : '');
    мелко.id = 'brand-sub';
    подпись.appendChild(мелко);
    кнопка.appendChild(подпись);

    var стрелка = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    стрелка.setAttribute('viewBox', '0 0 24 24');
    стрелка.setAttribute('class', 'navpick__chevron');
    стрелка.setAttribute('aria-hidden', 'true');
    var путь = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    путь.setAttribute('d', 'M8 10l4 4 4-4');
    стрелка.appendChild(путь);
    кнопка.appendChild(стрелка);

    var меню = el('div', 'navpick__menu');
    меню.setAttribute('role', 'menu');
    меню.hidden = true;

    РАЗДЕЛЫ.forEach(function (раздел) {
      var пункт = el('a', 'navpick__item' + (раздел.path === current ? ' is-current' : ''));
      пункт.href = раздел.path;
      пункт.setAttribute('role', 'menuitem');

      var текст = el('span', 'navpick__itemtext');
      текст.appendChild(el('span', 'navpick__itemtitle', раздел.title));
      текст.appendChild(el('span', 'navpick__itemsub', раздел.sub));
      пункт.appendChild(текст);

      if (раздел.path === current) пункт.appendChild(el('span', 'navpick__tick', '✓'));
      меню.appendChild(пункт);
    });

    function закрыть() {
      меню.hidden = true;
      кнопка.setAttribute('aria-expanded', 'false');
    }

    кнопка.addEventListener('click', function (event) {
      event.stopPropagation();
      меню.hidden = !меню.hidden;
      кнопка.setAttribute('aria-expanded', меню.hidden ? 'false' : 'true');
    });
    document.addEventListener('click', закрыть);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') закрыть();
    });

    var обёртка = el('div', 'navpick');
    обёртка.appendChild(кнопка);
    обёртка.appendChild(меню);

    host.appendChild(обёртка);
  }

  global.Nav = { mount: mount, sections: РАЗДЕЛЫ };

  // Ставим переключатель сразу: скрипты подключены в конце страницы, значит
  // разметка уже разобрана. Если нет — дожидаемся готовности документа.
  function поставить() {
    mount(document.getElementById('brand'), location.pathname.replace(/\/$/, '') || '/');
  }
  if (document.getElementById('brand')) поставить();
  else document.addEventListener('DOMContentLoaded', поставить);
})(window);
