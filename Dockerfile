FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Europe/Moscow

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY dashboard/ ./dashboard/
COPY web/ ./web/
COPY bot/ ./bot/

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080

# По умолчанию поднимается веб-панель. Бот запускается отдельным сервисом
# в docker-compose.yml (command: python -m bot.main).
CMD ["python", "-m", "dashboard.main"]
