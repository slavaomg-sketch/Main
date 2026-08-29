.PHONY: install run track track-bot test lint docker-up docker-down docker-logs

VENV := .venv
PY   := $(VENV)/bin/python

install:  ## Создать окружение и поставить зависимости
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -r requirements.txt
	$(VENV)/bin/pip install -q pytest pytest-asyncio pyflakes

run:      ## Запустить бота
	$(PY) -m bot.main

track-bot: ## Запустить бота-трекера доставок (см. TRACKER.md)
	$(PY) -m trackerbot

track:    ## Следить за доставками из терминала (см. TRACKER.md)
	$(PY) -m tracker watch

test:     ## Прогнать тесты
	$(PY) -m pytest -q

lint:     ## Проверить код на неиспользуемое и опечатки
	$(PY) -m pyflakes bot/ tracker/ trackerbot/ tests/

docker-up:    ## Поднять в Docker
	docker compose up -d --build

docker-down:  ## Остановить
	docker compose down

docker-logs:  ## Смотреть логи
	docker compose logs -f bot
