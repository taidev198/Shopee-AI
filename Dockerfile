FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MARKET_DB=/data/market.db
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install --with-deps chromium
# app.py imports the analytics, auth, crawler and AI modules at the project
# root. Copy all root Python modules so the container has the same runtime
# module set as local development.
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream && rm /tmp/litestream.tar.gz
COPY *.py ./
COPY litestream.yml docker-entrypoint.sh ./
COPY static ./static
COPY samples ./samples
RUN mkdir -p /data
EXPOSE 8000
CMD ["sh","/app/docker-entrypoint.sh"]
