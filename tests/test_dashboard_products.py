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
