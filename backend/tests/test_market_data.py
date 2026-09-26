import math
from datetime import datetime, timezone

import httpx

from common import market_data


def test_indicator_calculation_returns_finite_values():
    candles = [
        {
            "ts": index,
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": float(index % 10 + 1),
        }
        for index in range(1, 261)
        for close in [100 + index * 0.05 + math.sin(index / 3) * 2]
    ]

    indicators = market_data.calculate_indicators(candles)

    assert 0 <= indicators["rsi"] <= 100
    assert indicators["ema_fast"] > 0
    assert indicators["ema_slow"] > 0
    assert isinstance(indicators["signal"], float)
    assert indicators["ema_200"] > 0
    assert indicators["average_directional_index_14"] is not None
    assert 0 <= indicators["stochastic_rsi_fast_3_3_14_14"] <= 100


def test_indicators_do_not_invent_long_history_values():
    candles = [
        {"ts": index, "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 1.0}
        for index in range(30)
    ]

    indicators = market_data.calculate_indicators(candles)

    assert indicators["ema_200"] is None
    assert indicators["sma_200"] is None


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
        if path.endswith("orderbook"):
            return {"b": [["100", "2"]], "a": [["102", "1"]]}
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


def test_fast_market_cycle_caches_orderbook_depth_and_fresh_heartbeat(monkeypatch):
    writes = []

    def fake_market_json(path, _params):
        if path.endswith("tickers"):
            return {"list": [{"lastPrice": "101.0"}]}
        return {"b": [["100", "2"], ["99", "3"]], "a": [["102", "1"], ["103", "4"]]}

    monkeypatch.setattr(market_data, "_market_json", fake_market_json)
    monkeypatch.setattr(market_data, "_write_pipeline", writes.append)

    market_data.collect_fast_market_cycle(["BTCUSDT"])

    commands = writes[0]
    cached_book = next(command for command in commands if command[1] == "mkt:BTCUSDT:book")
    book = __import__("json").loads(cached_book[2])
    assert book["spread_bps"] > 0
    assert book["bid_depth_usdt_l10"] == 497.0
    assert book["ask_depth_usdt_l10"] == 514.0
    assert commands[-1][1:2] == ["hb:market"]
    assert commands[-1][-1] == "20"


def test_candle_claim_is_atomic_and_expires(monkeypatch):
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://redis.upstash.io")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "token")
    commands = []
    responses = [
        httpx.Response(200, json={"result": "OK"}, request=httpx.Request("POST", "https://redis.upstash.io")),
        httpx.Response(200, json={"result": None}, request=httpx.Request("POST", "https://redis.upstash.io")),
    ]

    def fake_post(_url, **kwargs):
        commands.append(kwargs["json"])
        return responses.pop(0)

    monkeypatch.setattr(market_data.httpx, "post", fake_post)

    assert market_data.claim_cache_key("user:u:agent:BTCUSDT:123", 86_400)
    assert not market_data.claim_cache_key("user:u:agent:BTCUSDT:123", 86_400)
    assert commands[0][-2:] == ["86400", "NX"]