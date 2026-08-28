/* Отрисовка содержимого блоков. Каждый рендерер получает пустое тело
   карточки и срез данных, и сам решает, что показать. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var Charts = global.Charts;

  var ICONS = {
    revenue: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    profit: '<path d="M3 17l6-6 4 4 8-8M21 7v5h-5"/>',
    orders: '<path d="M6 2l1.5 3h9L18 2M3 6h18l-1.5 13.5A2 2 0 0 1 17.5 21h-11a2 2 0 0 1-2-1.5z"/>',
    check: '<path d="M2 8h20M6 12h5M6 16h3M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
    buyout: '<path d="M20 6L9 17l-5-5"/>',
    ads: '<path d="M3 10v4h4l5 4V6l-5 4H3zM16 9a4 4 0 0 1 0 6"/>',
    returns: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
    star: '<path d="M12 3l2.7 5.6 6.3.9-4.5 4.3 1 6.2-5.5-2.9-5.5 2.9 1-6.2L4 9.5l6.3-.9z"/>',
    chart: '<path d="M3 3v18h18M7 14l4-5 3.5 3L21 6"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    donut: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>',
    table: '<path d="M3 5h18v14H3zM3 10h18M9 10v9M15 10v9"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/>',
    warning: '<path d="M12 3l9.5 17H2.5zM12 9v5M12 17.5v.5"/>',
    wallet: '<path d="M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1zM3 7V5.5A1.5 1.5 0 0 1 4.5 4H16M17 13h.5"/>',
    funnel: '<path d="M3 4h18l-7 8v8l-4-2v-6z"/>',
    message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24">' + (ICONS[name] || ICONS.chart) + '</svg>';
  }

  function deltaBadge(delta) {
    if (!delta || delta.change === null || delta.change === undefined) {
      return Fmt.el('span', 'delta', 'нет данных за прошлый период');
    }
    var up = delta.change >= 0;
    var node = Fmt.el('span', 'delta ' + (up ? 'delta--up' : 'delta--down'));
    node.innerHTML = '<svg viewBox="0 0 12 12">' +
      (up ? '<path d="M6 2l4 6H2z"/>' : '<path d="M6 10L2 4h8z"/>') + '</svg>';
    node.appendChild(Fmt.el('span', null, Fmt.signedPercent(Math.abs(delta.change) * (up ? 1 : -1))));
    return node;
  }

  /* Универсальная карточка показателя. */
  function metric(body, options) {
    var wrap = Fmt.el('div', 'metric');
    var value = Fmt.el('div', 'metric__value', '—');
    wrap.appendChild(value);

    var row = Fmt.el('div', 'metric__row');
    if (options.delta) row.appendChild(deltaBadge(options.delta));
    if (options.footer) row.appendChild(Fmt.el('span', 'metric__foot', options.footer));
    wrap.appendChild(row);
    body.appendChild(wrap);

    Fmt.countUp(value, options.value, options.format);

    if (options.spark && options.spark.length > 1) {
      var sparkHost = Fmt.el('div');
      body.appendChild(sparkHost);
      Charts.sparkline(sparkHost, options.spark, options.color || 'var(--accent)');
    }
  }

  function seriesValues(data, key) {
    return (data.totals.series || []).map(function (point) { return point[key] || 0; });
  }

  function seriesLabels(data) {
    return (data.totals.series || []).map(function (point) { return Fmt.dayShort(point.day); });
  }

  function reverseDelta(delta) {
    /* Для возвратов и ДРР рост — плохая новость: переворачиваем знак у бейджа. */
    if (!delta || delta.change === null || delta.change === undefined) return delta;
    return { value: delta.value, prev: delta.prev, change: -delta.change };
  }

  var RENDERERS = {

    'kpi.revenue': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.revenue,
        format: Fmt.compactMoney,
        delta: ctx.data.deltas.revenue,
        footer: Fmt.number(ctx.data.totals.orders) + ' ' +
                Fmt.plural(ctx.data.totals.orders, ['заказ', 'заказа', 'заказов']),
        spark: seriesValues(ctx.data, 'revenue'),
        color: 'var(--accent)'
      });
    },

    'kpi.profit': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.profit,
        format: Fmt.compactMoney,
        delta: ctx.data.deltas.profit,
        footer: 'маржинальность ' + Fmt.percent(ctx.data.totals.margin),
        spark: seriesValues(ctx.data, 'revenue'),
        color: 'var(--positive)'
      });
    },

    'kpi.orders': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.orders,
        format: function (value) { return Fmt.number(value); },
        delta: ctx.data.deltas.orders,
        footer: Fmt.number(ctx.data.totals.units) + ' ' +
                Fmt.plural(ctx.data.totals.units, ['товар', 'товара', 'товаров']),
        spark: seriesValues(ctx.data, 'orders'),
        color: 'var(--ozon)'
      });
    },

    'kpi.avgCheck': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.avgCheck,
        format: Fmt.compactMoney,
        delta: ctx.data.deltas.avgCheck,
        footer: 'на заказ',
        spark: (ctx.data.totals.series || []).map(function (point) {
          return point.orders ? point.revenue / point.orders : 0;
        }),
        color: 'var(--yandex)'
      });
    },

    'kpi.buyoutRate': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.buyoutRate,
        format: function (value) { return Fmt.percent(value); },
        delta: ctx.data.deltas.buyoutRate,
        footer: Fmt.number(ctx.data.totals.buyouts) + ' выкуплено'
      });
    },

    'kpi.drr': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.drr,
        format: function (value) { return Fmt.percent(value); },
        delta: reverseDelta(ctx.data.deltas.drr),
        footer: 'реклама ' + Fmt.compactMoney(ctx.data.totals.adSpend)
      });
    },

    'kpi.returnRate': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.returnRate,
        format: function (value) { return Fmt.percent(value); },
        delta: reverseDelta(ctx.data.deltas.returnRate),
        footer: Fmt.number(ctx.data.totals.returns) + ' ' +
                Fmt.plural(ctx.data.totals.returns, ['возврат', 'возврата', 'возвратов'])
      });
    },

    'kpi.rating': function (body, ctx) {
      metric(body, {
        value: ctx.data.totals.rating,
        format: function (value) { return (Math.round(value * 100) / 100).toFixed(2).replace('.', ','); },
        footer: Fmt.number(ctx.data.totals.reviewsCount) + ' ' +
                Fmt.plural(ctx.data.totals.reviewsCount, ['отзыв', 'отзыва', 'отзывов'])
      });
    },

    'chart.revenueDynamics': function (body, ctx) {
      var host = Fmt.el('div');
      body.appendChild(host);
      var series = ctx.data.marketplaces.map(function (report) {
        return {
          title: report.title,
          color: Fmt.colorOf(report.marketplace),
          values: report.series.map(function (point) { return point.revenue; })
        };
      });
      if (series.length > 1) {
        series.unshift({
          title: 'Все площадки',
          color: 'var(--accent)',
          values: seriesValues(ctx.data, 'revenue')
        });
      }
      Charts.areaChart(host, {
        uid: ctx.block.id,
        labels: seriesLabels(ctx.data),
        tooltipTitles: (ctx.data.totals.series || []).map(function (p) { return Fmt.dayLong(p.day); }),
        series: series,
        height: ctx.block.size === 'xl' ? 300 : 240,
        formatValue: Fmt.compactMoney,
        formatAxis: Fmt.compactNumber
      });
    },

    'chart.ordersByDay': function (body, ctx) {
      var host = Fmt.el('div');
      body.appendChild(host);
      Charts.barChart(host, {
        items: (ctx.data.totals.series || []).map(function (point) {
          return {
            label: Fmt.dayShort(point.day),
            tooltip: Fmt.dayLong(point.day),
            value: point.orders,
            color: 'var(--accent)'
          };
        }),
        height: 230,
        formatValue: function (value) {
          return Fmt.number(value) + ' ' + Fmt.plural(value, ['заказ', 'заказа', 'заказов']);
        }
      });
    },

    'chart.marketplaceShare': function (body, ctx) {
      Charts.donut(body, {
        items: (ctx.data.totals.share || []).map(function (item) {
          return { label: item.title, value: item.revenue, color: Fmt.colorOf(item.marketplace) };
        }),
        centerValue: Fmt.compactMoney(ctx.data.totals.revenue),
        centerCaption: 'выручка'
      });
    },

    'chart.regions': function (body, ctx) {
      var merged = {};
      ctx.data.marketplaces.forEach(function (report) {
        (report.regions || []).forEach(function (region) {
          merged[region.region] = (merged[region.region] || 0) + region.revenue;
        });
      });
      var rows = Object.keys(merged).map(function (name) {
        return { name: name, value: merged[name] };
      }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);

      if (!rows.length) {
        body.appendChild(Charts.emptyState('Площадки не отдали разбивку по регионам'));
        return;
      }

      var max = rows[0].value || 1;
      var list = Fmt.el('div', 'bar-list');
      rows.forEach(function (row, index) {
        var item = Fmt.el('div', 'bar-item');
        item.appendChild(Fmt.el('span', 'bar-item__name', row.name));
        item.appendChild(Fmt.el('span', 'bar-item__value', Fmt.compactMoney(row.value)));
        var track = Fmt.el('div', 'bar-item__track');
        var fill = Fmt.el('div', 'bar-item__fill');
        fill.style.width = (row.value / max * 100).toFixed(1) + '%';
        fill.style.background = 'var(--accent)';
        fill.style.opacity = String(1 - index * 0.07);
        fill.style.animationDelay = (index * 0.05) + 's';
        track.appendChild(fill);
        item.appendChild(track);
        list.appendChild(item);
      });
      body.appendChild(list);
    },

    'table.marketplaces': function (body, ctx) {
      var wrap = Fmt.el('div', 'table-wrap');
      var table = Fmt.el('table', 'table');
      var head = Fmt.el('thead');
      head.innerHTML = '<tr><th>Площадка</th><th>Выручка</th><th>Доля</th><th>Заказы</th>' +
        '<th>Ср. чек</th><th>Выкуп</th><th>Возвраты</th><th>ДРР</th><th>Прибыль</th></tr>';
      table.appendChild(head);

      var shareByCode = {};
      (ctx.data.totals.share || []).forEach(function (item) { shareByCode[item.marketplace] = item.share; });

      var tbody = Fmt.el('tbody');
      ctx.data.marketplaces.slice().sort(function (a, b) { return b.revenue - a.revenue; })
        .forEach(function (report) {
          var row = Fmt.el('tr');

          var nameCell = Fmt.el('td');
          var name = Fmt.el('span', 'cell-mp');
          var dot = Fmt.el('span', 'cell-mp__dot');
          dot.style.background = Fmt.colorOf(report.marketplace);
          name.appendChild(dot);
          name.appendChild(Fmt.el('span', null, report.title));
          if (report.error) {
            var badge = Fmt.el('span', 'badge badge--critical', 'ошибка');
            badge.title = report.error;
            name.appendChild(badge);
          } else if (report.demo) {
            name.appendChild(Fmt.el('span', 'badge badge--muted', 'демо'));
          }
          nameCell.appendChild(name);
          row.appendChild(nameCell);

          [
            Fmt.compactMoney(report.revenue),
            Fmt.percent(shareByCode[report.marketplace] || 0),
            Fmt.number(report.orders),
            Fmt.compactMoney(report.avgCheck),
            Fmt.percent(report.buyoutRate),
            Fmt.percent(report.returnRate),
            Fmt.percent(report.drr),
            Fmt.compactMoney(report.profit)
          ].forEach(function (text, index) {
            var cell = Fmt.el('td', index === 0 || index === 7 ? '' : 'is-muted', text);
            row.appendChild(cell);
          });

          tbody.appendChild(row);
        });

      var totals = Fmt.el('tr');
      totals.innerHTML = '<td><strong>Итого</strong></td>' +
        '<td><strong>' + Fmt.compactMoney(ctx.data.totals.revenue) + '</strong></td>' +
        '<td class="is-muted">100%</td>' +
        '<td><strong>' + Fmt.number(ctx.data.totals.orders) + '</strong></td>' +
        '<td class="is-muted">' + Fmt.compactMoney(ctx.data.totals.avgCheck) + '</td>' +
        '<td class="is-muted">' + Fmt.percent(ctx.data.totals.buyoutRate) + '</td>' +
        '<td class="is-muted">' + Fmt.percent(ctx.data.totals.returnRate) + '</td>' +
        '<td class="is-muted">' + Fmt.percent(ctx.data.totals.drr) + '</td>' +
        '<td><strong>' + Fmt.compactMoney(ctx.data.totals.profit) + '</strong></td>';
      tbody.appendChild(totals);

      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
    },

    'table.topProducts': function (body, ctx) {
      var merged = {};
      ctx.data.marketplaces.forEach(function (report) {
        (report.products || []).forEach(function (product) {
          var key = product.sku + '|' + report.marketplace;
          merged[key] = {
            sku: product.sku,
            name: product.name,
            revenue: product.revenue,
            units: product.units,
            stock: product.stock,
            marketplace: report.marketplace
          };
        });
      });

      var rows = Object.keys(merged).map(function (key) { return merged[key]; })
        .sort(function (a, b) { return b.revenue - a.revenue; })
        .slice(0, ctx.block.size === 'xl' ? 12 : 8);

      if (!rows.length) {
        body.appendChild(Charts.emptyState('Нет продаж за период'));
        return;
      }

      var wrap = Fmt.el('div', 'table-wrap');
      var table = Fmt.el('table', 'table');
      var head = Fmt.el('thead');
      head.innerHTML = '<tr><th>Товар</th><th>Площадка</th><th>Продано</th><th>Остаток</th><th>Выручка</th></tr>';
      table.appendChild(head);

      var tbody = Fmt.el('tbody');
      rows.forEach(function (row, index) {
        var tr = Fmt.el('tr');

        var nameCell = Fmt.el('td', 'is-name');
        var rank = Fmt.el('span', 'rank', String(index + 1));
        nameCell.appendChild(rank);
        nameCell.appendChild(document.createTextNode(row.name));
        tr.appendChild(nameCell);

        var mpCell = Fmt.el('td', 'is-muted');
        var mp = Fmt.el('span', 'cell-mp');
        var dot = Fmt.el('span', 'cell-mp__dot');
        dot.style.background = Fmt.colorOf(row.marketplace);
        mp.appendChild(dot);
        mp.appendChild(Fmt.el('span', null, Fmt.titleOf(row.marketplace)));
        mpCell.appendChild(mp);
        tr.appendChild(mpCell);

        tr.appendChild(Fmt.el('td', 'is-muted', Fmt.number(row.units)));
        tr.appendChild(Fmt.el('td', 'is-muted', Fmt.number(row.stock)));
        tr.appendChild(Fmt.el('td', null, Fmt.compactMoney(row.revenue)));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
    },

    'list.stockAlerts': function (body, ctx) {
      var alerts = [];
      ctx.data.marketplaces.forEach(function (report) {
        (report.stockAlerts || []).forEach(function (alert) { alerts.push(alert); });
      });
      alerts.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
      alerts = alerts.slice(0, 8);

      if (!alerts.length) {
        body.appendChild(Charts.emptyState('Запаса хватает по всем товарам'));
        return;
      }

      var list = Fmt.el('div', 'list');
      alerts.forEach(function (alert) {
        var row = Fmt.el('div', 'list__row');
        var dot = Fmt.el('span', 'cell-mp__dot');
        dot.style.background = Fmt.colorOf(alert.marketplace);
        row.appendChild(dot);

        var main = Fmt.el('div', 'list__main');
        main.appendChild(Fmt.el('div', 'list__name', alert.name));
        var meta = Fmt.titleOf(alert.marketplace) + ' · остаток ' + Fmt.number(alert.stock) + ' шт';
        if (alert.warehouse) meta += ' · ' + alert.warehouse;
        main.appendChild(Fmt.el('div', 'list__meta', meta));
        row.appendChild(main);

        var days = Math.round(alert.daysLeft);
        var badge = Fmt.el('span', 'badge badge--' + alert.severity,
          days + ' ' + Fmt.plural(days, ['день', 'дня', 'дней']));
        row.appendChild(badge);
        list.appendChild(row);
      });
      body.appendChild(list);
    },

    'panel.unitEconomics': function (body, ctx) {
      var totals = ctx.data.totals;
      var revenue = totals.revenue || 1;
      var parts = [
        { label: 'Себестоимость', value: totals.costPrice, color: 'var(--text-tertiary)' },
        { label: 'Комиссия', value: totals.commission, color: 'var(--wb)' },
        { label: 'Логистика', value: totals.logistics, color: 'var(--ozon)' },
        { label: 'Реклама', value: totals.adSpend, color: 'var(--yandex)' },
        { label: 'Прибыль', value: Math.max(totals.profit, 0), color: 'var(--positive)' }
      ];

      var wrap = Fmt.el('div', 'economics');
      var bar = Fmt.el('div', 'economics__bar');
      parts.forEach(function (part, index) {
        var segment = Fmt.el('div', 'economics__seg');
        segment.style.flex = String(Math.max(part.value, 0));
        segment.style.background = part.color;
        segment.style.animationDelay = (index * 0.06) + 's';
        segment.title = part.label + ': ' + Fmt.compactMoney(part.value);
        bar.appendChild(segment);
      });
      wrap.appendChild(bar);

      var legend = Fmt.el('div', 'economics__legend');
      parts.forEach(function (part) {
        var item = Fmt.el('div', 'eco-item');
        var label = Fmt.el('span', 'eco-item__label');
        var swatch = Fmt.el('span', 'eco-item__swatch');
        swatch.style.background = part.color;
        label.appendChild(swatch);
        label.appendChild(Fmt.el('span', null, part.label));
        item.appendChild(label);
        item.appendChild(Fmt.el('div', 'eco-item__value', Fmt.compactMoney(part.value)));
        item.appendChild(Fmt.el('div', 'eco-item__share', Fmt.percent(part.value / revenue * 100) + ' от выручки'));
        legend.appendChild(item);
      });
      wrap.appendChild(legend);
      body.appendChild(wrap);
    },

    'panel.funnel': function (body, ctx) {
      var totals = { impressions: 0, cardViews: 0, cartAdds: 0, orders: 0, buyouts: 0 };
      ctx.data.marketplaces.forEach(function (report) {
        Object.keys(totals).forEach(function (key) {
          totals[key] += (report.funnel && report.funnel[key]) || 0;
        });
      });

      var steps = [
        { name: 'Показы', value: totals.impressions },
        { name: 'Просмотры карточки', value: totals.cardViews },
        { name: 'В корзину', value: totals.cartAdds },
        { name: 'Заказы', value: totals.orders },
        { name: 'Выкуплено', value: totals.buyouts }
      ].filter(function (step) { return step.value > 0; });

      if (steps.length < 2) {
        body.appendChild(Charts.emptyState('Площадки не отдают данные воронки'));
        return;
      }

      var max = steps[0].value || 1;
      var wrap = Fmt.el('div', 'funnel');
      steps.forEach(function (step, index) {
        var block = Fmt.el('div', 'funnel__step');
        block.appendChild(Fmt.el('span', 'funnel__name', step.name));
        block.appendChild(Fmt.el('span', 'funnel__value', Fmt.compactNumber(step.value)));
        var track = Fmt.el('div', 'funnel__track');
        var fill = Fmt.el('div', 'funnel__fill');
        fill.style.width = Math.max(step.value / max * 100, 2).toFixed(1) + '%';
        fill.style.animationDelay = (index * 0.07) + 's';
        track.appendChild(fill);
        block.appendChild(track);
        wrap.appendChild(block);

        if (index < steps.length - 1) {
          var conversion = steps[index + 1].value / step.value * 100;
          wrap.appendChild(Fmt.el('div', 'funnel__conv', '↓ конверсия ' + Fmt.percent(conversion)));
        }
      });
      body.appendChild(wrap);
    },

    'list.reviews': function (body, ctx) {
      var reviews = [];
      ctx.data.marketplaces.forEach(function (report) {
        (report.reviews || []).forEach(function (review) { reviews.push(review); });
      });
      reviews.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      reviews = reviews.slice(0, 6);

      if (!reviews.length) {
        body.appendChild(Charts.emptyState('Свежих отзывов нет'));
        return;
      }

      var wrap = Fmt.el('div');
      reviews.forEach(function (review) {
        var item = Fmt.el('div', 'review');
        var head = Fmt.el('div', 'review__head');
        var stars = Fmt.el('span', 'stars',
          '★★★★★'.slice(0, Math.round(review.rating)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(review.rating)));
        head.appendChild(stars);
        head.appendChild(Fmt.el('span', 'review__name', review.name));
        var dot = Fmt.el('span', 'cell-mp__dot');
        dot.style.background = Fmt.colorOf(review.marketplace);
        dot.title = Fmt.titleOf(review.marketplace);
        head.appendChild(dot);
        item.appendChild(head);
        item.appendChild(Fmt.el('div', 'review__text', review.text));
        wrap.appendChild(item);
      });
      body.appendChild(wrap);
    },

    'panel.goal': function (body, ctx) {
      var goal = Number((ctx.block.settings && ctx.block.settings.goal) || 5000000);
      var revenue = ctx.data.totals.revenue;
      var progress = goal > 0 ? Math.min(revenue / goal, 1) : 0;

      var size = 132;
      var radius = 54;
      var circumference = 2 * Math.PI * radius;

      var wrap = Fmt.el('div', 'goal');
      var svg = Fmt.svg('svg', { class: 'goal__ring', width: size, height: size, viewBox: '0 0 ' + size + ' ' + size });
      svg.appendChild(Fmt.svg('circle', {
        class: 'goal__track', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': 12
      }));
      var value = Fmt.svg('circle', {
        class: 'goal__value', cx: size / 2, cy: size / 2, r: radius, 'stroke-width': 12,
        stroke: progress >= 1 ? 'var(--positive)' : 'var(--accent)',
        'stroke-dasharray': circumference.toFixed(1),
        'stroke-dashoffset': circumference.toFixed(1)
      });
      svg.appendChild(value);
      wrap.appendChild(svg);
      requestAnimationFrame(function () {
        value.setAttribute('stroke-dashoffset', (circumference * (1 - progress)).toFixed(1));
      });

      var center = Fmt.el('div', 'goal__center');
      center.appendChild(Fmt.el('div', 'goal__percent', Fmt.percent(progress * 100, 0)));
      center.appendChild(Fmt.el('div', 'goal__caption',
        Fmt.compactMoney(revenue) + ' из ' + Fmt.compactMoney(goal)));
      wrap.appendChild(center);

      var input = document.createElement('input');
      input.className = 'goal__input';
      input.type = 'number';
      input.min = '0';
      input.step = '100000';
      input.value = String(goal);
      input.title = 'План по выручке за период';
      input.addEventListener('change', function () {
        ctx.onSettings(ctx.block, { goal: Math.max(Number(input.value) || 0, 0) });
      });
      wrap.appendChild(input);
      body.appendChild(wrap);
    },

    'panel.health': function (body, ctx) {
      var wrap = Fmt.el('div', 'health');
      ctx.data.marketplaces.forEach(function (report) {
        var row = Fmt.el('div', 'health__row');
        var dot = Fmt.el('span', 'health__dot');
        dot.style.background = report.error ? 'var(--negative)'
          : report.demo ? 'var(--warning)' : 'var(--positive)';
        row.appendChild(dot);
        row.appendChild(Fmt.el('span', 'health__name', report.title));

        var status = report.error ? 'ошибка' : report.demo ? 'демо-данные' : 'подключено';
        var badge = Fmt.el('span', 'badge badge--' +
          (report.error ? 'critical' : report.demo ? 'warning' : 'ok'), status);
        if (report.error) badge.title = report.error;
        row.appendChild(badge);
        wrap.appendChild(row);
      });
      body.appendChild(wrap);
    }
  };

  function subtitle(type, data) {
    if (type.indexOf('chart.') === 0 || type.indexOf('table.') === 0) {
      return Fmt.periodLabel(data.period);
    }
    return '';
  }

  global.Blocks = {
    render: function (type, body, ctx) {
      var renderer = RENDERERS[type];
      if (!renderer) {
        body.appendChild(Charts.emptyState('Неизвестный блок'));
        return;
      }
      renderer(body, ctx);
    },
    subtitle: subtitle,
    icon: icon,
    has: function (type) { return Boolean(RENDERERS[type]); }
  };
})(window);
