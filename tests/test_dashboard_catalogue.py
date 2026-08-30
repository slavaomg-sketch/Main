"""Сбор каталога: полный список родителей из карточек кабинета."""

import asyncio

import httpx
import pytest

from dashboard import catalogue, db, knowledge
from dashboard import connections as conn
from dashboard.config import settings
from dashboard.connectors.wb_catalogue import WildberriesCatalogue


@pytest.fixture
async def кабинет(dashboard_db):
    await db.init_db()
    создан = await conn.create("wildberries", "ВБ Вячеслав")
    await conn.save_values(создан.id, {"token": "token-slava"})
    return создан.id


@pytest.fixture(autouse=True)
def чистый_сбор():
    catalogue._run = None
    yield
    catalogue._run = None


def карточка(article: str, title: str = "") -> dict:
    return {"vendorCode": article, "title": title, "subjectName": "Кабель", "brand": "UA"}


def сервер(страницы: list[list[dict]]):
    """Поддельная площадка: отдаёт карточки страницами по курсору."""
    выдано = {"n": 0}
    видел: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        видел.append(request.url.path)
        номер = выдано["n"]
        выдано["n"] += 1
        карточки = страницы[номер] if номер < len(страницы) else []
        return httpx.Response(200, json={
            "cards": карточки,
            "cursor": {"updatedAt": f"2026-08-30T0{номер}:00:00Z",
                       "nmID": 1000 + номер, "total": len(карточки)},
        })

    handler.видел = видел
    return handler


def подменить(monkeypatch, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesCatalogue, "client", client)


async def дождаться() -> None:
    for _ in range(200):
        if catalogue._run and catalogue._run.finished:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("сбор не закончился")


async def test_карточки_сходятся_в_родителей(кабинет, monkeypatch):
    """Тысяча карточек одного кабеля — это один товар в справочнике."""
    подменить(monkeypatch, сервер([[
        карточка("CAB-(UA-TC-1M-WH)-SAMSUNG-S24", "Кабель для Samsung S24"),
        карточка("CAB-(UA-TC-1M-WH)-TECNO-SPARKGO3", "Кабель для Tecno"),
        карточка("CAB-(UA-TC-2M-BK)-XIAOMI", "Кабель 2 м для Xiaomi"),
    ]]))

    catalogue.start(settings)
    await дождаться()

    все = await knowledge.all_parents()
    коды = {item.parent: item for item in все}
    assert set(коды) == {"UA-TC-1M-WH", "UA-TC-2M-BK"}
    assert коды["UA-TC-1M-WH"].cards == 2
    assert коды["UA-TC-2M-BK"].cards == 1
    # Имя площадки помогает узнать товар в лицо.
    assert коды["UA-TC-1M-WH"].sample == "Кабель для Samsung S24"


async def test_страницы_дочитываются_до_конца(кабинет, monkeypatch):
    полная = [карточка(f"CAB-(P{number})-X") for number in range(100)]
    хвост = [карточка("CAB-(ХВОСТ)-Y")]
    handler = сервер([полная, хвост])
    подменить(monkeypatch, handler)

    catalogue.start(settings)
    await дождаться()

    assert catalogue._run.cards == 101
    assert len(handler.видел) == 2      # вторая страница была запрошена
    assert await knowledge.get("ХВОСТ") is not None


async def test_сбор_не_затирает_написанное_владельцем(кабинет, monkeypatch):
    """Название и справку пишет человек — пересбор их не трогает."""
    await knowledge.save("UA-TC-1M-WH", "Кабель Type-C 1 м, белый", "До 60 Вт.")

    подменить(monkeypatch, сервер([[карточка("CAB-(UA-TC-1M-WH)-SAMSUNG", "Другое имя")]]))
    catalogue.start(settings)
    await дождаться()

    снова = await knowledge.get("UA-TC-1M-WH")
    assert снова.title == "Кабель Type-C 1 м, белый"
    assert снова.facts == "До 60 Вт."
    assert снова.cards == 1


async def test_отказ_кабинета_не_роняет_сбор(кабинет, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={})

    подменить(monkeypatch, handler)
    catalogue.start(settings)
    await дождаться()

    assert catalogue._run.errors == {"ВБ Вячеслав": "нет прав в ключе"}
    assert catalogue._run.finished is True


async def test_повторный_запуск_не_плодит_второй_сбор(кабинет, monkeypatch):
    подменить(monkeypatch, сервер([[карточка("CAB-(A)-X")]]))

    первый = catalogue.start(settings)
    второй = catalogue.start(settings)
    assert первый["startedAt"] == второй["startedAt"]
    await дождаться()


async def test_товары_с_названием_уходят_вниз(кабинет, monkeypatch):
    """Сверху — то, что ещё не описано, и самое ходовое из этого."""
    подменить(monkeypatch, сервер([[
        карточка("CAB-(МНОГО)-1"), карточка("CAB-(МНОГО)-2"), карточка("CAB-(МНОГО)-3"),
        карточка("CAB-(МАЛО)-1"),
        карточка("CAB-(ОПИСАН)-1"), карточка("CAB-(ОПИСАН)-2"),
    ]]))
    catalogue.start(settings)
    await дождаться()
    await knowledge.save("ОПИСАН", "Уже описан", "")

    порядок = [item.parent for item in await knowledge.all_parents()]
    assert порядок == ["МНОГО", "МАЛО", "ОПИСАН"]


# --- ошибки, найденные на настоящем кабинете ------------------------------------


async def test_обход_кончается_по_короткой_странице(кабинет, monkeypatch):
    """Площадка присылала в курсоре поле total не в том смысле, в каком его
    понимала панель, и обход не заканчивался: 233 страницы за восемь минут.
    Признак конца теперь фактический — пришло меньше, чем просили."""
    полная = [карточка(f"CAB-(P{number})-X") for number in range(100)]
    короткая = [карточка("CAB-(КОНЕЦ)-Y")]

    страницы = {"n": 0}
    видел: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        номер = страницы["n"]
        страницы["n"] += 1
        видел.append(номер)
        карточки = полная if номер == 0 else короткая
        # Площадка настойчиво отдаёт большое total — раньше это зациклило бы.
        return httpx.Response(200, json={
            "cards": карточки,
            "cursor": {"updatedAt": f"2026-08-30T0{номер}:00:00Z",
                       "nmID": 500 + номер, "total": 9999},
        })

    подменить(monkeypatch, handler)
    catalogue.start(settings)
    await дождаться()

    assert len(видел) == 2      # вторая страница короткая — на ней и встали


async def test_застрявший_курсор_не_вешает_обход(кабинет, monkeypatch):
    """Если площадка перестала двигать курсор, следующая страница повторит
    эту. Это тоже конец, а не повод ходить кругами."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "cards": [карточка(f"CAB-(P{number})-X") for number in range(100)],
            "cursor": {"updatedAt": "стоит-на-месте", "nmID": 1, "total": 100},
        })

    подменить(monkeypatch, handler)
    catalogue.start(settings)
    await дождаться()

    # Два запроса: первый и повтор, на котором заметили, что курсор тот же.
    assert catalogue._run.pages == 2


async def test_имя_площадки_не_занимает_поле_владельца(кабинет, monkeypatch):
    """Название товара пишет владелец. Имя карточки с площадки — подсказка,
    и лежит оно отдельно."""
    подменить(monkeypatch, сервер([[
        карточка("CAB-(UA-TC-1M-WH)-SAMSUNG", "Зарядка для Vivo T1 быстрая блок питания"),
    ]]))
    catalogue.start(settings)
    await дождаться()

    товар = await knowledge.get("UA-TC-1M-WH")
    assert товар.title == ""                      # владелец ещё не называл
    assert товар.to_dict()["named"] is False      # и экран это покажет
    assert "Зарядка для Vivo T1" in товар.sample


async def test_повторный_сбор_не_удваивает_счётчик(кабинет, monkeypatch):
    подменить(monkeypatch, сервер([[
        карточка("CAB-(ОДИН)-A"), карточка("CAB-(ОДИН)-B"),
    ]]))
    catalogue.start(settings)
    await дождаться()
    assert (await knowledge.get("ОДИН")).cards == 2

    catalogue._run = None
    подменить(monkeypatch, сервер([[
        карточка("CAB-(ОДИН)-A"), карточка("CAB-(ОДИН)-B"),
    ]]))
    catalogue.start(settings)
    await дождаться()

    assert (await knowledge.get("ОДИН")).cards == 2


async def test_карточки_считаются_через_несколько_страниц(кабинет, monkeypatch):
    """Один товар может встретиться и на первой странице, и на пятой."""
    первая = [карточка("CAB-(ОДИН)-A")] + [карточка(f"CAB-(P{n})-X") for n in range(99)]
    вторая = [карточка("CAB-(ОДИН)-B")]
    подменить(monkeypatch, сервер([первая, вторая]))

    catalogue.start(settings)
    await дождаться()

    assert (await knowledge.get("ОДИН")).cards == 2
