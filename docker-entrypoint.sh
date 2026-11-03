#!/bin/sh
# Restore the database from object storage when the container starts empty, then
# serve while Litestream replicates every change. Without LITESTREAM_BUCKET the
# app runs exactly as before (data lives only on the container disk).
CMD="uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"
if [ -n "$LITESTREAM_BUCKET" ] && [ -n "$LITESTREAM_ENDPOINT" ]; then
  mkdir -p "$(dirname "$MARKET_DB")"
  if litestream restore -config /app/litestream.yml -if-db-not-exists -if-replica-exists "$MARKET_DB"; then
    exec litestream replicate -config /app/litestream.yml -exec "$CMD"
  fi
  # Starting without replication keeps the site reachable, but nothing is being backed up.
  echo "CANH BAO: Litestream khong truy cap duoc kho luu tru (kiem tra LITESTREAM_ENDPOINT, bucket, quyen cua token R2). App chay KHONG sao luu." >&2
else
  echo "LITESTREAM_BUCKET chua dat: du lieu se mat khi container khoi dong lai." >&2
fi
exec $CMD
