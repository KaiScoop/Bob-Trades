from worker import trading


def test_trading_cycle_is_dormant_by_default(monkeypatch):
    monkeypatch.setenv("TRADING_WORKER_ENABLED", "false")
    monkeypatch.setattr(
        trading,
        "_admin_request",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not query Supabase")),
    )

    assert trading.run_trading_cycle() == []


def test_trading_cycle_requires_worker_only_credentials(monkeypatch):
    monkeypatch.setenv("TRADING_WORKER_ENABLED", "true")
    monkeypatch.setenv("JEV_API_KEY", "test-key")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("BROKER_ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(
        trading,
        "_admin_request",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not query Supabase")),
    )

    assert trading.run_trading_cycle() == []


def test_process_agent_skips_stale_market_feed_and_logs(monkeypatch):
    logs = []
    monkeypatch.setattr(trading, "_cached", lambda key: [{"ts": 120_000}] if key.endswith(":candles") else None)
    monkeypatch.setattr(trading, "claim_cache_key", lambda *_args: True)
    monkeypatch.setattr(trading, "_log_decision", lambda *args: logs.append(args))

    result = trading._process_agent({"user_id": "user-1", "symbol": "BTCUSDT"})

    assert result["reason"] == "feed_stale"
    assert logs[0][-1] == "feed_stale"


def test_process_agent_deduplicates_closed_candle_before_jev(monkeypatch):
    calls = []
    now_ms = int(__import__("time").time() * 1000)
    cache = {
        "hb:market": now_ms,
        "mkt:BTCUSDT:1m:candles": [{"ts": now_ms - 60_000}],
        "ind:BTCUSDT:1m": {"atr14": 1.0},
        "mkt:BTCUSDT:ticker": {},
        "mkt:BTCUSDT:book": {"bid": 99.0, "ask": 101.0},
    }
    monkeypatch.setattr(trading, "_cached", lambda key: cache.get(key))
    monkeypatch.setattr(trading, "claim_cache_key", lambda key, _ttl: calls.append(key) or False)

    result = trading._process_agent({"user_id": "user-2", "symbol": "BTCUSDT"})

    assert result is None
    assert calls == [f"user:user-2:agent:claim:BTCUSDT:{now_ms - 60_000}"]


def test_process_agent_hold_decision_logs_without_order(monkeypatch):
    now_ms = 1_800_000_000_000
    cache = {
        "hb:market": now_ms,
        "mkt:BTCUSDT:1m:candles": [{"ts": now_ms - 60_000, "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 20.0}],
        "ind:BTCUSDT:1m": {"atr14": 1.0, "atr_pct": 0.01, "realized_vol_20": 0.001},
        "mkt:BTCUSDT:ticker": {"lastPrice": "100", "highPrice24h": "105", "lowPrice24h": "95", "volume24h": "500", "turnover24h": "50000"},
        "mkt:BTCUSDT:book": {"bid": 99.9, "ask": 100.1, "spread_bps": 20, "bid_depth_usdt_l10": 1000, "ask_depth_usdt_l10": 1000},
    }
    logs = []
    monkeypatch.setattr(trading, "_cached", lambda key: cache.get(key))
    monkeypatch.setattr(trading, "claim_cache_key", lambda *_args: True)
    monkeypatch.setattr(trading, "_load_broker_connection", lambda _user: {"mode": "testnet", "key_enc": "enc", "secret_enc": "enc"})
    monkeypatch.setattr(trading, "_decrypt", lambda value: value)
    monkeypatch.setattr(trading, "kill_switch_reason", lambda: None)

    class FakeBroker:
        def __init__(self, _api_key, _api_secret, _mode):
            self.exchange = self

        def market(self, _symbol):
            return {"limits": {"amount": {"min": 0.001}, "cost": {"min": 5}}, "info": {"lotSizeFilter": {"minNotionalValue": "5"}}, "precision": {}, "taker": 0.001}

        def fetch_balance(self):
            return {"USDT": {"free": 100.0, "total": 100.0}}

        def fetch_holdings(self, _symbol):
            return {"free": 0.0, "total": 0.0}

        def _exchange_symbol(self, symbol):
            return f"{symbol[:-4]}/USDT"

    monkeypatch.setattr(trading, "BybitSpotExecution", FakeBroker)
    monkeypatch.setattr(trading, "evaluate_jev", lambda state: {"answers": {"action_choice": {"type": "choice", "choice": "hold", "confidence": 0.99}}})
    monkeypatch.setattr(trading, "_log_decision", lambda *args: logs.append(args))
    monkeypatch.setattr(trading, "set_cached_json", lambda *_args: None)

    result = trading._process_agent({"user_id": "user-3", "symbol": "BTCUSDT", "risk_profile": "balanced", "max_position_pct": 0.2})

    assert result["reason"] == "jev_hold"
    assert result["executed"] is False
    assert logs[0][-1] == "jev_hold"