FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MARKET_DB=/data/market.db
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install --with-deps chromium
# app.py imports the analytics, auth, crawler and AI modules at the project
# root. Copy all root Python modules so the container has the same runtime
# module set as local development.
COPY *.py ./
COPY static ./static
COPY samples ./samples
RUN mkdir -p /data
EXPOSE 8000
CMD ["sh","-c","uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
