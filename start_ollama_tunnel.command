#!/bin/zsh
# Publishes the local Ollama through an authenticated gateway + Cloudflare quick tunnel.
cd "$(dirname "$0")" || exit 1
source .venv/bin/activate
TOKEN_FILE=.ollama-gateway-token
[ -f "$TOKEN_FILE" ] || { python -c "import secrets;print(secrets.token_urlsafe(36))" > "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE"; }
export OLLAMA_GATEWAY_TOKEN="$(cat $TOKEN_FILE)"
curl -s http://127.0.0.1:11434/api/tags >/dev/null || { echo "Ollama chưa chạy. Mở Ollama.app trước."; exit 1; }
python -m uvicorn ollama_gateway:app --host 127.0.0.1 --port 8787 --no-access-log &
GW=$!; trap 'kill $GW' EXIT
printf '\nOLLAMA_API_TOKEN (dán vào Render): %s\nTìm dòng https://xxxx.trycloudflare.com bên dưới -> đó là OLLAMA_BASE_URL.\n\n' "$OLLAMA_GATEWAY_TOKEN"
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8787
