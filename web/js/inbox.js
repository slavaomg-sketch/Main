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

  var state = {
    data: null,          // последний ответ /api/inbox
    loading: null,       // текущий запрос, чтобы не дёргать площадки дважды
    place: '',           // выбранная площадка
    store: '',           // выбранный магазин
    chapter: '',         // выбранная глава
    drafts: {},          // набранные, но не отправленные ответы
    sending: {},         // обращения, по которым ответ уже улетел
    confirming: {},      // нажали «Отправить» — ждём подтверждения
    answered: {},        // на что уже ответили в этом сеансе
    drafting: {},        // помощник сейчас пишет черновик
    hints: {}            // предупреждения помощника «тут нужен человек»
  };

  var host = null;
  var onCounts = function () {};

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  function key(item) {
    return item.accountId + ':' + item.kind + ':' + item.id;
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
    return ((chapter && chapter.items) || []).filter(function (item) {
      return !state.answered[key(item)];
    });
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

  /* --- мелочи --------------------------------------------------------------- */

  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // «сегодня, 14:30» — понятнее, чем «2026-08-28T14:30:00Z».
  function moment(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';

    var time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return 'сегодня, ' + time;

    var yesterday = new Date(now.getTime() - 86400000);
    if (date.toDateString() === yesterday.toDateString()) return 'вчера, ' + time;

    var label = date.getDate() + ' ' + MONTHS[date.getMonth()];
    if (date.getFullYear() !== now.getFullYear()) label += ' ' + date.getFullYear();
    return label + ', ' + time;
  }

  function stars(rating) {
    var node = Fmt.el('span', 'inbox__stars');
    node.title = 'Оценка ' + rating + ' из 5';
    for (var i = 1; i <= 5; i += 1) {
      node.appendChild(Fmt.el('span', i <= rating ? 'inbox__star is-on' : 'inbox__star', '★'));
    }
    return node;
  }

  /* --- черновик от помощника ------------------------------------------------ */

  function askDraft(item) {
    var id = key(item);
    state.drafting[id] = true;
    delete state.hints[id];
    render();

    Api.draftInbox(item.accountId, item.kind, item.id)
      .then(function (written) {
        delete state.drafting[id];
        state.drafts[id] = written.answer || '';
        if (written.needsHuman) {
          state.hints[id] = written.why ||
            'Помощник не уверен в ответе — проверьте его сами.';
        }
        render();
      })
      .catch(function (error) {
        delete state.drafting[id];
        render();
        toast(error.message);
      });
  }

  /* --- отправка ответа ------------------------------------------------------ */

  function send(item, text) {
    var id = key(item);
    state.sending[id] = true;
    render();

    Api.answerInbox(item.accountId, item.kind, item.id, text)
      .then(function () {
        delete state.sending[id];
        delete state.drafts[id];
        state.answered[id] = text;
        toast('Ответ отправлен');
        render();
        announce();
      })
      .catch(function (error) {
        delete state.sending[id];
        render();
        toast(error.message);
      });
  }

  /* --- карточка обращения --------------------------------------------------- */

  function answeredCard(item, text) {
    var card = Fmt.el('article', 'inbox-card inbox-card--done');
    card.appendChild(Fmt.el('div', 'inbox-card__done', 'Ответ отправлен'));
    card.appendChild(Fmt.el('p', 'inbox-card__answer', text));
    return card;
  }

  function cardHead(item) {
    var head = Fmt.el('header', 'inbox-card__head');

    if (item.author) head.appendChild(Fmt.el('span', 'inbox-card__store', item.author));
    if (item.kind === 'feedback' && item.rating) head.appendChild(stars(item.rating));
    if (item.urgent) head.appendChild(Fmt.el('span', 'inbox-card__flag', 'нужен человек'));

    head.appendChild(Fmt.el('span', 'inbox-card__when', moment(item.createdAt)));
    return head;
  }

  function photos(item) {
    var row = Fmt.el('div', 'inbox-card__photos');
    item.photos.slice(0, 6).forEach(function (url) {
      var link = document.createElement('a');
      link.className = 'inbox-card__photo';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      var image = document.createElement('img');
      image.src = url;
      image.alt = 'Фото покупателя';
      image.loading = 'lazy';
      link.appendChild(image);
      row.appendChild(link);
    });
    return row;
  }

  function answerBox(item) {
    var id = key(item);
    var box = Fmt.el('div', 'inbox-card__reply');

    if (state.hints[id]) {
      var hint = Fmt.el('div', 'inbox-card__hint');
      hint.appendChild(Fmt.el('strong', null, 'Проверьте сами. '));
      hint.appendChild(Fmt.el('span', null, state.hints[id]));
      box.appendChild(hint);
    }

    var area = document.createElement('textarea');
    area.className = 'inbox-card__input';
    area.rows = 3;
    area.placeholder = item.kind === 'question'
      ? 'Ответ на вопрос покупателя'
      : 'Ответ покупателю';
    area.value = state.drafts[id] || '';
    area.disabled = !!state.sending[id];
    area.addEventListener('input', function () {
      state.drafts[id] = area.value;
      button.disabled = !area.value.trim();
      if (state.confirming[id]) {
        delete state.confirming[id];
        label.textContent = 'Отправить покупателю';
        button.classList.remove('btn--danger');
      }
    });
    box.appendChild(area);

    var foot = Fmt.el('div', 'inbox-card__foot');

    if (state.data && state.data.agent) {
      var ask = Fmt.el('button', 'btn btn--ghost');
      ask.type = 'button';
      ask.appendChild(Fmt.el('span', null,
        state.drafting[id] ? 'Помощник пишет…' : 'Черновик от помощника'));
      ask.disabled = !!state.drafting[id] || !!state.sending[id];
      ask.addEventListener('click', function () { askDraft(item); });
      foot.appendChild(ask);
    }

    var button = Fmt.el('button', 'btn btn--primary');
    button.type = 'button';
    var label = Fmt.el('span', null,
      state.confirming[id] ? 'Точно отправить?' : 'Отправить покупателю');
    if (state.confirming[id]) button.classList.add('btn--danger');
    button.appendChild(label);
    button.disabled = !(state.drafts[id] || '').trim() || !!state.sending[id];
    if (state.sending[id]) label.textContent = 'Отправляем…';

    button.addEventListener('click', function () {
      var text = (state.drafts[id] || '').trim();
      if (!text) return;
      if (!state.confirming[id]) {
        // Первое нажатие только предупреждает: ответ публичный и навсегда.
        state.confirming[id] = true;
        label.textContent = 'Точно отправить?';
        button.classList.add('btn--danger');
        return;
      }
      delete state.confirming[id];
      send(item, text);
    });
    foot.appendChild(button);

    box.appendChild(foot);
    // Предупреждение отдельной строкой: между кнопками оно сжималось
    // в столбик из трёх слов и переставало читаться.
    box.appendChild(Fmt.el('p', 'inbox-card__note',
      item.kind === 'chat'
        ? 'Сообщение уйдёт покупателю в чат'
        : 'Ответ увидят все покупатели, отозвать его нельзя'));
    return box;
  }

  function card(item) {
    var id = key(item);
    if (state.answered[id]) return answeredCard(item, state.answered[id]);

    var node = Fmt.el('article', 'inbox-card' + (item.urgent ? ' inbox-card--urgent' : ''));
    node.appendChild(cardHead(item));

    if (item.product || item.article) {
      var product = Fmt.el('div', 'inbox-card__product');
      if (item.product) product.appendChild(Fmt.el('span', null, item.product));
      if (item.article) product.appendChild(Fmt.el('span', 'inbox-card__article', item.article));
      node.appendChild(product);
    }

    node.appendChild(Fmt.el('p', 'inbox-card__text',
      item.text || 'Покупатель написал без текста'));

    if (item.photos && item.photos.length) node.appendChild(photos(item));

    node.appendChild(answerBox(item));
    return node;
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

    var items = visible(chapter);
    if (!items.length) {
      host.appendChild(emptyChapter(chapter.title));
      return;
    }

    var list = Fmt.el('div', 'inbox__list');
    items.forEach(function (item) { list.appendChild(card(item)); });
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
