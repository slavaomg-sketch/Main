/* Постоянная левая навигация.

   Правило простое: слева — куда пойти, сверху — где я сейчас, в середине —
   что происходит. Раньше «куда пойти» было спрятано в выпадающем списке
   рядом с названием раздела, и владелец не видел устройства панели целиком.

   Показываем только то, за чем есть данные и рабочий сценарий. Разделы,
   у которых пока нет источника, в навигацию не попадают вовсе: пункт,
   ведущий в пустоту, хуже отсутствующего пункта. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Scope = global.Scope;

  var ЗНАЧКИ = {
    home: 'M4 11l8-7 8 7M6 10v9h12v-9',
    actions: 'M4 7h11M4 12h16M4 17h8M18 5l2 2-2 2',
    catalog: 'M4 6h7v7H4zM13 6h7v7h-7zM4 15h7v3H4zM13 15h7v3h-7z',
    customers: 'M16 18v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z'
  };

  var host = null;
  var значки = {};        // счётчики у пунктов: {actions: 12}

  function значок(имя) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'nav__icon');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ЗНАЧКИ[имя] || ЗНАЧКИ.home);
    svg.appendChild(path);
    return svg;
  }

  function пункт(options) {
    var ссылка = Fmt.el('a', 'nav__item' + (options.active ? ' is-active' : ''));
    ссылка.href = options.href;
    if (options.active) ссылка.setAttribute('aria-current', 'page');
    ссылка.title = options.title;

    if (options.icon) ссылка.appendChild(значок(options.icon));
    if (options.dot) {
      var точка = Fmt.el('span', 'nav__dot');
      точка.style.background = options.dot;
      ссылка.appendChild(точка);
    }
    ссылка.appendChild(Fmt.el('span', 'nav__label', options.title));

    if (options.count) {
      ссылка.appendChild(Fmt.el('span',
        'nav__count' + (options.urgent ? ' is-urgent' : ''), String(options.count)));
    }
    return ссылка;
  }

  function группа(заголовок) {
    var блок = Fmt.el('div', 'nav__group');
    if (заголовок) блок.appendChild(Fmt.el('div', 'nav__title', заголовок));
    return блок;
  }

  /* Активность считаем по началу пути: /catalog/p/UA-TC подсвечивает
     «Каталог», а не оставляет навигацию без выделения. */
  function активен(путь, адрес) {
    if (путь === '/') return адрес === '/';
    return адрес === путь || адрес.indexOf(путь + '/') === 0;
  }

  function render(маршрут) {
    if (!host) return;
    Fmt.clear(host);
    var адрес = маршрут.path;

    var главное = группа();
    главное.appendChild(пункт({
      href: '/', title: 'Главная', icon: 'home', active: активен('/', адрес)
    }));
    главное.appendChild(пункт({
      href: '/actions', title: 'Центр действий', icon: 'actions',
      active: активен('/actions', адрес),
      count: значки.actions, urgent: значки.actionsUrgent
    }));
    host.appendChild(главное);

    // Площадки появятся здесь вместе с рабочим местом площадки: сейчас за
    // этим пунктом нет своего экрана, а вести владельца в никуда нельзя.
    var площадки = [];
    if (площадки.length) {
      var блок = группа('Площадки');
      площадки.forEach(function (item) {
        var свой = адрес === '/mp/' + item.code;
        блок.appendChild(пункт({
          href: '/mp/' + item.code,
          title: item.title,
          dot: Scope.colorOf(item.code),
          active: свой,
          count: item.stores > 1 ? item.stores : 0
        }));
      });
      host.appendChild(блок);
    }

    var работа = группа('Работа');
    работа.appendChild(пункт({
      href: '/catalog', title: 'Каталог', icon: 'catalog', active: активен('/catalog', адрес)
    }));
    работа.appendChild(пункт({
      href: '/customers', title: 'Покупатели', icon: 'customers',
      active: активен('/customers', адрес),
      count: значки.customers, urgent: значки.customersUrgent
    }));
    host.appendChild(работа);

    var низ = группа();
    низ.className = 'nav__group nav__group--bottom';
    низ.appendChild(пункт({
      href: '/settings/accounts', title: 'Настройки', icon: 'settings',
      active: активен('/settings', адрес)
    }));
    host.appendChild(низ);
  }

  function mount(node) {
    host = node;
  }

  /* Счётчик у пункта. Ставится теми разделами, которые уже знают число:
     выдумывать его навигация не должна. */
  function setCount(имя, число, срочных) {
    значки[имя] = число || 0;
    значки[имя + 'Urgent'] = !!срочных;
  }

  global.Sidebar = { mount: mount, render: render, setCount: setCount };
})(window);
