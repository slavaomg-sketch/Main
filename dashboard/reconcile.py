"""Сверка двух источников Wildberries между собой.

У площадки два способа отдать одни и те же продажи:

* **статистика** — быстро и в реальном времени, но неглубоко и, по
  собственному предупреждению Wildberries, «по упрощённой логике»;
* **отчёт реализации** — с задержкой, зато это тот самый документ, по
  которому идут расчёты, и хранится он годами.

Панель берёт свежие дни из первого, глубокие — из второго. Значит, на днях,
которые покрыты обоими, они обязаны сходиться. Если разошлись — виновата
разметка колонок, и знать об этом надо до того, как по цифрам примут
решение. Поэтому после каждой выгрузки итоги за один общий день пишутся
в журнал: строку видно в `journalctl -u marketplace-dashboard`.

Ключи здесь не участвуют: считаются только уже выгруженные строки.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import date, timedelta
from typing import Any

from .models import Period

log = logging.getLogger(__name__)


def _num(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def statistics_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Итоги дня по строкам статистики — так, как их считает панель сейчас."""
    totals = Counter()
    for row in rows:
        sale_id = str(row.get("saleID") or "")
        is_return = sale_id.startswith("R") or _num(row, "finishedPrice") < 0
        bucket = "возвраты" if is_return else "выкупы"
        totals[f"{bucket}:строк"] += 1
        totals[f"{bucket}:priceWithDisc"] += abs(_num(row, "priceWithDisc"))
        totals[f"{bucket}:finishedPrice"] += abs(_num(row, "finishedPrice"))
        totals[f"{bucket}:totalPrice"] += abs(_num(row, "totalPrice"))
        totals[f"{bucket}:forPay"] += abs(_num(row, "forPay"))
    return dict(totals)


def orders_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Итоги дня по строкам заказов, во всех колонках цены.

    Приложение Wildberries показывает заказы в деньгах, и панель обязана
    сходиться с ним. Считаем отдельно принятые и отменённые: неизвестно,
    включает приложение отмены или нет.
    """
    totals: Counter = Counter()
    for row in rows:
        bucket = "отменённые" if row.get("isCancel") else "принятые"
        totals[f"{bucket}:строк"] += 1
        for name in ("priceWithDisc", "finishedPrice", "totalPrice"):
            totals[f"{bucket}:{name}"] += abs(_num(row, name))
    return {key: round(value, 2) for key, value in totals.items()}


def finance_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Итоги дня по строкам отчёта реализации, во всех подходящих колонках.

    Считаем сразу несколько вариантов выручки: какой из них совпадёт со
    статистикой, тот и есть правильная колонка.
    """
    totals: Counter = Counter()
    kinds: Counter = Counter()

    for row in rows:
        doc = str(row.get("docTypeName") or "—")
        kinds[doc] += 1
        if "озврат" in doc:
            bucket = "возвраты"
        elif "родаж" in doc:
            bucket = "выкупы"
        else:
            bucket = "прочее"

        quantity = max(int(_num(row, "quantity")) or 1, 1)
        totals[f"{bucket}:строк"] += 1
        totals[f"{bucket}:штук"] += quantity
        totals[f"{bucket}:retailAmount"] += abs(_num(row, "retailAmount"))
        totals[f"{bucket}:retailPriceWithDisc×кол"] += (
            abs(_num(row, "retailPriceWithDisc")) * quantity
        )
        totals[f"{bucket}:retailPrice×кол"] += abs(_num(row, "retailPrice")) * quantity
        totals[f"{bucket}:forPay"] += abs(_num(row, "forPay"))
        totals[f"{bucket}:комиссия"] += abs(_num(row, "ppvzSalesCommission"))
        totals[f"{bucket}:эквайринг"] += abs(_num(row, "acquiringFee"))
        totals[f"{bucket}:ПВЗ"] += abs(_num(row, "ppvzReward"))

        # Удержания живут в отдельных строках отчёта, а не в строках продаж:
        # логистика, хранение, приёмка, штрафы. Считаем их по всем строкам.
        totals["все:forPay"] += _num(row, "forPay")
        for name, key in (
            ("доставка", "deliveryService"),
            ("логистика", "rebillLogisticCost"),
            ("хранение", "paidStorage"),
            ("приёмка", "paidAcceptance"),
            ("штрафы", "penalty"),
            ("удержания", "deduction"),
            ("доплаты", "additionalPayment"),
        ):
            totals[f"все:{name}"] += _num(row, key)

    result: dict[str, Any] = {key: round(value, 2) for key, value in totals.items()}
    # Что реально дойдёт до баланса кабинета: за товар минус расходы площадки.
    result["все:кВыводу"] = round(
        result.get("все:forPay", 0.0)
        - sum(
            result.get(f"все:{name}", 0.0)
            for name in (
                "доставка", "логистика", "хранение", "приёмка", "штрафы", "удержания"
            )
        )
        + result.get("все:доплаты", 0.0),
        2,
    )
    result["типы строк"] = dict(kinds.most_common(12))
    return result


async def check_day(connection_id: str, day: date) -> dict[str, Any]:
    """Итоги одного дня по обоим источникам — для сравнения глазами.

    Отчёт реализации считается дважды: по дате продажи и по дате операции.
    Совпасть со статистикой должна первая — но проверять это лучше цифрами,
    а не на слово.
    """
    from . import warehouse
    from .connectors.dates import parse_day

    period = Period(date_from=day, date_to=day)
    statistics = await warehouse.read_rows(connection_id, "sales", period)
    orders = await warehouse.read_rows(connection_id, "orders", period)
    finance = await warehouse.read_rows(connection_id, "finance", period)

    by_operation = [row for row in finance if parse_day(row.get("rrDate")) == day]
    return {
        "день": day.isoformat(),
        "статистика": statistics_totals(statistics),
        "заказы": orders_totals(orders),
        "финотчёт по дате продажи": finance_totals(finance),
        "финотчёт по дате операции": finance_totals(by_operation),
    }


async def months(connection_id: str, back: int = 14, today: date | None = None) -> dict[str, Any]:
    """Помесячный разрез отчёта реализации: сколько выкуплено и сколько
    из этого дошло до продавца.

    Нужен, чтобы отличить настоящее изменение условий площадки от ошибки
    разметки: настоящее меняется плавно, ошибка — обрывом.
    """
    from . import warehouse
    from .models import shift_months

    today = today or date.today()
    result: dict[str, Any] = {}

    for step in range(back):
        start = shift_months(today.replace(day=1), step)
        end = shift_months(today.replace(day=1), step - 1) - timedelta(days=1)
        rows = await warehouse.read_rows(
            connection_id, "finance", Period(date_from=start, date_to=end)
        )
        totals = finance_totals(rows)
        bought = totals.get("выкупы:retailAmount", 0.0)
        for_pay = totals.get("выкупы:forPay", 0.0)
        if not bought:
            continue
        turnover = totals.get("выкупы:retailPriceWithDisc×кол", 0.0)
        payable = totals.get("все:кВыводу", 0.0)
        result[start.strftime("%Y-%m")] = {
            "оборот": round(turnover),
            "кПеречислению": round(for_pay),
            "доставка": round(totals.get("все:доставка", 0.0)),
            "логистика": round(totals.get("все:логистика", 0.0)),
            "хранение": round(totals.get("все:хранение", 0.0)),
            "приёмка": round(totals.get("все:приёмка", 0.0)),
            "штрафы": round(totals.get("все:штрафы", 0.0)),
            "удержания": round(totals.get("все:удержания", 0.0)),
            "кВыводу": round(payable),
            "доляОтОборота": round(payable / turnover * 100, 1) if turnover else 0.0,
        }
    return result


async def log_check(connection_id: str, title: str, today: date | None = None) -> None:
    """Записать сверку в журнал. Ошибка здесь не должна ломать выгрузку."""
    today = today or date.today()
    for back in (1, 7):
        try:
            report = await check_day(connection_id, today - timedelta(days=back))
        except Exception as exc:  # noqa: BLE001 — сверка не важнее выгрузки
            log.warning("Сверка источников %s не удалась: %s", title, exc)
            return
        log.info("Сверка источников %s: %s", title, report)

    try:
        log.info("Помесячно %s: %s", title, await months(connection_id, today=today))
    except Exception as exc:  # noqa: BLE001 — сверка не важнее выгрузки
        log.warning("Помесячная сверка %s не удалась: %s", title, exc)
