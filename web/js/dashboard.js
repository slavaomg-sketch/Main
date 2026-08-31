/* Раздел «Главная»: показатели, графики, настраиваемая доска.

   Раньше этот файл был хозяином всей страницы: он же вход по паролю, он же
   тема, он же тосты, он же верхняя панель. Теперь всё это принадлежит
   оболочке, а здесь осталась только доска — её состояние, загрузка данных,
   режим настройки и перетаскивание блоков.

   Сама доска не переписана: логика показателей, раскладок и блоков та же,
   что и была. Изменилось только то, кто рисует рамку вокруг неё. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;
  var Blocks = global.Blocks;
  var Charts = global.Charts;

  var PERIODS = [
    { key: 'today', label: 'Сегодня' },
    { key: 'yesterday', label: 'Вчера' },
    { key: '7d', label: '7 дней' },
    { key: '30d', label: '30 дней' },
    { key: 'month', label: 'Месяц' },
    { key: 'quarter', label: 'Квартал' },
    { key: 'half', label: 'Полгода' },
    { key: 'year', label: 'Год' },
    { key: 'custom', label: 'Свой' }
  ];

  var SIZE_ORDER = ['sm', 'md', 'lg', 'xl'];
  var SIZE_LABEL = { sm: 'S', md: 'M', lg: 'L', xl: 'XL' };
  var AUTO_REFRESH_MS = 5 * 60 * 1000;

  var state = {
    session: { authEnabled: false, authenticated: true },
    catalog: [],
    catalogByType: {},
    layouts: [],
    active: '',
    preset: '30d',
    from: '',
    to: '',
    selected: null,      // Set кодов площадок; null — все
    store: '',           // id магазина; пусто — все магазины вместе
    skipToday: false,    // отбросить незавершённые сегодняшние сутки
    storeList: [],
    data: null,
    editing: false,
    loading: false,
    saveTimer: null,
    refreshTimer: null,
    sync: null,
    syncing: false
  };

  var dom = {};

  function $(id) { return document.getElementById(id); }

  function cacheDom() {
    ['tabs', 'periods', 'marketplaces', 'stores', 'skip-today', 'board', 'editbar',
     'btn-edit', 'btn-done', 'btn-library', 'btn-reset', 'btn-new-tab',
     'library', 'library-body', 'range', 'range-form', 'range-from', 'range-to',
     'status-dot', 'status-text', 'footer-note', 'coverage-note'].forEach(function (id) {
      dom[id] = $(id);
    });
  }

  /* --- Мелочи интерфейса ---------------------------------------------------- */

  // Уведомления и запоминание настроек — общие для всей панели.
  function toast(message) { global.Shell.toast(message); }
  function readStorage(key, fallback) { return global.Shell.read(key, fallback); }
  function writeStorage(key, value) { global.Shell.write(key, value); }

  function openSheet(id) { dom[id].hidden = false; }
  function closeSheet(id) { dom[id].hidden = true; }

  /* --- Фильтры -------------------------------------------------------------- */

  function renderPeriods() {
    Fmt.clear(dom.periods);
    PERIODS.forEach(function (period) {
      var button = Fmt.el('button', 'segment', period.label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      if (state.preset === period.key) button.classList.add('is-active');
      button.addEventListener('click', function () {
        if (period.key === 'custom') {
          dom['range-from'].value = state.from || (state.data && state.data.period.from) || '';
          dom['range-to'].value = state.to || (state.data && state.data.period.to) || '';
          openSheet('range');
          return;
        }
        state.preset = period.key;
        state.from = '';
        state.to = '';
        writeStorage('dashboard.preset', period.key);
        renderPeriods();
        renderSkipToday();
        loadData();
      });
      dom.periods.appendChild(button);
    });
  }

  /* Сегодняшний день неполный. Для длинных периодов это заметно искажает
     цифры, поэтому его можно отбросить целиком — одним переключателем. */
  function renderSkipToday() {
    Fmt.clear(dom['skip-today']);
    var open = ['7d', '14d', '30d', '90d', 'month', 'quarter', 'half', 'year'];
    var applies = open.indexOf(state.preset) !== -1;
    dom['skip-today'].hidden = !applies;
    if (!applies) return;

    var chip = Fmt.el('button', 'chip');
    chip.type = 'button';
    chip.appendChild(Fmt.el('span', null, 'Без сегодня'));
    if (state.skipToday) chip.classList.add('is-active');
    chip.title = state.skipToday
      ? 'Период считается по вчерашний день включительно'
      : 'Сегодняшний неполный день входит в период';
    chip.addEventListener('click', function () {
      state.skipToday = !state.skipToday;
      writeStorage('dashboard.skipToday', state.skipToday ? '1' : '');
      renderSkipToday();
      loadData();
    });
    dom['skip-today'].appendChild(chip);
  }

  function renderMarketplaceChips(list) {
    Fmt.clear(dom.marketplaces);

    // Скрытые площадки хранятся списком, а показанные вычисляются от него:
    // площадка, у которой только что появились ключи, включается сама.
    var hidden = readStorage('dashboard.hidden', '');
    var hiddenSet = new Set(hidden ? hidden.split(',') : []);
    var visible = list
      .map(function (item) { return item.code; })
      .filter(function (code) { return !hiddenSet.has(code); });
    state.selected = visible.length === list.length ? null : new Set(visible);

    list.forEach(function (item) {
      var chip = Fmt.el('button', 'chip');
      chip.type = 'button';
      chip.style.setProperty('--dot', Fmt.colorOf(item.code));
      var dot = Fmt.el('span', 'chip__dot');
      chip.appendChild(dot);
      chip.appendChild(Fmt.el('span', null, item.title));
      if (item.state === 'demo') {
        chip.appendChild(Fmt.el('span', 'badge badge--muted', 'демо'));
      } else if (item.state === 'empty') {
        chip.appendChild(Fmt.el('span', 'badge badge--muted', 'нет ключей'));
      } else if (item.stores > 1) {
        chip.appendChild(Fmt.el('span', 'badge badge--muted', String(item.stores)));
      }
      if (!state.selected || state.selected.has(item.code)) chip.classList.add('is-active');
      chip.addEventListener('click', function () {
        var codes = state.selected ? new Set(state.selected) : new Set(list.map(function (m) { return m.code; }));
        if (codes.has(item.code)) {
          codes.delete(item.code);
        } else {
          codes.add(item.code);
        }
        if (!codes.size) {
          toast('Оставьте хотя бы одну площадку');
          return;
        }
        state.selected = codes.size === list.length ? null : codes;
        var hidden = list
          .map(function (item) { return item.code; })
          .filter(function (code) { return !codes.has(code); });
        writeStorage('dashboard.hidden', hidden.join(','));
        renderMarketplaceChips(list);
        loadData();
      });
      dom.marketplaces.appendChild(chip);
    });
  }

  function storeTitle(id) {
    var found = state.storeList.filter(function (item) { return item.id === id; })[0];
    return found ? found.title : '';
  }

  function renderStoreChips(list) {
    state.storeList = list || [];
    Fmt.clear(dom.stores);

    // Переключатель нужен, только когда кабинетов больше одного.
    dom.stores.hidden = state.storeList.length < 2;
    if (state.storeList.length < 2) {
      state.store = '';
      return;
    }

    // Выбранный магазин мог быть удалён — тогда возвращаемся ко «Всем».
    if (state.store && !storeTitle(state.store)) state.store = '';

    var options = [{ id: '', title: 'Все магазины', marketplace: '' }]
      .concat(state.storeList);

    options.forEach(function (item) {
      var chip = Fmt.el('button', 'chip');
      chip.type = 'button';
      if (item.id) {
        chip.style.setProperty('--dot', Fmt.colorOf(item.marketplace));
        chip.appendChild(Fmt.el('span', 'chip__dot'));
      }
      chip.appendChild(Fmt.el('span', null, item.title));
      if (state.store === item.id) chip.classList.add('is-active');
      chip.addEventListener('click', function () {
        if (state.store === item.id) return;
        state.store = item.id;
        writeStorage('dashboard.store', item.id);
        renderStoreChips(state.storeList);
        loadData();
      });
      dom.stores.appendChild(chip);
    });
  }

  /* --- Вкладки (раскладки) --------------------------------------------------- */

  function activeLayout() {
    return state.layouts.filter(function (item) { return item.name === state.active; })[0]
      || state.layouts[0];
  }

  function renderTabs() {
    Fmt.clear(dom.tabs);
    state.layouts.forEach(function (layout) {
      var tab = Fmt.el('button', 'tab');
      tab.type = 'button';
      tab.appendChild(Fmt.el('span', null, layout.name));
      if (layout.name === state.active) {
        tab.classList.add('is-active');
        if (state.layouts.length > 1) {
          var close = Fmt.el('span', 'tab__close', '×');
          close.title = 'Удалить вкладку';
          close.addEventListener('click', function (event) {
            event.stopPropagation();
            if (!confirm('Удалить вкладку «' + layout.name + '»?')) return;
            Api.deleteLayout(layout.name).then(function () {
              return loadLayouts();
            }).then(function () {
              toast('Вкладка удалена');
            }).catch(function (error) { toast(error.message); });
          });
          tab.appendChild(close);
        }
      }
      tab.addEventListener('click', function () {
        if (state.active === layout.name) {
          if (state.editing) renameTab(layout.name);
          return;
        }
        state.active = layout.name;
        writeStorage('dashboard.layout', layout.name);
        Api.savePreference('active_layout', layout.name).catch(function () {});
        renderTabs();
        renderBoard();
      });
      tab.title = state.editing ? 'Нажмите ещё раз, чтобы переименовать' : layout.name;
      dom.tabs.appendChild(tab);
    });
  }

  function renameTab(name) {
    var next = prompt('Новое имя вкладки', name);
    if (!next || next.trim() === name) return;
    Api.renameLayout(name, next.trim()).then(function (result) {
      state.active = result.name;
      return loadLayouts();
    }).then(function () {
      toast('Вкладка переименована');
    }).catch(function (error) { toast(error.message); });
  }

  function createTab() {
    var name = prompt('Название новой вкладки', 'Финансы');
    if (!name || !name.trim()) return;
    Api.saveLayout(name.trim(), []).then(function () {
      state.active = name.trim();
      return loadLayouts();
    }).then(function () {
      toast('Вкладка создана — добавьте блоки');
      openSheet('library');
    }).catch(function (error) { toast(error.message); });
  }

  /* --- Сохранение раскладки -------------------------------------------------- */

  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      var layout = activeLayout();
      if (!layout) return;
      Api.saveLayout(layout.name, layout.blocks).catch(function (error) {
        toast('Не удалось сохранить: ' + error.message);
      });
    }, 500);
  }

  /* --- Отрисовка доски ------------------------------------------------------- */

  function renderBoard() {
    var board = dom.board;
    Charts.hideTooltip();
    Fmt.clear(board);
    board.classList.toggle('is-editing', state.editing);

    var layout = activeLayout();
    if (!layout) return;

    var visible = layout.blocks.filter(function (block) {
      return state.editing || !block.hidden;
    });

    // Период — общий для всей доски, поэтому сказан один раз и над ней.
    if (state.data && visible.length) {
      var линия = Fmt.el('div', 'board__period', Blocks.periodLine(state.data));
      board.appendChild(линия);
    }

    if (!visible.length) {
      var empty = Fmt.el('div', 'board-empty');
      empty.appendChild(Fmt.el('h2', null, state.editing ? 'Пустая вкладка' : 'Здесь пока пусто'));
      empty.appendChild(Fmt.el('p', null,
        'Нажмите «Настроить» и соберите панель из блоков: показатели, графики, таблицы, остатки.'));
      var button = Fmt.el('button', 'btn btn--primary', 'Добавить блок');
      button.type = 'button';
      button.addEventListener('click', function () {
        setEditing(true);
        openSheet('library');
      });
      empty.appendChild(button);
      board.appendChild(empty);
      return;
    }

    visible.forEach(function (block, index) {
      board.appendChild(buildCard(block, index));
    });
  }

  function buildCard(block, index) {
    var definition = state.catalogByType[block.type] || { title: block.type, sizes: SIZE_ORDER };
    var card = Fmt.el('article', 'card');
    card.dataset.size = block.size;
    card.dataset.id = block.id;
    card.style.animationDelay = Math.min(index * 0.035, 0.4) + 's';
    if (block.hidden) card.classList.add('is-hidden');

    var head = Fmt.el('div', 'card__head');
    var titleWrap = Fmt.el('div');
    titleWrap.appendChild(Fmt.el('h3', 'card__title', block.title || definition.title));
    var sub = state.data ? Blocks.subtitle(block.type, state.data) : '';
    if (sub) titleWrap.appendChild(Fmt.el('p', 'card__sub', sub));
    head.appendChild(titleWrap);
    head.appendChild(buildTools(block, definition));
    card.appendChild(head);

    var body = Fmt.el('div', 'card__body');
    card.appendChild(body);

    if (state.loading || !state.data) {
      renderSkeleton(body, block);
    } else {
      try {
        Blocks.render(block.type, body, {
          block: block,
          data: state.data,
          onSettings: updateSettings
        });
      } catch (error) {
        body.appendChild(Charts.emptyState('Не удалось построить блок'));
        if (global.console) console.error(error);
      }
    }
    return card;
  }

  function renderSkeleton(body, block) {
    if (block.type.indexOf('kpi.') === 0) {
      body.appendChild(Fmt.el('div', 'skeleton skeleton--value'));
      body.appendChild(Fmt.el('div', 'skeleton skeleton--line is-short'));
      return;
    }
    body.appendChild(Fmt.el('div', 'skeleton skeleton--block'));
  }

  function buildTools(block, definition) {
    var tools = Fmt.el('div', 'card__tools');

    var sizes = definition.sizes || SIZE_ORDER;
    var sizeButton = Fmt.el('button', 'tool tool--size', SIZE_LABEL[block.size] || 'M');
    sizeButton.type = 'button';
    sizeButton.title = 'Размер блока';
    sizeButton.addEventListener('click', function (event) {
      event.stopPropagation();
      var current = sizes.indexOf(block.size);
      block.size = sizes[(current + 1) % sizes.length];
      scheduleSave();
      renderBoard();
    });
    tools.appendChild(sizeButton);

    var hideButton = Fmt.el('button', 'tool');
    hideButton.type = 'button';
    hideButton.title = block.hidden ? 'Показать блок' : 'Скрыть блок';
    hideButton.innerHTML = block.hidden
      ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A9 9 0 0 1 21 12a15 15 0 0 1-3 3.6M6.6 6.6A15 15 0 0 0 3 12a9 9 0 0 0 12.5 4.4"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    hideButton.addEventListener('click', function (event) {
      event.stopPropagation();
      block.hidden = !block.hidden;
      scheduleSave();
      renderBoard();
      toast(block.hidden ? 'Блок скрыт' : 'Блок показан');
    });
    tools.appendChild(hideButton);

    var removeButton = Fmt.el('button', 'tool tool--danger');
    removeButton.type = 'button';
    removeButton.title = 'Удалить блок';
    removeButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    removeButton.addEventListener('click', function (event) {
      event.stopPropagation();
      var layout = activeLayout();
      layout.blocks = layout.blocks.filter(function (item) { return item.id !== block.id; });
      scheduleSave();
      renderBoard();
      toast('Блок удалён');
    });
    tools.appendChild(removeButton);

    return tools;
  }

  function updateSettings(block, patch) {
    Object.keys(patch).forEach(function (key) {
      block.settings = block.settings || {};
      block.settings[key] = patch[key];
    });
    scheduleSave();
    renderBoard();
  }

  /* --- Перетаскивание блоков -------------------------------------------------
     Работает и мышью, и пальцем: тянем настоящую карточку, соседей двигаем
     приёмом FLIP, поэтому перестановка выглядит плавной. */

  function setupDragging() {
    var dragging = null;
    var startX = 0;
    var startY = 0;
    var ghost = null;
    var offsetX = 0;
    var offsetY = 0;
    var started = false;

    dom.board.addEventListener('pointerdown', function (event) {
      if (!state.editing || event.button !== 0) return;
      if (event.target.closest('.tool') || event.target.closest('input')) return;
      var card = event.target.closest('.card');
      if (!card) return;

      dragging = card;
      started = false;
      startX = event.clientX;
      startY = event.clientY;
      var box = card.getBoundingClientRect();
      offsetX = event.clientX - box.left;
      offsetY = event.clientY - box.top;
    });

    global.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      if (!started) {
        if (Math.abs(event.clientX - startX) < 6 && Math.abs(event.clientY - startY) < 6) return;
        started = true;
        var box = dragging.getBoundingClientRect();
        ghost = dragging.cloneNode(true);
        ghost.style.position = 'fixed';
        ghost.style.left = box.left + 'px';
        ghost.style.top = box.top + 'px';
        ghost.style.width = box.width + 'px';
        ghost.style.height = box.height + 'px';
        ghost.style.margin = '0';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '40';
        ghost.style.transform = 'scale(1.02)';
        ghost.style.boxShadow = 'var(--shadow-lg)';
        ghost.style.transition = 'none';
        document.body.appendChild(ghost);
        dragging.classList.add('is-dragging');
        document.body.style.userSelect = 'none';
      }

      ghost.style.left = (event.clientX - offsetX) + 'px';
      ghost.style.top = (event.clientY - offsetY) + 'px';

      var target = document.elementFromPoint(event.clientX, event.clientY);
      var overCard = target && target.closest ? target.closest('.card') : null;
      if (!overCard || overCard === dragging || overCard.parentElement !== dom.board) return;

      var box = overCard.getBoundingClientRect();
      var before = event.clientX < box.left + box.width / 2;
      var reference = before ? overCard : overCard.nextSibling;
      if (reference === dragging) return;

      flip(function () {
        dom.board.insertBefore(dragging, reference);
      });
    });

    global.addEventListener('pointerup', function () {
      if (!dragging) return;
      if (started) {
        if (ghost) ghost.remove();
        ghost = null;
        dragging.classList.remove('is-dragging');
        document.body.style.userSelect = '';
        commitOrder();
      }
      dragging = null;
      started = false;
    });
  }

  /* FLIP: запоминаем положение до изменения DOM, после — анимируем разницу. */
  function flip(mutate) {
    var cards = Array.prototype.slice.call(dom.board.children);
    var before = cards.map(function (card) { return card.getBoundingClientRect(); });
    mutate();
    cards.forEach(function (card, index) {
      var after = card.getBoundingClientRect();
      var dx = before[index].left - after.left;
      var dy = before[index].top - after.top;
      if (!dx && !dy) return;
      card.style.transition = 'none';
      card.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      requestAnimationFrame(function () {
        card.style.transition = 'transform 0.42s var(--ease-spring)';
        card.style.transform = '';
      });
    });
  }

  function commitOrder() {
    var layout = activeLayout();
    if (!layout) return;
    var order = Array.prototype.slice.call(dom.board.children)
      .map(function (card) { return card.dataset.id; })
      .filter(Boolean);

    var byId = {};
    layout.blocks.forEach(function (block) { byId[block.id] = block; });

    var reordered = order.map(function (id) { return byId[id]; }).filter(Boolean);
    // Скрытые блоки вне режима настройки не отрисованы — дописываем их в конец.
    layout.blocks.forEach(function (block) {
      if (order.indexOf(block.id) === -1) reordered.push(block);
    });

    layout.blocks = reordered;
    scheduleSave();
  }

  /* --- Библиотека блоков ------------------------------------------------------ */

  function renderLibrary() {
    Fmt.clear(dom['library-body']);
    var layout = activeLayout();
    var counts = {};
    (layout ? layout.blocks : []).forEach(function (block) {
      counts[block.type] = (counts[block.type] || 0) + 1;
    });

    var groups = {};
    var order = [];
    state.catalog.forEach(function (definition) {
      if (!groups[definition.group]) {
        groups[definition.group] = [];
        order.push(definition.group);
      }
      groups[definition.group].push(definition);
    });

    order.forEach(function (groupName) {
      var group = Fmt.el('div', 'lib-group');
      group.appendChild(Fmt.el('h3', 'lib-group__title', groupName));
      groups[groupName].forEach(function (definition) {
        var shown = !!counts[definition.type];
        var item = Fmt.el('div', 'lib-item' + (shown ? ' is-on' : ''));

        var iconWrap = Fmt.el('div', 'lib-item__icon');
        iconWrap.innerHTML = Blocks.icon(definition.icon);
        item.appendChild(iconWrap);

        var text = Fmt.el('div');
        text.appendChild(Fmt.el('div', 'lib-item__name', definition.title));
        text.appendChild(Fmt.el('div', 'lib-item__desc', definition.description));
        item.appendChild(text);

        var toggle = Fmt.el('button', 'lib-item__toggle');
        toggle.type = 'button';
        toggle.textContent = shown
          ? (counts[definition.type] > 1 ? 'Убрать ×' + counts[definition.type] : 'Убрать')
          : 'Показать';
        toggle.addEventListener('click', function () {
          if (shown) removeBlockType(definition);
          else addBlockType(definition);
        });
        item.appendChild(toggle);

        group.appendChild(item);
      });
      dom['library-body'].appendChild(group);
    });
  }

  function addBlockType(definition) {
    Api.newBlock(definition.type, definition.defaultSize).then(function (block) {
      var current = activeLayout();
      current.blocks.push(block);
      scheduleSave();
      renderBoard();
      renderLibrary();
      toast('Блок «' + definition.title + '» показан');
      var card = dom.board.querySelector('[data-id="' + block.id + '"]');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).catch(function (error) { toast(error.message); });
  }

  function removeBlockType(definition) {
    var current = activeLayout();
    if (!current) return;
    current.blocks = current.blocks.filter(function (block) {
      return block.type !== definition.type;
    });
    scheduleSave();
    renderBoard();
    renderLibrary();
    toast('Блок «' + definition.title + '» убран');
  }

  /* --- Режим настройки -------------------------------------------------------- */

  function setEditing(value) {
    state.editing = value;
    dom.editbar.hidden = !value;
    dom['btn-edit'].hidden = value;
    renderTabs();
    renderBoard();
  }

  /* --- Загрузка данных --------------------------------------------------------- */

  function setStatus(kind, text) {
    dom['status-dot'].className = 'meta__dot ' + kind;
    dom['status-text'].textContent = text;
  }

  /* Пояснения под шапкой: чего в периоде не хватает и откуда взяты цифры.
     Это не сбой — тревогу в строке состояния такие заметки не поднимают. */
  function renderCoverageNote(data) {
    var lines = [];

    var short = data.marketplaces.filter(function (report) {
      return report.connected && report.dataFrom && report.dataFrom > data.period.from;
    });
    if (short.length) {
      var parts = short.map(function (report) {
        return report.title + ' — с ' + Fmt.dayLong(report.dataFrom);
      });
      lines.push('<strong>Период показан не полностью.</strong> ' +
        'Данные есть не за весь выбранный отрезок: ' + parts.join(', ') + '.');
    }

    data.marketplaces.forEach(function (report) {
      (report.notes || []).forEach(function (note) {
        if (lines.indexOf(note) === -1) lines.push(note);
      });
    });

    if (!lines.length) {
      dom['coverage-note'].hidden = true;
      return;
    }

    dom['coverage-note'].innerHTML = '<span class="notice-strip__lines">' +
      lines.map(function (line) { return '<span>' + line + '</span>'; }).join('') +
      '</span>';
    dom['coverage-note'].hidden = false;
  }

  function loadSyncStatus() {
    return Api.syncStatus().then(function (payload) {
      state.sync = payload;
    }).catch(function () { /* хранилище может быть ещё пустым */ });
  }

  function loadData(force) {
    state.loading = true;
    renderBoard();

    var params = { preset: state.preset, refresh: force ? 'true' : '' };
    if (state.preset === 'custom' && state.from && state.to) {
      params.from = state.from;
      params.to = state.to;
    }
    if (state.selected) params.marketplaces = Array.from(state.selected).join(',');
    if (state.store) params.stores = state.store;
    if (state.skipToday) params.skipToday = 'true';

    return Api.overview(params).then(function (data) {
      state.data = data;
      state.loading = false;
      renderBoard();

      var demo = data.marketplaces.filter(function (report) { return report.demo; });
      var failed = data.marketplaces.filter(function (report) { return report.error; });
      var live = data.marketplaces.filter(function (report) { return report.connected; });
      var partial = data.marketplaces.filter(function (report) {
        return report.connected && (report.warnings || []).length;
      });

      if (demo.length) {
        setStatus('is-demo', 'демо-режим · цифры вымышленные');
      } else if (!live.length) {
        setStatus('is-demo', 'ключи не заведены · данных нет');
      } else if (failed.length) {
        setStatus('is-error', 'нет данных: ' +
          failed.map(function (report) { return report.title; }).join(', '));
      } else if (partial.length) {
        setStatus('is-demo', 'часть данных не пришла · ' + Fmt.timeLabel(data.generatedAt));
      } else {
        setStatus('is-live', 'данные обновлены в ' + Fmt.timeLabel(data.generatedAt));
      }

      renderCoverageNote(data);
      // Период и выбранный кабинет показывает верхняя полоса оболочки:
      // это контекст, а не часть доски.
      var scope = state.store ? storeTitle(state.store) : '';
      global.Topbar.set({
        note: Fmt.periodLabel(data.period) + (scope ? ' · ' + scope : ''),
        updated: data.generatedAt ? new Date(data.generatedAt) : new Date()
      });
      var syncedAt = state.sync && state.sync.syncedAt;
      dom['footer-note'].textContent = 'Период: ' + Fmt.periodLabel(data.period) +
        ' · подключено площадок: ' + live.length + ' из ' + data.marketplaces.length +
        (syncedAt ? ' · выгрузка с площадок в ' + Fmt.timeLabel(syncedAt) : '') +
        ' · страница обновлена ' + Fmt.timeLabel(data.generatedAt);
      return data;
    }).catch(function (error) {
      state.loading = false;
      if (error.status === 401) {
        global.Shell.showGate();
        return;
      }
      setStatus('is-error', 'ошибка загрузки');
      toast(error.message);
      renderBoard();
    });
  }

  function loadLayouts() {
    return Api.layouts().then(function (payload) {
      state.layouts = payload.layouts;
      var stored = readStorage('dashboard.layout', '');
      var candidates = state.layouts.map(function (item) { return item.name; });
      state.active = candidates.indexOf(stored) !== -1 ? stored
        : (candidates.indexOf(payload.active) !== -1 ? payload.active : candidates[0]);
      renderTabs();
      renderBoard();
    });
  }

  /* --- Экран входа -------------------------------------------------------------- */

  /* --- Инициализация ------------------------------------------------------------ */

  function bindEvents() {
    dom['btn-edit'].addEventListener('click', function () { setEditing(true); });
    dom['btn-done'].addEventListener('click', function () {
      setEditing(false);
      toast('Настройки сохранены');
    });
    dom['btn-library'].addEventListener('click', function () {
      renderLibrary();
      openSheet('library');
    });
    dom['btn-new-tab'].addEventListener('click', createTab);
    dom['btn-reset'].addEventListener('click', function () {
      var layout = activeLayout();
      if (!layout || !confirm('Вернуть стандартный набор блоков на вкладке «' + layout.name + '»?')) return;
      Api.resetLayout(layout.name).then(function () {
        return loadLayouts();
      }).then(function () { toast('Раскладка сброшена'); });
    });

    document.addEventListener('click', function (event) {
      var closer = event.target.closest('[data-close]');
      if (closer) closeSheet(closer.getAttribute('data-close'));
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        // Сначала закрываем открытую панель и только потом выходим из настройки,
        // иначе один Escape отменял бы сразу и то и другое.
        var openPanel = ['library', 'range']
          .filter(function (id) { return dom[id] && !dom[id].hidden; })[0];
        if (openPanel) {
          closeSheet(openPanel);
        } else if (state.editing) {
          setEditing(false);
        }
      }
      if (event.key === 'e' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setEditing(!state.editing);
      }
    });

    dom['range-form'].addEventListener('submit', function (event) {
      event.preventDefault();
      state.from = dom['range-from'].value;
      state.to = dom['range-to'].value;
      if (!state.from || !state.to) return;
      state.preset = 'custom';
      writeStorage('dashboard.preset', 'custom');
      writeStorage('dashboard.range', state.from + '|' + state.to);
      closeSheet('range');
      renderPeriods();
      loadData();
    });
  }

  function restoreFilters() {
    state.preset = readStorage('dashboard.preset', '30d');
    var range = readStorage('dashboard.range', '');
    if (state.preset === 'custom' && range.indexOf('|') !== -1) {
      var parts = range.split('|');
      state.from = parts[0];
      state.to = parts[1];
    } else if (state.preset === 'custom') {
      state.preset = '30d';
    }
    // Раньше хранился список показанных площадок — переносим его в новый вид.
    var legacy = readStorage('dashboard.marketplaces', '');
    if (legacy && !readStorage('dashboard.hidden', '')) {
      var shown = new Set(legacy.split(','));
      var all = ['wildberries', 'ozon', 'yandex', 'ali'];
      writeStorage('dashboard.hidden', all.filter(function (code) {
        return !shown.has(code);
      }).join(','));
      writeStorage('dashboard.marketplaces', '');
    }
    state.selected = null;
    state.store = readStorage('dashboard.store', '');
    state.skipToday = readStorage('dashboard.skipToday', '') === '1';
  }

  function start() {
    renderPeriods();
    renderSkipToday();

    Promise.all([Api.blocks(), Api.marketplaces()]).then(function (results) {
      state.catalog = results[0].catalog;
      state.catalogByType = {};
      state.catalog.forEach(function (definition) {
        state.catalogByType[definition.type] = definition;
      });
      renderMarketplaceChips(results[1].marketplaces);
      renderStoreChips(results[1].stores);
      return loadSyncStatus();
    }).then(function () {
      return loadLayouts();
    }).then(function () {
      return loadData();
    }).then(function () {
    }).catch(function (error) {
      if (error.status === 401) { global.Shell.showGate(); return; }
      toast(error.message);
    });

    // Число обращений нужно навигации, а не доске: значок стоит у пункта
    // «Покупатели». Спрашиваем один раз, экран при этом не открывается.
    global.Inbox.prefetch(function (total, urgent) {
      global.Sidebar.setCount('customers', total, urgent);
      global.Sidebar.render(global.Router.read());
    });

    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {
      if (!state.editing && !document.hidden) loadData();
    }, AUTO_REFRESH_MS);
  }

  /* Разметка доски. Раньше она лежала в index.html; теперь раздел приносит
     её с собой — оболочка о доске ничего не знает и знать не должна. */
  var РАЗМЕТКА = [
    '<div class="filters">',
    '  <div class="segmented" id="periods" role="tablist" aria-label="Период"></div>',
    '  <div class="chips" id="skip-today" aria-label="Учитывать сегодня" hidden></div>',
    '  <div class="chips" id="marketplaces" aria-label="Площадки"></div>',
    '  <div class="chips chips--stores" id="stores" aria-label="Магазины" hidden></div>',
    '  <div class="filters__meta">',
    '    <span class="meta__dot" id="status-dot" aria-hidden="true"></span>',
    '    <span id="status-text">загрузка…</span>',
    '  </div>',
    '  <nav class="tabs" id="tabs" aria-label="Раскладки"></nav>',
    '  <button class="btn btn--ghost filters__edit" id="btn-edit" type="button">',
    '    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16v4z"/></svg>',
    '    <span>Настроить</span>',
    '  </button>',
    '</div>',
    '<div class="editbar" id="editbar" hidden>',
    '  <div class="editbar__inner">',
    '    <span class="editbar__hint"><strong>Режим настройки.</strong> ',
    '      Перетаскивайте блоки, меняйте размер, скрывайте лишнее.</span>',
    '    <div class="editbar__actions">',
    '      <button class="btn btn--ghost" id="btn-library" type="button">',
    '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    '        <span>Показатели</span></button>',
    '      <button class="btn btn--ghost" id="btn-new-tab" type="button">Новая вкладка</button>',
    '      <button class="btn btn--ghost" id="btn-reset" type="button">Сбросить</button>',
    '      <button class="btn btn--primary" id="btn-done" type="button">Готово</button>',
    '    </div>',
    '  </div>',
    '</div>',
    '<p class="notice-strip" id="coverage-note" hidden></p>',
    '<main class="board" id="board" aria-live="polite"></main>',
    '<footer class="footer"><span id="footer-note"></span></footer>',
    '<div class="sheet" id="library" hidden>',
    '  <div class="sheet__backdrop" data-close="library"></div>',
    '  <aside class="sheet__panel" role="dialog" aria-label="Библиотека блоков">',
    '    <header class="sheet__head"><h2>Показатели панели</h2>',
    '      <button class="icon-btn" type="button" data-close="library" aria-label="Закрыть">',
    '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    '      </button></header>',
    '    <p class="sheet__hint">Нажмите «Показать», чтобы вывести показатель на панель, ',
    '      и «Убрать» — чтобы скрыть. Порядок и размер настраиваются прямо на карточках.</p>',
    '    <div class="sheet__body" id="library-body"></div>',
    '  </aside>',
    '</div>',
    '<div class="sheet sheet--center" id="range" hidden>',
    '  <div class="sheet__backdrop" data-close="range"></div>',
    '  <form class="dialog" id="range-form" role="dialog" aria-label="Произвольный период">',
    '    <h2 class="dialog__title">Свой период</h2>',
    '    <label class="field"><span>С</span><input type="date" id="range-from" required /></label>',
    '    <label class="field"><span>По</span><input type="date" id="range-to" required /></label>',
    '    <div class="dialog__actions">',
    '      <button class="btn btn--ghost" type="button" data-close="range">Отмена</button>',
    '      <button class="btn btn--primary" type="submit">Показать</button>',
    '    </div>',
    '  </form>',
    '</div>'
  ].join('');

  /* Выгрузка с площадок. Раньше висела на отдельной кнопке в шапке; теперь
     её зовёт строка «обновлено N минут назад» в полосе контекста. */
  function sync() {
    if (state.syncing) return Promise.resolve();
    state.syncing = true;
    toast('Скачиваю свежие данные с площадок — это займёт до минуты');

    return Api.sync().then(function (payload) {
      state.sync = payload.status || state.sync;
      return loadData(true);
    }).then(function () {
      toast('Данные обновлены');
    }).catch(function (error) {
      toast('Не удалось обновить: ' + error.message);
    }).then(function () {
      state.syncing = false;
    });
  }

  function mount(node) {
    node.className = 'section section--dashboard';
    node.innerHTML = РАЗМЕТКА;

    global.Topbar.set({
      title: 'Главная',
      note: '',
      // У доски свой, более богатый выбор площадок и магазинов — сразу с
      // периодом. Дублировать его в полосе контекста незачем.
      scoped: false,
      onRefresh: sync
    });

    cacheDom();
    restoreFilters();
    bindEvents();
    setupDragging();
    start();
  }

  function unmount() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  }

  global.Shell.register('dashboard', {
    mount: mount,
    unmount: unmount,
    refresh: function () { return loadData(true); }
  });
})(window);
