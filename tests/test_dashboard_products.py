"""Товары: каталог, карточки, оценка и правки владельца."""

import httpx
import pytest

from dashboard import connections as conn
from dashboard import db, knowledge, products
from dashboard.config import settings
from dashboard.connectors.wb_catalogue import Card
from dashboard.connectors.wb_feedback_rating import WildberriesRating


@pytest.fixture
async def кабинет(dashboard_db):
    await db.init_db()
    создан = await conn.create("wildberries", "ВБ Вячеслав")
    await conn.save_values(создан.id, {"token": "token-slava"})
    return создан.id


def карточка(nm_id, article, name="Товар", photos=("https://wb/1.jpg",)):
    return Card(article=article, name=name, nm_id=str(nm_id),
                brand="UA", subject="Кабель", photos=tuple(photos))


async def test_карточки_раскладываются_по_товарам(кабинет):
    await products.save_cards(кабинет, [
        карточка(1, "CAB-(UA-TC-1M-WH)-SAMSUNG", "Кабель для Samsung"),
        карточка(2, "CAB-(UA-TC-1M-WH)-TECNO", "Кабель для Tecno"),
        карточка(3, "CAB-(UA-TC-2M-BK)-XIAOMI", "Кабель 2 м"),
    ])

    список = await products.parents()
    по_коду = {item["parent"]: item for item in список}

    assert по_коду["UA-TC-1M-WH"]["cards"] == 2
    assert по_коду["UA-TC-2M-BK"]["cards"] == 1
    # Товары с наибольшим числом карточек — сверху.
    assert список[0]["parent"] == "UA-TC-1M-WH"


async def test_можно_провалиться_в_товар(кабинет):
    await products.save_cards(кабинет, [
        карточка(number, f"CAB-(ОДИН)-M{number}", f"Карточка {number}")
        for number in range(5)
    ])

    внутри = await products.cards_of("ОДИН")
    assert внутри["total"] == 5
    assert len(внутри["cards"]) == 5
    assert внутри["more"] is False
    assert внутри["cards"][0]["photo"] == "https://wb/1.jpg"


async def test_карточки_листаются(кабинет):
    await products.save_cards(кабинет, [
        карточка(number, f"CAB-(МНОГО)-M{number:03d}") for number in range(products.PAGE + 20)
    ])

    первая = await products.cards_of("МНОГО")
    assert len(первая["cards"]) == products.PAGE
    assert первая["more"] is True

    вторая = await products.cards_of("МНОГО", offset=products.PAGE)
    assert len(вторая["cards"]) == 20
    assert вторая["more"] is False
    # Страницы не пересекаются.
    assert not ({c["nmId"] for c in первая["cards"]} & {c["nmId"] for c in вторая["cards"]})


async def test_видно_все_фотографии_карточки(кабинет):
    await products.save_cards(кабинет, [
        карточка(7, "CAB-(ФОТО)-X", photos=("https://wb/1.jpg", "https://wb/2.jpg",
                                            "https://wb/3.jpg")),
    ])

    одна = await products.card("7")
    assert одна.photo == "https://wb/1.jpg"          # главное — первое
    assert одна.to_dict()["photoCount"] == 3
    assert одна.to_dict()["photos"][2] == "https://wb/3.jpg"


async def test_карточки_без_фото_видны_в_списке_товаров(кабинет):
    """Пустое главное фото — то, ради чего владелец и ходит по каталогу."""
    await products.save_cards(кабинет, [
        карточка(1, "CAB-(ПУСТО)-A", photos=()),
        карточка(2, "CAB-(ПУСТО)-B", photos=("https://wb/2.jpg",)),
    ])

    товар = (await products.parents())[0]
    assert товар["withoutPhoto"] == 1


async def test_правка_сохраняется_и_видна_в_списке(кабинет):
    await products.save_cards(кабинет, [карточка(9, "CAB-(ПРАВКА)-A")])

    await products.save_note("9", "Заменить главное фото")

    assert (await products.card("9")).note == "Заменить главное фото"
    assert (await products.parents())[0]["noted"] == 1
    # И такие карточки собираются в один рабочий список.
    отмеченные = await products.notes()
    assert [item["nmId"] for item in отмеченные] == ["9"]


async def test_пересбор_каталога_не_стирает_правки(кабинет):
    await products.save_cards(кабинет, [карточка(9, "CAB-(ПРАВКА)-A", "Старое имя")])
    await products.save_note("9", "Дописать длину в описание")

    await products.save_cards(кабинет, [карточка(9, "CAB-(ПРАВКА)-A", "Новое имя")])

    снова = await products.card("9")
    assert снова.note == "Дописать длину в описание"
    assert снова.title == "Новое имя"


# --- оценка и отзывы ------------------------------------------------------------


def подменить_рейтинг(monkeypatch, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesRating, "client", client)


async def test_оценка_спрашивается_у_площадки(кабинет, monkeypatch):
    await products.save_cards(кабинет, [карточка(11, "CAB-(ОЦЕНКА)-A")])

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/feedbacks/products/rating/nmid"
        assert request.url.params.get("nmId") == "11"
        return httpx.Response(200, json={"data": {"valuation": "4.8", "feedbacksCount": 277}})

    подменить_рейтинг(monkeypatch, handler)
    свежая = await products.rating("11", settings)

    assert свежая.rating == 4.8
    assert свежая.feedbacks == 277
    assert свежая.rating_known is True


async def test_молчание_площадки_не_превращается_в_ноль_отзывов(кабинет, monkeypatch):
    """«Отзывов нет» и «не удалось спросить» — разные вещи."""
    await products.save_cards(кабинет, [карточка(12, "CAB-(МОЛЧИТ)-A")])

    подменить_рейтинг(monkeypatch, lambda request: httpx.Response(500, json={}))
    свежая = await products.rating("12", settings)

    assert свежая.feedbacks == -1
    assert свежая.rating_known is False


async def test_ноль_отзывов_это_настоящий_ответ(кабинет, monkeypatch):
    await products.save_cards(кабинет, [карточка(13, "CAB-(НОВЫЙ)-A")])

    подменить_рейтинг(monkeypatch, lambda request: httpx.Response(
        200, json={"data": {"valuation": "0", "feedbacksCount": 0}}))
    свежая = await products.rating("13", settings)

    assert свежая.feedbacks == 0
    assert свежая.rating_known is True      # спросили и узнали: отзывов нет


async def test_название_владельца_подставляется_в_каталог(кабинет):
    await products.save_cards(кабинет, [карточка(1, "CAB-(UA-TC-1M-WH)-A", "Имя карточки")])
    await knowledge.save("UA-TC-1M-WH", "Кабель Type-C 1 м, белый", "До 60 Вт.")

    товар = (await products.parents())[0]
    assert товар["title"] == "Кабель Type-C 1 м, белый"
    assert товар["described"] is True


# --- полки по категориям --------------------------------------------------------


async def test_товары_раскладываются_по_категориям(кабинет):
    """Провода в одном месте, плёнки в другом — иначе 383 товара это свалка."""
    провод = Card(article="CAB-(ПРОВОД)-A", name="Кабель", nm_id="1",
                  brand="UA", subject="Кабели", photos=("https://wb/1.jpg",))
    плёнка = Card(article="FLM-(ПЛЁНКА)-A", name="Плёнка", nm_id="2",
                  brand="UA", subject="Защитные плёнки", photos=("https://wb/2.jpg",))
    await products.save_cards(кабинет, [провод, плёнка])

    по_коду = {item["parent"]: item for item in await products.parents()}
    assert по_коду["ПРОВОД"]["category"] == "Кабели"
    assert по_коду["ПЛЁНКА"]["category"] == "Защитные плёнки"


async def test_категория_берётся_преобладающая(кабинет):
    """Одна карточка, отнесённая площадкой не туда, не должна уводить весь
    товар на чужую полку."""
    карточки = [
        Card(article="CAB-(СМЕСЬ)-A", name="1", nm_id="1", brand="UA",
             subject="Кабели", photos=()),
        Card(article="CAB-(СМЕСЬ)-B", name="2", nm_id="2", brand="UA",
             subject="Кабели", photos=()),
        Card(article="CAB-(СМЕСЬ)-C", name="3", nm_id="3", brand="UA",
             subject="Перчатки", photos=()),
    ]
    await products.save_cards(кабинет, карточки)

    assert (await products.parents())[0]["category"] == "Кабели"


async def test_товар_без_категории_не_пропадает(кабинет):
    await products.save_cards(кабинет, [
        Card(article="CAB-(БЕЗ)-A", name="Товар", nm_id="1", brand="", subject="", photos=()),
    ])

    товар = (await products.parents())[0]
    assert товар["category"] == "Без категории"


# --- продажи по карточкам -------------------------------------------------------


async def _положить_продажи(кабинет, строки):
    """Продажи лежат в хранилище так же, как их отдал Wildberries."""
    import json

    from dashboard import db as база

    async with база.connect() as connection:
        for number, строка in enumerate(строки):
            await connection.execute(
                """
                INSERT INTO marketplace_rows
                    (connection_id, source, row_id, day, payload, updated_at)
                VALUES (?, 'sales', ?, '2026-08-01', ?, '2026-08-01')
                """,
                (кабинет, f"r{number}", json.dumps(строка)),
            )
        await connection.commit()


async def test_продажи_считаются_из_хранилища(кабинет):
    """Новых запросов к площадке для этого не нужно: продажи уже выгружены."""
    await products.save_cards(кабинет, [
        карточка(101, "CAB-(ПРОДАЖИ)-A"), карточка(102, "CAB-(ПРОДАЖИ)-B"),
    ])
    await _положить_продажи(кабинет, [
        {"nmId": 101, "saleID": "S1"},
        {"nmId": 101, "saleID": "S2"},
        {"nmId": 102, "saleID": "S3"},
    ])

    внутри = await products.cards_of("ПРОДАЖИ")
    по_номеру = {card["nmId"]: card for card in внутри["cards"]}
    assert по_номеру["101"]["sales"] == 2
    assert по_номеру["102"]["sales"] == 1


async def test_возврат_не_считается_продажей(кабинет):
    """У возврата номер начинается с R — это не продажа."""
    await products.save_cards(кабинет, [карточка(103, "CAB-(ВОЗВРАТ)-A")])
    await _положить_продажи(кабинет, [
        {"nmId": 103, "saleID": "S1"},
        {"nmId": 103, "saleID": "R1"},
    ])

    внутри = await products.cards_of("ВОЗВРАТ")
    assert внутри["cards"][0]["sales"] == 1


async def test_карточка_без_продаж_показывает_ноль(кабинет):
    await products.save_cards(кабинет, [карточка(104, "CAB-(ТИХИЙ)-A")])
    внутри = await products.cards_of("ТИХИЙ")
    assert внутри["cards"][0]["sales"] == 0


async def test_продажи_видны_и_в_самой_карточке(кабинет):
    await products.save_cards(кабинет, [карточка(105, "CAB-(ОДНА)-A")])
    await _положить_продажи(кабинет, [{"nmId": 105, "saleID": "S1"}])

    вид = await products.card_view("105")
    assert вид["sales"] == 1


# --- разделение по кабинетам ----------------------------------------------------


@pytest.fixture
async def два_кабинета(dashboard_db):
    """Два кабинета Wildberries, как у владельца."""
    await db.init_db()
    созданные = {}
    for название, токен in (("ВБ Вячеслав", "token-slava"), ("ВБ Наталья", "token-natasha")):
        запись = await conn.create("wildberries", название)
        await conn.save_values(запись.id, {"token": токен})
        созданные[название] = запись.id
    return созданные


async def test_товары_разделены_по_кабинетам(два_кабинета):
    """У Вячеслава свои товары, у Натальи свои — вперемешку их смотреть
    нельзя, иначе непонятно, где что править."""
    await products.save_cards(два_кабинета["ВБ Вячеслав"], [
        карточка(1, "CAB-(СЛАВА-1)-A"), карточка(2, "CAB-(СЛАВА-2)-A"),
    ])
    await products.save_cards(два_кабинета["ВБ Наталья"], [
        карточка(3, "CAB-(НАТАША-1)-A"),
    ])

    у_славы = {item["parent"] for item in await products.parents(два_кабинета["ВБ Вячеслав"])}
    у_наташи = {item["parent"] for item in await products.parents(два_кабинета["ВБ Наталья"])}

    assert у_славы == {"СЛАВА-1", "СЛАВА-2"}
    assert у_наташи == {"НАТАША-1"}
    # А без выбора кабинета видно всё сразу.
    assert len(await products.parents()) == 3


async def test_карточки_товара_берутся_из_своего_кабинета(два_кабинета):
    """Один и тот же товар может продаваться из обоих кабинетов."""
    await products.save_cards(два_кабинета["ВБ Вячеслав"], [
        карточка(1, "CAB-(ОБЩИЙ)-A", "У Вячеслава"),
    ])
    await products.save_cards(два_кабинета["ВБ Наталья"], [
        карточка(2, "CAB-(ОБЩИЙ)-B", "У Натальи"),
    ])

    у_славы = await products.cards_of("ОБЩИЙ", account_id=два_кабинета["ВБ Вячеслав"])
    assert у_славы["total"] == 1
    assert у_славы["cards"][0]["title"] == "У Вячеслава"

    вместе = await products.cards_of("ОБЩИЙ")
    assert вместе["total"] == 2


async def test_список_кабинетов_со_счётчиками(два_кабинета):
    await products.save_cards(два_кабинета["ВБ Вячеслав"], [
        карточка(1, "CAB-(A)-X"), карточка(2, "CAB-(A)-Y"), карточка(3, "CAB-(B)-Z"),
    ])
    await products.save_cards(два_кабинета["ВБ Наталья"], [карточка(4, "CAB-(C)-W")])

    список = {item["title"]: item for item in await products.stores(settings)}
    assert список["ВБ Вячеслав"]["cards"] == 3
    assert список["ВБ Вячеслав"]["parents"] == 2
    assert список["ВБ Наталья"]["cards"] == 1


async def test_категории_считаются_внутри_кабинета(два_кабинета):
    await products.save_cards(два_кабинета["ВБ Вячеслав"], [
        Card(article="CAB-(ПРОВОД)-A", name="Кабель", nm_id="1",
             brand="", subject="Кабели", photos=()),
    ])
    await products.save_cards(два_кабинета["ВБ Наталья"], [
        Card(article="GLV-(ПЕРЧАТКИ)-A", name="Перчатки", nm_id="2",
             brand="", subject="Перчатки", photos=()),
    ])

    полки = {item["category"] for item in await products.parents(два_кабинета["ВБ Вячеслав"])}
    assert полки == {"Кабели"}


async def test_справка_остаётся_общей_на_товар(два_кабинета):
    """Товар физически один: описывать один и тот же кабель дважды —
    лишняя работа для владельца."""
    await products.save_cards(два_кабинета["ВБ Вячеслав"], [карточка(1, "CAB-(ОБЩИЙ)-A")])
    await products.save_cards(два_кабинета["ВБ Наталья"], [карточка(2, "CAB-(ОБЩИЙ)-B")])
    await knowledge.save("ОБЩИЙ", "Кабель", "До 60 Вт.")

    for кабинет in два_кабинета.values():
        видно = await knowledge.all_parents(кабинет)
        assert [item.facts for item in видно] == ["До 60 Вт."]


async def test_справочник_показывает_товары_своего_кабинета(два_кабинета):
    await products.save_cards(два_кабинета["ВБ Вячеслав"], [карточка(1, "CAB-(СЛАВА)-A")])
    await products.save_cards(два_кабинета["ВБ Наталья"], [карточка(2, "CAB-(НАТАША)-A")])

    у_славы = {item.parent for item in await knowledge.all_parents(два_кабинета["ВБ Вячеслав"])}
    assert у_славы == {"СЛАВА"}
