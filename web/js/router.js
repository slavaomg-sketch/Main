/* Адрес страницы как состояние панели.

   До этого панель была четырьмя отдельными страницами, и переход между
   ними означал перезагрузку браузера. Теперь адрес — это то, что панель
   показывает: раздел, площадка, кабинет, открытый товар.

   Из этого само собой получается то, чего раньше не было:
   перезагрузка возвращает на то же место, «назад» работает, ссылку можно
   отправить сотруднику, а закладка ведёт куда положено.

   Модуль намеренно крошечный: разбирает адрес, слушает историю браузера
   и зовёт того, кто подписался. Ничего не рисует. */
(function (global) {
  'use strict';

  var подписчики = [];

  /* Разбор адреса. Отдаём и куски пути, и параметры — по ним разделы
     сами решают, что показывать. */
  function читать() {
    var путь = location.pathname.replace(/\/+$/, '') || '/';
    var куски = путь === '/' ? [] : путь.slice(1).split('/');
    var params = {};
    var поиск = location.search.replace(/^\?/, '');
    if (поиск) {
      поиск.split('&').forEach(function (пара) {
        if (!пара) return;
        var знак = пара.indexOf('=');
        var ключ = знак === -1 ? пара : пара.slice(0, знак);
        var значение = знак === -1 ? '' : пара.slice(знак + 1);
        params[decodeURIComponent(ключ)] = decodeURIComponent(значение.replace(/\+/g, ' '));
      });
    }
    return { path: путь, parts: куски, params: params, url: путь + location.search };
  }

  function собрать(путь, params) {
    var хвост = [];
    Object.keys(params || {}).forEach(function (ключ) {
      var значение = params[ключ];
      if (значение === undefined || значение === null || значение === '') return;
      хвост.push(encodeURIComponent(ключ) + '=' + encodeURIComponent(значение));
    });
    return путь + (хвост.length ? '?' + хвост.join('&') : '');
  }

  function сообщить() {
    var маршрут = читать();
    подписчики.forEach(function (кто) { кто(маршрут); });
  }

  /* Переход. `replace` — когда адрес уточняется сам собой (например,
     подставился кабинет по умолчанию) и захламлять историю нечем. */
  function go(путь, params, options) {
    var адрес = собрать(путь, params);
    if (адрес === location.pathname + location.search) return;
    if (options && options.replace) history.replaceState({}, '', адрес);
    else history.pushState({}, '', адрес);
    сообщить();
  }

  /* Изменить только параметры, оставшись в том же разделе. */
  function setParams(params, options) {
    var было = читать();
    var стало = {};
    Object.keys(было.params).forEach(function (ключ) { стало[ключ] = было.params[ключ]; });
    Object.keys(params).forEach(function (ключ) { стало[ключ] = params[ключ]; });
    go(было.path, стало, options);
  }

  function subscribe(кто) {
    подписчики.push(кто);
    return function () {
      подписчики = подписчики.filter(function (иной) { return иной !== кто; });
    };
  }

  // Кнопки «назад» и «вперёд» браузера.
  global.addEventListener('popstate', сообщить);

  /* Ссылки внутри панели ведут себя как ссылки: их видно в строке
     состояния, их можно открыть в новой вкладке средней кнопкой. Но
     обычное нажатие обрабатываем сами — без перезагрузки страницы. */
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var узел = event.target;
    while (узел && узел.tagName !== 'A') узел = узел.parentNode;
    if (!узел || !узел.getAttribute) return;

    var href = узел.getAttribute('href');
    if (!href || href.charAt(0) !== '/' || узел.getAttribute('target')) return;
    if (href.indexOf('/assets/') === 0 || href.indexOf('/api/') === 0) return;

    event.preventDefault();
    var знак = href.indexOf('?');
    var путь = знак === -1 ? href : href.slice(0, знак);
    if (href === location.pathname + location.search) return;
    history.pushState({}, '', href);
    сообщить();
    void путь;
  });

  global.Router = {
    read: читать,
    build: собрать,
    go: go,
    setParams: setParams,
    subscribe: subscribe,
    notify: сообщить
  };
})(window);
