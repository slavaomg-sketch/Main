/* Экран «Задачи»: список дел по кабинету, как в кабинете продавца.

   Навигация:  площадка → кабинет → задача → рабочий список.

   Отличие от «Входящих» — не в оформлении, а в природе. «Входящие» это
   переписка, а «Задачи» со временем соберут разную работу: собрать заказ,
   забрать возврат, починить карточку. Поэтому раздел отдельный.

   Всё, что касается самого обращения — карточка, ответ, черновик помощника,
   конвейер — берётся из общего модуля Reply. Второй реализации здесь нет.

   Сегодня объявлена одна задача: вопросы Wildberries. Пунктов-заглушек
   на экране нет: пустой пункт в списке дел хуже, чем его отсутствие. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;
  var Reply = global.Reply;

  var state = {
    catalogue: null,     // площадки → кабинеты → задачи
    place: '',
    store: '',
    task: '',
    work: null,          // загруженный рабочий список
    loading: false,
    loadingMore: false,
    agent: false
  };

  var host = null;

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  /* --- выборка по дереву ---------------------------------------------------- */

  function places() {
    return (state.catalogue && state.catalogue.marketplaces) || [];
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

  function currentTask() {
    var store = currentStore();
    if (!store) return null;
    var list = store.tasks || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].key === state.task) return list[i];
    }
    return list[0] || null;
  }

  /* --- загрузка ------------------------------------------------------------- */

  function loadCatalogue() {
    return Api.tasks().then(function (payload) {
      state.catalogue = payload;
      return payload;
    });
  }

  function loadWork() {
    var store = currentStore();
    var task = currentTask();
    // Кабинетов или задач нет — показываем это, а не вечное «загружаем».
    if (!store || !task) {
      state.loading = false;
      render();
      return Promise.resolve(null);
    }

    state.loading = true;
    state.work = null;
    Reply.resetBatch();
    render();

    return Api.task(store.id, task.key, 0)
      .then(function (payload) {
        state.loading = false;
        state.work = payload;
        render();
      })
      .catch(function (error) {
        state.loading = false;
        render();
        toast(error.message);
      });
  }

  function loadMore() {
    var work = state.work;
    if (!work || !work.more || state.loadingMore) return;

    state.loadingMore = true;
    render();

    Api.task(work.accountId, work.task, work.offset + work.loaded)
      .then(function (next) {
        state.loadingMore = false;
        // Дописываем к уже показанному, а не заменяем: владелец мог
        // набрать ответы в верхних карточках.
        work.items = work.items.concat(next.items || []);
        work.loaded = work.items.length;
        work.more = next.more;
        if (next.total !== undefined) work.total = next.total;
        render();
      })
      .catch(function (error) {
        state.loadingMore = false;
        render();
        toast(error.message);
      });
  }

  /* --- ряды навигации ------------------------------------------------------- */

  /* Путь до задачи: площадка → кабинет → задача. Раньше это были три ряда
     плиток один под другим — три строки экрана на выбор, который делают раз
     в день. Теперь это одна строка, читается слева направо, как дорога. */
  function path() {
    var row = Fmt.el('div', 'path');
    var place = currentPlace();
    var store = currentStore();
    var task = currentTask();

    row.appendChild(Menu.picker({
      value: place ? place.code : '',
      items: places().map(function (item) {
        return { key: item.code, title: item.title };
      }),
      onPick: function (key) {
        state.place = key;
        state.store = '';
        state.task = '';
        loadWork();
      }
    }));

    var shops = (place && place.stores) || [];
    if (shops.length) {
      row.appendChild(Fmt.el('span', 'path__sep', '›'));
      row.appendChild(Menu.picker({
        value: store ? store.id : '',
        items: shops.map(function (shop) {
          return { key: shop.id, title: shop.title };
        }),
        onPick: function (key) {
          state.store = key;
          state.task = '';
          loadWork();
        }
      }));
    }

    var tasks = (store && store.tasks) || [];
    if (tasks.length) {
      row.appendChild(Fmt.el('span', 'path__sep', '›'));
      row.appendChild(Menu.picker({
        value: task ? task.key : '',
        items: tasks.map(function (item) {
          return { key: item.key, title: item.title };
        }),
        onPick: function (key) {
          state.task = key;
          loadWork();
        }
      }));
    }

    return row;
  }

  /* --- строка «всего / загружено» ------------------------------------------- */

  function tally(work) {
    var bar = Fmt.el('div', 'tasks__tally');
    var waiting = Reply.visible(work.items || []).length;

    // «Всего» и «сейчас загружено» — разные числа, и путать их нельзя.
    if (work.total === null || work.total === undefined) {
      bar.appendChild(Fmt.el('span', 'tasks__total is-unknown', 'Всего: не удалось узнать'));
    } else {
      bar.appendChild(Fmt.el('span', 'tasks__total',
        'Всего у площадки: ' + Fmt.number(work.total)));
    }

    bar.appendChild(Fmt.el('span', 'tasks__loaded',
      'загружено ' + (work.items || []).length +
      (waiting !== (work.items || []).length ? ', осталось ' + waiting : '')));

    if (work.more) {
      var more = Fmt.el('button', 'btn btn--ghost');
      more.type = 'button';
      more.appendChild(Fmt.el('span', null,
        state.loadingMore ? 'Загружаем…' : 'Показать ещё'));
      more.disabled = !!state.loadingMore;
      more.addEventListener('click', loadMore);
      bar.appendChild(more);
    }
    return bar;
  }

  /* --- сборка экрана -------------------------------------------------------- */

  function render() {
    if (!host) return;
    Fmt.clear(host);

    if (!state.catalogue) {
      host.appendChild(Fmt.el('p', 'inbox__loading', 'Загружаем список задач…'));
      return;
    }

    if (!places().length) {
      var empty = Fmt.el('div', 'inbox__empty');
      empty.appendChild(Fmt.el('p', 'inbox__emptyText',
        'Нет ни одного кабинета с готовыми задачами. Добавьте ключи на ' +
        'странице «Ключи» — и задачи появятся здесь.'));
      host.appendChild(empty);
      return;
    }

    host.appendChild(path());

    var place = currentPlace();
    var store = currentStore();
    var task = currentTask();
    if (place) state.place = place.code;
    if (store) state.store = store.id;
    if (task) state.task = task.key;

    if (state.loading) {
      host.appendChild(Fmt.el('p', 'inbox__loading', 'Спрашиваем площадку…'));
      return;
    }

    var work = state.work;
    if (!work) return;

    // Ошибка получения списка не должна выглядеть как «ноль задач».
    if (work.error) {
      var trouble = Fmt.el('div', 'inbox__trouble');
      trouble.appendChild(Fmt.el('strong', null,
        'Список не загрузился: ' + work.error + '. '));
      trouble.appendChild(Fmt.el('span', null,
        work.error === 'нет прав в ключе'
          ? 'Откройте «Ключи» и создайте токен с категорией «Вопросы и отзывы».'
          : 'Попробуйте обновить через несколько минут.'));
      host.appendChild(trouble);
      return;
    }

    host.appendChild(tally(work));

    var items = work.items || [];
    var ctx = {
      agent: state.agent,
      redraw: render
    };
    var scope = {
      accountId: work.accountId, kind: work.kind, marketplace: work.marketplace
    };

    var bar = Reply.conveyor(scope, items, ctx);
    if (bar) host.appendChild(bar);

    var waiting = Reply.visible(items);
    if (!waiting.length) {
      var done = Fmt.el('div', 'inbox__empty');
      done.appendChild(Fmt.el('div', 'inbox__zero', '0'));
      done.appendChild(Fmt.el('p', 'inbox__emptyText',
        work.title + ' — ничего не ждёт ответа. Так и должно быть.'));
      host.appendChild(done);
      return;
    }

    var list = Fmt.el('div', 'inbox__list');
    waiting.forEach(function (item) { list.appendChild(Reply.card(item, ctx)); });
    host.appendChild(list);
  }

  function mount(node, options) {
    host = node;
    options = options || {};
    state.agent = !!options.agent;
    render();

    loadCatalogue()
      .then(function () {
        render();               // оглавление уже есть — рисуем ряды сразу
        return loadWork();
      })
      .catch(function (error) {
        Fmt.clear(host);
        host.appendChild(Fmt.el('p', 'inbox__loading', error.message));
      });
  }

  function reload() {
    return loadCatalogue().then(loadWork).catch(function (error) {
      toast(error.message);
    });
  }

  global.Tasks = { mount: mount, reload: reload };
})(window);
