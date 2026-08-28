/* Экран «Входящие»: всё, что ждёт ответа покупателям.

   В кабинете Wildberries это красные кружки с числами на главной —
   отзывы без ответа, вопросы, заявки на возврат. Здесь они собраны по
   всем магазинам сразу, разделены на главы и закрываются прямо отсюда.

   Ответ покупателю виден всем и его нельзя отозвать, поэтому кнопка
   требует второго нажатия — случайный клик ничего не отправит. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;

  var state = {
    data: null,          // последний ответ /api/inbox
    loading: null,       // текущий запрос, чтобы не дёргать площадку дважды
    chapter: '',         // открытая глава
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
        onCounts(payload.total || 0, payload.urgent || 0);
        return payload;
      })
      .catch(function (error) {
        state.loading = null;
        throw error;
      });
    return state.loading;
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
    var sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return 'сегодня, ' + time;

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

  function chapterOf(kind) {
    var chapters = (state.data && state.data.chapters) || [];
    for (var i = 0; i < chapters.length; i += 1) {
      if (chapters[i].kind === kind) return chapters[i];
    }
    return null;
  }

  function visible(chapter) {
    return (chapter.items || []).filter(function (item) {
      return !state.answered[key(item)];
    });
  }

  // Счётчик на кнопке должен считать то же, что видно на экране.
  function announce() {
    var chapters = (state.data && state.data.chapters) || [];
    var total = 0;
    var urgent = 0;
    chapters.forEach(function (chapter) {
      visible(chapter).forEach(function (item) {
        total += 1;
        if (item.urgent) urgent += 1;
      });
    });
    onCounts(total, urgent);
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

  /* --- карточка обращения --------------------------------------------------- */

  function answeredCard(item, text) {
    var card = Fmt.el('article', 'inbox-card inbox-card--done');
    card.appendChild(Fmt.el('div', 'inbox-card__done', 'Ответ отправлен'));
    card.appendChild(Fmt.el('p', 'inbox-card__answer', text));
    return card;
  }

  function cardHead(item) {
    var head = Fmt.el('header', 'inbox-card__head');

    var store = Fmt.el('span', 'inbox-card__store');
    var dot = Fmt.el('span', 'inbox-card__dot');
    dot.style.background = Fmt.colorOf('wildberries');
    store.appendChild(dot);
    store.appendChild(Fmt.el('span', null, item.accountTitle || 'магазин'));
    head.appendChild(store);

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

    foot.appendChild(Fmt.el('span', 'inbox-card__note',
      'Ответ увидят все покупатели, отозвать его нельзя'));

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
      item.text || 'Покупатель оставил оценку без текста'));

    if (item.photos && item.photos.length) node.appendChild(photos(item));

    node.appendChild(answerBox(item));
    return node;
  }

  /* --- главы ---------------------------------------------------------------- */

  function chapterChips() {
    var row = Fmt.el('div', 'chips inbox__chapters');
    (state.data.chapters || []).forEach(function (chapter) {
      var items = visible(chapter);
      var chip = Fmt.el('button', 'chip' + (chapter.kind === state.chapter ? ' is-active' : ''));
      chip.type = 'button';
      chip.appendChild(Fmt.el('span', null, chapter.title));
      chip.appendChild(Fmt.el('span',
        'inbox__count' + (items.length ? '' : ' is-zero'), String(items.length)));
      chip.addEventListener('click', function () {
        state.chapter = chapter.kind;
        render();
      });
      row.appendChild(chip);
    });
    return row;
  }

  function emptyChapter(title) {
    var box = Fmt.el('div', 'inbox__empty');
    box.appendChild(Fmt.el('div', 'inbox__zero', '0'));
    box.appendChild(Fmt.el('p', 'inbox__emptyText',
      title + ' — ничего не ждёт ответа. Так и должно быть.'));
    return box;
  }

  function troubles() {
    var errors = (state.data && state.data.errors) || {};
    var codes = Object.keys(errors);
    if (!codes.length) return null;

    var box = Fmt.el('div', 'inbox__trouble');
    box.appendChild(Fmt.el('strong', null, 'Часть обращений не загрузилась.'));
    box.appendChild(Fmt.el('span', null,
      ' Чаще всего это значит, что в токене Wildberries не отмечена категория ' +
      '«Вопросы и отзывы». Откройте «Ключи», создайте токен с этой категорией ' +
      'и вставьте его заново.'));
    return box;
  }

  function noStores() {
    var box = Fmt.el('div', 'inbox__empty');
    box.appendChild(Fmt.el('p', 'inbox__emptyText',
      'Нет ни одного подключённого магазина Wildberries. Добавьте ключи на ' +
      'странице «Ключи» — и обращения покупателей появятся здесь.'));
    return box;
  }

  /* --- сборка экрана -------------------------------------------------------- */

  function render() {
    if (!host) return;
    Fmt.clear(host);

    if (!state.data) {
      host.appendChild(Fmt.el('p', 'inbox__loading', 'Спрашиваем площадку…'));
      return;
    }

    if (!(state.data.stores || []).length) {
      host.appendChild(noStores());
      return;
    }

    var trouble = troubles();
    if (trouble) host.appendChild(trouble);

    host.appendChild(chapterChips());

    var chapter = chapterOf(state.chapter) || (state.data.chapters || [])[0];
    if (!chapter) return;
    state.chapter = chapter.kind;

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
