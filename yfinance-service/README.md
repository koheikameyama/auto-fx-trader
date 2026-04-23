# yfinance-service

Python FastAPI service that exposes FX daily bars from yfinance.

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

## Example

```bash
curl 'http://localhost:8765/fx/daily?ticker=USDJPY=X&start=2024-01-01&end=2024-02-01'
```
