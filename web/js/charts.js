/* Графики на чистом SVG: без внешних библиотек, рисуем по фактической ширине
   контейнера и перерисовываем при изменении размера. */
(function (global) {
  'use strict';

  var Fmt = global.Fmt;
  var tooltip = null;

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = Fmt.el('div', 'tooltip');
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function showTooltip(html, x, y) {
    var node = ensureTooltip();
    node.innerHTML = html;
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    node.classList.add('is-visible');
  }

  function hideTooltip() {
    if (tooltip) tooltip.classList.remove('is-visible');
  }

  /* Перерисовка при изменении ширины карточки (в том числе при смене размера блока). */
  function responsive(container, draw) {
    var lastWidth = 0;
    function render() {
      var width = container.clientWidth;
      if (!width || Math.abs(width - lastWidth) < 2) return;
      lastWidth = width;
      Fmt.clear(container);
      draw(container, width);
    }
    render();
    if (global.ResizeObserver) {
      var observer = new ResizeObserver(function () { render(); });
      observer.observe(container);
      container._chartObserver = observer;
    } else {
      global.addEventListener('resize', render);
    }
    // Если карточка пока не в потоке, ширина будет нулевой — дорисуем позже.
    if (!container.clientWidth) requestAnimationFrame(render);
  }

  function niceMax(value) {
    if (value <= 0) return 1;
    var exponent = Math.pow(10, Math.floor(Math.log10(value)));
    var normalized = value / exponent;
    var step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return step * exponent;
  }

  /* Сглаженная кривая: монотонные кубические Безье без «выбросов». */
  function smoothPath(points) {
    if (!points.length) return '';
    // Одна точка линией не рисуется — её показываем кружком отдельно.
    if (points.length === 1) return '';
    if (points.length < 3) {
      return points.map(function (p, i) {
        return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      }).join(' ');
    }
    var d = 'M' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
    for (var i = 0; i < points.length - 1; i++) {
      var current = points[i];
      var next = points[i + 1];
      var controlX = (current.x + next.x) / 2;
      d += ' C' + controlX.toFixed(1) + ' ' + current.y.toFixed(1) +
           ' ' + controlX.toFixed(1) + ' ' + next.y.toFixed(1) +
           ' ' + next.x.toFixed(1) + ' ' + next.y.toFixed(1);
    }
    return d;
  }

  /* --- График динамики: несколько линий с заливкой ------------------------ */

  function areaChart(container, options) {
    var series = (options.series || []).filter(function (item) { return item.values.length; });
    var labels = options.labels || [];
    var height = options.height || 260;
    var formatValue = options.formatValue || Fmt.fullMoney;

    if (!series.length || !labels.length) {
      container.appendChild(emptyState('Нет данных за период'));
      return;
    }

    responsive(container, function (host, width) {
      var padding = { top: 16, right: 12, bottom: 26, left: 54 };
      var innerWidth = Math.max(width - padding.left - padding.right, 10);
      var innerHeight = height - padding.top - padding.bottom;

      var maxValue = 0;
      series.forEach(function (item) {
        item.values.forEach(function (value) { maxValue = Math.max(maxValue, value); });
      });
      maxValue = niceMax(maxValue * 1.08);

      var stepX = labels.length > 1 ? innerWidth / (labels.length - 1) : 0;
      // Единственную точку ставим по центру, а не в левый край.
      var scaleX = labels.length > 1
        ? function (index) { return padding.left + index * stepX; }
        : function () { return padding.left + innerWidth / 2; };
      var scaleY = function (value) {
        return padding.top + innerHeight - (value / maxValue) * innerHeight;
      };

      var root = Fmt.svg('svg', {
        class: 'chart',
        viewBox: '0 0 ' + width + ' ' + height,
        height: height,
        role: 'img'
      });

      var defs = Fmt.svg('defs', {});
      series.forEach(function (item, index) {
        var gradient = Fmt.svg('linearGradient', {
          id: 'grad-' + (options.uid || 'c') + '-' + index,
          x1: '0', y1: '0', x2: '0', y2: '1'
        });
        var stopTop = Fmt.svg('stop', { offset: '0', 'stop-color': item.color, 'stop-opacity': '0.85' });
        var stopBottom = Fmt.svg('stop', { offset: '1', 'stop-color': item.color, 'stop-opacity': '0' });
        gradient.appendChild(stopTop);
        gradient.appendChild(stopBottom);
        defs.appendChild(gradient);
      });
      root.appendChild(defs);

      // Сетка и подписи оси Y
      var grid = Fmt.svg('g', { class: 'chart__grid' });
      var ticks = 4;
      for (var t = 0; t <= ticks; t++) {
        var value = (maxValue / ticks) * t;
        var y = scaleY(value);
        grid.appendChild(Fmt.svg('line', {
          x1: padding.left, y1: y.toFixed(1), x2: width - padding.right, y2: y.toFixed(1)
        }));
        var label = Fmt.svg('text', {
          class: 'chart__axis', x: padding.left - 9, y: (y + 4).toFixed(1), 'text-anchor': 'end'
        });
        label.textContent = options.formatAxis ? options.formatAxis(value) : Fmt.compactNumber(value);
        grid.appendChild(label);
      }
      root.appendChild(grid);

      // Подписи оси X — показываем не больше 7 меток, чтобы не слипались
      var maxLabels = Math.max(2, Math.min(7, Math.floor(innerWidth / 70)));
      var every = Math.max(1, Math.ceil(labels.length / maxLabels));
      labels.forEach(function (label, index) {
        if (index % every !== 0 && index !== labels.length - 1) return;
        var text = Fmt.svg('text', {
          class: 'chart__axis',
          x: scaleX(index).toFixed(1),
          y: height - 6,
          'text-anchor': index === 0 ? 'start' : (index === labels.length - 1 ? 'end' : 'middle')
        });
        text.textContent = label;
        root.appendChild(text);
      });

      // Линии и заливка
      series.forEach(function (item, index) {
        var points = item.values.map(function (value, i) {
          return { x: scaleX(i), y: scaleY(value) };
        });
        var line = smoothPath(points);
        if (series.length <= 2) {
          var area = Fmt.svg('path', {
            class: 'chart__area',
            d: line + ' L' + scaleX(points.length - 1).toFixed(1) + ' ' + (padding.top + innerHeight) +
               ' L' + scaleX(0).toFixed(1) + ' ' + (padding.top + innerHeight) + ' Z',
            fill: 'url(#grad-' + (options.uid || 'c') + '-' + index + ')'
          });
          root.appendChild(area);
        }
        root.appendChild(Fmt.svg('path', { class: 'chart__line', d: line, stroke: item.color }));

        // Период в один день: линии нет, поэтому показываем саму точку.
        if (points.length === 1) {
          root.appendChild(Fmt.svg('circle', {
            cx: points[0].x.toFixed(1), cy: points[0].y.toFixed(1), r: 5,
            fill: item.color, stroke: 'var(--surface-solid)', 'stroke-width': 2
          }));
        }
      });

      // Прозрачные колонки-«ловушки» для подсказки
      var marker = Fmt.svg('line', {
        x1: 0, y1: padding.top, x2: 0, y2: padding.top + innerHeight,
        stroke: 'var(--line-strong)', 'stroke-width': 1, opacity: 0
      });
      root.appendChild(marker);

      var dots = series.map(function (item) {
        var dot = Fmt.svg('circle', {
          class: 'chart__dot', r: 4, fill: item.color,
          stroke: 'var(--surface-solid)', 'stroke-width': 2, opacity: 0
        });
        root.appendChild(dot);
        return dot;
      });

      labels.forEach(function (label, index) {
        var hit = Fmt.svg('rect', {
          class: 'chart__hit',
          x: (labels.length > 1 ? scaleX(index) - stepX / 2 : padding.left).toFixed(1),
          y: padding.top,
          width: (labels.length > 1 ? Math.max(stepX, 6) : innerWidth).toFixed(1),
          height: innerHeight
        });
        hit.addEventListener('mouseenter', function (event) {
          marker.setAttribute('x1', scaleX(index).toFixed(1));
          marker.setAttribute('x2', scaleX(index).toFixed(1));
          marker.setAttribute('opacity', '1');
          var rows = '<div class="tooltip__title">' + (options.tooltipTitles ? options.tooltipTitles[index] : label) + '</div>';
          series.forEach(function (item, si) {
            dots[si].setAttribute('cx', scaleX(index).toFixed(1));
            dots[si].setAttribute('cy', scaleY(item.values[index] || 0).toFixed(1));
            dots[si].setAttribute('opacity', '1');
            rows += '<div class="tooltip__row">' +
              '<span class="legend__swatch" style="background:' + item.color + '"></span>' +
              '<span>' + item.title + '</span>' +
              '<span class="tooltip__value">' + formatValue(item.values[index] || 0) + '</span></div>';
          });
          var box = hit.getBoundingClientRect();
          showTooltip(rows, box.left + box.width / 2, box.top + 40);
        });
        hit.addEventListener('mousemove', function (event) {
          var node = ensureTooltip();
          node.style.left = event.clientX + 'px';
          node.style.top = (event.clientY - 12) + 'px';
        });
        hit.addEventListener('mouseleave', function () {
          marker.setAttribute('opacity', '0');
          dots.forEach(function (dot) { dot.setAttribute('opacity', '0'); });
          hideTooltip();
        });
        root.appendChild(hit);
      });

      host.appendChild(root);

      if (options.legend !== false && series.length > 1) {
        var legend = Fmt.el('div', 'chart-legend');
        series.forEach(function (item) {
          var wrap = Fmt.el('span', 'legend__item');
          var swatch = Fmt.el('span', 'legend__swatch');
          swatch.style.background = item.color;
          wrap.appendChild(swatch);
          wrap.appendChild(Fmt.el('span', null, item.title));
          var total = item.values.reduce(function (sum, value) { return sum + value; }, 0);
          wrap.appendChild(Fmt.el('span', 'legend__value', formatValue(total)));
          legend.appendChild(wrap);
        });
        host.appendChild(legend);
      }
    });
  }

  /* --- Столбчатая диаграмма ------------------------------------------------ */

  function barChart(container, options) {
    var items = options.items || [];
    var height = options.height || 220;
    var formatValue = options.formatValue || Fmt.number;

    if (!items.length) {
      container.appendChild(emptyState('Нет данных за период'));
      return;
    }

    responsive(container, function (host, width) {
      var padding = { top: 14, right: 8, bottom: 26, left: 46 };
      var innerWidth = Math.max(width - padding.left - padding.right, 10);
      var innerHeight = height - padding.top - padding.bottom;
      var maxValue = niceMax(Math.max.apply(null, items.map(function (item) { return item.value; })) * 1.1) || 1;

      var slot = innerWidth / items.length;
      var barWidth = Math.max(Math.min(slot * 0.62, 34), 2);
      var radius = Math.min(barWidth / 2, 5);

      var root = Fmt.svg('svg', { class: 'chart', viewBox: '0 0 ' + width + ' ' + height, height: height });

      var grid = Fmt.svg('g', { class: 'chart__grid' });
      for (var t = 0; t <= 3; t++) {
        var value = (maxValue / 3) * t;
        var y = padding.top + innerHeight - (value / maxValue) * innerHeight;
        grid.appendChild(Fmt.svg('line', { x1: padding.left, y1: y.toFixed(1), x2: width - padding.right, y2: y.toFixed(1) }));
        var label = Fmt.svg('text', { class: 'chart__axis', x: padding.left - 9, y: (y + 4).toFixed(1), 'text-anchor': 'end' });
        label.textContent = Fmt.compactNumber(value);
        grid.appendChild(label);
      }
      root.appendChild(grid);

      var maxLabels = Math.max(2, Math.floor(innerWidth / 60));
      var every = Math.max(1, Math.ceil(items.length / maxLabels));

      items.forEach(function (item, index) {
        var centerX = padding.left + slot * index + slot / 2;
        var barHeight = Math.max((item.value / maxValue) * innerHeight, item.value > 0 ? 2 : 0);
        var rect = Fmt.svg('rect', {
          class: 'chart__bar',
          x: (centerX - barWidth / 2).toFixed(1),
          y: (padding.top + innerHeight - barHeight).toFixed(1),
          width: barWidth.toFixed(1),
          height: barHeight.toFixed(1),
          rx: radius.toFixed(1),
          fill: item.color || 'var(--accent)'
        });
        rect.addEventListener('mouseenter', function (event) {
          showTooltip(
            '<div class="tooltip__title">' + (item.tooltip || item.label) + '</div>' +
            '<div class="tooltip__row"><span class="tooltip__value">' + formatValue(item.value) + '</span></div>',
            event.clientX, event.clientY - 12
          );
        });
        rect.addEventListener('mousemove', function (event) {
          var node = ensureTooltip();
          node.style.left = event.clientX + 'px';
          node.style.top = (event.clientY - 12) + 'px';
        });
        rect.addEventListener('mouseleave', hideTooltip);
        root.appendChild(rect);

        if (index % every === 0) {
          var text = Fmt.svg('text', { class: 'chart__axis', x: centerX.toFixed(1), y: height - 6, 'text-anchor': 'middle' });
          text.textContent = item.label;
          root.appendChild(text);
        }
      });

      host.appendChild(root);
    });
  }

  /* --- Кольцевая диаграмма ------------------------------------------------- */

  function donut(container, options) {
    var items = (options.items || []).filter(function (item) { return item.value > 0; });
    var size = options.size || 148;
    var thickness = options.thickness || 20;

    if (!items.length) {
      container.appendChild(emptyState('Нет продаж за период'));
      return;
    }

    var total = items.reduce(function (sum, item) { return sum + item.value; }, 0);
    var radius = (size - thickness) / 2;
    var circumference = 2 * Math.PI * radius;

    var wrap = Fmt.el('div', 'donut');
    var root = Fmt.svg('svg', {
      class: 'donut__chart', width: size, height: size, viewBox: '0 0 ' + size + ' ' + size
    });

    var offset = 0;
    items.forEach(function (item) {
      var fraction = item.value / total;
      var arc = Fmt.svg('circle', {
        cx: size / 2, cy: size / 2, r: radius,
        fill: 'none',
        stroke: item.color,
        'stroke-width': thickness,
        'stroke-dasharray': (fraction * circumference - 2).toFixed(2) + ' ' + circumference.toFixed(2),
        'stroke-dashoffset': (-offset * circumference).toFixed(2),
        'stroke-linecap': 'round',
        transform: 'rotate(-90 ' + (size / 2) + ' ' + (size / 2) + ')'
      });
      arc.style.transition = 'opacity .2s';
      arc.addEventListener('mouseenter', function (event) {
        arc.style.opacity = '0.75';
        showTooltip(
          '<div class="tooltip__row"><span class="legend__swatch" style="background:' + item.color + '"></span>' +
          '<span>' + item.label + '</span><span class="tooltip__value">' +
          Fmt.percent(fraction * 100) + '</span></div>',
          event.clientX, event.clientY - 12
        );
      });
      arc.addEventListener('mouseleave', function () { arc.style.opacity = '1'; hideTooltip(); });
      root.appendChild(arc);
      offset += fraction;
    });

    var center = Fmt.svg('text', { class: 'donut__center', x: size / 2, y: size / 2 - 2 });
    var totalText = Fmt.svg('tspan', { class: 'donut__total', x: size / 2, dy: '0' });
    totalText.textContent = options.centerValue || Fmt.fullMoney(total);
    // Точная сумма в середине кольца длиннее сокращённой — ужимаем кегль.
    if (totalText.textContent.length > 11) {
      totalText.setAttribute('class', 'donut__total donut__total--long');
    }
    var caption = Fmt.svg('tspan', { class: 'donut__caption', x: size / 2, dy: '16' });
    caption.textContent = options.centerCaption || 'всего';
    center.appendChild(totalText);
    center.appendChild(caption);
    root.appendChild(center);

    wrap.appendChild(root);

    var list = Fmt.el('div', 'donut__list');
    items.forEach(function (item) {
      var row = Fmt.el('div', 'share-row');
      var dot = Fmt.el('span', 'share-row__dot');
      dot.style.background = item.color;
      row.appendChild(dot);
      row.appendChild(Fmt.el('span', 'share-row__name', item.label));
      row.appendChild(Fmt.el('span', 'share-row__value',
        Fmt.percent(item.value / total * 100) ));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    container.appendChild(wrap);
  }

  /* --- Мини-график в карточке показателя ----------------------------------- */

  /* Круглое число не меньше заданного: 4 700 → 5 000, 57 032 → 60 000.
     По таким засечкам глаз ориентируется без наведения курсора. */
  var NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

  function niceCeil(value) {
    if (!value) return 0;
    var sign = value < 0 ? -1 : 1;
    var abs = Math.abs(value);
    var step = Math.pow(10, Math.floor(Math.log(abs) / Math.LN10));
    var ratio = abs / step;
    var nice = NICE_STEPS[NICE_STEPS.length - 1];
    for (var i = 0; i < NICE_STEPS.length; i++) {
      if (ratio <= NICE_STEPS[i]) { nice = NICE_STEPS[i]; break; }
    }
    return sign * nice * step;
  }

  /* Все засечки одной оси меряются одной меркой: «60 тыс / 30 тыс / 0»,
     а не «60 тыс / 30 000 / 0» — иначе шкала читается рывками. */
  function tickFormatter(top) {
    var abs = Math.abs(top);
    var unit = abs >= 1e6 ? 1e6 : abs >= 1e4 ? 1e3 : 1;
    var suffix = unit === 1e6 ? ' млн' : unit === 1e3 ? ' тыс' : '';
    return function (value) {
      if (!value) return '0';           // ноль остаётся нулём, без «0 тыс»
      return unit === 1 ? Fmt.number(value) : Fmt.decimal(value / unit) + suffix;
    };
  }

  /* Линия под показателем — со шкалами и разлиновкой, чтобы значение
     читалось сразу, а курсор нужен был только для точной цифры дня. */
  function sparkline(container, values, color, options) {
    if (!values || values.length < 2) return;
    // Ровная нулевая линия ничего не сообщает — лучше не рисовать вовсе.
    if (!values.some(function (value) { return value !== 0; })) return;
    var settings = options || {};

    responsive(container, function (host, width) {
      var height = 96;
      var padLeft = 46, padRight = 8, padTop = 10, padBottom = 20;
      var plotW = Math.max(width - padLeft - padRight, 10);
      var plotH = height - padTop - padBottom;

      // Область с заливкой обязана начинаться от нуля: обрезанная шкала
      // превращает колебание в обрыв и обманывает глаз.
      var top = niceCeil(Math.max.apply(null, values.concat([0])));
      var bottom = Math.min.apply(null, values.concat([0]));
      bottom = bottom < 0 ? niceCeil(bottom) : 0;
      var span = (top - bottom) || 1;
      var formatAxis = settings.formatAxis || tickFormatter(top);

      var stepX = plotW / (values.length - 1);
      var points = values.map(function (value, index) {
        return {
          x: padLeft + index * stepX,
          y: padTop + plotH - ((value - bottom) / span) * plotH
        };
      });

      var root = Fmt.svg('svg', {
        class: 'spark', viewBox: '0 0 ' + width + ' ' + height, height: height
      });

      // --- шкала Y: три засечки с разлиновкой ---
      [bottom, bottom + span / 2, top].forEach(function (tick) {
        var y = padTop + plotH - ((tick - bottom) / span) * plotH;
        root.appendChild(Fmt.svg('line', {
          class: 'spark__grid', x1: padLeft, y1: y, x2: width - padRight, y2: y
        }));
        var label = Fmt.svg('text', {
          class: 'spark__tick', x: padLeft - 8, y: y, 'text-anchor': 'end',
          'dominant-baseline': 'middle'
        });
        label.textContent = formatAxis(tick);
        root.appendChild(label);
      });

      // --- шкала X: только края и середина, чтобы не рябило ---
      var days = settings.days || [];
      if (days.length === values.length) {
        [0, Math.floor((values.length - 1) / 2), values.length - 1].forEach(
          function (index, position) {
            var label = Fmt.svg('text', {
              class: 'spark__tick', x: points[index].x, y: height - 5,
              'text-anchor': position === 0 ? 'start' : position === 1 ? 'middle' : 'end'
            });
            label.textContent = Fmt.axisLabel(days[index]);
            root.appendChild(label);
          }
        );
      }

      var gradientId = 'spark-' + Math.random().toString(36).slice(2, 8);
      var defs = Fmt.svg('defs', {});
      var gradient = Fmt.svg('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' });
      gradient.appendChild(Fmt.svg('stop', { offset: '0', 'stop-color': color, 'stop-opacity': '0.22' }));
      gradient.appendChild(Fmt.svg('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' }));
      defs.appendChild(gradient);
      root.appendChild(defs);

      var base = padTop + plotH;
      var path = smoothPath(points);
      root.appendChild(Fmt.svg('path', {
        d: path + ' L' + points[points.length - 1].x + ' ' + base +
           ' L' + points[0].x + ' ' + base + ' Z',
        fill: 'url(#' + gradientId + ')'
      }));
      root.appendChild(Fmt.svg('path', {
        d: path, fill: 'none', stroke: color, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }));

      // Курсор ведёт по линии: точка на ближайшем дне и подпись рядом.
      var marker = Fmt.svg('circle', {
        class: 'spark__marker', r: 4, cx: 0, cy: 0,
        fill: color, stroke: 'var(--surface-solid)', 'stroke-width': 2
      });
      marker.style.opacity = '0';
      var rule = Fmt.svg('line', {
        class: 'spark__rule', x1: 0, y1: padTop, x2: 0, y2: base,
        stroke: color, 'stroke-width': 1
      });
      rule.style.opacity = '0';
      root.appendChild(rule);
      root.appendChild(marker);

      root.addEventListener('mousemove', function (event) {
        var box = root.getBoundingClientRect();
        var scale = box.width / width || 1;
        var inside = (event.clientX - box.left) / scale - padLeft;
        var index = Math.max(0, Math.min(values.length - 1, Math.round(inside / stepX)));
        var point = points[index];

        marker.setAttribute('cx', point.x);
        marker.setAttribute('cy', point.y);
        marker.style.opacity = '1';
        rule.setAttribute('x1', point.x);
        rule.setAttribute('x2', point.x);
        rule.style.opacity = '0.35';

        var day = days[index];
        var text = settings.format ? settings.format(values[index]) : Fmt.fullMoney(values[index]);
        showTooltip(
          (day ? '<b>' + Fmt.momentLabel(day) + '</b><br>' : '') + text,
          event.clientX,
          box.top - 8
        );
      });
      root.addEventListener('mouseleave', function () {
        marker.style.opacity = '0';
        rule.style.opacity = '0';
        hideTooltip();
      });

      host.appendChild(root);
    });
  }

  function emptyState(text) {
    var wrap = Fmt.el('div', 'empty');
    wrap.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 3v18h18" stroke-linecap="round"/>' +
      '<path d="M7 15l3.5-4 3 2.5L20 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    wrap.appendChild(Fmt.el('span', null, text));
    return wrap;
  }

  global.Charts = {
    areaChart: areaChart,
    barChart: barChart,
    donut: donut,
    sparkline: sparkline,
    emptyState: emptyState,
    hideTooltip: hideTooltip
  };
})(window);
