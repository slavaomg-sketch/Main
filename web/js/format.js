/* Форматирование чисел, дат и мелкие DOM-помощники. */
(function (global) {
  'use strict';

  var MARKETPLACE_COLORS = {
    wildberries: 'var(--wb)',
    ozon: 'var(--ozon)',
    yandex: 'var(--yandex)',
    ali: 'var(--ali)'
  };

  var MARKETPLACE_TITLES = {
    wildberries: 'Wildberries',
    ozon: 'Ozon',
    yandex: 'Яндекс Маркет',
    ali: 'AliExpress'
  };

  var money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  var money2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* Крупные суммы сокращаем: руководителю важен порядок, а не копейки. */
  /* Суммы в панели не сокращаются: «1,5 млн ₽» прячет полсотни тысяч, а
     руководитель сверяет цифры с кабинетом до рубля. Сокращение осталось
     только для подписей осей — там это шкала, а не сумма. */
  function compactMoney(value) {
    var abs = Math.abs(value || 0);
    if (abs && abs < 100) return money2.format(value) + ' ₽';
    return money.format(Math.round(value || 0)) + ' ₽';
  }

  function trim(value) {
    var rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return String(rounded).replace('.', ',');
  }

  function fullMoney(value) {
    var abs = Math.abs(value || 0);
    // Мелкие суммы показываем с копейками, крупные — целыми рублями.
    if (abs && abs < 100) return money2.format(value) + ' ₽';
    return money.format(Math.round(value || 0)) + ' ₽';
  }

  function number(value) {
    return money.format(Math.round(value || 0));
  }

  function compactNumber(value) {
    var abs = Math.abs(value || 0);
    if (abs >= 1e6) return trim(value / 1e6) + ' млн';
    if (abs >= 1e4) return trim(value / 1e3) + ' тыс';
    return money.format(Math.round(value || 0));
  }

  function percent(value, digits) {
    var d = digits === undefined ? 1 : digits;
    return (Math.round((value || 0) * Math.pow(10, d)) / Math.pow(10, d))
      .toString().replace('.', ',') + '%';
  }

  function signedPercent(value) {
    if (value === null || value === undefined) return '—';
    var sign = value > 0 ? '+' : '';
    return sign + percent(value);
  }

  /* Склонение: 1 день, 2 дня, 5 дней */
  function plural(count, forms) {
    var n = Math.abs(Math.round(count)) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн',
                      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function parseDay(iso) {
    var parts = String(iso).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function dayShort(iso) {
    var date = parseDay(iso);
    return date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()];
  }

  function dayLong(iso) {
    var date = parseDay(iso);
    return date.getDate() + ' ' + MONTHS[date.getMonth()];
  }

  function periodLabel(period) {
    if (!period) return '';
    var from = parseDay(period.from);
    var to = parseDay(period.to);
    if (period.from === period.to) return dayLong(period.from);
    if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
      return from.getDate() + '–' + to.getDate() + ' ' + MONTHS[to.getMonth()];
    }
    return dayLong(period.from) + ' — ' + dayLong(period.to);
  }

  function timeLabel(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  /* Плавный «набор» числа — оживляет карточки показателей. */
  function countUp(node, target, render) {
    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !target) {
      node.textContent = render(target);
      return;
    }
    var duration = 900;
    var start = null;
    function step(timestamp) {
      if (start === null) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 4);
      node.textContent = render(target * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function colorOf(code) {
    return MARKETPLACE_COLORS[code] || 'var(--accent)';
  }

  function titleOf(code) {
    return MARKETPLACE_TITLES[code] || code;
  }

  /* Подпись точки на линии: «27 августа» по дням и «27 августа, 14:00»
     внутри суток — час отличается наличием времени в самой дате. */
  function momentLabel(value) {
    var text = String(value || '');
    if (text.indexOf('T') === -1) return dayLong(value);
    var parts = text.split('T');
    return dayLong(parts[0]) + ', ' + parts[1].slice(0, 5);
  }

  global.Fmt = {
    momentLabel: momentLabel,
    compactMoney: compactMoney,
    fullMoney: fullMoney,
    number: number,
    compactNumber: compactNumber,
    percent: percent,
    signedPercent: signedPercent,
    plural: plural,
    dayShort: dayShort,
    dayLong: dayLong,
    periodLabel: periodLabel,
    timeLabel: timeLabel,
    parseDay: parseDay,
    countUp: countUp,
    el: el,
    svg: svg,
    clear: clear,
    colorOf: colorOf,
    titleOf: titleOf,
    MARKETPLACE_COLORS: MARKETPLACE_COLORS
  };
})(window);
