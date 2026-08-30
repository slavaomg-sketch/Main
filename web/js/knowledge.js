/* Справочник товаров: что панель знает о каждом «родителе».

   Смысл страницы — один. Помощнику запрещено выдумывать характеристики,
   поэтому на вопрос «сколько вольт» он честно зовёт человека. Заполненная
   здесь справка едет к нему вместе с обращением, и такие вопросы он
   начинает закрывать сам.

   Родитель — это физический товар. Кабель Type-C 1 м белый продаётся
   тысячей карточек «для Samsung», «для Tecno», а товар один, и справка
   у него одна. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;

  var state = {
    parents: [],
    filled: 0,
    total: 0,
    drafts: {},        // изменённое, но ещё не сохранённое
    saving: {},
    filter: 'all',     // all | unnamed | unfilled
    search: '',
    refresh: null      // ход сбора каталога
  };

  var host = null;

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  function load() {
    return Api.knowledge().then(function (payload) {
      state.parents = payload.parents || [];
      state.filled = payload.filled || 0;
      state.named = payload.named || 0;
      state.total = payload.total || 0;
      render();
    });
  }

  function draftOf(item) {
    var draft = state.drafts[item.parent];
    return draft === undefined ? { title: item.title, facts: item.facts } : draft;
  }

  function change(item, field, value) {
    var draft = draftOf(item);
    state.drafts[item.parent] = {
      title: field === 'title' ? value : draft.title,
      facts: field === 'facts' ? value : draft.facts
    };
  }

  function save(item, card) {
    var draft = draftOf(item);
    state.saving[item.parent] = true;
    render();

    Api.saveKnowledge(item.parent, draft.title, draft.facts)
      .then(function (saved) {
        delete state.saving[item.parent];
        delete state.drafts[item.parent];
        // Обновляем строку на месте, не перезагружая весь список: владелец
        // мог уже начать печатать в соседней карточке.
        for (var i = 0; i < state.parents.length; i += 1) {
          if (state.parents[i].parent === saved.parent) state.parents[i] = saved;
        }
        state.filled = state.parents.filter(function (row) { return row.filled; }).length;
        state.named = state.parents.filter(function (row) { return row.named; }).length;
        toast('Справка сохранена');
        render();
      })
      .catch(function (error) {
        delete state.saving[item.parent];
        render();
        toast(error.message);
      });
    return card;
  }

  /* --- сбор каталога из кабинетов ------------------------------------------- */

  function startRefresh() {
    Api.refreshKnowledge()
      .then(watchRefresh)
      .catch(function (error) { toast(error.message); });
  }

  function watchRefresh(run) {
    state.refresh = run;
    render();

    if (!run || run.finished) {
      // Сбор закончился — перечитываем список, там появились новые товары.
      if (run && run.finished) {
        load().then(function () {
          var беды = Object.keys((run.errors) || {});
          toast(беды.length
            ? 'Собрано товаров: ' + run.parents + ', но ' + беды.length +
              ' кабинет(ов) не ответили'
            : 'Каталог собран: товаров ' + run.parents + ' из ' + run.cards + ' карточек');
        });
      }
      return;
    }

    setTimeout(function () {
      Api.knowledgeRefreshStatus()
        .then(watchRefresh)
        .catch(function (error) {
          state.refresh = null;
          render();
          toast(error.message);
        });
    }, 1500);
  }

  function refreshBar() {
    var run = state.refresh;
    var bar = Fmt.el('div', 'know__refresh');

    if (run && run.running) {
      bar.appendChild(Fmt.el('span', 'know__progress',
        'Читаем карточки: кабинет ' + (run.storesDone + 1) + ' из ' + run.storesTotal +
        (run.store ? ' — ' + run.store : '') +
        (run.cards ? ', уже ' + Fmt.number(run.cards) + ' карточек' : '')));
      return bar;
    }

    bar.appendChild(Fmt.el('span', 'know__progress',
      state.total
        ? 'Список можно пересобрать, если добавились новые товары.'
        : 'Список пуст. Соберите его из карточек ваших кабинетов — ' +
          'после этого товары появятся и здесь, и в разделе «Товары».'));

    var run_button = Fmt.el('button', 'btn ' + (state.total ? 'btn--ghost' : 'btn--primary'));
    run_button.type = 'button';
    run_button.appendChild(Fmt.el('span', null, 'Собрать из кабинетов'));
    run_button.addEventListener('click', startRefresh);
    bar.appendChild(run_button);
    return bar;
  }

  /* --- карточка родителя ---------------------------------------------------- */

  function card(item) {
    var draft = draftOf(item);
    var изменено = state.drafts[item.parent] !== undefined;

    var node = Fmt.el('article',
      'know-card' + (item.filled ? ' know-card--filled' : ''));

    var head = Fmt.el('header', 'know-card__head');
    head.appendChild(Fmt.el('span', 'know-card__code', item.parent));
    if (item.cards) {
      head.appendChild(Fmt.el('span', 'know-card__cards',
        item.cards + ' ' + Fmt.plural(item.cards, ['карточка', 'карточки', 'карточек'])));
    }
    head.appendChild(Fmt.el('span',
      'know-card__state' + (item.filled ? ' is-filled' : ''),
      item.filled ? 'справка есть' : 'справки нет'));
    node.appendChild(head);

    // Как товар называет площадка — чтобы узнать его в лицо. Для общения
    // это имя не годится: оно про одну карточку из тысячи.
    if (item.sample) {
      node.appendChild(Fmt.el('p', 'know-card__sample', 'на площадке: ' + item.sample));
    }

    var title = document.createElement('input');
    title.className = 'know-card__title';
    title.type = 'text';
    title.placeholder = 'Как называть этот товар между собой — ' +
      'например, «Кабель USB Type-C — Type-C, 1 м, белый»';
    title.value = draft.title || '';
    title.addEventListener('input', function () { change(item, 'title', title.value); });
    node.appendChild(title);

    var facts = document.createElement('textarea');
    facts.className = 'know-card__facts';
    facts.rows = 5;
    facts.placeholder =
      'Что помощник должен знать об этом товаре. Например:\n' +
      'Длина 1 м. Разъёмы USB Type-C — Type-C.\n' +
      'Мощность до 60 Вт, ток до 3 А, поддерживает Power Delivery.\n' +
      'Передаёт данные до 480 Мбит/с. Оплётка нейлоновая.\n' +
      'Гарантия 12 месяцев.';
    facts.value = draft.facts || '';
    facts.addEventListener('input', function () {
      change(item, 'facts', facts.value);
      button.disabled = false;
      button.classList.add('btn--primary');
    });
    node.appendChild(facts);

    var foot = Fmt.el('div', 'know-card__foot');
    foot.appendChild(Fmt.el('span', 'know-card__hint',
      item.updatedAt && item.filled ? 'сохранено' : 'помощник ответит точнее'));

    var button = Fmt.el('button', 'btn ' + (изменено ? 'btn--primary' : 'btn--ghost'));
    button.type = 'button';
    button.appendChild(Fmt.el('span', null,
      state.saving[item.parent] ? 'Сохраняем…' : 'Сохранить'));
    button.disabled = !изменено || !!state.saving[item.parent];
    button.addEventListener('click', function () { save(item, node); });
    foot.appendChild(button);

    node.appendChild(foot);
    return node;
  }

  /* --- отбор ---------------------------------------------------------------- */

  function shown() {
    var needle = state.search.trim().toLowerCase();
    return state.parents.filter(function (item) {
      if (state.filter === 'unnamed' && item.named) return false;
      if (state.filter === 'unfilled' && item.filled) return false;
      if (!needle) return true;
      var haystack = item.parent + ' ' + (item.title || '') + ' ' + (item.sample || '');
      return haystack.toLowerCase().indexOf(needle) !== -1;
    });
  }

  function toolbar() {
    var bar = Fmt.el('div', 'know__bar');

    bar.appendChild(Fmt.el('span', 'know__tally',
      'Товаров: ' + state.total + ' · с названием: ' + state.named +
      ' · со справкой: ' + state.filled));

    var search = document.createElement('input');
    search.className = 'know__search';
    search.type = 'search';
    search.placeholder = 'Поиск по коду или названию';
    search.value = state.search;
    search.addEventListener('input', function () {
      state.search = search.value;
      renderList();
    });
    bar.appendChild(search);

    [['all', 'Все'], ['unnamed', 'Без названия'], ['unfilled', 'Без справки']]
      .forEach(function (pair) {
        var chip = Fmt.el('button', 'chip' + (state.filter === pair[0] ? ' is-active' : ''));
        chip.type = 'button';
        chip.appendChild(Fmt.el('span', null, pair[1]));
        chip.addEventListener('click', function () {
          state.filter = pair[0];
          render();
        });
        bar.appendChild(chip);
      });

    return bar;
  }

  var listHost = null;

  function renderList() {
    if (!listHost) return;
    Fmt.clear(listHost);
    var items = shown();

    if (!items.length) {
      listHost.appendChild(Fmt.el('p', 'inbox__loading',
        state.total
          ? 'Ничего не нашлось.'
          : 'Список пуст. Нажмите «Собрать из кабинетов» — панель прочитает ' +
            'карточки и соберёт список товаров.'));
      return;
    }
    items.forEach(function (item) { listHost.appendChild(card(item)); });
  }

  function render() {
    if (!host) return;
    Fmt.clear(host);
    host.appendChild(Fmt.el('p', 'know__lead',
      'Это справочник ответов: что помощник вправе сказать покупателю. ' +
      'Ему запрещено выдумывать характеристики, поэтому на вопрос о товаре ' +
      'он зовёт вас. Заполните справку один раз на товар — и такие вопросы ' +
      'он начнёт закрывать сам. Сами карточки и фотографии живут в разделе ' +
      '«Товары».'));
    host.appendChild(refreshBar());
    host.appendChild(toolbar());
    listHost = Fmt.el('div', 'know__list');
    host.appendChild(listHost);
    renderList();
  }

  function mount(node) {
    host = node;
    Fmt.clear(host);
    host.appendChild(Fmt.el('p', 'inbox__loading', 'Загружаем справочник…'));
    load().catch(function (error) {
      Fmt.clear(host);
      host.appendChild(Fmt.el('p', 'inbox__loading', error.message));
    });
  }

  global.Knowledge = { mount: mount, reload: load };
})(window);
