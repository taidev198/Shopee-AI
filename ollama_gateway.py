"""Bearer-token gateway in front of a local Ollama, meant to sit behind a tunnel.

Only the two routes MarketLens uses are forwarded; everything else (pull, delete,
create...) is refused so the public URL cannot manage the machine's models.
Run: OLLAMA_GATEWAY_TOKEN=... python -m uvicorn ollama_gateway:app --host 127.0.0.1 --port 8787
"""
import hmac
import os

import httpx
from fastapi import FastAPI, Request, Response

UPSTREAM = os.environ.get('OLLAMA_UPSTREAM', 'http://127.0.0.1:11434')
TOKEN = os.environ.get('OLLAMA_GATEWAY_TOKEN', '')
ROUTES = {('GET', '/api/tags'), ('POST', '/api/generate')}
if len(TOKEN) < 24:
    raise SystemExit('Đặt OLLAMA_GATEWAY_TOKEN dài ít nhất 24 ký tự.')

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.api_route('/{path:path}', methods=['GET', 'POST'])
async def forward(path: str, request: Request):
    supplied = request.headers.get('authorization', '')
    if not hmac.compare_digest(supplied.encode(), f'Bearer {TOKEN}'.encode()):
        return Response('unauthorized', status_code=401)
    if (request.method, '/' + path) not in ROUTES:
        return Response('not found', status_code=404)
    async with httpx.AsyncClient(timeout=600) as client:
        upstream = await client.request(request.method, UPSTREAM + '/' + path, content=await request.body(),
                                        headers={'Content-Type': 'application/json'})
    return Response(upstream.content, status_code=upstream.status_code, media_type='application/json')
