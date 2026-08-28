.PHONY: install dashboard diagnose run test lint docker-up docker-down docker-logs

VENV := .venv
PY   := $(VENV)/bin/python

install:    ## Создать окружение и поставить зависимости
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -r requirements.txt
	$(VENV)/bin/pip install -q pytest pytest-asyncio pyflakes

dashboard:  ## Запустить веб-панель маркетплейсов (http://localhost:8080)
	$(PY) -m dashboard.main

diagnose:   ## Проверить ключи маркетплейсов (make diagnose ARGS="--days 7")
	$(PY) -m dashboard.diagnose $(ARGS)

run:        ## Запустить телеграм-бота напоминаний
	$(PY) -m bot.main

test:       ## Прогнать тесты
	$(PY) -m pytest -q

lint:       ## Проверить код на неиспользуемое и опечатки
	$(PY) -m pyflakes bot/ dashboard/ tests/

docker-up:    ## Поднять панель в Docker
	docker compose up -d --build

docker-down:  ## Остановить
	docker compose down

docker-logs:  ## Смотреть логи
	docker compose logs -f dashboard
