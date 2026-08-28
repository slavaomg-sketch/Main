"""Площадка без ключей.

Раньше на её месте показывались демонстрационные данные. Для витрины это
удобно, для работы — вредно: выдуманные продажи попадали в общую выручку,
и по цифрам нельзя было понять, где правда. Поэтому неподключённая площадка
теперь честно отдаёт нули и помечается как «не подключено», а демо-режим
включается только явным флагом `DASHBOARD_DEMO=1`.
"""

from __future__ import annotations

from ..models import DayPoint, MarketplaceReport, Period
from .base import MarketplaceConnector


class NotConnectedConnector(MarketplaceConnector):
    """Отдаёт пустой отчёт за период — без данных и без выдумок."""

    def __init__(self, code: str, title: str, credentials=None) -> None:  # type: ignore[no-untyped-def]
        super().__init__(credentials)  # type: ignore[arg-type]
        self.code = code
        self.title = title

    @property
    def configured(self) -> bool:
        return False

    async def fetch(self, period: Period) -> MarketplaceReport:
        report = MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=False,
            demo=False,
        )
        # Ряд по дням нужен, чтобы графики совпадали по датам с остальными.
        report.series = [DayPoint(day=day) for day in period.each_day()]
        return report
