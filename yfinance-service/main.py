"""
yfinance サイドカーサービス (FX 向け)

Yahoo Finance の FX 日足データを yfinance 経由で取得する FastAPI サーバー。
Node.js バックテストワーカーから localhost HTTP 経由で呼び出される。
"""

import asyncio
import logging
import math
import os
import threading
from typing import Any, Callable, TypeVar

T = TypeVar("T")

import uvicorn
import yfinance as yf
from curl_cffi.requests import Session as CurlSession
from fastapi import FastAPI, HTTPException, Request

try:
    from yfinance.exceptions import YFRateLimitError
except ImportError:
    YFRateLimitError = None  # type: ignore[misc,assignment]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("yfinance-service")

app = FastAPI(title="yfinance sidecar (FX)")

# ========================================
# 認証
# ========================================

SIDECAR_SECRET = os.environ.get("SIDECAR_SECRET", "")

# ========================================
# セッションプール（プロキシフォールバック対応）
# ========================================
#
# yfinance はデフォルトでシングルトンセッション（同一 Cookie）を使うため、
# rotation residential プロキシを使っても Yahoo 側から同一ユーザーに見える。
# → リクエストごとに独立した curl_cffi Session を渡し、Cookie を分離する。
#
# プロキシフォールバック戦略:
# 1. まず直接接続（プロキシなし）で試行
# 2. 失敗した場合、プロキシ経由でリトライ
# → プロキシが不要な環境ではオーバーヘッドなし、必要な環境では自動切替

PROXY = os.environ.get("YFINANCE_PROXY", "")
_SESSION_POOL_SIZE = 5

# 直接接続用プール
_direct_pool: list[CurlSession] = []
_direct_index = 0
_direct_lock = threading.Lock()

# プロキシ接続用プール（PROXY が設定されている場合のみ使用）
_proxy_pool: list[CurlSession] = []
_proxy_index = 0
_proxy_lock = threading.Lock()


def _create_session(*, use_proxy: bool = False) -> CurlSession:
    """curl_cffi Session を作成（use_proxy=True でプロキシ付き）"""
    session = CurlSession(impersonate="chrome")
    if use_proxy and PROXY:
        session.proxies = {"http": PROXY, "https": PROXY}
    return session


def _init_session_pools() -> None:
    """セッションプールを初期化（直接 + プロキシの2系統）"""
    global _direct_pool, _proxy_pool
    _direct_pool = [_create_session(use_proxy=False) for _ in range(_SESSION_POOL_SIZE)]
    logger.info(f"Direct session pool initialized: {_SESSION_POOL_SIZE} sessions")
    if PROXY:
        _proxy_pool = [_create_session(use_proxy=True) for _ in range(_SESSION_POOL_SIZE)]
        proxy_display = PROXY.split("@")[-1] if "@" in PROXY else PROXY
        logger.info(f"Proxy session pool initialized: {_SESSION_POOL_SIZE} sessions, proxy={proxy_display}")
    else:
        logger.info("No proxy configured, proxy fallback disabled")


def get_session(*, use_proxy: bool = False) -> CurlSession:
    """ラウンドロビンでセッションを取得（各セッションが独立した Cookie を持つ）"""
    if use_proxy and PROXY:
        global _proxy_index
        with _proxy_lock:
            session = _proxy_pool[_proxy_index % _SESSION_POOL_SIZE]
            _proxy_index += 1
        return session
    else:
        global _direct_index
        with _direct_lock:
            session = _direct_pool[_direct_index % _SESSION_POOL_SIZE]
            _direct_index += 1
        return session


def _refresh_all_sessions(*, use_proxy: bool = False) -> None:
    """rate limit 時にセッションを新しい Cookie で再作成する"""
    if use_proxy and PROXY:
        with _proxy_lock:
            for i in range(_SESSION_POOL_SIZE):
                _proxy_pool[i] = _create_session(use_proxy=True)
        logger.info(f"All {_SESSION_POOL_SIZE} proxy sessions refreshed due to rate limit")
    else:
        with _direct_lock:
            for i in range(_SESSION_POOL_SIZE):
                _direct_pool[i] = _create_session(use_proxy=False)
        logger.info(f"All {_SESSION_POOL_SIZE} direct sessions refreshed due to rate limit")


_init_session_pools()


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if SIDECAR_SECRET:
        api_key = request.headers.get("x-api-key", "")
        if api_key != SIDECAR_SECRET:
            raise HTTPException(status_code=401, detail="Unauthorized")
    return await call_next(request)


# ========================================
# レート制限（直列化 + 1秒ディレイ）
# ========================================

_semaphore = asyncio.Semaphore(1)
_MIN_DELAY_S = 1.0
_REQUEST_TIMEOUT_S = 30.0  # yfinance リクエストのタイムアウト（秒）


async def throttled(fn: Callable[[], T]) -> T:
    """Yahoo Finance へのリクエストを直列化し、リクエスト間に1秒ディレイを入れる"""
    async with _semaphore:
        loop = asyncio.get_event_loop()
        result: T = await asyncio.wait_for(
            loop.run_in_executor(None, fn),  # type: ignore[arg-type]
            timeout=_REQUEST_TIMEOUT_S,
        )
        await asyncio.sleep(_MIN_DELAY_S)
        return result


# ========================================
# リトライ
# ========================================

_RETRY_MAX = 2  # 最大2回リトライ（計3回試行）
_RETRY_DELAY_S = 2.0


def _is_retryable(e: Exception) -> bool:
    """リトライ可能なエラーか判定（rate limit は除外 — 呼び出し側のバックオフに委ねる）"""
    # rate limit はサイドカーではリトライしない
    if _is_rate_limit_error(e):
        return False
    # asyncio.wait_for によるタイムアウト
    if isinstance(e, (asyncio.TimeoutError, TimeoutError)):
        return True
    msg = str(e)
    # yfinance 内部のパースエラー（'str' object has no attribute 'get' 等）
    if "has no attribute" in msg:
        return True
    # ネットワーク系
    if any(code in msg for code in ("ConnectionError", "Timeout", "ReadTimeout")):
        return True
    return False


async def throttled_with_retry(fn: Callable[[CurlSession], T]) -> T:
    """throttled + リトライ + プロキシフォールバック

    fn は CurlSession を受け取る callable。
    1. まず直接接続セッションで最大3回試行
    2. すべて失敗し、PROXY が設定されていればプロキシセッションで最大3回試行
    """
    last_error: Exception | None = None

    # フェーズ1: 直接接続で試行
    for attempt in range(_RETRY_MAX + 1):
        try:
            session = get_session(use_proxy=False)
            return await throttled(lambda: fn(session))
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e):
                _refresh_all_sessions(use_proxy=False)
                # プロキシがあればフォールバックへ、なければ即 raise
                if not PROXY:
                    raise
                logger.info(f"Rate limited on direct connection, falling back to proxy")
                break
            if not _is_retryable(e) or attempt >= _RETRY_MAX:
                if not PROXY:
                    raise
                # 直接接続で全リトライ失敗 → プロキシフォールバックへ
                logger.info(f"Direct connection failed after {attempt + 1} attempt(s): {e}, falling back to proxy")
                break
            logger.warning(
                f"リトライ(direct) {attempt + 1}/{_RETRY_MAX} after {_RETRY_DELAY_S}s: {e}"
            )
            await asyncio.sleep(_RETRY_DELAY_S)
    else:
        # for-else: break せずにループ完了 = PROXY なしで全リトライ失敗
        raise last_error  # type: ignore[misc]

    # フェーズ2: プロキシで試行（PROXY が設定されている場合のみ到達）
    for attempt in range(_RETRY_MAX + 1):
        try:
            session = get_session(use_proxy=True)
            return await throttled(lambda: fn(session))
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e):
                _refresh_all_sessions(use_proxy=True)
                raise
            if not _is_retryable(e) or attempt >= _RETRY_MAX:
                raise
            logger.warning(
                f"リトライ(proxy) {attempt + 1}/{_RETRY_MAX} after {_RETRY_DELAY_S}s: {e}"
            )
            await asyncio.sleep(_RETRY_DELAY_S)
    raise last_error  # type: ignore[misc]


# ========================================
# ユーティリティ
# ========================================

def _is_rate_limit_error(e: Exception) -> bool:
    """レート制限エラーかどうか判定"""
    if YFRateLimitError is not None and isinstance(e, YFRateLimitError):
        return True
    msg = str(e).lower()
    return "rate limit" in msg or "too many requests" in msg or "429" in msg


def _error_status(e: Exception) -> int:
    """例外に応じた HTTP ステータスコードを返す"""
    if _is_rate_limit_error(e):
        return 429
    if isinstance(e, (asyncio.TimeoutError, TimeoutError)):
        return 504
    return 500


def _error_detail(e: Exception) -> str:
    """例外のエラーメッセージを返す（空なら型名を使う）"""
    msg = str(e)
    if msg:
        return msg
    return f"{type(e).__name__}: request timed out after {_REQUEST_TIMEOUT_S}s"


def safe_float(value: Any, default: float = 0.0) -> float:
    """NaN/None を安全に変換"""
    if value is None:
        return default
    try:
        f = float(value)
        return default if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return default


def safe_float_or_none(value: Any) -> float | None:
    """NaN/None → None"""
    if value is None:
        return None
    try:
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _flatten_columns(df) -> None:
    """yf.download() が返す MultiIndex カラムをフラット化する（in-place）

    yfinance 1.x では単一銘柄でも MultiIndex カラム
    (e.g. ('Close', 'USDJPY=X')) を返すため、'Close' 等で
    アクセスできるようレベルを落とす。
    """
    if hasattr(df, "columns") and hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)


def _df_to_bars(df, *, require_positive_close: bool = False) -> list[dict]:
    """DataFrame を OHLCV バー一覧に変換する共通ヘルパー"""
    if df is None or df.empty:
        return []
    _flatten_columns(df)
    bars = []
    for date, row in df.iterrows():
        o = safe_float_or_none(row.get("Open"))
        h = safe_float_or_none(row.get("High"))
        l = safe_float_or_none(row.get("Low"))
        c = safe_float_or_none(row.get("Close"))
        if o is None or h is None or l is None or c is None:
            continue
        if require_positive_close and c <= 0:
            continue
        ts = date if hasattr(date, "strftime") else date[1] if isinstance(date, tuple) else date
        bars.append({
            "date": ts.strftime("%Y-%m-%d"),
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": safe_float(row.get("Volume")),
        })
    return bars


# ========================================
# エンドポイント
# ========================================

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/fx/daily")
async def fx_daily(ticker: str, start: str, end: str):
    """
    FX 日足データを取得する。

    ticker: yfinance FX ticker (e.g. 'USDJPY=X', 'EURUSD=X', 'GBPUSD=X')
    start, end: 'YYYY-MM-DD'
    """
    try:
        def _fetch(session: CurlSession):
            t = yf.Ticker(ticker, session=session)
            df = t.history(start=start, end=end, interval="1d", auto_adjust=False)
            return df

        df = await throttled_with_retry(_fetch)
        bars = _df_to_bars(df)
        return {"ticker": ticker, "bars": bars}
    except Exception as e:
        logger.error(f"Failed to fetch fx/daily for {ticker}: {e}")
        raise HTTPException(status_code=_error_status(e), detail=_error_detail(e))


@app.get("/fx/intraday")
async def fx_intraday(ticker: str, interval: str, start: str, end: str):
    """
    Fetch intraday FX bars from yfinance.

    ticker: yfinance FX ticker, e.g. 'USDJPY=X'
    interval: '1h' (only supported value)
    start, end: 'YYYY-MM-DD'
    """
    if interval != "1h":
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")

    try:
        def _fetch(session: CurlSession):
            t = yf.Ticker(ticker, session=session)
            df = t.history(start=start, end=end, interval="1h", auto_adjust=False)
            return df

        df = await throttled_with_retry(_fetch)

        if df is None or df.empty:
            return {"ticker": ticker, "interval": interval, "bars": []}

        _flatten_columns(df)
        bars = []
        for ts, row in df.iterrows():
            o = safe_float_or_none(row.get("Open"))
            h = safe_float_or_none(row.get("High"))
            l = safe_float_or_none(row.get("Low"))
            c = safe_float_or_none(row.get("Close"))
            if o is None or h is None or l is None or c is None:
                continue
            # ts is pandas Timestamp; convert to ISO UTC
            if hasattr(ts, "tz_convert"):
                ts_utc = ts.tz_convert("UTC") if ts.tzinfo else ts.tz_localize("UTC")
            else:
                ts_utc = ts
            dt_iso = ts_utc.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(ts_utc, "strftime") else str(ts_utc)
            bars.append({
                "datetime": dt_iso,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": safe_float_or_none(row.get("Volume")),
            })
        return {"ticker": ticker, "interval": interval, "bars": bars}
    except Exception as e:
        logger.error(f"Failed to fetch intraday for {ticker}: {e}")
        raise HTTPException(status_code=_error_status(e), detail=_error_detail(e))


# ========================================
# エントリーポイント
# ========================================

if __name__ == "__main__":
    port = int(os.environ.get("YFINANCE_PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
