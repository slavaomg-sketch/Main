#!/usr/bin/env node
'use strict';
/* Рендерит docs/plan-100.json в документ dist/plan.html (готов к публикации Артефактом). */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var plan = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'plan-100.json'), 'utf8'));

var levelDir = path.join(root, 'levels');
var builtIds = {};
fs.readdirSync(levelDir).filter(function (f) { return /^\d+\.txt$/.test(f); })
  .forEach(function (f) { builtIds[parseInt(f, 10)] = true; });

var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
var hue = function (n) { return 210 + (n - 1) * 19; };

var chapters = plan.chapters.map(function (c) {
  var rows = c.levels.map(function (l, i) {
    var num = (c.n - 1) * 10 + i + 1;
    var tags = l[2].map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
    var done = builtIds[num];
    return '<tr class="' + (done ? 'built' : '') + '"><td class="num">' + num + '</td>' +
           '<td class="lname">' + (done ? '<b class="ok">✓</b> ' : '') + esc(l[0]) + '</td>' +
           '<td class="idea">' + esc(l[1]) + '</td><td class="tags">' + tags + '</td></tr>';
  }).join('\n');
  var cbuilt = c.levels.filter(function (l, i) { return builtIds[(c.n - 1) * 10 + i + 1]; }).length;
  var novelty = c.new.length
    ? '<p class="new">Новое в движке: ' + c.new.map(function (x) { return '<b>' + esc(x) + '</b>'; }).join(', ') + '</p>'
    : '';
  return '<section class="chapter" style="--hue:' + hue(c.n) + '" id="ch' + c.n + '">' +
    '<header class="chead">' +
      '<span class="cnum">Глава ' + c.n + '</span>' +
      '<h3>' + esc(c.title) + '</h3>' +
      '<span class="crange">уровни ' + esc(c.range) + '</span>' +
      '<span class="cbuilt' + (cbuilt === c.levels.length ? ' full' : '') + '">' +
        (cbuilt ? 'собрано ' + cbuilt + '/' + c.levels.length : 'не начата') + '</span>' +
      '<span class="cdiff" title="Сложность главы"><i style="--w:' + (c.difficulty * 10) + '%"></i>' + c.difficulty + '/10</span>' +
    '</header>' +
    '<p class="teaches">' + esc(c.teaches) + '</p>' + novelty +
    '<table class="levels"><tbody>' + rows + '</tbody></table>' +
  '</section>';
}).join('\n');

var navLinks = plan.chapters.map(function (c) {
  return '<a href="#ch' + c.n + '" style="--hue:' + hue(c.n) + '"><b>' + c.n + '</b> ' + esc(c.title) + '</a>';
}).join('');

var html = `<title>Сто уровней «Инфотрона»</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap&subset=cyrillic,latin">
<style>
:root{
  --ground:#0a0e17; --panel:#111828; --panel2:#161f33; --line:#26314b;
  --text:#dde5f5; --dim:#8d9ab8; --dimmer:#66718d;
  --amber:#ffb02e; --green:#4dff9f; --red:#ff6b6b;
  --sans:"IBM Plex Sans",-apple-system,"Segoe UI",Roboto,sans-serif;
  --cond:"IBM Plex Sans Condensed","IBM Plex Sans",-apple-system,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--text);font:16px/1.62 var(--sans);
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto;padding:0 20px 96px}
.prose{max-width:70ch}
h1,h2,h3{font-family:var(--cond);font-weight:700;text-wrap:balance;margin:0}
a{color:var(--amber)}

header.top{padding:56px 0 34px;border-bottom:1px solid var(--line);margin-bottom:38px}
.kicker{font-family:var(--mono);font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:14px}
h1{font-size:clamp(32px,6vw,52px);line-height:1.04;letter-spacing:-.015em}
.lede{margin:16px 0 0;color:var(--dim);font-size:18px;max-width:62ch}
.meta{margin-top:22px;display:flex;flex-wrap:wrap;gap:8px}
.pill{font-family:var(--mono);font-size:12.5px;color:var(--dim);border:1px solid var(--line);
  background:var(--panel);border-radius:999px;padding:4px 11px}
.pill b{color:var(--text);font-weight:500}

h2{font-size:26px;margin:52px 0 6px;letter-spacing:-.01em}
h2 .no{font-family:var(--mono);font-size:14px;color:var(--dimmer);font-weight:400;margin-right:10px;letter-spacing:0}
.sub{color:var(--dim);margin:0 0 20px}
p{margin:0 0 14px}
ul{margin:0 0 16px;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:11px}
ul li{padding-left:20px;position:relative;color:var(--dim)}
ul li::before{content:"";position:absolute;left:4px;top:.62em;width:6px;height:6px;border-radius:2px;background:var(--line)}
ul li b,ul li strong{color:var(--text);font-weight:600}
em{color:var(--text);font-style:normal;border-bottom:1px dotted var(--dimmer)}

.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:16px}
.card h4{font-family:var(--cond);font-size:17px;margin:0 0 6px}
.card p{color:var(--dim);margin:0;font-size:15px}

table.spec{width:100%;border-collapse:collapse;font-size:15px;margin-bottom:8px}
table.spec th{text-align:left;font-family:var(--mono);font-weight:500;font-size:12px;letter-spacing:.09em;
  text-transform:uppercase;color:var(--dimmer);padding:0 10px 8px 0;border-bottom:1px solid var(--line)}
table.spec td{padding:11px 10px 11px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--dim)}
table.spec td:first-child{color:var(--text);font-weight:600;white-space:nowrap}
.cost{font-family:var(--mono);font-size:12.5px;white-space:nowrap}
.cost.s{color:var(--green)} .cost.m{color:var(--amber)} .cost.l{color:var(--red)}

nav.chapters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin:0 0 30px}
nav.chapters a{display:flex;gap:8px;align-items:baseline;text-decoration:none;color:var(--dim);font-size:14px;
  border:1px solid var(--line);border-left:3px solid hsl(var(--hue) 70% 58%);border-radius:8px;padding:8px 11px;background:var(--panel)}
nav.chapters a:hover{background:var(--panel2);color:var(--text)}
nav.chapters a b{font-family:var(--mono);color:hsl(var(--hue) 70% 62%)}

.chapter{margin:0 0 26px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--panel)}
.chead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:15px 18px;
  background:linear-gradient(90deg,hsl(var(--hue) 55% 22%),var(--panel2) 70%);border-bottom:1px solid var(--line)}
.cnum{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:hsl(var(--hue) 80% 72%)}
.chead h3{font-size:21px}
.crange{font-family:var(--mono);font-size:12.5px;color:var(--dimmer)}
.cbuilt{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--dimmer);
  border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.cbuilt.full{color:var(--green);border-color:#2c6b4c}
.cdiff{font-family:var(--mono);font-size:12px;color:var(--dim);display:flex;align-items:center;gap:8px}
.cdiff i{display:block;width:76px;height:5px;border-radius:3px;background:var(--line);position:relative}
.cdiff i::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);border-radius:3px;background:hsl(var(--hue) 75% 58%)}
.teaches{padding:13px 18px 0;margin:0;color:var(--dim);font-size:15px}
.new{padding:6px 18px 0;margin:0;color:var(--dim);font-size:14px}
.new b{color:hsl(var(--hue) 80% 70%);font-weight:600}

table.levels{width:100%;border-collapse:collapse;margin-top:12px;font-size:15px}
table.levels td{padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}
td.num{font-family:var(--mono);font-size:13px;color:var(--dimmer);width:44px;text-align:right;
  font-variant-numeric:tabular-nums;padding-left:18px}
td.lname{font-weight:600;white-space:nowrap;width:1%}
td.idea{color:var(--dim)}
td.tags{width:1%;white-space:nowrap;padding-right:18px;text-align:right}
tr.built td.lname{color:var(--text)}
tr.built td.idea{color:var(--dim)}
tr:not(.built) td.lname{color:var(--dim);font-weight:500}
tr:not(.built) td.idea{color:var(--dimmer)}
b.ok{color:var(--green);font-weight:700;margin-right:2px}
.tag{display:inline-block;font-family:var(--mono);font-size:11px;color:var(--dimmer);
  border:1px solid var(--line);border-radius:5px;padding:1px 6px;margin-left:4px}

.q{border-left:3px solid var(--amber);background:var(--panel);border-radius:0 10px 10px 0;padding:14px 18px;margin:0 0 12px}
.q h4{font-family:var(--cond);font-size:17px;margin:0 0 5px}
.q p{margin:0;color:var(--dim);font-size:15px}
.q .opts{margin-top:9px;display:flex;flex-direction:column;gap:5px}
.q .opts span{font-size:14.5px;color:var(--dim)}
.q .opts b{color:var(--text);font-weight:600}

footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);color:var(--dimmer);font-size:14px}
@media (max-width:640px){
  td.lname{white-space:normal}
  td.tags{display:none}
  .cdiff{margin-left:0}
}
</style>

<div class="wrap">
<header class="top">
  <div class="kicker">Сценарий · утверждён · в работе</div>
  <h1>Сто уровней «Инфотрона»</h1>
  <p class="lede">Из чего складывается интерес в такой игре, что для ста уровней нужно
  добавить в движок, и весь список — десять глав по десять уровней, у каждого своя мысль.</p>
  <div class="meta">
    <span class="pill">Собрано: <b>${Object.keys(builtIds).length} из 100</b></span>
    <span class="pill">Глава 1: <b>готова</b></span>
    <span class="pill">Новых механик: <b>6</b></span>
    <span class="pill">Поставка: <b>по главам</b></span>
  </div>
</header>

<div class="prose">

<h2><span class="no">01</span>Что уже работает</h2>
<p class="sub">Инвентарь на сегодня — от него и пляшем.</p>
<p>Мир пошаговый и полностью детерминированный: грунт, зонк, инфотрон, шлюз, чип,
односторонние порты, снипснаки и электроны, оранжевые диски, цепные взрывы, «снап»,
качание камня перед срывом. Первая глава собрана целиком, и каждый уровень проверяется
автоматически: для каждого записана реальная последовательность ходов, и тест её проигрывает.</p>
<p>Этого словаря хватает уровней на тридцать. Дальше начнётся самоповтор —
поэтому в плане есть шесть новых элементов, и появляются они не сразу, а тогда,
когда старые темы исчерпаны.</p>

<h2><span class="no">02</span>Отчего такая игра держит</h2>
<p class="sub">Пять пружин. Каждый уровень в списке ниже крутит хотя бы одну из них.</p>
<ul>
  <li><b>Необратимость.</b> Зонк толкается только вперёд. Толкнул не туда — уровень
  окончен, хотя ты ещё ходишь. Это главный источник напряжения: цена хода видна заранее.</li>
  <li><b>Полная информация.</b> Карта видна целиком, случайности нет. Проиграл — значит
  не подумал, а не «не повезло». Отсюда право автора делать уровни жёсткими.</li>
  <li><b>Два разных темпа.</b> Думаешь сколько угодно, но выполняешь по секундам:
  камень качается четыре тика, патруль идёт по кругу. Голова и руки нагружаются по очереди.</li>
  <li><b>Дефицит.</b> Инфотронов ровно столько, сколько нужно; зонк, годный для подрыва, один.
  Каждый предмет на карте — ресурс, а не декорация.</li>
  <li><b>Последствия по цепочке.</b> Одно действие вызывает обвал, обвал — взрыв,
  взрыв — новые инфотроны. Приятнее всего то, что игрок запустил сам.</li>
</ul>

<h2><span class="no">03</span>Договор честности</h2>
<p class="sub">Правила, которым обязан подчиняться каждый из ста уровней. Это не пожелания, а условия приёмки.</p>
<ul>
  <li><b>У смерти всегда есть предупреждение.</b> Камень качается, монстр виден с маршрута,
  радиус взрыва предсказуем. Смерть из ниоткуда — брак уровня, а не сложность.</li>
  <li><b>Тупик виден до того, как в него попал.</b> Если ход делает уровень непроходимым,
  это должно читаться заранее. Уровень, который тихо становится нерешаемым за двадцать ходов
  до конца, переделывается.</li>
  <li><b>Одна мысль на уровень.</b> В списке у каждого своя строчка-идея. Если идею
  не удаётся сформулировать одной фразой, уровня не будет.</li>
  <li><b>Решение существует и проверено машиной.</b> Не «кажется проходимо», а записанная
  последовательность ходов, которую гоняет тест.</li>
  <li><b>Рестарт мгновенный.</b> Цена ошибки — секунда, а не минута. Иначе жёсткость
  превращается в занудство.</li>
</ul>

<h2><span class="no">04</span>Размер и плотность</h2>
<p class="sub">Первая глава показала главную ошибку: уровни были вчетверо мельче оригинальных
и оттого проходились без единой мысли. Это условие приёмки наравне с честностью.</p>
<p>Оригинальный Supaplex — 60×24, то есть 1440 клеток, плотно набитых. Мои первые уровни
были на 300 клеток с тремя-шестью инфотронами: игрок ходил где хотел, потому что вокруг
был сплошной пустой грунт. Дальше — так:</p>
<table class="spec">
  <thead><tr><th>Параметр</th><th>Норма</th><th>Зачем</th></tr></thead>
  <tbody>
    <tr><td>Размер</td><td class="cost m">от 40×20 до 60×24</td><td>Уровень должен быть путешествием, а не комнатой. Камера и так ездит за Мёрфи.</td></tr>
    <tr><td>Инфотроны</td><td class="cost m">20–40, собрать 70–90 %</td><td>Заставляет обойти всю карту; запас прощает одну потерю, но не три.</td></tr>
    <tr><td>Зонки</td><td class="cost m">от 25 и гуще к концу</td><td>Копать становится опасно везде, а не в одном отведённом месте.</td></tr>
    <tr><td>Открытый грунт</td><td class="cost m">не больше трети</td><td>Залы делятся стенами с узкими проходами — иначе маршрут не вынужденный и головоломки нет.</td></tr>
  </tbody>
</table>
<p>Исключение — первые три уровня: они обучающие и остаются маленькими нарочно.
Всё остальное живёт по этой норме, включая уже собранное — оно будет переделано.</p>

<h2><span class="no">05</span>Что придётся добавить в движок</h2>
<p class="sub">Шесть элементов. Порядок совпадает с порядком глав — каждый появляется ровно тогда, когда нужен.</p>
<table class="spec">
  <thead><tr><th>Элемент</th><th>Что даёт игре</th><th>Работа</th></tr></thead>
  <tbody>
    <tr><td>Жук</td><td>Неподвижная, но мигающая угроза: тайминг без беготни монстра. Дешёвый способ сделать коридор опасным.</td><td class="cost s">небольшая</td></tr>
    <tr><td>Жёлтый диск</td><td>Толкается в любую сторону и не падает — единственный предмет, которым можно двигать вверх. Открывает настоящий сокобан.</td><td class="cost s">небольшая</td></tr>
    <tr><td>Терминал</td><td>Кнопка, подрывающая все жёлтые диски разом. Появляется глагол «сначала расставь, потом взорви».</td><td class="cost m">средняя</td></tr>
    <tr><td>Красный диск</td><td>Заряд, который Мёрфи носит с собой и кладёт. Первый предмет в руках игрока, а не на карте.</td><td class="cost m">средняя</td></tr>
    <tr><td>Гравитация для Мёрфи</td><td>В зонах тяжести падает и сам игрок: спуск становится односторонним, зонк — подставкой. Это как в оригинальном Supaplex.</td><td class="cost l">крупная</td></tr>
    <tr><td>Гравипорт</td><td>Переключает тяжесть по ходу маршрута. Без него предыдущий пункт — просто режим уровня.</td><td class="cost s">небольшая</td></tr>
  </tbody>
</table>
<p>Плюс к этому — то, чего требует уже сам объём: выбор уровня по главам с прогрессом,
статистика по ходам и запись собственного прохождения (об этом ниже).</p>

<h2><span class="no">06</span>Структура: десять глав по десять</h2>
<p class="sub">Внутри главы сложность растёт, на стыке глав — падает. Новая тема всегда начинается с лёгкого уровня, иначе она не читается.</p>
<p>Каждая глава устроена одинаково: один-два обучающих уровня, пять-шесть основных,
один-два трудных и финал. Финал главы не вводит ничего нового — он проверяет,
понял ли игрок тему.</p>
<p>Двенадцать существующих уровней переезжают в новую нумерацию по своим главам
и частично переделываются под этот темп: «Пирамида» — в первую, «Толкач» — во вторую,
«Патруль» — в четвёртую, и так далее.</p>

<h2><span class="no">07</span>Сто уровней</h2>
<p class="sub">Название, мысль уровня и механики, на которых он держится.</p>
</div>

<nav class="chapters">${navLinks}</nav>
${chapters}

<div class="prose">
<h2><span class="no">08</span>Как это будет проверяться</h2>
<p>Сто уровней вручную не проверить — глаз замыливается на десятом. Поэтому проверка машинная,
и она уже работает: у каждого уровня есть записанное прохождение, тест его проигрывает,
и любая правка физики, которая ломает уровень, всплывает сразу.</p>
<ul>
  <li><b>Автопилот</b> сам находит решение там, где уровень сводится к «дойти и собрать»:
  ищет путь волной, толкает камни, лезет в односторонние порты в последнюю очередь и отбраковывает
  ходы, ведущие к смерти в ближайшие тики. Это примерно две трети плана.</li>
  <li><b>Уровни-ловушки</b> — подрывы, тайминг, дистанционные заряды — автопилот не осилит,
  для них решение записывается вручную через отладчик. Это самая трудоёмкая часть работы,
  и она честно заложена в сроки.</li>
  <li><b>Запись прохождения из игры.</b> Добавлю в игру скрытую команду: пройти уровень руками
  и получить строку ходов. Тогда и ты сможешь записать эталон для своего уровня.</li>
</ul>

<h2><span class="no">09</span>Как поставлять</h2>
<p>Предлагаю выпускать по главе. Глава — это законченный десяток с новой темой:
я собираю, проверяю, публикую по той же ссылке, ты играешь и говоришь, что не так,
и это влияет на следующую главу. Одним куском на сто уровней делать не стоит:
если темп или сложность окажутся не те, переделывать придётся всё.</p>
<p>Первые три главы соберутся быстро — большая часть механик уже есть.
Главы с новыми элементами (4, 7, 8) идут дольше: сперва движок, потом уровни.
Глава 8 — самая дорогая: падение самого Мёрфи затрагивает всю физику перемещения,
и её разумно делать последней, уже после девятой и десятой.</p>

<h2><span class="no">10</span>Что решено</h2>
<p class="sub">Развилки, которые уже пройдены — здесь для памяти.</p>
<ul>
  <li><b>Гравитация для Мёрфи — делаем</b>, как в оригинале. Глава 8 про невесомость остаётся.</li>
  <li><b>Жёсткость — как в оригинале.</b> Только рестарт, никаких откатов и поблажек.</li>
  <li><b>Уровни — смешанно.</b> Идейные вручную, «пейзажные» отбираются из сгенерированных:
  генератор выдаёт карту, автопилот доказывает проходимость, я отбираю удачные.</li>
  <li><b>Прогресс сброшен</b> при переходе на стоуровневую нумерацию.</li>
</ul>

<footer>
  Документ собирается из <span style="font-family:var(--mono)">docs/plan-100.json</span> —
  после утверждения он же станет чек-листом реализации.
</footer>
</div>
</div>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'plan.html'), html);
var total = plan.chapters.reduce(function (a, c) { return a + c.levels.length; }, 0);
console.log('dist/plan.html — глав ' + plan.chapters.length + ', уровней ' + total +
  ', ' + (fs.statSync(path.join(root, 'dist', 'plan.html')).size / 1024).toFixed(0) + ' КБ');
