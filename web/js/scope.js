/* Контекст: какая площадка и какой кабинет выбраны.

   Это единственное место, где панель хранит ответ на вопрос «чьи цифры я
   сейчас смотрю». Раньше такой ответ был у каждой страницы свой: на
   показателях — набор плиток площадок и магазинов, на товарах — свой
   выбор кабинета, на задачах — третий. Владелец переходил между
   разделами и терял контекст.

   Хранится он в адресе строки браузера (`?mp=` и `?account=`), а не в
   отдельной переменной. Из этого следует, что перезагрузка, «назад» и
   присланная ссылка показывают ровно то же самое.

   Список кабинетов подгружается один раз с `/api/marketplaces` — это
   существующий метод, ничего нового на сервере не понадобилось. */
(function (global) {
  'use strict';

  var Api = global.Api;
  var Router = global.Router;

  var ПОРЯДОК = ['wildberries', 'ozon', 'yandex'];

  var НАЗВАНИЯ = {
    wildberries: 'Wildberries',
    ozon: 'Ozon',
    yandex: 'Яндекс Маркет',
    ali: 'AliExpress'
  };

  // Имена переменных цвета в оформлении совпадают с кодами, кроме ВБ.
  function цвет(код) {
    return 'var(--' + (код === 'wildberries' ? 'wb' : код) + ')';
  }

  var state = {
    loaded: false,
    marketplaces: [],   // [{code, title, state, stores, storeTitles}]
    stores: []          // [{id, title, marketplace}]
  };

  var слушатели = [];

  function load() {
    if (state.loaded) return Promise.resolve(state);
    return Api.marketplaces().then(function (payload) {
      state.marketplaces = payload.marketplaces || [];
      state.stores = payload.stores || [];
      state.loaded = true;
      return state;
    });
  }

  /* Что выбрано прямо сейчас — читается из адреса, а не из памяти. */
  function current() {
    var params = Router.read().params;
    var площадка = params.mp || '';
    var кабинет = params.account || '';

    // Кабинет всегда принадлежит своей площадке. Если в адресе оказалась
    // несовместимая пара — верим кабинету: он конкретнее.
    var найден = null;
    state.stores.forEach(function (store) {
      if (store.id === кабинет) найден = store;
    });
    if (найден) площадка = найден.marketplace;
    else кабинет = '';

    return {
      marketplace: площадка,
      account: кабинет,
      store: найден,
      title: найден ? найден.title : (площадка ? НАЗВАНИЯ[площадка] || площадка : 'Все площадки')
    };
  }

  /* Кабинеты выбранной площадки (или все, если площадка не выбрана). */
  function storesOf(площадка) {
    if (!площадка) return state.stores.slice();
    return state.stores.filter(function (store) { return store.marketplace === площадка; });
  }

  /* Площадки, у которых есть хотя бы один рабочий кабинет. Пустые в
     навигацию не показываем: пункт, за которым ничего нет, только мешает. */
  function marketplaces() {
    function место(код) {
      var номер = ПОРЯДОК.indexOf(код);
      return номер === -1 ? 99 : номер;      // ноль — тоже номер, а не «нет»
    }
    return state.marketplaces
      .filter(function (item) { return item.stores > 0; })
      .sort(function (a, b) { return место(a.code) - место(b.code); });
  }

  /* Смена контекста. Пишем в адрес — и всё остальное само перерисуется
     по подписке на роутер. */
  function set(площадка, кабинет, options) {
    Router.setParams({ mp: площадка || '', account: кабинет || '' }, options);
    слушатели.forEach(function (кто) { кто(current()); });
  }

  function subscribe(кто) {
    слушатели.push(кто);
    return function () {
      слушатели = слушатели.filter(function (иной) { return иной !== кто; });
    };
  }

  global.Scope = {
    load: load,
    current: current,
    set: set,
    subscribe: subscribe,
    storesOf: storesOf,
    marketplaces: marketplaces,
    titleOf: function (код) { return НАЗВАНИЯ[код] || код; },
    colorOf: цвет,
    all: function () { return state; }
  };
})(window);
