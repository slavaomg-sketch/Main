/* Сборка панели: состояние, загрузка данных, режим настройки, перетаскивание. */
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
    ['gate', 'gate-form', 'gate-password', 'gate-error', 'app', 'tabs', 'periods',
     'marketplaces', 'board', 'editbar', 'btn-edit', 'btn-done', 'btn-library',
     'btn-reset', 'btn-refresh', 'btn-theme', 'btn-new-tab', 'library', 'library-body',
     'range', 'range-form', 'range-from', 'range-to', 'status-dot', 'status-text',
     'toasts', 'footer-note', 'brand-sub', 'topbar',
     'btn-keys', 'keys', 'keys-body', 'coverage-note'].forEach(function (id) {
      dom[id] = $(id);
    });
  }

  /* --- Мелочи интерфейса ---------------------------------------------------- */

  function toast(message) {
    var node = Fmt.el('div', 'toast', message);
    dom.toasts.appendChild(node);
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 320);
    }, 2400);
  }

  function openSheet(id) {
    dom[id].hidden = false;
  }

  // Страница ключей пользуется теми же уведомлениями, что и панель.
  global.Toast = toast;

  function closeSheet(id) {
    dom[id].hidden = true;
  }

  function readStorage(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* приватный режим */ }
  }

  /* --- Тема ----------------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    writeStorage('dashboard.theme', theme);
  }

  function cycleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'auto';
    var next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
    applyTheme(next);
    toast(next === 'auto' ? 'Тема — как в системе' : next === 'light' ? 'Светлая тема' : 'Тёмная тема');
  }

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
        loadData();
      });
      dom.periods.appendChild(button);
    });
  }

  function renderMarketplaceChips(list) {
    Fmt.clear(dom.marketplaces);
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
        writeStorage('dashboard.marketplaces', state.selected ? Array.from(codes).join(',') : '');
        renderMarketplaceChips(list);
        loadData();
      });
      dom.marketplaces.appendChild(chip);
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
        var item = Fmt.el('button', 'lib-item');
        item.type = 'button';

        var iconWrap = Fmt.el('div', 'lib-item__icon');
        iconWrap.innerHTML = Blocks.icon(definition.icon);
        item.appendChild(iconWrap);

        var text = Fmt.el('div');
        text.appendChild(Fmt.el('div', 'lib-item__name', definition.title));
        text.appendChild(Fmt.el('div', 'lib-item__desc', definition.description));
        item.appendChild(text);

        if (counts[definition.type]) {
          item.appendChild(Fmt.el('span', 'lib-item__count', '×' + counts[definition.type]));
        }

        item.addEventListener('click', function () {
          Api.newBlock(definition.type, definition.defaultSize).then(function (block) {
            var current = activeLayout();
            current.blocks.push(block);
            scheduleSave();
            renderBoard();
            renderLibrary();
            toast('Блок «' + definition.title + '» добавлен');
            var card = dom.board.querySelector('[data-id="' + block.id + '"]');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }).catch(function (error) { toast(error.message); });
        });

        group.appendChild(item);
      });
      dom['library-body'].appendChild(group);
    });
  }

  /* --- Режим настройки -------------------------------------------------------- */

  function setEditing(value) {
    state.editing = value;
    dom.editbar.hidden = !value;
    dom['btn-edit'].hidden = value;
    document.documentElement.style.setProperty('--topbar-height',
      dom.topbar.offsetHeight + 'px');
    renderTabs();
    renderBoard();
  }

  /* --- Загрузка данных --------------------------------------------------------- */

  function setStatus(kind, text) {
    dom['status-dot'].className = 'meta__dot ' + kind;
    dom['status-text'].textContent = text;
  }

  /* Площадки хранят статистику ограниченный срок. Если выбранный период
     начинается раньше, чем есть данные, об этом надо сказать заметно. */
  function renderCoverageNote(data) {
    var short = data.marketplaces.filter(function (report) {
      return report.connected && report.dataFrom && report.dataFrom > data.period.from;
    });

    if (!short.length) {
      dom['coverage-note'].hidden = true;
      return;
    }

    var parts = short.map(function (report) {
      return report.title + ' — с ' + Fmt.dayLong(report.dataFrom);
    });

    dom['coverage-note'].innerHTML = '<span><strong>Период показан не полностью.</strong> ' +
      'Данные есть не за весь выбранный отрезок: ' + parts.join(', ') +
      '. Площадка не хранит статистику глубже, поэтому цифры за более ранние дни отсутствуют.</span>';
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
      dom['brand-sub'].textContent = Fmt.periodLabel(data.period);
      var syncedAt = state.sync && state.sync.syncedAt;
      dom['footer-note'].textContent = 'Период: ' + Fmt.periodLabel(data.period) +
        ' · подключено площадок: ' + live.length + ' из ' + data.marketplaces.length +
        (syncedAt ? ' · выгрузка с площадок в ' + Fmt.timeLabel(syncedAt) : '') +
        ' · страница обновлена ' + Fmt.timeLabel(data.generatedAt);
      return data;
    }).catch(function (error) {
      state.loading = false;
      if (error.status === 401) {
        showGate();
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

  function showGate() {
    dom.gate.hidden = false;
    dom.app.hidden = true;
    dom['gate-password'].focus();
  }

  function hideGate() {
    dom.gate.hidden = true;
    dom.app.hidden = false;
  }

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
    dom['btn-theme'].addEventListener('click', cycleTheme);
    dom['btn-keys'].addEventListener('click', openKeys);

    dom['btn-refresh'].addEventListener('click', function () {
      if (state.syncing) return;
      state.syncing = true;
      dom['btn-refresh'].disabled = true;
      dom['btn-refresh'].classList.add('is-spinning');
      toast('Скачиваю свежие данные с площадок — это займёт до минуты');

      // Выгрузка идёт на сервере; страница потом читает уже готовое.
      Api.sync().then(function (payload) {
        state.sync = payload.status || state.sync;
        return loadData(true);
      }).then(function () {
        toast('Данные обновлены');
      }).catch(function (error) {
        toast('Не удалось обновить: ' + error.message);
      }).then(function () {
        state.syncing = false;
        dom['btn-refresh'].disabled = false;
        dom['btn-refresh'].classList.remove('is-spinning');
      });
    });

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
        var openPanel = ['library', 'range', 'keys'].filter(function (id) { return !dom[id].hidden; })[0];
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

    dom['gate-form'].addEventListener('submit', function (event) {
      event.preventDefault();
      dom['gate-error'].hidden = true;
      Api.login(dom['gate-password'].value).then(function () {
        hideGate();
        start();
      }).catch(function (error) {
        dom['gate-error'].textContent = error.message;
        dom['gate-error'].hidden = false;
      });
    });

    global.addEventListener('resize', function () {
      document.documentElement.style.setProperty('--topbar-height', dom.topbar.offsetHeight + 'px');
    });
  }

  function openKeys() {
    openSheet('keys');
    global.Keys.mount(dom['keys-body'], {
      onSaved: function () {
        // Ключи изменились — площадки могли перестать быть демонстрационными.
        Api.marketplaces()
          .then(function (payload) { renderMarketplaceChips(payload.marketplaces); })
          .then(function () { return loadData(true); });
      }
    });
  }

  function restoreFilters() {
    applyTheme(readStorage('dashboard.theme', 'auto'));
    state.preset = readStorage('dashboard.preset', '30d');
    var range = readStorage('dashboard.range', '');
    if (state.preset === 'custom' && range.indexOf('|') !== -1) {
      var parts = range.split('|');
      state.from = parts[0];
      state.to = parts[1];
    } else if (state.preset === 'custom') {
      state.preset = '30d';
    }
    var codes = readStorage('dashboard.marketplaces', '');
    state.selected = codes ? new Set(codes.split(',')) : null;
  }

  function start() {
    renderPeriods();

    Promise.all([Api.blocks(), Api.marketplaces()]).then(function (results) {
      state.catalog = results[0].catalog;
      state.catalogByType = {};
      state.catalog.forEach(function (definition) {
        state.catalogByType[definition.type] = definition;
      });
      renderMarketplaceChips(results[1].marketplaces);
      return loadSyncStatus();
    }).then(function () {
      return loadLayouts();
    }).then(function () {
      return loadData();
    }).then(function () {
      document.documentElement.style.setProperty('--topbar-height', dom.topbar.offsetHeight + 'px');
    }).catch(function (error) {
      if (error.status === 401) { showGate(); return; }
      toast(error.message);
    });

    // Ссылка вида /#keys открывает страницу ключей сразу.
    if (global.location.hash === '#keys') openKeys();

    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {
      if (!state.editing && !document.hidden) loadData();
    }, AUTO_REFRESH_MS);
  }

  function init() {
    cacheDom();
    restoreFilters();
    bindEvents();
    setupDragging();

    Api.session().then(function (session) {
      state.session = session;
      if (session.authEnabled && !session.authenticated) {
        showGate();
        return;
      }
      hideGate();
      start();
    }).catch(function () {
      hideGate();
      start();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
