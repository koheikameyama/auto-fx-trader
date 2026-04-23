# yfinance-service

Python FastAPI service that exposes FX daily bars from yfinance.

Runs on port **8765** by default (to avoid clashing with the stock trader
sidecar if both run on the same host).

## Setup (fish shell)

```fish
cd yfinance-service
python3 -m venv .venv
source .venv/bin/activate.fish
pip install -r requirements.txt
```

## Run

```fish
uvicorn main:app --host 0.0.0.0 --port 8765
```

Or via the module entrypoint (reads `YFINANCE_PORT`, defaults to 8765):

```fish
python main.py
```

## Environment variables

| Variable          | Required | Description                                                                                   |
| ----------------- | -------- | --------------------------------------------------------------------------------------------- |
| `YFINANCE_PORT`   | no       | Port for the sidecar. Defaults to `8765`.                                                     |
| `YFINANCE_PROXY`  | no       | Proxy URL used as fallback when Yahoo Finance rate-limits the direct connection. Format: `http://user:pass@host:port`. When set, a second session pool is initialized and used automatically after direct connection retries are exhausted. |
| `SIDECAR_SECRET`  | no       | Shared secret for simple auth. If set, every request except `/health` must send `x-api-key: <SIDECAR_SECRET>`. |

## Endpoints

- `GET /health` — returns `{"status": "ok"}`. No auth required.
- `GET /fx/daily?ticker=<ticker>&start=<YYYY-MM-DD>&end=<YYYY-MM-DD>` — returns `{"ticker": "...", "bars": [{date, open, high, low, close, volume}, ...]}`.

## Example

```bash
curl 'http://localhost:8765/fx/daily?ticker=USDJPY=X&start=2024-01-01&end=2024-02-01'
```

With auth enabled:

```bash
curl -H "x-api-key: $SIDECAR_SECRET" \
  'http://localhost:8765/fx/daily?ticker=USDJPY=X&start=2024-01-01&end=2024-02-01'
```

## Notes

- Uses `curl_cffi` with Chrome impersonation and a session pool of size 5 per
  pool (direct + proxy). Each call is serialized via an asyncio semaphore and
  spaced by 1 second to respect Yahoo Finance rate limits.
- On rate-limit (`YFRateLimitError` / `429` / "Too Many Requests"), all
  sessions in the active pool are refreshed (new cookies); if a proxy is
  configured the request falls back to the proxy pool.
- Historical data uses `yf.Ticker(...).history(..., auto_adjust=False)` to
  preserve raw FX quotes.
