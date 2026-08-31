/* Справочник товаров: что панель знает о каждом «родителе».

   Смысл страницы — один. Помощнику запрещено выдумывать характеристики,
   поэтому на вопрос «сколько вольт» он честно зовёт человека. Заполненная
   здесь справка едет к нему вместе с обращением, и такие вопросы он
   начинает закрывать сам.

   Родитель — это физический товар. Кабель Type-C 1 м белый продаётся
   тысячей карточек «для Samsung», «для Tecno», а товар один, и справка
   у него одна.

   Как устроена работа. Товаров сотни, и открытых форм на экране раньше было
   столько же — работать в этом невозможно. Теперь это очередь: строка на
   товар, открыта ровно одна, рядом фотография (назвать своими словами
   товар, которого не видишь, нельзя), а Cmd/Ctrl+Enter сохраняет и сразу
   открывает следующий неописанный. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;

  var state = {
    parents: [],
    filled: 0,
    named: 0,
    total: 0,
    drafts: {},        // изменённое, но ещё не сохранённое
    saving: {},
    open: '',          // какой товар раскрыт прямо сейчас
    filter: 'unnamed', // all | unnamed | unfilled
    search: '',
    stores: [],
    account: '',
    refresh: null
  };

  var host = null;
  var listHost = null;

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  function load() {
    return Api.knowledge(state.account).then(function (payload) {
      state.parents = payload.parents || [];
      state.filled = payload.filled || 0;
      state.named = payload.named || 0;
      state.total = payload.total || 0;
      state.stores = payload.stores || [];
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

  /* --- сохранение ----------------------------------------------------------- */

  function save(item, дальше) {
    var draft = draftOf(item);
    state.saving[item.parent] = true;
    render();

    return Api.saveKnowledge(item.parent, draft.title, draft.facts)
      .then(function (saved) {
        delete state.saving[item.parent];
        delete state.drafts[item.parent];
        for (var i = 0; i < state.parents.length; i += 1) {
          if (state.parents[i].parent === saved.parent) {
            // Фотографию сервер в ответе не присылает — она к справке
            // отношения не имеет, а терять её на экране нельзя.
            saved.photo = state.parents[i].photo;
            state.parents[i] = saved;
          }
        }
        state.named = state.parents.filter(function (row) { return row.named; }).length;
        state.filled = state.parents.filter(function (row) { return row.filled; }).length;
        state.open = дальше ? следующий(item) : '';
        toast(дальше ? 'Сохранено, открыт следующий' : 'Справка сохранена');
        render();
      })
      .catch(function (error) {
        delete state.saving[item.parent];
        render();
        toast(error.message);
      });
  }

  /* Следующий товар в текущем списке — тот, что стоит ниже. Именно то, что
     нужно после сохранения: работа идёт сверху вниз и не перескакивает. */
  function следующий(item) {
    var список = shown();
    for (var i = 0; i < список.length; i += 1) {
      if (список[i].parent === item.parent) {
        return список[i + 1] ? список[i + 1].parent : '';
      }
    }
    return список.length ? список[0].parent : '';
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
      if (run && run.finished) {
        load().then(function () {
          var беды = Object.keys(run.errors || {});
          toast(беды.length
            ? 'Собрано товаров: ' + run.parents + ', но не ответили: ' + беды.join(', ')
            : 'Собрано: товаров ' + run.parents + ' из ' +
              Fmt.number(run.cards) + ' карточек');
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
    if (!run && state.total) return null;

    var bar = Fmt.el('div', 'know__refresh');
    if (run && run.running) {
      bar.appendChild(Fmt.el('span', 'know__progress',
        'Читаем карточки: кабинет ' + (run.storesDone + 1) + ' из ' + run.storesTotal +
        (run.store ? ' — ' + run.store : '') +
        (run.cards ? ', уже ' + Fmt.number(run.cards) + ' карточек' : '')));
      return bar;
    }

    bar.appendChild(Fmt.el('span', 'know__progress',
      'Список пуст. Соберите товары из карточек ваших кабинетов — ' +
      'после этого их можно будет описывать.'));
    var кнопка = Fmt.el('button', 'btn btn--primary');
    кнопка.type = 'button';
    кнопка.appendChild(Fmt.el('span', null, 'Собрать из кабинетов'));
    кнопка.addEventListener('click', startRefresh);
    bar.appendChild(кнопка);
    return bar;
  }

  /* --- шапка с ходом работы -------------------------------------------------- */

  function progress() {
    var block = Fmt.el('div', 'progress');

    var head = Fmt.el('div', 'progress__head');
    var сделано = state.filled;
    head.appendChild(Fmt.el('span', 'progress__count',
      Fmt.number(сделано) + ' из ' + Fmt.number(state.total)));
    head.appendChild(Fmt.el('span', 'progress__label', 'товаров описано для помощника'));
    block.appendChild(head);

    var желоб = Fmt.el('div', 'progress__track');
    var полоса = Fmt.el('div', 'progress__fill');
    полоса.style.width = (state.total ? Math.round(сделано / state.total * 100) : 0) + '%';
    желоб.appendChild(полоса);
    block.appendChild(желоб);

    block.appendChild(Fmt.el('p', 'progress__hint',
      'Помощнику запрещено выдумывать характеристики: на вопрос о товаре он ' +
      'зовёт вас. Опишите товар один раз — и такие вопросы он начнёт ' +
      'закрывать сам. Фотографии и карточки живут в разделе «Товары».'));
    return block;
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
    var bar = Fmt.el('div', 'toolbar');

    var search = document.createElement('input');
    search.className = 'toolbar__search';
    search.type = 'search';
    search.placeholder = 'Поиск по названию или коду';
    search.value = state.search;
    search.addEventListener('input', function () {
      state.search = search.value;
      renderList();
    });
    bar.appendChild(search);

    var виды = [
      { key: 'unnamed', title: 'Ещё не названы', count: state.total - state.named },
      { key: 'unfilled', title: 'Без справки', count: state.total - state.filled },
      { key: 'all', title: 'Все товары', count: state.total }
    ];
    bar.appendChild(Menu.picker({
      value: state.filter,
      items: виды,
      onPick: function (key) {
        state.filter = key;
        state.open = '';
        render();
      }
    }));

    var видно = shown().length;
    var счёт = Fmt.el('span', 'toolbar__tally');
    счёт.appendChild(Fmt.el('strong', null, Fmt.number(видно)));
    счёт.appendChild(document.createTextNode(
      ' ' + Fmt.plural(видно, ['товар', 'товара', 'товаров'])));
    bar.appendChild(счёт);
    return bar;
  }

  /* --- строка товара --------------------------------------------------------- */

  function photo(url) {
    var box = Fmt.el('div', 'know-row__shot');
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      box.appendChild(img);
    }
    return box;
  }

  function row(item) {
    var раскрыт = state.open === item.parent;
    var node = Fmt.el('article', 'know-row' + (раскрыт ? ' is-open' : ''));

    var head = Fmt.el('button', 'know-row__head');
    head.type = 'button';
    head.appendChild(photo(item.photo));

    var текст = Fmt.el('div', 'know-row__text');
    var имя = Fmt.el('div', 'know-row__name' + (item.named ? '' : ' is-empty'),
      item.title || item.sample || 'без названия');
    текст.appendChild(имя);

    var низ = Fmt.el('div', 'know-row__meta');
    низ.appendChild(Fmt.el('span', 'know-row__code', item.parent));
    if (item.cards) {
      низ.appendChild(Fmt.el('span', null,
        Fmt.number(item.cards) + ' ' +
        Fmt.plural(item.cards, ['карточка', 'карточки', 'карточек'])));
    }
    текст.appendChild(низ);
    head.appendChild(текст);

    if (item.filled) {
      head.appendChild(Fmt.el('span', 'know-row__state is-filled', 'справка есть'));
    }

    head.addEventListener('click', function () {
      state.open = раскрыт ? '' : item.parent;
      render();
    });
    node.appendChild(head);

    if (раскрыт) node.appendChild(editor(item));
    return node;
  }

  function editor(item) {
    var draft = draftOf(item);
    var изменено = state.drafts[item.parent] !== undefined;
    var занят = !!state.saving[item.parent];

    var box = Fmt.el('div', 'know-row__editor');

    if (item.sample) {
      box.appendChild(Fmt.el('p', 'know-row__sample', 'на площадке: ' + item.sample));
    }

    var title = document.createElement('input');
    title.className = 'know-row__title';
    title.type = 'text';
    title.placeholder = 'Как называть этот товар между собой — ' +
      'например, «Кабель USB Type-C — Type-C, 1 м, белый»';
    title.value = draft.title || '';
    box.appendChild(title);

    var facts = document.createElement('textarea');
    facts.className = 'know-row__facts';
    facts.rows = 6;
    facts.placeholder =
      'Что помощник должен знать об этом товаре. Например:\n' +
      'Длина 1 м. Разъёмы USB Type-C — Type-C.\n' +
      'Мощность до 60 Вт, ток до 3 А, поддерживает Power Delivery.\n' +
      'Передаёт данные до 480 Мбит/с. Оплётка нейлоновая.\n' +
      'Гарантия 12 месяцев.';
    facts.value = draft.facts || '';
    box.appendChild(facts);

    var foot = Fmt.el('div', 'know-row__foot');
    foot.appendChild(Fmt.el('span', 'know-row__hint',
      'Сохранить и открыть следующий — ⌘↵'));

    var сохранить = Fmt.el('button', 'btn btn--ghost');
    сохранить.type = 'button';
    сохранить.appendChild(Fmt.el('span', null, занят ? 'Сохраняем…' : 'Сохранить'));
    сохранить.disabled = !изменено || занят;
    сохранить.addEventListener('click', function () { save(item, false); });
    foot.appendChild(сохранить);

    var дальше = Fmt.el('button', 'btn btn--primary');
    дальше.type = 'button';
    дальше.appendChild(Fmt.el('span', null, 'Сохранить и следующий'));
    дальше.disabled = !изменено || занят;
    дальше.addEventListener('click', function () { save(item, true); });
    foot.appendChild(дальше);

    box.appendChild(foot);

    function печать(field, node) {
      return function () {
        change(item, field, node.value);
        сохранить.disabled = false;
        дальше.disabled = false;
      };
    }
    title.addEventListener('input', печать('title', title));
    facts.addEventListener('input', печать('facts', facts));

    function горячая(event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (state.drafts[item.parent] !== undefined) save(item, true);
      }
    }
    title.addEventListener('keydown', горячая);
    facts.addEventListener('keydown', горячая);

    // Курсор сразу в поле названия: раскрыли строку — можно печатать.
    setTimeout(function () { title.focus(); }, 0);
    return box;
  }

  /* --- сборка страницы ------------------------------------------------------- */

  function renderList() {
    if (!listHost) return;
    Fmt.clear(listHost);
    var items = shown();

    if (!items.length) {
      listHost.appendChild(Fmt.el('p', 'inbox__loading',
        state.total
          ? 'Здесь пусто — значит, всё описано. Переключите вид, чтобы увидеть остальные.'
          : 'Список пуст. Нажмите «Собрать из кабинетов» — панель прочитает ' +
            'карточки и соберёт список товаров.'));
      return;
    }
    items.forEach(function (item) { listHost.appendChild(row(item)); });
  }

  /* Кабинет выбирается в верхней полосе оболочки. Справка при этом общая:
     товар физически один, в каком бы кабинете он ни продавался. */
  function switchStore(id) {
    if (state.account === (id || '')) return;
    state.account = id || '';
    state.open = '';
    return load().catch(function (error) { toast(error.message); });
  }

  function render() {
    if (!host) return;
    Fmt.clear(host);

    host.appendChild(progress());

    var сбор = refreshBar();
    if (сбор) host.appendChild(сбор);

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

  global.Knowledge = { mount: mount, reload: load, setAccount: switchStore };
})(window);
