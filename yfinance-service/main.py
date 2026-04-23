from fastapi import FastAPI, HTTPException
import yfinance as yf

app = FastAPI()


@app.get("/fx/daily")
def fx_daily(ticker: str, start: str, end: str):
    """
    Fetch daily FX bars from yfinance.

    ticker: yfinance FX ticker, e.g. 'USDJPY=X', 'EURUSD=X', 'GBPUSD=X'
    start, end: 'YYYY-MM-DD'
    """
    try:
        df = yf.download(
            ticker,
            start=start,
            end=end,
            interval="1d",
            progress=False,
            auto_adjust=False,
        )
    except Exception as e:
        raise HTTPException(500, str(e))

    if df.empty:
        return {"ticker": ticker, "bars": []}

    df = df.reset_index()
    if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)
    bars = []
    for _, r in df.iterrows():
        bars.append({
            "date": r["Date"].strftime("%Y-%m-%d"),
            "open": float(r["Open"]),
            "high": float(r["High"]),
            "low": float(r["Low"]),
            "close": float(r["Close"]),
            "volume": float(r["Volume"]) if r["Volume"] else None,
        })
    return {"ticker": ticker, "bars": bars}
