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
    category: '',       // выбранная полка
    stores: [],         // кабинеты, в которых есть карточки
    account: '',        // выбранный кабинет

    parent: null,       // открытый товар
    list: null,         // его карточки
    loadingMore: false,

    refresh: null,      // сбор каталога: идущий сейчас или последний прошедший

    card: null,         // открытая карточка
    note: null,         // правка, набранная но не сохранённая
    savingNote: false,
    askingRating: false
  };

  var host = null;
  var gridHost = null;   // сетка плиток — перерисовывается без остальной страницы
  var tallyHost = null;  // счётчик «сколько видно из скольких»

  // Номер текущего похода за оценками. Уходим с экрана — номер меняется,
  // и незаконченная дозагрузка сама прекращается.
  var поход = 0;
  var tiles = {};

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  /* --- загрузка ------------------------------------------------------------- */

  function loadParents() {
    return Api.products(state.account).then(function (payload) {
      state.parents = payload.parents || [];
      state.total = payload.total || 0;
      state.cards = payload.cards || 0;
      state.stores = payload.stores || [];
      state.level = 'parents';
      render();
    });
  }

  /* Выбор кабинета переехал в верхнюю полосу оболочки и живёт в адресе
     страницы. Здесь остаётся только отзываться на его смену: держать
     второй такой же переключатель у себя — значит развести два разных
     ответа на вопрос «чей кабинет открыт». */
  function switchStore(id) {
    if (state.account === (id || '')) return;
    // Кабинет сменился — прежний товар и его карточки к нему не относятся.
    state.account = id || '';
    state.category = '';
    state.parent = null;
    state.card = null;
    state.level = 'parents';
    поход += 1;
    loadParents().catch(function (error) { toast(error.message); });
  }

  function openParent(parent) {
    state.level = 'cards';
    state.parent = parent;
    state.list = null;
    поход += 1;                     // прежняя дозагрузка оценок больше не нужна
    render();

    Api.productCards(parent.parent, 0, state.account)
      .then(function (payload) {
        state.list = payload;
        render();
        fillRatings();
      })
      .catch(function (error) { toast(error.message); });
  }

  /* Оценки подтягиваются по одной и в фоне.

     У площадки нет метода «оценки списком», а спрашивать по карточке —
     секунда на запрос. Поэтому не держим владельца перед пустым экраном:
     плитки появляются сразу, а звёзды доезжают на ходу. Узнанное
     сохраняется, и во второй раз всё уже на месте. */
  function fillRatings() {
    var мой = поход;
    // Оценку умеет отдавать пока только Wildberries. Дёргать ради неё
    // карточки Ozon и Яндекса — это ждать ответа, которого не будет.
    var осталось = (state.list ? state.list.cards : [])
      .filter(function (card) {
        return !card.ratingKnown && card.marketplace === 'wildberries';
      });

    function дальше() {
      if (мой !== поход || !осталось.length) return;
      var card = осталось.shift();

      Api.cardRating(card.nmId)
        .then(function (fresh) {
          if (мой !== поход) return;
          card.ratingKnown = fresh.ratingKnown;
          card.rating = fresh.rating;
          card.feedbacks = fresh.feedbacks;
          обновить(card);
          дальше();
        })
        .catch(function () {
          if (мой !== поход) return;
          дальше();       // одна неудача не должна останавливать остальные
        });
    }

    дальше();
  }

  function обновить(card) {
    var tile = tiles[card.nmId];
    if (!tile) return;
    var строка = tile.querySelector('.ctile__rate');
    if (!строка) return;
    Fmt.clear(строка);
    if (card.ratingKnown) {
      строка.appendChild(stars(card.rating));
      строка.appendChild(Fmt.el('span', 'ctile__reviews',
        Fmt.number(card.feedbacks) + ' ' +
        Fmt.plural(card.feedbacks, ['отзыв', 'отзыва', 'отзывов'])));
    } else {
      строка.appendChild(Fmt.el('span', 'ctile__waiting', 'оценка неизвестна'));
    }
  }

  function loadMoreCards() {
    var list = state.list;
    if (!list || !list.more || state.loadingMore) return;

    state.loadingMore = true;
    render();

    Api.productCards(list.parent, list.offset + list.cards.length, state.account)
      .then(function (next) {
        state.loadingMore = false;
        list.cards = list.cards.concat(next.cards || []);
        list.more = next.more;
        render();
        fillRatings();
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

  function stars(rating) {
    var node = Fmt.el('span', 'ctile__stars');
    node.title = 'Оценка ' + rating + ' из 5';
    var целых = Math.round(rating);
    for (var i = 1; i <= 5; i += 1) {
      node.appendChild(Fmt.el('span', i <= целых ? 'inbox__star is-on' : 'inbox__star', '★'));
    }
    node.appendChild(Fmt.el('span', 'ctile__rating', String(rating)));
    return node;
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

    var shot = photo(item.photo, 'ptile__shot');
    // Метка на снимке — то, ради чего владелец сюда и смотрит: где непорядок.
    if (item.withoutPhoto) {
      shot.appendChild(Fmt.el('span', 'ptile__flag',
        item.withoutPhoto + ' без фото'));
    }
    tile.appendChild(shot);

    var body = Fmt.el('div', 'ptile__body');
    body.appendChild(Fmt.el('div', 'ptile__name', item.title || item.sample || item.parent));
    body.appendChild(Fmt.el('div', 'ptile__code', item.parent));

    var marks = Fmt.el('div', 'ptile__marks');
    marks.appendChild(Fmt.el('span', 'ptile__count',
      Fmt.number(item.cards) + ' ' +
      Fmt.plural(item.cards, ['карточка', 'карточки', 'карточек'])));
    if (item.noted) {
      marks.appendChild(Fmt.el('span', 'ptile__note',
        Fmt.number(item.noted) + ' ' + Fmt.plural(item.noted, ['правка', 'правки', 'правок'])));
    }
    if (!item.described) {
      marks.appendChild(Fmt.el('span', 'ptile__undescribed', 'нет справки'));
    }
    body.appendChild(marks);

    tile.appendChild(body);
    tile.addEventListener('click', function () { openParent(item); });
    return tile;
  }

  function categories() {
    var counts = {};
    state.parents.forEach(function (item) {
      var name = item.category || 'Без категории';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b, 'ru'); })
      .map(function (name) { return { name: name, parents: counts[name] }; });
  }

  function categoryRow() {
    var list = categories();
    if (list.length < 2) return null;   // одна полка — выбирать не из чего

    var row = Fmt.el('div', 'chips products__shelves');
    var все = Fmt.el('button', 'chip' + (state.category ? '' : ' is-active'));
    все.type = 'button';
    все.appendChild(Fmt.el('span', null, 'Все категории'));
    все.appendChild(Fmt.el('span', 'inbox__count', String(state.parents.length)));
    все.addEventListener('click', function () {
      state.category = '';
      render();
    });
    row.appendChild(все);

    list.forEach(function (item) {
      var chip = Fmt.el('button', 'chip' + (state.category === item.name ? ' is-active' : ''));
      chip.type = 'button';
      chip.appendChild(Fmt.el('span', null, item.name));
      chip.appendChild(Fmt.el('span', 'inbox__count', String(item.parents)));
      chip.addEventListener('click', function () {
        state.category = item.name;
        render();
      });
      row.appendChild(chip);
    });
    return row;
  }

  function shownParents() {
    var needle = state.search.trim().toLowerCase();
    return state.parents.filter(function (item) {
      if (state.category && (item.category || 'Без категории') !== state.category) return false;
      if (state.onlyTrouble && !item.withoutPhoto && !item.noted) return false;
      if (!needle) return true;
      var haystack = item.parent + ' ' + (item.title || '') + ' ' + (item.sample || '');
      return haystack.toLowerCase().indexOf(needle) !== -1;
    });
  }

  function parentsLevel() {
    // Чей кабинет — сказано в верхней полосе. Здесь только «что ищем»
    // и сами товары.
    host.appendChild(toolbar());

    var сбор = refreshBar();
    if (сбор) host.appendChild(сбор);

    gridHost = Fmt.el('div', 'products__grid');
    host.appendChild(gridHost);
    renderGrid();
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
      renderGrid();
      updateTally();
    });
    bar.appendChild(search);

    var полки = categories();
    if (полки.length > 1) {
      bar.appendChild(Menu.picker({
        empty: 'Все категории',
        value: state.category,
        items: [{ key: '', title: 'Все категории', count: state.parents.length }]
          .concat(полки.map(function (item) {
            return { key: item.name, title: item.name, count: item.parents };
          })),
        onPick: function (key) {
          state.category = key;
          render();
        }
      }));
    }

    // Отдельная кнопка, а не такая же плитка, как у категорий: это не полка,
    // а взгляд на те же товары под другим углом.
    var trouble = Fmt.el('button', 'toolbar__toggle' + (state.onlyTrouble ? ' is-active' : ''));
    trouble.type = 'button';
    trouble.appendChild(Fmt.el('span', 'toolbar__dot'));
    trouble.appendChild(Fmt.el('span', null, 'Требуют внимания'));
    trouble.addEventListener('click', function () {
      state.onlyTrouble = !state.onlyTrouble;
      render();
    });
    bar.appendChild(trouble);

    tallyHost = Fmt.el('span', 'toolbar__tally');
    bar.appendChild(tallyHost);
    updateTally();

    // Пересборка каталога — работа редкая, поэтому кнопка скромная и стоит
    // с краю. Но она всегда на месте: искать её по другим страницам не нужно.
    //
    // И она обязана отвечать на нажатие. Раньше кнопка не менялась ничем, а
    // сбор шёл своим чередом внизу — со стороны это выглядело так, будто
    // нажатие не сработало.
    var идёт = !!(state.refresh && state.refresh.running);
    var собрать = Fmt.el('button', 'toolbar__quiet');
    собрать.type = 'button';
    собрать.title = 'Прочитать карточки всех кабинетов заново';
    собрать.appendChild(Fmt.el('span', null, идёт ? 'Идёт сбор…' : 'Собрать из кабинетов'));
    собрать.disabled = идёт;
    собрать.addEventListener('click', startRefresh);
    bar.appendChild(собрать);

    return bar;
  }

  function updateTally() {
    if (!tallyHost) return;
    var видно = shownParents().length;
    var всего = state.parents.length;
    Fmt.clear(tallyHost);
    tallyHost.appendChild(Fmt.el('strong', null, Fmt.number(видно)));
    tallyHost.appendChild(document.createTextNode(
      ' ' + Fmt.plural(видно, ['товар', 'товара', 'товаров']) +
      (видно === всего ? '' : ' из ' + Fmt.number(всего))));
  }

  function renderGrid() {
    if (!gridHost) return;
    Fmt.clear(gridHost);
    var items = shownParents();
    if (!items.length) {
      gridHost.appendChild(Fmt.el('p', 'inbox__loading',
        state.total ? 'Ничего не нашлось. Попробуйте другой запрос или снимите фильтры.'
                    : 'Каталог пуст. Нажмите «Собрать из кабинетов» — панель прочитает '
                      + 'карточки всех ваших кабинетов.'));
      return;
    }
    items.forEach(function (item) { gridHost.appendChild(parentTile(item)); });
  }

  /* --- сбор каталога из кабинетов -------------------------------------------

     Кнопка сбора стояла только в справочнике ответов, и это было ошибкой:
     за товарами владелец приходит сюда. Обход один и тот же — он наполняет
     и товары, и справочник. */

  function startRefresh() {
    // Отклик до ответа сервера: запрос идёт секунду-другую, и всё это время
    // экран не должен выглядеть так, будто нажатия не было.
    state.refresh = { running: true, storesDone: 0, storesTotal: 0, cards: 0, store: '' };
    render();
    toast('Сбор запущен. Это надолго: кабинеты читаются по очереди.');

    Api.refreshKnowledge()
      .then(watchRefresh)
      .catch(function (error) {
        state.refresh = null;
        render();
        toast(error.message);
      });
  }

  function watchRefresh(run) {
    state.refresh = run;

    if (!run || run.finished) {
      if (run && run.finished) {
        // Сбор закончился — перечитываем список: там появились новые
        // кабинеты, товары и карточки.
        state.refresh = run;
        loadParents().then(function () {
          var беды = Object.keys(run.errors || {});
          toast(беды.length
            ? 'Собрано товаров: ' + run.parents + ', но не ответили: ' + беды.join(', ')
            : 'Собрано: товаров ' + run.parents + ' из ' +
              Fmt.number(run.cards) + ' карточек');
        }).catch(function (error) { toast(error.message); });
        return;
      }
      render();
      return;
    }

    render();
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

  var СОСТОЯНИЯ = {
    done: { знак: '✓', текст: 'прочитан', класс: 'is-done' },
    running: { знак: '•', текст: 'читаем сейчас', класс: 'is-running' },
    waiting: { знак: '·', текст: 'в очереди', класс: 'is-waiting' },
    error: { знак: '!', текст: 'не ответил', класс: 'is-error' },
    interrupted: { знак: '!', текст: 'прочитан не до конца', класс: 'is-error' },
    skipped: { знак: '!', текст: 'очередь не дошла', класс: 'is-error' }
  };

  function refreshBar() {
    var run = state.refresh;

    // Пока сбор не запускали и жаловаться не на что, полосе тут делать
    // нечего: кнопка «Собрать из кабинетов» и так стоит в панели.
    if (!run) return state.total ? null : пустойКаталог();
    if (run.finished && !run.interrupted && !Object.keys(run.errors || {}).length) {
      return null;
    }

    var bar = Fmt.el('div', 'know__refresh');

    if (run.running) {
      bar.appendChild(Fmt.el('span', 'know__progress',
        run.storesTotal
          ? 'Читаем карточки: кабинет ' + (run.storesDone + 1) + ' из ' + run.storesTotal +
            (run.store ? ' — ' + run.store : '') +
            (run.cards ? ', уже ' + Fmt.number(run.cards) + ' карточек' : '')
          : 'Запускаем сбор…'));
    } else if (run.interrupted) {
      bar.appendChild(Fmt.el('span', 'know__progress',
        'Прошлый сбор не закончился: панель обновлялась и прервала его. ' +
        'Нажмите «Собрать из кабинетов» ещё раз.'));
    } else {
      bar.appendChild(Fmt.el('span', 'know__progress', 'Последний сбор прошёл не до конца:'));
    }

    // Список кабинетов — прямой ответ на вопрос «а где мой второй Озон».
    var кабинеты = run.shops || [];
    if (кабинеты.length) {
      var список = Fmt.el('div', 'shops');
      кабинеты.forEach(function (shop) {
        var вид = СОСТОЯНИЯ[shop.state] || СОСТОЯНИЯ.waiting;
        var строка = Fmt.el('div', 'shops__item ' + вид.класс);
        строка.appendChild(Fmt.el('span', 'shops__mark', вид.знак));
        строка.appendChild(Fmt.el('span', 'shops__title', shop.title));
        строка.appendChild(Fmt.el('span', 'shops__state',
          shop.error || (shop.cards
            ? вид.текст + ', ' + Fmt.number(shop.cards) + ' карточек'
            : вид.текст)));
        список.appendChild(строка);
      });
      bar.appendChild(список);
    }
    return bar;
  }

  function пустойКаталог() {
    var bar = Fmt.el('div', 'know__refresh');
    bar.appendChild(Fmt.el('span', 'know__progress',
      'Каталог пуст. Соберите товары из карточек ваших кабинетов.'));
    var кнопка = Fmt.el('button', 'btn btn--primary');
    кнопка.type = 'button';
    кнопка.appendChild(Fmt.el('span', null, 'Собрать из кабинетов'));
    кнопка.addEventListener('click', startRefresh);
    bar.appendChild(кнопка);
    return bar;
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
    marks.appendChild(Fmt.el('span', 'ctile__sales',
      Fmt.number(card.sales || 0) + ' ' +
      Fmt.plural(card.sales || 0, ['продажа', 'продажи', 'продаж'])));
    if (card.note) marks.appendChild(Fmt.el('span', 'ctile__noted', 'есть правка'));
    body.appendChild(marks);

    var оценка = Fmt.el('div', 'ctile__rate');
    if (card.ratingKnown) {
      оценка.appendChild(stars(card.rating));
      оценка.appendChild(Fmt.el('span', 'ctile__reviews',
        Fmt.number(card.feedbacks) + ' ' +
        Fmt.plural(card.feedbacks, ['отзыв', 'отзыва', 'отзывов'])));
    } else {
      оценка.appendChild(Fmt.el('span', 'ctile__waiting', 'оценка загружается…'));
    }
    body.appendChild(оценка);

    tile.appendChild(body);
    tile.addEventListener('click', function () { openCard(card); });
    tiles[card.nmId] = tile;
    return tile;
  }

  function cardsLevel() {
    host.appendChild(backButton('Все товары', function () {
      state.level = 'parents';
      state.parent = null;
      поход += 1;                   // уходим — дозагрузку оценок прекращаем
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

    tiles = {};
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
    facts.appendChild(fact('Номер на площадке', card.platformId || card.nmId));
    facts.appendChild(fact('Площадка', card.marketplaceTitle || 'Wildberries'));
    facts.appendChild(fact('Фотографий', String(card.photoCount)));
    facts.appendChild(fact('Оценка',
      card.ratingKnown ? (card.rating ? '★ ' + card.rating : 'нет оценки') : '—'));
    facts.appendChild(fact('Отзывов',
      card.ratingKnown ? Fmt.number(card.feedbacks) : '—'));
    facts.appendChild(fact('Продаж', Fmt.number(card.sales || 0)));
    host.appendChild(facts);

    // Оценку по требованию умеем спрашивать пока только у Wildberries.
    if (!card.ratingKnown && card.marketplace === 'wildberries') {
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

    // Сбор мог идти прямо сейчас — или оборваться на обновлении панели.
    // И то и другое нужно показать сразу при открытии страницы, иначе
    // непрочитанный кабинет выглядит просто как отсутствующий.
    Api.knowledgeRefreshStatus()
      .then(function (run) {
        if (!run || (!run.running && !run.shops)) return;
        if (run.running) watchRefresh(run);
        else { state.refresh = run; render(); }
      })
      .catch(function () { /* сбора не было — обычное дело */ });
  }

  global.Products = {
    mount: mount,
    reload: loadParents,
    // Оболочка сообщает о смене кабинета — источник правды один, и он в адресе.
    setAccount: switchStore
  };
})(window);
