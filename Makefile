.PHONY: install run test lint docker-up docker-down docker-logs pipeline-install pipeline-once pipeline-dry pipeline-test

VENV := .venv
PY   := $(VENV)/bin/python

install:  ## Создать окружение и поставить зависимости
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -r requirements.txt -r requirements-pipeline.txt
	$(VENV)/bin/pip install -q pytest pytest-asyncio pyflakes

run:      ## Запустить бота
	$(PY) -m bot.main

test:     ## Прогнать тесты
	$(PY) -m pytest -q

lint:     ## Проверить код на неиспользуемое и опечатки
	$(PY) -m pyflakes bot/ tests/

docker-up:    ## Поднять в Docker
	docker compose up -d --build

docker-down:  ## Остановить
	docker compose down

docker-logs:  ## Смотреть логи
	docker compose logs -f bot

# ---- Конвейер карточек ----
pipeline-install:  ## Зависимости конвейера в то же окружение
	$(VENV)/bin/pip install -q -r requirements-pipeline.txt

pipeline-once:     ## Один проход конвейера (нужны claude и codex с выполненным входом)
	$(PY) -m pipeline.run --once

pipeline-dry:      ## Проверка разбора идей без claude/codex/push
	$(PY) -m pipeline.run --once --dry-run

pipeline-test:     ## Только тесты конвейера
	$(PY) -m pytest -q tests/test_pipeline_*.py
