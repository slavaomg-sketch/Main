/* Разделы панели: тонкие обёртки над тем, что уже написано.

   Каждая обёртка делает три вещи: говорит верхней полосе, как называется
   раздел и нужен ли ему выбор кабинета, монтирует существующий модуль в
   отведённое место и умеет его убрать. Внутренностей модулей это не
   касается — товары, справочник, задачи и входящие работают как работали.

   Разделы, для которых пока нет данных и рабочего сценария, здесь не
   объявлены вовсе: пункт, ведущий в пустоту, хуже отсутствующего пункта. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Shell = global.Shell;
  var Topbar = global.Topbar;
  var Scope = global.Scope;

  /* Общая заготовка: раздел с одним существующим модулем внутри. */
  function простой(options) {
    var снять = null;

    return {
      mount: function (node, ctx) {
        node.className = 'section ' + (options.className || '');
        Topbar.set({
          title: options.title,
          note: options.note || '',
          scoped: !!options.scoped,
          onRefresh: options.refreshable
            ? function () { options.module().reload(); }
            : null
        });
        options.module().mount(node, options.mountOptions ? options.mountOptions(ctx) : undefined);

        // Раздел, работающий в контексте кабинета, обязан слушать его смену:
        // иначе выбор в верхней полосе ничего бы не менял.
        if (options.scoped && options.onScope) {
          снять = Scope.subscribe(function (scope) { options.onScope(scope); });
        }
      },
      update: function (ctx) {
        if (options.onScope) options.onScope(ctx.scope);
      },
      unmount: function () {
        if (снять) { снять(); снять = null; }
        if (options.module().unmount) options.module().unmount();
      }
    };
  }

  /* --- Каталог: товары, карточки, фотографии -------------------------------- */

  Shell.register('catalog', простой({
    title: 'Каталог',
    note: 'товары, карточки и фотографии',
    className: 'section--catalog',
    scoped: true,
    refreshable: true,
    module: function () { return global.Products; },
    onScope: function (scope) { global.Products.setAccount(scope.account); }
  }));

  /* --- Знания о товарах (бывший «Справочник ответов») ----------------------- */

  Shell.register('knowledge', простой({
    title: 'Знания о товарах',
    note: 'что помощник вправе сказать покупателю',
    className: 'section--knowledge',
    scoped: true,
    refreshable: true,
    module: function () { return global.Knowledge; },
    onScope: function (scope) { global.Knowledge.setAccount(scope.account); }
  }));

  /* --- Центр действий. На этом шаге — существующие задачи по кабинетам.
         Единая очередь поверх задач и входящих делается отдельным этапом. --- */

  Shell.register('actions', простой({
    title: 'Центр действий',
    note: 'что ждёт ответа в кабинетах',
    className: 'section--actions',
    refreshable: true,
    module: function () { return global.Tasks; }
  }));

  /* --- Покупатели: отзывы, вопросы, заявки ---------------------------------- */

  Shell.register('customers', {
    mount: function (node) {
      node.className = 'section section--customers';
      Topbar.set({
        title: 'Покупатели',
        note: 'отзывы, вопросы и заявки по всем кабинетам',
        scoped: false,
        onRefresh: function () { global.Inbox.reload(); }
      });
      global.Inbox.mount(node, {
        onCounts: function (total, urgent) {
          global.Sidebar.setCount('customers', total, urgent);
          global.Sidebar.render(global.Router.read());
        }
      });
    },
    unmount: function () {}
  });

  /* --- Настройки: кабинеты и ключи ------------------------------------------ */

  Shell.register('settings', {
    mount: function (node) {
      node.className = 'section section--settings';
      Topbar.set({
        title: 'Кабинеты и API',
        note: 'ключи площадок — вводите их сами, панель показывает только хвост',
        scoped: false,
        onRefresh: null
      });
      global.Keys.mount(node, {
        onSaved: function () {
          // Ключи изменились — список кабинетов мог стать другим.
          Shell.reloadScope();
        }
      });
    },
    unmount: function () {}
  });

  /* --- Неизвестный адрес ----------------------------------------------------- */

  Shell.register('missing', {
    mount: function (node) {
      node.className = 'section section--missing';
      Topbar.set({ title: 'Раздел не найден', note: '', scoped: false, onRefresh: null });
      var блок = Fmt.el('div', 'missing');
      блок.appendChild(Fmt.el('p', 'missing__text',
        'Такого раздела в панели нет. Возможно, ссылка устарела.'));
      var домой = Fmt.el('a', 'btn btn--primary');
      домой.href = '/';
      домой.appendChild(Fmt.el('span', null, 'На главную'));
      блок.appendChild(домой);
      node.appendChild(блок);
    },
    unmount: function () {}
  });
})(window);
