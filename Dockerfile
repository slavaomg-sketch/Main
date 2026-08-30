# Один образ на оба бота.
#
# По умолчанию запускается бот-хаб (ветка «Доставка» и всё, что добавите
# дальше) — так облачные платформы, которые просто находят Dockerfile,
# поднимают именно его без всякой настройки.
#
# Бот напоминаний для сотрудников запускается тем же образом:
#   docker run -e APP_MODULE=bot.main ...
# Именно так это делает docker-compose.yml.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Europe/Moscow \
    APP_MODULE=hub

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot/ ./bot/
COPY hub/ ./hub/
COPY tracker/ ./tracker/

# /data переживает перезапуски и обновления: там список поездок и открытые ветки.
ENV HUB_STATE=/data/hub.json \
    TRACKER_STATE=/data/trips.json \
    TRACKER_ICS_DIR=/data/ics
RUN mkdir -p /data /app/data
VOLUME ["/data"]

CMD ["sh", "-c", "exec python -m $APP_MODULE"]
