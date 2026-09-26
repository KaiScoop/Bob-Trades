from datetime import datetime, timezone

from common import market_data


def test_indicator_calculation_returns_finite_values():
    candles = [
        {"ts": index, "open": float(index), "high": float(index + 1), "low": float(index - 1), "close": float(index), "volume": 1.0}
        for index in range(1, 31)
    ]

    indicators = market_data.calculate_indicators(candles)

    assert 0 <= indicators["rsi"] <= 100
    assert indicators["ema_fast"] > 0
    assert indicators["ema_slow"] > 0
    assert indicators["signal"] in {"bullish", "bearish", "neutral"}


def test_closed_candle_filter_excludes_current_interval():
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    rows = [
        [str(now_ms - 120_000), "10", "12", "9", "11", "100"],
        [str(now_ms - 30_000), "11", "13", "10", "12", "200"],
    ]

    candles = market_data._closed_candles(rows, "1m")

    assert len(candles) == 1
    assert candles[0]["close"] == 11.0


def test_market_cycle_writes_ticker_candles_indicators_and_heartbeat(monkeypatch):
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    kline_rows = [
        [str(now_ms - 3 * 86_400_000), "10", "12", "9", "11", "100"],
        [str(now_ms - 2 * 86_400_000), "11", "13", "10", "12", "200"],
    ]
    writes = []

    def fake_market_json(path, params):
        if path.endswith("tickers"):
            return {"list": [{"symbol": params["symbol"], "lastPrice": "12"}]}
        return {"list": kline_rows}

    monkeypatch.setattr(market_data, "_market_json", fake_market_json)
    monkeypatch.setattr(market_data, "_write_pipeline", writes.append)

    market_data.collect_market_cycle(["BTCUSDT"])

    commands = writes[0]
    keys = {command[1] for command in commands}
    assert "mkt:BTCUSDT:ticker" in keys
    assert "mkt:BTCUSDT:1m:candles" in keys
    assert "ind:BTCUSDT:1m" in keys
    assert "mkt:BTCUSDT:1d:candles" in keys
    assert "hb:market" in keys