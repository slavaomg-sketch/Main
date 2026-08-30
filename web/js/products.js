/* Экран «Товары»: каталог глазами владельца.

   Три уровня:

       товар (родитель)  →  его карточки  →  одна карточка

   У одного товара карточек бывает несколько сотен — кабель продаётся
   «для Samsung», «для Tecno» и так далее. Пройти их глазами по фотографиям
   это единственный способ заметить, что где-то не то изображение.

   Раздел намеренно отдельный от справочника ответов: там про то, что
   помощник говорит покупателю, здесь — про то, что покупатель видит. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;

  var state = {
    level: 'parents',   // parents | cards | card
    parents: [],
    total: 0,
    cards: 0,
    search: '',
    onlyTrouble: false,

    parent: null,       // открытый товар
    list: null,         // его карточки
    loadingMore: false,

    card: null,         // открытая карточка
    note: null,         // правка, набранная но не сохранённая
    savingNote: false,
    askingRating: false
  };

  var host = null;

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  /* --- загрузка ------------------------------------------------------------- */

  function loadParents() {
    return Api.products().then(function (payload) {
      state.parents = payload.parents || [];
      state.total = payload.total || 0;
      state.cards = payload.cards || 0;
      state.level = 'parents';
      render();
    });
  }

  function openParent(parent) {
    state.level = 'cards';
    state.parent = parent;
    state.list = null;
    render();

    Api.productCards(parent.parent, 0)
      .then(function (payload) {
        state.list = payload;
        render();
      })
      .catch(function (error) { toast(error.message); });
  }

  function loadMoreCards() {
    var list = state.list;
    if (!list || !list.more || state.loadingMore) return;

    state.loadingMore = true;
    render();

    Api.productCards(list.parent, list.offset + list.cards.length)
      .then(function (next) {
        state.loadingMore = false;
        list.cards = list.cards.concat(next.cards || []);
        list.more = next.more;
        render();
      })
      .catch(function (error) {
        state.loadingMore = false;
        render();
        toast(error.message);
      });
  }

  function openCard(card) {
    state.level = 'card';
    state.card = card;
    state.note = null;
    render();

    // Подтягиваем свежие данные карточки: в списке они могли устареть.
    Api.productCard(card.nmId)
      .then(function (fresh) {
        state.card = fresh;
        render();
      })
      .catch(function () { /* показываем то, что уже есть */ });
  }

  function askRating() {
    if (!state.card || state.askingRating) return;
    state.askingRating = true;
    render();

    Api.cardRating(state.card.nmId)
      .then(function (fresh) {
        state.askingRating = false;
        state.card = fresh;
        render();
        if (!fresh.ratingKnown) toast('Площадка не ответила про оценку');
      })
      .catch(function (error) {
        state.askingRating = false;
        render();
        toast(error.message);
      });
  }

  function saveNote() {
    if (!state.card || state.note === null) return;
    state.savingNote = true;
    render();

    Api.saveCardNote(state.card.nmId, state.note)
      .then(function (fresh) {
        state.savingNote = false;
        state.note = null;
        state.card = fresh;
        toast('Правка сохранена');
        render();
      })
      .catch(function (error) {
        state.savingNote = false;
        render();
        toast(error.message);
      });
  }

  /* --- мелочи --------------------------------------------------------------- */

  function photo(url, className) {
    var box = Fmt.el('div', className);
    if (!url) {
      box.classList.add('is-empty');
      box.appendChild(Fmt.el('span', 'shot__none', 'нет фото'));
      return box;
    }
    var image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    box.appendChild(image);
    return box;
  }

  function backButton(text, onBack) {
    var button = Fmt.el('button', 'btn btn--ghost products__back');
    button.type = 'button';
    button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
    button.appendChild(Fmt.el('span', null, text));
    button.addEventListener('click', onBack);
    return button;
  }

  /* --- уровень 1: товары ---------------------------------------------------- */

  function parentTile(item) {
    var tile = Fmt.el('button', 'ptile');
    tile.type = 'button';
    tile.appendChild(photo(item.photo, 'ptile__shot'));

    var body = Fmt.el('div', 'ptile__body');
    body.appendChild(Fmt.el('div', 'ptile__name', item.title || item.sample || item.parent));
    body.appendChild(Fmt.el('div', 'ptile__code', item.parent));

    var marks = Fmt.el('div', 'ptile__marks');
    marks.appendChild(Fmt.el('span', 'ptile__count',
      item.cards + ' ' + Fmt.plural(item.cards, ['карточка', 'карточки', 'карточек'])));
    if (item.withoutPhoto) {
      marks.appendChild(Fmt.el('span', 'ptile__warn', 'без фото: ' + item.withoutPhoto));
    }
    if (item.noted) {
      marks.appendChild(Fmt.el('span', 'ptile__note', 'правок: ' + item.noted));
    }
    body.appendChild(marks);

    tile.appendChild(body);
    tile.addEventListener('click', function () { openParent(item); });
    return tile;
  }

  function shownParents() {
    var needle = state.search.trim().toLowerCase();
    return state.parents.filter(function (item) {
      if (state.onlyTrouble && !item.withoutPhoto && !item.noted) return false;
      if (!needle) return true;
      var haystack = item.parent + ' ' + (item.title || '') + ' ' + (item.sample || '');
      return haystack.toLowerCase().indexOf(needle) !== -1;
    });
  }

  function parentsLevel() {
    var bar = Fmt.el('div', 'know__bar');
    bar.appendChild(Fmt.el('span', 'know__tally',
      'Товаров: ' + state.total + ' · карточек: ' + Fmt.number(state.cards)));

    var search = document.createElement('input');
    search.className = 'know__search';
    search.type = 'search';
    search.placeholder = 'Поиск по коду или названию';
    search.value = state.search;
    search.addEventListener('input', function () {
      state.search = search.value;
      renderGrid();
    });
    bar.appendChild(search);

    var trouble = Fmt.el('button', 'chip' + (state.onlyTrouble ? ' is-active' : ''));
    trouble.type = 'button';
    trouble.appendChild(Fmt.el('span', null, 'Требуют внимания'));
    trouble.addEventListener('click', function () {
      state.onlyTrouble = !state.onlyTrouble;
      render();
    });
    bar.appendChild(trouble);

    host.appendChild(bar);
    gridHost = Fmt.el('div', 'products__grid');
    host.appendChild(gridHost);
    renderGrid();
  }

  var gridHost = null;

  function renderGrid() {
    if (!gridHost) return;
    Fmt.clear(gridHost);
    var items = shownParents();
    if (!items.length) {
      gridHost.appendChild(Fmt.el('p', 'inbox__loading',
        state.total ? 'Ничего не нашлось.'
                    : 'Каталог пуст. Соберите его на странице «Справочник ответов».'));
      return;
    }
    items.forEach(function (item) { gridHost.appendChild(parentTile(item)); });
  }

  /* --- уровень 2: карточки товара ------------------------------------------- */

  function cardTile(card) {
    var tile = Fmt.el('button', 'ctile' + (card.note ? ' ctile--noted' : ''));
    tile.type = 'button';
    tile.appendChild(photo(card.photo, 'ctile__shot'));

    var body = Fmt.el('div', 'ctile__body');
    body.appendChild(Fmt.el('div', 'ctile__title', card.title || card.article));
    body.appendChild(Fmt.el('div', 'ctile__code', card.article));

    var marks = Fmt.el('div', 'ctile__marks');
    marks.appendChild(Fmt.el('span', null,
      card.photoCount + ' ' + Fmt.plural(card.photoCount, ['фото', 'фото', 'фото'])));
    if (card.ratingKnown) {
      marks.appendChild(Fmt.el('span', null, '★ ' + card.rating));
    }
    if (card.note) marks.appendChild(Fmt.el('span', 'ctile__noted', 'есть правка'));
    body.appendChild(marks);

    tile.appendChild(body);
    tile.addEventListener('click', function () { openCard(card); });
    return tile;
  }

  function cardsLevel() {
    host.appendChild(backButton('Все товары', function () {
      state.level = 'parents';
      state.parent = null;
      render();
    }));

    var item = state.parent;
    var head = Fmt.el('div', 'products__head');
    head.appendChild(Fmt.el('h2', 'products__title',
      item.title || item.sample || item.parent));
    head.appendChild(Fmt.el('span', 'products__code', item.parent));
    host.appendChild(head);

    if (!state.list) {
      host.appendChild(Fmt.el('p', 'inbox__loading', 'Загружаем карточки…'));
      return;
    }

    host.appendChild(Fmt.el('p', 'products__tally',
      'Карточек: ' + Fmt.number(state.list.total) +
      ', показано ' + state.list.cards.length));

    var grid = Fmt.el('div', 'products__grid products__grid--cards');
    state.list.cards.forEach(function (card) { grid.appendChild(cardTile(card)); });
    host.appendChild(grid);

    if (state.list.more) {
      var more = Fmt.el('button', 'btn btn--ghost products__more');
      more.type = 'button';
      more.appendChild(Fmt.el('span', null,
        state.loadingMore ? 'Загружаем…' : 'Показать ещё'));
      more.disabled = !!state.loadingMore;
      more.addEventListener('click', loadMoreCards);
      host.appendChild(more);
    }
  }

  /* --- уровень 3: одна карточка --------------------------------------------- */

  function cardLevel() {
    var card = state.card;
    host.appendChild(backButton('К карточкам товара', function () {
      state.level = 'cards';
      state.card = null;
      render();
    }));

    var head = Fmt.el('div', 'products__head');
    head.appendChild(Fmt.el('h2', 'products__title', card.title || card.article));
    head.appendChild(Fmt.el('span', 'products__code', card.article));
    host.appendChild(head);

    var facts = Fmt.el('div', 'card__facts');
    facts.appendChild(fact('Артикул WB', card.nmId));
    facts.appendChild(fact('Фотографий', String(card.photoCount)));
    facts.appendChild(fact('Оценка',
      card.ratingKnown ? (card.rating ? '★ ' + card.rating : 'нет оценки') : '—'));
    facts.appendChild(fact('Отзывов',
      card.ratingKnown ? Fmt.number(card.feedbacks) : '—'));
    host.appendChild(facts);

    if (!card.ratingKnown) {
      var ask = Fmt.el('button', 'btn btn--ghost');
      ask.type = 'button';
      ask.appendChild(Fmt.el('span', null,
        state.askingRating ? 'Спрашиваем…' : 'Узнать оценку и отзывы'));
      ask.disabled = !!state.askingRating;
      ask.addEventListener('click', askRating);
      host.appendChild(ask);
    }

    // Все изображения карточки, первое — главное.
    var shots = Fmt.el('div', 'card__shots');
    if (!card.photos.length) {
      shots.appendChild(Fmt.el('p', 'inbox__loading', 'У карточки нет ни одного фото.'));
    }
    card.photos.forEach(function (url, number) {
      var box = photo(url, 'card__shot' + (number === 0 ? ' is-hero' : ''));
      if (number === 0) box.appendChild(Fmt.el('span', 'card__hero', 'главное'));
      shots.appendChild(box);
    });
    host.appendChild(shots);

    var block = Fmt.el('div', 'card__note');
    block.appendChild(Fmt.el('label', 'card__noteLabel',
      'Что поправить в этой карточке'));

    var area = document.createElement('textarea');
    area.className = 'inbox-card__input';
    area.rows = 3;
    area.placeholder = 'Например: заменить главное фото, дописать длину в описание';
    area.value = state.note === null ? (card.note || '') : state.note;
    area.addEventListener('input', function () {
      state.note = area.value;
      save.disabled = false;
    });
    block.appendChild(area);

    var foot = Fmt.el('div', 'inbox-card__foot');
    var save = Fmt.el('button', 'btn btn--primary');
    save.type = 'button';
    save.appendChild(Fmt.el('span', null,
      state.savingNote ? 'Сохраняем…' : 'Сохранить правку'));
    save.disabled = state.note === null || !!state.savingNote;
    save.addEventListener('click', saveNote);
    foot.appendChild(save);
    block.appendChild(foot);

    host.appendChild(block);
  }

  function fact(label, value) {
    var box = Fmt.el('div', 'card__fact');
    box.appendChild(Fmt.el('span', 'card__factLabel', label));
    box.appendChild(Fmt.el('span', 'card__factValue', value));
    return box;
  }

  /* --- сборка --------------------------------------------------------------- */

  function render() {
    if (!host) return;
    Fmt.clear(host);
    gridHost = null;

    if (state.level === 'card' && state.card) return cardLevel();
    if (state.level === 'cards' && state.parent) return cardsLevel();
    return parentsLevel();
  }

  function mount(node) {
    host = node;
    Fmt.clear(host);
    host.appendChild(Fmt.el('p', 'inbox__loading', 'Загружаем товары…'));
    loadParents().catch(function (error) {
      Fmt.clear(host);
      host.appendChild(Fmt.el('p', 'inbox__loading', error.message));
    });
  }

  global.Products = { mount: mount, reload: loadParents };
})(window);
