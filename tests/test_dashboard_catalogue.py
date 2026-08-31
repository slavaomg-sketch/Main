"""Сбор каталога: полный список родителей из карточек кабинета."""

import asyncio
import json

import httpx
import pytest

from dashboard import catalogue, db, knowledge, products
from dashboard import connections as conn
from dashboard.config import settings
from dashboard.connectors import ozon_catalogue
from dashboard.connectors.ozon_catalogue import OzonCatalogue
from dashboard.connectors.wb_catalogue import WildberriesCatalogue
from dashboard.connectors.yandex_catalogue import YandexCatalogue


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


# --- Ozon и Яндекс: те же товары, но каждый кабинет отдельно --------------------


@pytest.fixture
async def кабинет_озон(dashboard_db):
    await db.init_db()
    создан = await conn.create("ozon", "Озон Вячеслав")
    await conn.save_values(создан.id, {"client_id": "111", "api_key": "ozon-key"})
    return создан.id


@pytest.fixture
async def кабинет_яндекс(dashboard_db):
    await db.init_db()
    создан = await conn.create("yandex", "Яндекс Вячеслав")
    await conn.save_values(создан.id, {"api_key": "ya-key", "campaign_id": "123", "business_id": "777"})
    return создан.id


def подменить_класс(monkeypatch, класс, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(класс, "client", client)


def озон_сервер(страницы: list[list[dict]], подробности: bool = True):
    """Поддельный Ozon: список товаров листается по last_id, подробности
    добираются вторым методом."""
    выдано = {"n": 0}
    видел: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        видел.append(request.url.path)
        if request.url.path == ozon_catalogue.PRODUCT_INFO:
            if not подробности:
                return httpx.Response(404, json={})
            номера = json.loads(request.content)["product_id"]
            return httpx.Response(200, json={"items": [
                {
                    "offer_id": f"CAB-(P{number - 900000})-X",
                    "name": f"Кабель {number - 900000}",
                    "type_name": "Кабель",
                    "primary_image": f"https://ozon/{number}-main.jpg",
                    "images": [f"https://ozon/{number}-2.jpg"],
                }
                for number in номера
            ]})

        номер = выдано["n"]
        выдано["n"] += 1
        товары = страницы[номер] if номер < len(страницы) else []
        return httpx.Response(200, json={"result": {
            "items": товары,
            "last_id": f"курсор-{номер}" if товары else "",
        }})

    handler.видел = видел
    return handler


def товар_озон(number: int) -> dict:
    return {"offer_id": f"CAB-(P{number})-X", "product_id": 900000 + number}


async def test_озон_собирается_отдельным_кабинетом(кабинет_озон, monkeypatch):
    monkeypatch.setattr(ozon_catalogue, "PAGE", 2)
    подменить_класс(monkeypatch, OzonCatalogue,
                    озон_сервер([[товар_озон(1), товар_озон(2)], [товар_озон(3)]]))

    catalogue.start(settings)
    await дождаться()

    assert catalogue._run.cards == 3
    карточки = await products.cards_of("P1", account_id=кабинет_озон)
    assert карточки["total"] == 1
    одна = карточки["cards"][0]
    assert одна["marketplace"] == "ozon"
    assert одна["platformId"] == "900001"
    assert одна["title"] == "Кабель 1"
    assert одна["photoCount"] == 2
    assert одна["subject"] == "Кабель"


async def test_озон_собирается_без_подробностей(кабинет_озон, monkeypatch):
    """Метод с названиями и картинками может не ответить. Список товаров и
    родители всё равно должны собраться: пустая картинка лучше сорванного сбора."""
    подменить_класс(monkeypatch, OzonCatalogue,
                    озон_сервер([[товар_озон(1), товар_озон(2)]], подробности=False))

    catalogue.start(settings)
    await дождаться()

    assert catalogue._run.errors == {}
    assert catalogue._run.cards == 2
    assert await knowledge.get("P1") is not None


async def test_номера_озона_не_путаются_с_номерами_вб(кабинет_озон, monkeypatch):
    """У площадок номера свои и вполне могут совпасть числом. Карточка ВБ
    не должна подменяться карточкой Ozon с тем же номером."""
    async with db.connect() as connection:
        await connection.execute(
            """
            INSERT INTO product_cards (nm_id, connection_id, parent, article, title)
            VALUES ('900001', 'вб-кабинет', 'P1', 'CAB-(P1)-ВБ', 'Карточка Wildberries')
            """
        )
        await connection.commit()

    подменить_класс(monkeypatch, OzonCatalogue, озон_сервер([[товар_озон(1)]]))
    catalogue.start(settings)
    await дождаться()

    вб = await products.card("900001")
    assert вб.title == "Карточка Wildberries"
    assert вб.marketplace == "wildberries"

    озон = await products.card("ozon-900001")
    assert озон is not None
    assert озон.marketplace == "ozon"


def яндекс_сервер(страницы: list[list[dict]]):
    """Поддельный Яндекс: товары листаются маркером страницы."""
    выдано = {"n": 0}
    видел: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        видел.append(str(request.url))
        номер = выдано["n"]
        выдано["n"] += 1
        товары = страницы[номер] if номер < len(страницы) else []
        paging = {"nextPageToken": f"метка-{номер}"} if номер + 1 < len(страницы) else {}
        return httpx.Response(200, json={
            "status": "OK",
            "result": {"offerMappings": товары, "paging": paging},
        })

    handler.видел = видел
    return handler


def товар_яндекс(article: str, name: str = "") -> dict:
    return {
        "offer": {
            "offerId": article,
            "name": name or article,
            "vendor": "UA",
            "pictures": ["https://ya/1.jpg", "https://ya/2.jpg"],
        },
        "mapping": {"marketCategoryName": "Кабели"},
    }


async def test_яндекс_дочитывается_по_метке_страницы(кабинет_яндекс, monkeypatch):
    handler = яндекс_сервер([
        [товар_яндекс("CAB-(UA-TC-1M-WH)-SAMSUNG", "Кабель для Samsung")],
        [товар_яндекс("CAB-(UA-TC-2M-BK)-XIAOMI")],
    ])
    подменить_класс(monkeypatch, YandexCatalogue, handler)

    catalogue.start(settings)
    await дождаться()

    assert catalogue._run.cards == 2
    assert "page_token=%D0%BC%D0%B5%D1%82%D0%BA%D0%B0-0" in handler.видел[1]

    карточки = await products.cards_of("UA-TC-1M-WH", account_id=кабинет_яндекс)
    одна = карточки["cards"][0]
    assert одна["marketplace"] == "yandex"
    assert одна["marketplaceTitle"] == "Яндекс Маркет"
    assert одна["platformId"] == "CAB-(UA-TC-1M-WH)-SAMSUNG"
    assert одна["subject"] == "Кабели"
    assert одна["photoCount"] == 2


async def test_яндекс_без_номера_бизнеса_говорит_чего_не_хватает(dashboard_db, monkeypatch):
    await db.init_db()
    создан = await conn.create("yandex", "Яндекс без номера")
    await conn.save_values(создан.id, {"api_key": "ya-key", "campaign_id": "123"})

    подменить_класс(monkeypatch, YandexCatalogue, яндекс_сервер([[]]))
    catalogue.start(settings)
    await дождаться()

    сказано = catalogue._run.errors["Яндекс без номера"]
    assert "Номер бизнеса" in сказано
    assert catalogue._run.finished is True


async def test_кабинеты_разных_площадок_считаются_порознь(
    кабинет, кабинет_озон, кабинет_яндекс, monkeypatch
):
    """Ровно то, о чём просил владелец: у каждого кабинета свои товары."""
    вб = dict(карточка("CAB-(ОБЩИЙ)-ВБ", "Кабель ВБ"), nmID=123456)
    подменить(monkeypatch, сервер([[вб]]))
    подменить_класс(monkeypatch, OzonCatalogue, озон_сервер([[товар_озон(1)]]))
    подменить_класс(monkeypatch, YandexCatalogue,
                    яндекс_сервер([[товар_яндекс("CAB-(ОБЩИЙ)-ЯНДЕКС")]]))

    catalogue.start(settings)
    await дождаться()

    полки = {shop["id"]: shop for shop in await products.stores(settings)}
    assert полки[кабинет]["cards"] == 1
    assert полки[кабинет]["marketplaceTitle"] == "Wildberries"
    assert полки[кабинет_озон]["marketplaceTitle"] == "Ozon"
    assert полки[кабинет_яндекс]["marketplaceTitle"] == "Яндекс Маркет"

    # Один и тот же товар продаётся на двух площадках — в справочнике он один,
    # а карточки лежат каждая в своём кабинете.
    общий = await knowledge.get("ОБЩИЙ")
    assert общий.cards == 2
    только_вб = await products.cards_of("ОБЩИЙ", account_id=кабинет)
    assert только_вб["total"] == 1
    assert только_вб["cards"][0]["marketplace"] == "wildberries"


# --- ход сбора: где какой кабинет ----------------------------------------------


async def test_видно_до_какого_кабинета_дошла_очередь(кабинет, кабинет_озон, monkeypatch):
    """Владелец спрашивает не «сколько страниц прочитано», а «где мой второй
    Озон». Ответить на это можно только списком кабинетов с их состоянием."""
    подменить(monkeypatch, сервер([[dict(карточка("CAB-(ВБ)-A"), nmID=1)]]))
    подменить_класс(monkeypatch, OzonCatalogue, озон_сервер([[товар_озон(1)]]))

    catalogue.start(settings)
    await дождаться()

    состояния = {shop["title"]: shop for shop in catalogue.status()["shops"]}
    assert состояния["ВБ Вячеслав"]["state"] == "done"
    assert состояния["ВБ Вячеслав"]["cards"] == 1
    assert состояния["Озон Вячеслав"]["state"] == "done"


async def test_отказавший_кабинет_виден_в_списке(кабинет, monkeypatch):
    подменить(monkeypatch, lambda request: httpx.Response(403, json={}))
    catalogue.start(settings)
    await дождаться()

    кабинеты = catalogue.status()["shops"]
    assert кабинеты[0]["state"] == "error"
    assert кабинеты[0]["error"] == "нет прав в ключе"


async def test_оборванный_сбор_помнится_после_перезапуска(кабинет, monkeypatch):
    """Служба перезапускается при каждом обновлении панели, и незаконченный
    сбор пропадает вместе с ней. Владелец должен видеть, что кабинет остался
    непрочитанным не просто так."""
    подменить(monkeypatch, сервер([[dict(карточка("CAB-(A)-X"), nmID=1)]]))
    catalogue.start(settings)
    await дождаться()

    # Это и есть перезапуск: память процесса чистая, база — нет.
    catalogue._run = None
    async with db.connect() as connection:
        await connection.execute(
            "UPDATE preferences SET value = REPLACE(value, '\"running\": false', '\"running\": true') "
            "WHERE key = ?", (catalogue.LAST_RUN,),
        )
        await connection.commit()

    было = await catalogue.last_run()
    assert было["interrupted"] is True
    assert было["running"] is False
