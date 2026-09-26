import json
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

BYBIT_URL = "https://api.bybit.com"
SUPPORTED_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "LINKUSDT",
]
TIMEFRAMES = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "1h": "60",
    "4h": "240",
    "1d": "D",
}


def _upstash_url() -> str:
    url = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
    if not url or not os.environ.get("UPSTASH_REDIS_REST_TOKEN"):
        raise RuntimeError("Upstash Redis is not configured")
    return url


def _upstash_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {os.environ['UPSTASH_REDIS_REST_TOKEN']}"}


def get_cached_json(key: str) -> Any:
    response = httpx.post(
        _upstash_url(),
        json=["GET", key],
        headers=_upstash_headers(),
        timeout=8,
    )
    response.raise_for_status()
    result = response.json().get("result")
    if result is None:
        raise KeyError(key)
    return json.loads(result)


def _market_json(path: str, params: dict[str, str]) -> dict[str, Any]:
    response = httpx.get(
        f"{BYBIT_URL}{path}",
        params=params,
        timeout=8,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("retCode") != 0:
        raise RuntimeError(payload.get("retMsg", "Bybit public market request failed"))
    return payload.get("result", {})


def _ema(values: list[float], period: int) -> float:
    multiplier = 2 / (period + 1)
    current = values[0]
    for value in values[1:]:
        current = value * multiplier + current * (1 - multiplier)
    return current


def calculate_indicators(candles: list[dict[str, float | int]]) -> dict[str, Any]:
    closes = [float(candle["close"]) for candle in candles]
    changes = [current - previous for previous, current in zip(closes, closes[1:])]
    recent_changes = changes[-14:]
    gains = sum(max(change, 0.0) for change in recent_changes) / max(len(recent_changes), 1)
    losses = sum(max(-change, 0.0) for change in recent_changes) / max(len(recent_changes), 1)
    rsi = 100.0 if losses == 0 else 100 - (100 / (1 + gains / losses))
    ema_fast = _ema(closes, min(12, len(closes)))
    ema_slow = _ema(closes, min(26, len(closes)))
    macd = ema_fast - ema_slow
    return {
        "rsi": round(rsi, 4),
        "ema_fast": round(ema_fast, 8),
        "ema_slow": round(ema_slow, 8),
        "macd": round(macd, 8),
        "signal": "bullish" if macd > 0 else "bearish" if macd < 0 else "neutral",
    }


def _closed_candles(rows: list[list[str]], timeframe: str) -> list[dict[str, float | int]]:
    interval_ms = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}[timeframe]
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    candles = []
    for row in reversed(rows):
        timestamp = int(row[0])
        if timestamp + interval_ms > now_ms:
            continue
        candles.append(
            {
                "ts": timestamp,
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            }
        )
    return candles


def _write_pipeline(commands: list[list[str]]) -> None:
    response = httpx.post(
        f"{_upstash_url()}/pipeline",
        json=commands,
        headers=_upstash_headers(),
        timeout=10,
    )
    response.raise_for_status()
    results = response.json()
    if any(isinstance(item, dict) and item.get("error") for item in results):
        raise RuntimeError("Upstash rejected a market cache write")


def collect_market_cycle(symbols: list[str]) -> None:
    commands: list[list[str]] = []
    for symbol in symbols:
        ticker = _market_json(
            "/v5/market/tickers",
            {"category": "spot", "symbol": symbol},
        )
        ticker_rows = ticker.get("list", [])
        if ticker_rows:
            commands.append(["SET", f"mkt:{symbol}:ticker", json.dumps(ticker_rows[0]), "EX", "60"])

        for timeframe, interval in TIMEFRAMES.items():
            result = _market_json(
                "/v5/market/kline",
                {"category": "spot", "symbol": symbol, "interval": interval, "limit": "200"},
            )
            candles = _closed_candles(result.get("list", []), timeframe)
            if not candles:
                continue
            candle_key = f"mkt:{symbol}:{timeframe}:candles"
            indicator_key = f"ind:{symbol}:{timeframe}"
            ttl = "90000" if timeframe == "1d" else "7200"
            commands.extend(
                [
                    ["SET", candle_key, json.dumps(candles), "EX", ttl],
                    ["SET", indicator_key, json.dumps(calculate_indicators(candles)), "EX", ttl],
                ]
            )

    commands.append(["SET", "hb:market", str(int(time.time() * 1000)), "EX", "60"])
    _write_pipeline(commands)