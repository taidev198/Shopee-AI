#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
python -m pip install -r requirements.txt || exit 1
python -m playwright install chromium || exit 1
ollama_bin="$(command -v ollama 2>/dev/null)"
if [ -x /Applications/Ollama.app/Contents/Resources/ollama ]; then ollama_bin=/Applications/Ollama.app/Contents/Resources/ollama; fi
if [ -z "$ollama_bin" ] && [ -x /opt/homebrew/bin/ollama ]; then ollama_bin=/opt/homebrew/bin/ollama; fi
if [ -n "$ollama_bin" ]; then
  if ! "$ollama_bin" list >/dev/null 2>&1; then
    nohup env OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 "$ollama_bin" serve > /tmp/marketlens-ollama.log 2>&1 &
  fi
fi
printf '\nMarketLens is ready. Open http://127.0.0.1:8000 in your browser.\nStop with Control+C.\n\n'
python -m uvicorn app:app --host 127.0.0.1 --port 8000
