/* Экран «Входящие»: всё, что ждёт ответа покупателям.

   Устроен в три уровня, как в кабинетах площадок:

       площадка  →  магазин  →  глава  →  обращения

   У каждой площадки свои главы: у Wildberries есть заявки на возврат,
   у Ozon их нет, у Яндекса нет отдельных вопросов. Список глав приходит
   с сервера — экран его не выдумывает.

   Ответ покупателю виден всем и его нельзя отозвать, поэтому кнопка
   требует второго нажатия — случайный клик ничего не отправит. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;
  var Reply = global.Reply;

  var state = {
    data: null,          // последний ответ /api/inbox
    loading: null,       // текущий запрос, чтобы не дёргать площадки дважды
    place: '',           // выбранная площадка
    store: '',           // выбранный магазин
    chapter: ''          // выбранная глава
  };

  var host = null;
  var onCounts = function () {};

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  /* --- загрузка ------------------------------------------------------------- */

  function load(force) {
    if (state.loading) return state.loading;
    if (state.data && !force) return Promise.resolve(state.data);

    state.loading = Api.inbox()
      .then(function (payload) {
        state.data = payload;
        state.loading = null;
        announce();
        return payload;
      })
      .catch(function (error) {
        state.loading = null;
        throw error;
      });
    return state.loading;
  }

  /* --- выборка по дереву ---------------------------------------------------- */

  function places() {
    return (state.data && state.data.marketplaces) || [];
  }

  function currentPlace() {
    var list = places();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].code === state.place) return list[i];
    }
    return list[0] || null;
  }

  function currentStore() {
    var place = currentPlace();
    if (!place) return null;
    var shops = place.stores || [];
    for (var i = 0; i < shops.length; i += 1) {
      if (shops[i].id === state.store) return shops[i];
    }
    return shops[0] || null;
  }

  function currentChapter() {
    var store = currentStore();
    if (!store) return null;
    var chapters = store.chapters || [];
    for (var i = 0; i < chapters.length; i += 1) {
      if (chapters[i].kind === state.chapter) return chapters[i];
    }
    return chapters[0] || null;
  }

  // Отвеченное в этом сеансе с экрана убираем, не дожидаясь обновления.
  function visible(chapter) {
    return Reply.visible((chapter && chapter.items) || []);
  }

  function countOf(node) {
    // Считаем по тем же правилам, что и показываем: без уже отвеченного.
    var total = 0;
    var urgent = 0;

    function walkChapters(chapters) {
      (chapters || []).forEach(function (chapter) {
        visible(chapter).forEach(function (item) {
          total += 1;
          if (item.urgent) urgent += 1;
        });
      });
    }

    if (node.chapters) {
      walkChapters(node.chapters);
    } else if (node.stores) {
      node.stores.forEach(function (store) { walkChapters(store.chapters); });
    }
    return { total: total, urgent: urgent };
  }

  // Счётчик на кнопке должен показывать то же, что видно на экране.
  function announce() {
    var total = 0;
    var urgent = 0;
    places().forEach(function (place) {
      var counted = countOf(place);
      total += counted.total;
      urgent += counted.urgent;
    });
    onCounts(total, urgent);
  }

  /* --- три ряда навигации --------------------------------------------------- */

  function chip(title, counted, active, onPick, dot) {
    var node = Fmt.el('button', 'chip' + (active ? ' is-active' : ''));
    node.type = 'button';
    if (dot) {
      var mark = Fmt.el('span', 'chip__dot');
      mark.style.background = dot;
      node.appendChild(mark);
    }
    node.appendChild(Fmt.el('span', null, title));
    node.appendChild(Fmt.el('span',
      'inbox__count' + (counted.total ? '' : ' is-zero') +
      (counted.urgent ? ' is-urgent' : ''), String(counted.total)));
    node.addEventListener('click', onPick);
    return node;
  }

  function placeRow() {
    var row = Fmt.el('div', 'chips inbox__row');
    var picked = currentPlace();
    places().forEach(function (place) {
      row.appendChild(chip(
        place.title, countOf(place), picked && place.code === picked.code,
        function () {
          state.place = place.code;
          state.store = '';
          state.chapter = '';
          render();
        },
        Fmt.colorOf(place.code)
      ));
    });
    return row;
  }

  function storeRow() {
    var place = currentPlace();
    var shops = (place && place.stores) || [];
    if (shops.length < 2) return null;   // один кабинет — выбирать не из чего

    var row = Fmt.el('div', 'chips chips--stores inbox__row');
    var picked = currentStore();
    shops.forEach(function (shop) {
      row.appendChild(chip(
        shop.title, countOf(shop), picked && shop.id === picked.id,
        function () {
          state.store = shop.id;
          state.chapter = '';
          render();
        }
      ));
    });
    return row;
  }

  function chapterRow() {
    var store = currentStore();
    if (!store) return null;

    var row = Fmt.el('div', 'chips inbox__row inbox__chapters');
    var picked = currentChapter();
    (store.chapters || []).forEach(function (chapter) {
      var items = visible(chapter);
      row.appendChild(chip(
        chapter.title, { total: items.length, urgent: chapter.urgent },
        picked && chapter.kind === picked.kind,
        function () {
          state.chapter = chapter.kind;
          Reply.resetBatch();
          render();
        }
      ));
    });
    return row;
  }

  /* --- состояния экрана ----------------------------------------------------- */

  function emptyChapter(title) {
    var box = Fmt.el('div', 'inbox__empty');
    box.appendChild(Fmt.el('div', 'inbox__zero', '0'));
    box.appendChild(Fmt.el('p', 'inbox__emptyText',
      title + ' — ничего не ждёт ответа. Так и должно быть.'));
    return box;
  }

  function troubles() {
    var errors = (state.data && state.data.errors) || {};
    var keys = Object.keys(errors);
    if (!keys.length) return null;

    var store = currentStore();
    var chapter = currentChapter();
    // Показываем беду только той главы, которая сейчас открыта, — иначе
    // предупреждение висело бы всегда и его перестали бы читать.
    var reason = store && chapter ? errors[store.id + ':' + chapter.kind] : null;
    if (!reason) return null;

    var box = Fmt.el('div', 'inbox__trouble');
    box.appendChild(Fmt.el('strong', null, 'Этот раздел не загрузился: ' + reason + '. '));
    box.appendChild(Fmt.el('span', null,
      reason === 'нет прав в ключе'
        ? 'Откройте «Ключи» и создайте токен, в котором отмечена нужная ' +
          'категория — «Вопросы и отзывы» или «Чат с покупателями».'
        : 'Попробуйте обновить через несколько минут.'));
    return box;
  }

  function nothing() {
    var box = Fmt.el('div', 'inbox__empty');
    box.appendChild(Fmt.el('p', 'inbox__emptyText',
      'Нет ни одного подключённого магазина. Добавьте ключи на странице ' +
      '«Ключи» — и обращения покупателей появятся здесь.'));
    return box;
  }

  /* --- сборка экрана -------------------------------------------------------- */

  function render() {
    if (!host) return;
    Fmt.clear(host);

    if (!state.data) {
      host.appendChild(Fmt.el('p', 'inbox__loading', 'Спрашиваем площадки…'));
      return;
    }

    if (!places().length) {
      host.appendChild(nothing());
      return;
    }

    host.appendChild(placeRow());
    var shops = storeRow();
    if (shops) host.appendChild(shops);
    var chapters = chapterRow();
    if (chapters) host.appendChild(chapters);

    // Запоминаем выбор, чтобы следующая отрисовка не «прыгнула» на первый.
    var place = currentPlace();
    var store = currentStore();
    var chapter = currentChapter();
    if (place) state.place = place.code;
    if (store) state.store = store.id;
    if (chapter) state.chapter = chapter.kind;

    var trouble = troubles();
    if (trouble) host.appendChild(trouble);

    if (!chapter) return;

    var ctx = { agent: !!(state.data && state.data.agent), redraw: render };
    var scope = {
      accountId: store.id, kind: chapter.kind, marketplace: place.code
    };

    var bar = Reply.conveyor(scope, chapter.items || [], ctx);
    if (bar) host.appendChild(bar);

    var items = visible(chapter);
    if (!items.length) {
      host.appendChild(emptyChapter(chapter.title));
      return;
    }

    var list = Fmt.el('div', 'inbox__list');
    items.forEach(function (item) { list.appendChild(Reply.card(item, ctx)); });
    host.appendChild(list);
  }

  function mount(node, options) {
    host = node;
    options = options || {};
    if (options.onCounts) onCounts = options.onCounts;
    render();
    load().then(render).catch(function (error) {
      Fmt.clear(host);
      host.appendChild(Fmt.el('p', 'inbox__loading', error.message));
    });
  }

  function reload() {
    state.data = null;
    render();
    return load(true).then(render).catch(function (error) { toast(error.message); });
  }

  global.Inbox = {
    mount: mount,
    reload: reload,
    // Панель узнаёт число на значке ещё до того, как экран открыли.
    prefetch: function (handler) {
      onCounts = handler || onCounts;
      return load().catch(function () { return null; });
    }
  };
})(window);
