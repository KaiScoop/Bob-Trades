import json
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import numpy as np
import pandas as pd

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


def set_cached_json(key: str, value: Any, ttl_seconds: int) -> None:
    response = httpx.post(
        _upstash_url(),
        json=["SET", key, json.dumps(value), "EX", str(ttl_seconds)],
        headers=_upstash_headers(),
        timeout=8,
    )
    response.raise_for_status()
    if response.json().get("result") != "OK":
        raise RuntimeError("Upstash rejected a cache write")


def claim_cache_key(key: str, ttl_seconds: int) -> bool:
    response = httpx.post(
        _upstash_url(),
        json=["SET", key, "1", "EX", str(ttl_seconds), "NX"],
        headers=_upstash_headers(),
        timeout=8,
    )
    response.raise_for_status()
    return response.json().get("result") == "OK"


def delete_cached_json(key: str) -> None:
    response = httpx.post(
        _upstash_url(),
        json=["DEL", key],
        headers=_upstash_headers(),
        timeout=8,
    )
    response.raise_for_status()


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


def _series(candles: list[dict[str, float | int]], key: str) -> pd.Series:
    return pd.Series([candle[key] for candle in candles], dtype="float64")


def _last(value: Any) -> float | None:
    return None if pd.isna(value) else round(float(value), 6)


def _wilder(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def _wma(series: pd.Series, period: int) -> pd.Series:
    weights = np.arange(1, period + 1, dtype="float64")
    return series.rolling(period).apply(
        lambda values: float((values * weights).sum() / weights.sum()), raw=True
    )


def calculate_indicators(candles: list[dict[str, float | int]]) -> dict[str, Any]:
    if not candles:
        return {}

    close = _series(candles, "close")
    high = _series(candles, "high")
    low = _series(candles, "low")
    volume = _series(candles, "volume")
    typical = (high + low + close) / 3
    moving_averages: dict[str, pd.Series] = {}
    for period in (10, 20, 30, 50, 100, 200):
        moving_averages[f"ema_{period}"] = close.ewm(
            span=period, adjust=False, min_periods=period
        ).mean()
        moving_averages[f"sma_{period}"] = close.rolling(period).mean()
    moving_averages["ichimoku_base_line_9_26_52_26"] = (
        high.rolling(26).max() + low.rolling(26).min()
    ) / 2
    volume_sum = volume.rolling(20).sum().replace(0, np.nan)
    moving_averages["vwma_20"] = (close * volume).rolling(20).sum() / volume_sum
    hull_half = _wma(close, 9 // 2)
    hull_full = _wma(close, 9)
    moving_averages["hull_ma_9"] = _wma(2 * hull_half - hull_full, int(9**0.5))

    delta = close.diff()
    average_gain = _wilder(delta.clip(lower=0), 14)
    average_loss = _wilder(-delta.clip(upper=0), 14)
    rsi = 100 - (100 / (1 + average_gain / average_loss.replace(0, np.nan)))
    rsi = rsi.mask((average_loss == 0) & (average_gain > 0), 100)
    rsi = rsi.mask((average_gain == 0) & (average_loss > 0), 0)
    trailing_high = high.rolling(14).max()
    trailing_low = low.rolling(14).min()
    stochastic_range = (trailing_high - trailing_low).replace(0, np.nan)
    stochastic_k = (100 * (close - trailing_low) / stochastic_range).rolling(3).mean()
    mean_deviation = typical.rolling(20).apply(
        lambda values: float(abs(values - values.mean()).mean()), raw=True
    )
    cci = (typical - typical.rolling(20).mean()) / (0.015 * mean_deviation)

    true_range = pd.concat(
        [high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1
    ).max(axis=1)
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0)
    minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0)
    atr14 = _wilder(true_range, 14)
    plus_di = 100 * _wilder(plus_dm, 14) / atr14
    minus_di = 100 * _wilder(minus_dm, 14) / atr14
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = _wilder(dx, 14)

    macd = close.ewm(span=12, adjust=False, min_periods=26).mean() - close.ewm(
        span=26, adjust=False, min_periods=26
    ).mean()
    macd_signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()
    stochastic_rsi_range = (rsi.rolling(14).max() - rsi.rolling(14).min()).replace(0, np.nan)
    stochastic_rsi = 100 * (rsi - rsi.rolling(14).min()) / stochastic_rsi_range
    stochastic_rsi_fast = stochastic_rsi.rolling(3).mean()
    williams = -100 * (trailing_high - close) / stochastic_range
    median_price = (high + low) / 2
    awesome = median_price.rolling(5).mean() - median_price.rolling(34).mean()
    momentum = close - close.shift(10)
    bull_bear = (high - close.ewm(span=13, adjust=False, min_periods=13).mean()) + (
        low - close.ewm(span=13, adjust=False, min_periods=13).mean()
    )
    true_low = pd.concat([low, close.shift()], axis=1).min(axis=1)
    buying_pressure = close - true_low
    ultimate_oscillator = (
        4 * buying_pressure.rolling(7).sum() / true_range.rolling(7).sum()
        + 2 * buying_pressure.rolling(14).sum() / true_range.rolling(14).sum()
        + buying_pressure.rolling(28).sum() / true_range.rolling(28).sum()
    ) / 7 * 100

    last_close = _last(close.iloc[-1])
    atr_pct = round(float(atr14.iloc[-1]) / float(close.iloc[-1]), 6) if last_close and last_close > 0 else None
    log_returns = np.log(close / close.shift())
    realized_vol_20 = _last(log_returns.rolling(20).std().iloc[-1])

    result = {name: _last(values.iloc[-1]) for name, values in moving_averages.items()}
    result.update(
        {
            "relative_strength_index_14": _last(rsi.iloc[-1]),
            "stochastic_percent_k_14_3_3": _last(stochastic_k.iloc[-1]),
            "commodity_channel_index_20": _last(cci.iloc[-1]),
            "average_directional_index_14": _last(adx.iloc[-1]),
            "awesome_oscillator": _last(awesome.iloc[-1]),
            "momentum_10": _last(momentum.iloc[-1]),
            "macd_level_12_26": _last(macd.iloc[-1]),
            "stochastic_rsi_fast_3_3_14_14": _last(stochastic_rsi_fast.iloc[-1]),
            "williams_percent_range_14": _last(williams.iloc[-1]),
            "bull_bear_power": _last(bull_bear.iloc[-1]),
            "ultimate_oscillator_7_14_28": _last(ultimate_oscillator.iloc[-1]),
            "ema20": _last(moving_averages["ema_20"].iloc[-1]),
            "sma50": _last(moving_averages["sma_50"].iloc[-1]),
            "rsi14": _last(rsi.iloc[-1]),
            "macd": _last(macd.iloc[-1]),
            "signal": _last(macd_signal.iloc[-1]),
            "atr14": _last(atr14.iloc[-1]),
            "atr_pct": atr_pct,
            "realized_vol_20": realized_vol_20,
            "rsi": _last(rsi.iloc[-1]),
            "ema_fast": _last(moving_averages["ema_10"].iloc[-1]),
            "ema_slow": _last(moving_averages["ema_20"].iloc[-1]),
        }
    )
    return result


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


def _ticker_book_commands(symbol: str) -> list[list[str]]:
    ticker_result = _market_json(
        "/v5/market/tickers",
        {"category": "spot", "symbol": symbol},
    )
    ticker_rows = ticker_result.get("list", [])
    if not ticker_rows:
        raise RuntimeError(f"Bybit returned no ticker for {symbol}")
    ticker = ticker_rows[0]
    book_result = _market_json(
        "/v5/market/orderbook",
        {"category": "spot", "symbol": symbol, "limit": "25"},
    )
    bid_rows = book_result.get("b", [])
    ask_rows = book_result.get("a", [])
    if not bid_rows or not ask_rows:
        raise RuntimeError(f"Bybit returned an empty orderbook for {symbol}")
    bid = float(bid_rows[0][0])
    ask = float(ask_rows[0][0])
    bid_base_l10 = sum(float(row[1]) for row in bid_rows[:10])
    ask_base_l10 = sum(float(row[1]) for row in ask_rows[:10])
    bid_depth_l1 = float(bid_rows[0][0]) * float(bid_rows[0][1])
    ask_depth_l1 = float(ask_rows[0][0]) * float(ask_rows[0][1])
    bid_depth_l10 = sum(float(row[0]) * float(row[1]) for row in bid_rows[:10])
    ask_depth_l10 = sum(float(row[0]) * float(row[1]) for row in ask_rows[:10])
    total_base = bid_base_l10 + ask_base_l10
    book = {
        "bid": bid,
        "ask": ask,
        "spread_bps": (ask - bid) / ((ask + bid) / 2) * 10_000,
        "mid": (ask + bid) / 2,
        "bid_depth_usdt_l1": bid_depth_l1,
        "ask_depth_usdt_l1": ask_depth_l1,
        "bid_depth_usdt_l10": bid_depth_l10,
        "ask_depth_usdt_l10": ask_depth_l10,
        "book_imbalance": (bid_base_l10 - ask_base_l10) / total_base if total_base else 0.0,
    }
    return [
        ["SET", f"mkt:{symbol}:ticker", json.dumps(ticker), "EX", "30"],
        ["SET", f"mkt:{symbol}:book", json.dumps(book), "EX", "30"],
    ]


def collect_fast_market_cycle(symbols: list[str]) -> None:
    commands = []
    for symbol in symbols:
        commands.extend(_ticker_book_commands(symbol))
    commands.append(["SET", "hb:market", str(int(time.time() * 1000)), "EX", "20"])
    _write_pipeline(commands)


def collect_market_cycle(symbols: list[str]) -> None:
    commands: list[list[str]] = []
    for symbol in symbols:
        commands.extend(_ticker_book_commands(symbol))

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