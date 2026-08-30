"""Задачи по кабинету: пункт №1 — «Ответить на вопросы» Wildberries."""

import httpx
import pytest

from dashboard import connections as conn
from dashboard import db, inbox, tasks
from dashboard.config import settings
from dashboard.connectors.inbox_base import InboxItem
from dashboard.connectors.wb_inbox import WildberriesInbox


@pytest.fixture(autouse=True)
def чистая_память():
    inbox._seen.clear()
    yield
    inbox._seen.clear()


@pytest.fixture
async def кабинеты(dashboard_db):
    """Два кабинета Wildberries, как у владельца."""
    await db.init_db()
    созданные = {}
    for название, токен in (("ВБ Вячеслав", "token-slava"), ("ВБ Наталья", "token-natasha")):
        запись = await conn.create("wildberries", название)
        await conn.save_values(запись.id, {"token": токен})
        созданные[название] = запись.id
    return созданные


def вопрос(number: int, text: str) -> dict:
    return {
        "id": f"q{number}",
        "text": text,
        "userName": "Покупатель",
        "createdDate": "2026-08-30T09:00:00Z",
        "productDetails": {"productName": "Кабель", "supplierArticle": "TC-1M", "nmId": 1},
    }


def сервер(*, всего=None, страницы=None, счётчик_падает=False, список_падает=False):
    """Поддельный Wildberries: считает вопросы и отдаёт их страницами."""
    страницы = страницы or {}
    видел: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        путь = request.url.path
        видел.append({
            "path": путь,
            "take": request.url.params.get("take"),
            "skip": request.url.params.get("skip"),
            "token": request.headers.get("Authorization"),
        })

        if путь == "/api/v1/questions/count-unanswered":
            if счётчик_падает:
                return httpx.Response(500, json={})
            return httpx.Response(200, json={"data": {"countUnanswered": всего}})

        if путь == "/api/v1/questions" and request.method == "GET":
            if список_падает:
                return httpx.Response(403, json={})
            skip = int(request.url.params.get("skip") or 0)
            return httpx.Response(200, json={"data": {"questions": страницы.get(skip, [])}})

        return httpx.Response(200, json={})

    handler.видел = видел
    return handler


def подменить(monkeypatch, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesInbox, "client", client)


# --- оглавление -----------------------------------------------------------------


async def test_оглавление_даёт_кабинеты_и_их_задачи(кабинеты):
    каталог = await tasks.catalogue(settings)

    assert [place["code"] for place in каталог["marketplaces"]] == ["wildberries"]
    магазины = каталог["marketplaces"][0]["stores"]
    assert [shop["title"] for shop in магазины] == ["ВБ Вячеслав", "ВБ Наталья"]
    # Объявлена ровно одна работающая задача. Заглушек быть не должно.
    assert [task["key"] for task in магазины[0]["tasks"]] == ["questions"]


async def test_площадки_без_задач_в_оглавление_не_попадают(dashboard_db):
    """Ozon и Яндекс задач пока не объявляют — показывать их нечем."""
    await db.init_db()
    запись = await conn.create("ozon", "Ozon WAAC")
    await conn.save_values(запись.id, {"client_id": "1", "api_key": "k"})

    каталог = await tasks.catalogue(settings)
    assert каталог["marketplaces"] == []


async def test_оглавление_не_ходит_на_площадки(кабинеты, monkeypatch):
    """Оглавление — это список дел, а не работа: запросов быть не должно."""
    handler = сервер(всего=5, страницы={0: [вопрос(1, "Есть?")]})
    подменить(monkeypatch, handler)

    await tasks.catalogue(settings)
    assert handler.видел == []


# --- рабочий список -------------------------------------------------------------


async def test_список_берёт_только_свой_кабинет(кабинеты, monkeypatch):
    handler = сервер(всего=2, страницы={0: [вопрос(1, "Подойдёт?"), вопрос(2, "Длина?")]})
    подменить(monkeypatch, handler)

    работа = await tasks.load(кабинеты["ВБ Вячеслав"], "questions", config=settings)

    assert работа["accountTitle"] == "ВБ Вячеслав"
    assert работа["kind"] == "question"
    assert работа["loaded"] == 2
    assert работа["items"][0]["accountId"] == кабинеты["ВБ Вячеслав"]
    # Ходили только под токеном этого кабинета — чужой не задет.
    assert {запрос["token"] for запрос in handler.видел} == {"token-slava"}


async def test_всего_берётся_у_площадки_а_не_из_длины_страницы(кабинеты, monkeypatch):
    """Главный дефект, который чинит этот пункт: 17 вопросов на странице
    не означают, что их всего 17."""
    страница = {0: [вопрос(number, "Вопрос") for number in range(50)]}
    подменить(monkeypatch, сервер(всего=1142, страницы=страница))

    работа = await tasks.load(кабинеты["ВБ Вячеслав"], "questions", config=settings)

    assert работа["total"] == 1142        # число площадки
    assert работа["loaded"] == 50         # а показано пока столько
    assert работа["more"] is True


async def test_следующая_страница_догружается(кабинеты, monkeypatch):
    страницы = {
        0: [вопрос(number, "Первая") for number in range(50)],
        50: [вопрос(number, "Вторая") for number in range(50, 60)],
    }
    handler = сервер(всего=60, страницы=страницы)
    подменить(monkeypatch, handler)

    вторая = await tasks.load(
        кабинеты["ВБ Вячеслав"], "questions", offset=50, config=settings
    )

    assert вторая["loaded"] == 10
    assert вторая["offset"] == 50
    assert вторая["more"] is False        # пришло меньше страницы — это конец
    assert any(запрос["skip"] == "50" for запрос in handler.видел)


async def test_неизвестное_количество_не_превращается_в_ноль(кабинеты, monkeypatch):
    """Счётчик площадки может не ответить. Это «неизвестно», а не «ноль»."""
    подменить(monkeypatch, сервер(счётчик_падает=True, страницы={0: [вопрос(1, "Есть?")]}))

    работа = await tasks.load(кабинеты["ВБ Вячеслав"], "questions", config=settings)

    assert работа["total"] is None
    assert работа["loaded"] == 1
    assert работа["error"] == ""


async def test_ошибка_площадки_не_выглядит_как_пусто(кабинеты, monkeypatch):
    подменить(monkeypatch, сервер(список_падает=True))

    работа = await tasks.load(кабинеты["ВБ Вячеслав"], "questions", config=settings)

    assert работа["error"] == "нет прав в ключе"
    assert работа["items"] == []
    assert работа["total"] is None


async def test_пустой_список_это_не_ошибка(кабинеты, monkeypatch):
    подменить(monkeypatch, сервер(всего=0, страницы={0: []}))

    работа = await tasks.load(кабинеты["ВБ Вячеслав"], "questions", config=settings)

    assert работа["total"] == 0
    assert работа["items"] == []
    assert работа["error"] == ""
    assert работа["more"] is False


async def test_кабинеты_не_смешиваются(кабинеты, monkeypatch):
    """У Вячеслава и Натальи номера вопросов могут совпасть — и это не повод
    показать один вопрос вместо другого."""
    def handler(request: httpx.Request) -> httpx.Response:
        путь = request.url.path
        чей = request.headers.get("Authorization")
        if путь == "/api/v1/questions/count-unanswered":
            return httpx.Response(200, json={"data": {"countUnanswered": 1}})
        текст = "Вопрос Вячеслава" if чей == "token-slava" else "Вопрос Натальи"
        # Один и тот же номер q1 в обоих кабинетах.
        return httpx.Response(200, json={"data": {"questions": [вопрос(1, текст)]}})

    подменить(monkeypatch, handler)

    у_славы = await tasks.load(кабинеты["ВБ Вячеслав"], "questions", config=settings)
    у_наташи = await tasks.load(кабинеты["ВБ Наталья"], "questions", config=settings)

    assert у_славы["items"][0]["text"] == "Вопрос Вячеслава"
    assert у_наташи["items"][0]["text"] == "Вопрос Натальи"

    # И память помощника их тоже различает.
    assert inbox.find(кабинеты["ВБ Вячеслав"], "question", "q1").text == "Вопрос Вячеслава"
    assert inbox.find(кабинеты["ВБ Наталья"], "question", "q1").text == "Вопрос Натальи"


async def test_неизвестная_задача_отвергается(кабинеты, monkeypatch):
    подменить(monkeypatch, сервер(всего=0, страницы={0: []}))
    with pytest.raises(LookupError):
        await tasks.load(кабинеты["ВБ Вячеслав"], "собрать-заказ", config=settings)


async def test_неизвестный_кабинет_отвергается(кабинеты):
    with pytest.raises(LookupError):
        await tasks.load("нет-такого", "questions", config=settings)


async def test_слишком_глубокая_страница_отвергается(кабинеты, monkeypatch):
    подменить(monkeypatch, сервер(всего=0, страницы={0: []}))
    with pytest.raises(ValueError):
        await tasks.load(
            кабинеты["ВБ Вячеслав"], "questions",
            offset=tasks.PAGE * tasks.MAX_PAGES + 1, config=settings,
        )


# --- общая память двух экранов --------------------------------------------------


async def test_загрузка_одного_экрана_не_стирает_другой(кабинеты, monkeypatch):
    """Обязательная проверка архитектора: открыли Вячеслава во «Входящих»,
    затем Наталью в «Задачах» — черновик для Вячеслава обязан остаться
    правильным. И наоборот."""
    def handler(request: httpx.Request) -> httpx.Response:
        путь = request.url.path
        чей = request.headers.get("Authorization")
        if путь.endswith("/count-unanswered"):
            return httpx.Response(200, json={"data": {"countUnanswered": 1}})
        if путь == "/api/v1/questions" and request.method == "GET":
            текст = "Вопрос Вячеслава" if чей == "token-slava" else "Вопрос Натальи"
            return httpx.Response(200, json={"data": {"questions": [вопрос(1, текст)]}})
        if путь == "/api/v1/feedbacks":
            return httpx.Response(200, json={"data": {"feedbacks": []}})
        if путь == "/api/v1/claims":
            return httpx.Response(200, json={"claims": []})
        return httpx.Response(200, json={})

    подменить(monkeypatch, handler)

    # Экран «Входящие» — оба кабинета сразу.
    await inbox.collect(settings)
    assert inbox.find(кабинеты["ВБ Вячеслав"], "question", "q1") is not None

    # Экран «Задачи» — только Наталья.
    await tasks.load(кабинеты["ВБ Наталья"], "questions", config=settings)

    # Вячеслав обязан остаться в памяти и с правильным текстом.
    слава = inbox.find(кабинеты["ВБ Вячеслав"], "question", "q1")
    наташа = inbox.find(кабинеты["ВБ Наталья"], "question", "q1")
    assert слава is not None and слава.text == "Вопрос Вячеслава"
    assert наташа is not None and наташа.text == "Вопрос Натальи"

    # И в обратную сторону: новый сбор «Входящих» не портит «Задачи».
    await inbox.collect(settings)
    assert inbox.find(кабинеты["ВБ Наталья"], "question", "q1").text == "Вопрос Натальи"


def test_одинаковые_номера_в_разных_кабинетах_не_путаются():
    """Номер обращения уникален только внутри кабинета."""
    inbox.remember([
        InboxItem(kind="question", id="42", text="У Вячеслава",
                  account_id="wb1", marketplace="wildberries"),
        InboxItem(kind="question", id="42", text="У Натальи",
                  account_id="wb2", marketplace="wildberries"),
    ])

    assert inbox.find("wb1", "question", "42").text == "У Вячеслава"
    assert inbox.find("wb2", "question", "42").text == "У Натальи"


def test_ответ_убирает_из_памяти_только_своё():
    inbox.remember([
        InboxItem(kind="question", id="42", text="У Вячеслава",
                  account_id="wb1", marketplace="wildberries"),
        InboxItem(kind="question", id="42", text="У Натальи",
                  account_id="wb2", marketplace="wildberries"),
    ])

    inbox.forget("wb1", "question", "42", "wildberries")

    assert inbox.find("wb1", "question", "42") is None
    assert inbox.find("wb2", "question", "42") is not None


def test_память_не_растёт_бесконечно(monkeypatch):
    """Это короткая память, а не вторая база данных."""
    monkeypatch.setattr(inbox, "MEMORY_LIMIT", 10)
    inbox.remember([
        InboxItem(kind="question", id=str(number), text=f"Вопрос {number}",
                  account_id="wb1", marketplace="wildberries")
        for number in range(25)
    ])

    assert len(inbox._seen) == 10
    # Вытесняются самые давние, свежие остаются.
    assert inbox.find("wb1", "question", "24") is not None
    assert inbox.find("wb1", "question", "0") is None
