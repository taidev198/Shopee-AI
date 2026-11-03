#!/bin/sh
# Restore the database from object storage when the container starts empty, then
# serve while Litestream replicates every change. Without LITESTREAM_BUCKET the
# app runs exactly as before (data lives only on the container disk).
set -e
CMD="uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"
if [ -n "$LITESTREAM_BUCKET" ] && [ -n "$LITESTREAM_ENDPOINT" ]; then
  mkdir -p "$(dirname "$MARKET_DB")"
  litestream restore -config /app/litestream.yml -if-db-not-exists -if-replica-exists "$MARKET_DB"
  exec litestream replicate -config /app/litestream.yml -exec "$CMD"
fi
echo "LITESTREAM_BUCKET chưa đặt: dữ liệu sẽ mất khi container khởi động lại." >&2
exec $CMD
