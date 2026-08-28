/* Страница «Ключи»: магазины по площадкам, ввод ключей, проверка связи.

   У одной площадки может быть несколько магазинов — каждый со своим
   названием и своими ключами. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;

  var state = {
    marketplaces: [],
    authEnabled: false,
    secretIsDefault: false,
    testing: {},
    results: {},
    open: {}
  };

  var host = null;
  var onSaved = function () {};

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  function warnings() {
    var list = [];
    if (!state.authEnabled) {
      list.push('Панель открыта без пароля. Любой, кто знает адрес, откроет эту страницу ' +
                'и сможет заменить ключи. Задайте DASHBOARD_PASSWORD в .env и перезапустите панель.');
    }
    if (state.secretIsDefault) {
      list.push('DASHBOARD_SECRET не изменён. Ключи шифруются им же — поставьте свой ' +
                'случайный секрет, иначе шифрование почти ничего не даёт.');
    }
    return list;
  }

  function refresh(payload, message) {
    state.marketplaces = payload.marketplaces;
    if (payload.authEnabled !== undefined) state.authEnabled = payload.authEnabled;
    if (payload.secretIsDefault !== undefined) state.secretIsDefault = payload.secretIsDefault;
    render();
    if (message) toast(message);
    onSaved();
  }

  function fail(error) {
    toast(error.message);
  }

  // --- поля ключей ------------------------------------------------------------

  function fieldRow(store, field, values) {
    var row = Fmt.el('div', 'keyfield');
    var inputId = 'k_' + store.id + '_' + field.key;

    var label = Fmt.el('label', 'keyfield__label');
    label.setAttribute('for', inputId);
    label.appendChild(Fmt.el('span', 'keyfield__name', field.label));
    if (!field.required) label.appendChild(Fmt.el('span', 'keyfield__optional', 'необязательно'));
    row.appendChild(label);

    var control = Fmt.el('div', 'keyfield__control');
    var input = document.createElement('input');
    input.id = inputId;
    input.type = 'password';
    input.className = 'keyfield__input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.disabled = !store.editable;
    input.placeholder = field.filled
      ? field.tail + ' — сохранён, введите новый чтобы заменить'
      : (store.editable ? 'вставьте ключ' : 'задан в файле .env');
    input.addEventListener('input', function () { values[field.key] = input.value; });
    control.appendChild(input);

    if (store.editable) {
      var reveal = Fmt.el('button', 'keyfield__eye');
      reveal.type = 'button';
      reveal.title = 'Показать введённое';
      reveal.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
      reveal.addEventListener('click', function () {
        input.type = input.type === 'password' ? 'text' : 'password';
      });
      control.appendChild(reveal);
    }
    row.appendChild(control);

    var foot = Fmt.el('div', 'keyfield__foot');
    if (field.hint) foot.appendChild(Fmt.el('span', 'keyfield__hint', field.hint));
    if (field.filled && store.editable) {
      var erase = Fmt.el('button', 'keyfield__erase', 'стереть');
      erase.type = 'button';
      erase.addEventListener('click', function () {
        var patch = {};
        patch[field.key] = '';
        Api.updateConnection(store.id, { values: patch })
          .then(function (payload) { refresh(payload, 'Ключ стёрт'); })
          .catch(fail);
      });
      foot.appendChild(erase);
    }
    row.appendChild(foot);
    return row;
  }

  // --- результат проверки -----------------------------------------------------

  function resultView(store) {
    var result = state.results[store.id];
    if (!result) return null;

    var box = Fmt.el('div', 'probe ' + (result.ok ? 'probe--ok' : 'probe--bad'));

    if (result.reason) {
      box.appendChild(Fmt.el('div', 'probe__head', result.reason));
      return box;
    }

    box.appendChild(Fmt.el('div', 'probe__head',
      result.ok ? 'Связь есть, данные приходят' : 'Площадка ответила не так, как ждали'));

    (result.probes || []).forEach(function (probe) {
      var line = Fmt.el('div', 'probe__row');
      line.appendChild(Fmt.el('span', 'badge badge--' + (probe.ok ? 'ok' : 'critical'),
        probe.ok ? String(probe.status) : ('ошибка ' + (probe.status || ''))));
      line.appendChild(Fmt.el('span', 'probe__label', probe.label));
      if (probe.rows !== null && probe.rows !== undefined) {
        line.appendChild(Fmt.el('span', 'probe__rows', 'строк: ' + Fmt.number(probe.rows)));
      }
      box.appendChild(line);

      if (probe.error) box.appendChild(Fmt.el('div', 'probe__error', probe.error));

      if (probe.fields && probe.fields.length) {
        var details = document.createElement('details');
        details.className = 'probe__fields';
        var summary = document.createElement('summary');
        summary.textContent = 'поля ответа (' + probe.fields.length + ')';
        details.appendChild(summary);
        var grid = Fmt.el('div', 'probe__grid');
        probe.fields.forEach(function (item) {
          grid.appendChild(Fmt.el('span', 'probe__key', item.name));
          grid.appendChild(Fmt.el('span', 'probe__shape', item.shape));
        });
        details.appendChild(grid);
        box.appendChild(details);
      }
    });

    if (result.summary) {
      var text = result.summary.error
        ? 'Разбор ответа: ' + result.summary.error
        : 'За неделю: заказов ' + Fmt.number(result.summary.orders) +
          ', товаров в отчёте ' + Fmt.number(result.summary.products) +
          ', выручка ' + (result.summary.hasRevenue ? 'посчитана' : 'нулевая') +
          ', остатки ' + (result.summary.hasStock ? 'есть' : 'не пришли');
      box.appendChild(Fmt.el('div', 'probe__summary', text));
    }
    return box;
  }

  // --- карточка магазина ------------------------------------------------------

  function storeCard(marketplace, store) {
    var values = {};
    var card = Fmt.el('div', 'store' + (store.enabled ? '' : ' store--off'));

    var head = Fmt.el('div', 'store__head');

    var title = document.createElement('input');
    title.className = 'store__title';
    title.value = store.title;
    title.disabled = !store.editable;
    title.setAttribute('aria-label', 'Название магазина');
    title.addEventListener('change', function () {
      if (title.value.trim() === store.title) return;
      Api.updateConnection(store.id, { title: title.value.trim() })
        .then(function (payload) { refresh(payload, 'Магазин переименован'); })
        .catch(fail);
    });
    head.appendChild(title);

    if (store.configured) {
      head.appendChild(Fmt.el('span', 'badge badge--ok', 'ключи на месте'));
    } else if (store.fields.some(function (f) { return f.filled; })) {
      head.appendChild(Fmt.el('span', 'badge badge--warning', 'заполнено не всё'));
    } else {
      head.appendChild(Fmt.el('span', 'badge badge--muted', 'пусто'));
    }
    if (!store.editable) head.appendChild(Fmt.el('span', 'badge badge--muted', 'из .env'));
    if (!store.enabled) head.appendChild(Fmt.el('span', 'badge badge--muted', 'выключен'));

    card.appendChild(head);

    store.fields.forEach(function (field) {
      card.appendChild(fieldRow(store, field, values));
    });

    var actions = Fmt.el('div', 'store__actions');

    if (store.editable) {
      var saveButton = Fmt.el('button', 'btn btn--primary', 'Сохранить');
      saveButton.type = 'button';
      saveButton.addEventListener('click', function () {
        var filled = {};
        var touched = false;
        Object.keys(values).forEach(function (key) {
          if (values[key] && values[key].trim()) {
            filled[key] = values[key].trim();
            touched = true;
          }
        });
        if (!touched) {
          toast('Введите хотя бы одно поле');
          return;
        }
        Api.updateConnection(store.id, { values: filled })
          .then(function (payload) { refresh(payload, 'Ключи сохранены'); })
          .catch(fail);
      });
      actions.appendChild(saveButton);
    }

    var testButton = Fmt.el('button', 'btn btn--ghost',
      state.testing[store.id] ? 'Проверяем…' : 'Проверить связь');
    testButton.type = 'button';
    testButton.disabled = Boolean(state.testing[store.id]);
    testButton.addEventListener('click', function () {
      state.testing[store.id] = true;
      render();
      Api.testConnection(store.id).then(function (result) {
        state.results[store.id] = result;
      }).catch(function (error) {
        state.results[store.id] = { ok: false, reason: error.message, probes: [] };
      }).then(function () {
        state.testing[store.id] = false;
        render();
      });
    });
    actions.appendChild(testButton);

    if (store.editable) {
      var toggle = Fmt.el('button', 'btn btn--ghost', store.enabled ? 'Выключить' : 'Включить');
      toggle.type = 'button';
      toggle.title = 'Выключенный магазин не опрашивается и не попадает в отчёты';
      toggle.addEventListener('click', function () {
        Api.updateConnection(store.id, { enabled: !store.enabled })
          .then(function (payload) {
            refresh(payload, store.enabled ? 'Магазин выключен' : 'Магазин включён');
          })
          .catch(fail);
      });
      actions.appendChild(toggle);

      var removeButton = Fmt.el('button', 'btn btn--danger', 'Удалить');
      removeButton.type = 'button';
      removeButton.addEventListener('click', function () {
        if (!confirm('Удалить магазин «' + store.title + '» вместе с ключами?')) return;
        Api.deleteConnection(store.id)
          .then(function (payload) {
            delete state.results[store.id];
            refresh(payload, 'Магазин удалён');
          })
          .catch(fail);
      });
      actions.appendChild(removeButton);
    }

    card.appendChild(actions);

    var result = resultView(store);
    if (result) card.appendChild(result);

    return card;
  }

  // --- группа площадки ---------------------------------------------------------

  function marketplaceGroup(marketplace) {
    var group = Fmt.el('section', 'keycard');

    var head = Fmt.el('div', 'keycard__head');
    var dot = Fmt.el('span', 'keycard__dot');
    dot.style.background = Fmt.colorOf(marketplace.code);
    head.appendChild(dot);
    head.appendChild(Fmt.el('h3', 'keycard__title', marketplace.title));

    var ready = marketplace.connections.filter(function (store) {
      return store.configured && store.enabled;
    }).length;
    head.appendChild(Fmt.el('span', 'badge badge--' + (ready ? 'ok' : 'muted'),
      ready ? (ready + ' ' + Fmt.plural(ready, ['магазин', 'магазина', 'магазинов']))
            : 'демо-данные'));

    if (marketplace.docs) {
      var link = document.createElement('a');
      link.className = 'keycard__docs';
      link.href = marketplace.docs;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'где взять ключ';
      head.appendChild(link);
    }
    group.appendChild(head);

    marketplace.connections.forEach(function (store) {
      group.appendChild(storeCard(marketplace, store));
    });

    var add = Fmt.el('button', 'store-add');
    add.type = 'button';
    add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
    add.appendChild(Fmt.el('span', null,
      marketplace.connections.length ? 'Ещё один магазин' : 'Добавить магазин'));
    add.addEventListener('click', function () {
      var suggestion = marketplace.title + ' — магазин ' + (marketplace.connections.length + 1);
      var name = prompt('Название магазина', suggestion);
      if (name === null) return;
      Api.addConnection(marketplace.code, name.trim() || suggestion)
        .then(function (payload) { refresh(payload, 'Магазин добавлен — введите ключи'); })
        .catch(fail);
    });
    group.appendChild(add);

    return group;
  }

  function render() {
    if (!host) return;
    Fmt.clear(host);

    host.appendChild(Fmt.el('p', 'keys__intro',
      'У площадки может быть несколько магазинов — добавьте каждый отдельно, ' +
      'и в отчётах они будут видны и по отдельности, и в сумме. Ключи хранятся ' +
      'на вашем сервере в зашифрованном виде и обратно в браузер не передаются: ' +
      'приходят только последние четыре символа.'));

    warnings().forEach(function (text) {
      host.appendChild(Fmt.el('div', 'notice notice--warning', text));
    });

    state.marketplaces.forEach(function (marketplace) {
      host.appendChild(marketplaceGroup(marketplace));
    });
  }

  function load() {
    return Api.connections().then(function (payload) {
      state.marketplaces = payload.marketplaces;
      state.authEnabled = payload.authEnabled;
      state.secretIsDefault = payload.secretIsDefault;
      render();
    });
  }

  global.Keys = {
    mount: function (node, options) {
      host = node;
      onSaved = (options && options.onSaved) || function () {};
      return load();
    },
    reload: load
  };
})(window);
