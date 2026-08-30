/* Работа с обращением: карточка, ответ, черновик помощника, конвейер.

   Общая часть для двух экранов — «Входящих» и «Задач». Второй реализации
   ручного ответа, двойного подтверждения и массовой отправки быть не должно:
   разъедутся правила безопасности, а они здесь главное.

   Навигацию этот модуль не знает и знать не должен. Экран сам решает, какие
   обращения показать, и передаёт их сюда списком.

   Состояние (набранное, отправленное, подсказки помощника) — общее на оба
   экрана: одно и то же обращение не должно вести себя по-разному в
   зависимости от того, откуда на него смотрят. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Api = global.Api;

  var state = {
    drafts: {},          // набранные, но не отправленные ответы
    sending: {},         // обращения, по которым ответ уже улетел
    confirming: {},      // нажали «Отправить» — ждём подтверждения
    answered: {},        // на что уже ответили в этом сеансе
    drafting: {},        // помощник сейчас пишет черновик
    hints: {},           // предупреждения помощника «тут нужен человек»
    batch: null,         // идущий или разобранный конвейер
    sendingBatch: false,
    confirmBatch: false
  };

  // Сколько обращений уходит помощнику в один заход. Столько же держит сервер.
  var BATCH = 30;

  function toast(message) {
    if (global.Toast) global.Toast(message);
  }

  /* Обращение опознаётся площадкой, кабинетом, главой и номером: номер
     уникален только внутри своей главы своего кабинета. */
  function key(item) {
    return [item.marketplace || '', item.accountId, item.kind, item.id].join(':');
  }

  function visible(items) {
    return (items || []).filter(function (item) { return !state.answered[key(item)]; });
  }

  function answeredIn(items) {
    return (items || []).filter(function (item) { return !!state.answered[key(item)]; }).length;
  }

  /* --- мелочи --------------------------------------------------------------- */

  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function moment(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';

    var time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return 'сегодня, ' + time;

    var yesterday = new Date(now.getTime() - 86400000);
    if (date.toDateString() === yesterday.toDateString()) return 'вчера, ' + time;

    var label = date.getDate() + ' ' + MONTHS[date.getMonth()];
    if (date.getFullYear() !== now.getFullYear()) label += ' ' + date.getFullYear();
    return label + ', ' + time;
  }

  function stars(rating) {
    var node = Fmt.el('span', 'inbox__stars');
    node.title = 'Оценка ' + rating + ' из 5';
    for (var i = 1; i <= 5; i += 1) {
      node.appendChild(Fmt.el('span', i <= rating ? 'inbox__star is-on' : 'inbox__star', '★'));
    }
    return node;
  }

  /* --- черновик помощника --------------------------------------------------- */

  function askDraft(item, redraw) {
    var id = key(item);
    state.drafting[id] = true;
    delete state.hints[id];
    redraw();

    Api.draftInbox(item.accountId, item.kind, item.id)
      .then(function (written) {
        delete state.drafting[id];
        state.drafts[id] = written.answer || '';
        if (written.needsHuman) {
          state.hints[id] = written.why || 'Помощник не уверен — проверьте сами.';
        }
        redraw();
      })
      .catch(function (error) {
        delete state.drafting[id];
        redraw();
        toast(error.message);
      });
  }

  /* --- отправка одного ответа ------------------------------------------------ */

  function send(item, text, redraw) {
    var id = key(item);
    state.sending[id] = true;
    redraw();

    Api.answerInbox(item.accountId, item.kind, item.id, text)
      .then(function () {
        delete state.sending[id];
        delete state.drafts[id];
        state.answered[id] = text;
        toast('Ответ отправлен');
        redraw();
      })
      .catch(function (error) {
        // Отправка не прошла — карточка обязана остаться на месте.
        delete state.sending[id];
        redraw();
        toast(error.message);
      });
  }

  /* --- карточка обращения --------------------------------------------------- */

  function answeredCard(text) {
    var card = Fmt.el('article', 'inbox-card inbox-card--done');
    card.appendChild(Fmt.el('div', 'inbox-card__done', 'Ответ отправлен'));
    card.appendChild(Fmt.el('p', 'inbox-card__answer', text));
    return card;
  }

  function cardHead(item) {
    var head = Fmt.el('header', 'inbox-card__head');
    if (item.author) head.appendChild(Fmt.el('span', 'inbox-card__store', item.author));
    if (item.kind === 'feedback' && item.rating) head.appendChild(stars(item.rating));
    if (item.urgent) head.appendChild(Fmt.el('span', 'inbox-card__flag', 'нужен человек'));
    head.appendChild(Fmt.el('span', 'inbox-card__when', moment(item.createdAt)));
    return head;
  }

  function photos(item) {
    var row = Fmt.el('div', 'inbox-card__photos');
    item.photos.slice(0, 6).forEach(function (url) {
      var link = document.createElement('a');
      link.className = 'inbox-card__photo';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      var image = document.createElement('img');
      image.src = url;
      image.alt = 'Фото покупателя';
      image.loading = 'lazy';
      link.appendChild(image);
      row.appendChild(link);
    });
    return row;
  }

  function answerBox(item, ctx) {
    var id = key(item);
    var box = Fmt.el('div', 'inbox-card__reply');

    if (state.hints[id]) {
      var hint = Fmt.el('div', 'inbox-card__hint');
      hint.appendChild(Fmt.el('strong', null, 'Проверьте сами. '));
      hint.appendChild(Fmt.el('span', null, state.hints[id]));
      box.appendChild(hint);
    }

    var area = document.createElement('textarea');
    area.className = 'inbox-card__input';
    area.rows = 3;
    area.placeholder = item.kind === 'question'
      ? 'Ответ на вопрос покупателя'
      : 'Ответ покупателю';
    area.value = state.drafts[id] || '';
    area.disabled = !!state.sending[id];
    area.addEventListener('input', function () {
      state.drafts[id] = area.value;
      button.disabled = !area.value.trim();
      if (state.confirming[id]) {
        delete state.confirming[id];
        label.textContent = 'Отправить покупателю';
        button.classList.remove('btn--danger');
      }
    });
    box.appendChild(area);

    var foot = Fmt.el('div', 'inbox-card__foot');

    if (ctx.agent) {
      var ask = Fmt.el('button', 'btn btn--ghost');
      ask.type = 'button';
      ask.appendChild(Fmt.el('span', null,
        state.drafting[id] ? 'Помощник пишет…' : 'Черновик от помощника'));
      ask.disabled = !!state.drafting[id] || !!state.sending[id];
      ask.addEventListener('click', function () { askDraft(item, ctx.redraw); });
      foot.appendChild(ask);
    }

    var button = Fmt.el('button', 'btn btn--primary');
    button.type = 'button';
    var label = Fmt.el('span', null,
      state.confirming[id] ? 'Точно отправить?' : 'Отправить покупателю');
    if (state.confirming[id]) button.classList.add('btn--danger');
    button.appendChild(label);
    button.disabled = !(state.drafts[id] || '').trim() || !!state.sending[id];
    if (state.sending[id]) label.textContent = 'Отправляем…';

    button.addEventListener('click', function () {
      var text = (state.drafts[id] || '').trim();
      if (!text) return;
      if (!state.confirming[id]) {
        // Первое нажатие только предупреждает: ответ публичный и навсегда.
        state.confirming[id] = true;
        label.textContent = 'Точно отправить?';
        button.classList.add('btn--danger');
        return;
      }
      delete state.confirming[id];
      send(item, text, ctx.redraw);
    });
    foot.appendChild(button);

    box.appendChild(foot);
    box.appendChild(Fmt.el('p', 'inbox-card__note',
      item.kind === 'chat'
        ? 'Сообщение уйдёт покупателю в чат'
        : 'Ответ увидят все покупатели, отозвать его нельзя'));
    return box;
  }

  function card(item, ctx) {
    var id = key(item);
    if (state.answered[id]) return answeredCard(state.answered[id]);

    var node = Fmt.el('article', 'inbox-card' + (item.urgent ? ' inbox-card--urgent' : ''));
    node.appendChild(cardHead(item));

    if (item.product || item.article) {
      var product = Fmt.el('div', 'inbox-card__product');
      if (item.product) product.appendChild(Fmt.el('span', null, item.product));
      if (item.article) product.appendChild(Fmt.el('span', 'inbox-card__article', item.article));
      node.appendChild(product);
    }

    node.appendChild(Fmt.el('p', 'inbox-card__text',
      item.text || 'Покупатель написал без текста'));

    if (item.photos && item.photos.length) node.appendChild(photos(item));

    node.appendChild(answerBox(item, ctx));
    return node;
  }

  /* --- конвейер ------------------------------------------------------------- */

  function approvedAnswers(items) {
    var answers = {};
    visible(items).forEach(function (item) {
      var id = key(item);
      var text = (state.drafts[id] || '').trim();
      if (!text || state.hints[id]) return;   // с пометкой — только руками
      answers[item.id] = text;
    });
    return answers;
  }

  function needingHuman(items) {
    return visible(items).filter(function (item) { return !!state.hints[key(item)]; }).length;
  }

  function startBatch(scope, items, redraw) {
    var ids = visible(items).slice(0, BATCH).map(function (item) { return item.id; });
    if (!ids.length) return;

    state.batch = { running: true, total: ids.length, done: 0, failed: 0 };
    redraw();

    Api.startBatch(scope.accountId, scope.kind, ids)
      .then(function (batch) { watchBatch(scope, batch, redraw); })
      .catch(function (error) {
        state.batch = null;
        redraw();
        toast(error.message);
      });
  }

  function watchBatch(scope, batch, redraw) {
    state.batch = {
      id: batch.id, running: !batch.finished, total: batch.total,
      done: batch.done, failed: batch.failed
    };

    (batch.drafts || []).forEach(function (draft) {
      var full = [scope.marketplace || '', batch.accountId, batch.kind, draft.id].join(':');
      if (draft.answer) state.drafts[full] = draft.answer;
      if (draft.needsHuman) {
        state.hints[full] = draft.why || 'Помощник не уверен — проверьте сами.';
      }
      if (draft.error) state.hints[full] = draft.error;
    });

    redraw();
    if (batch.finished) return;

    setTimeout(function () {
      Api.readBatch(batch.id)
        .then(function (next) { watchBatch(scope, next, redraw); })
        .catch(function (error) {
          state.batch = null;
          redraw();
          toast(error.message);
        });
    }, 1500);
  }

  function sendApproved(scope, items, redraw) {
    var answers = approvedAnswers(items);
    var ids = Object.keys(answers);
    if (!ids.length) return;

    state.sendingBatch = true;
    redraw();

    Api.sendBatch(scope.accountId, scope.kind, answers)
      .then(function (result) {
        state.sendingBatch = false;
        (result.sent || []).forEach(function (itemId) {
          var full = [scope.marketplace || '', scope.accountId, scope.kind, itemId].join(':');
          state.answered[full] = state.drafts[full] || '';
          delete state.drafts[full];
        });
        var failed = Object.keys(result.failed || {}).length;
        toast('Отправлено: ' + (result.sent || []).length +
              (failed ? ', не удалось: ' + failed : ''));
        redraw();
      })
      .catch(function (error) {
        state.sendingBatch = false;
        redraw();
        toast(error.message);
      });
  }

  function conveyor(scope, items, ctx) {
    if (!ctx.agent) return null;
    var waiting = visible(items);
    if (!waiting.length) return null;

    var bar = Fmt.el('div', 'inbox__conveyor');
    var batch = state.batch;

    if (batch && batch.running) {
      bar.appendChild(Fmt.el('span', 'inbox__progress',
        'Помощник пишет: ' + batch.done + ' из ' + batch.total + '…'));
      return bar;
    }

    var ready = Object.keys(approvedAnswers(items)).length;

    if (batch) {
      bar.appendChild(Fmt.el('span', 'inbox__progress',
        'Разобрано ' + batch.total + ': типовых ' + ready +
        ', нужен человек — ' + needingHuman(items) +
        (batch.failed ? ', не вышло ' + batch.failed : '')));
    } else {
      bar.appendChild(Fmt.el('span', 'inbox__progress',
        'Ждёт ответа: ' + waiting.length +
        (waiting.length > BATCH ? ' — за раз разбираем ' + BATCH : '')));
    }

    var run = Fmt.el('button', 'btn btn--ghost');
    run.type = 'button';
    run.appendChild(Fmt.el('span', null, 'Разобрать ' + Math.min(waiting.length, BATCH)));
    run.addEventListener('click', function () { startBatch(scope, items, ctx.redraw); });
    bar.appendChild(run);

    if (ready) {
      var post = Fmt.el('button', 'btn btn--primary');
      post.type = 'button';
      var label = Fmt.el('span', null, state.confirmBatch
        ? 'Точно отправить ' + ready + '?'
        : 'Отправить типовые (' + ready + ')');
      if (state.confirmBatch) post.classList.add('btn--danger');
      if (state.sendingBatch) label.textContent = 'Отправляем…';
      post.appendChild(label);
      post.disabled = !!state.sendingBatch;
      post.addEventListener('click', function () {
        if (!state.confirmBatch) {
          // Пачка уходит покупателям и не отзывается — спрашиваем дважды.
          state.confirmBatch = true;
          ctx.redraw();
          return;
        }
        state.confirmBatch = false;
        sendApproved(scope, items, ctx.redraw);
      });
      bar.appendChild(post);
    }

    return bar;
  }

  function resetBatch() {
    state.batch = null;
    state.confirmBatch = false;
  }

  global.Reply = {
    key: key,
    visible: visible,
    answeredIn: answeredIn,
    card: card,
    conveyor: conveyor,
    resetBatch: resetBatch,
    moment: moment,
    stars: stars,
    BATCH: BATCH
  };
})(window);
