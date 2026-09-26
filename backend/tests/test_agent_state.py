from worker.agent_state import build_jev_state, calculate_entry_notional, calculate_jev_targets
from worker.decision import DecisionGate


def test_state_builder_preserves_legacy_names_and_live_market_fields():
    candles = [
        {"ts": 1, "open": 99.0, "high": 102.0, "low": 98.0, "close": 100.0, "volume": 10.0},
        {"ts": 2, "open": 100.0, "high": 104.0, "low": 99.0, "close": 103.0, "volume": 20.0},
    ]
    indicators = {
        "relative_strength_index_14": 50.0,
        "ema_20": 100.0,
        "atr14": 2.0,
        "atr_pct": 0.02,
        "realized_vol_20": 0.01,
    }
    state = build_jev_state(
        "BTCUSDT",
        {"risk_profile": "balanced", "max_position_pct": 0.2},
        candles,
        indicators,
        {"lastPrice": "103", "highPrice24h": "110", "lowPrice24h": "90", "volume24h": "500", "turnover24h": "50000"},
        {"bid": 102.9, "ask": 103.1, "spread_bps": 19.4, "bid_depth_usdt_l10": 500, "ask_depth_usdt_l10": 600, "book_imbalance": 0.1},
        {"USDT": {"free": 100.0, "used": 10.0, "total": 110.0}},
        {"free": 0.0, "total": 0.0},
        {"venue": "bybit-testnet", "min_qty": 0.0001, "min_notional": 5.0},
    )

    assert state["symbol"] == "BTC-USD"
    assert state["oscillators"]["relative_strength_index_14"] == 50.0
    assert state["moving_averages"]["ema_20"] == 100.0
    assert state["price"]["atr14"] == 2.0
    assert state["liquidity"]["ask_depth_usdt_l10"] == 600
    assert state["position"] == "None"
    assert state["cash_balance"] == 100.0


def test_target_calculation_and_notional_respect_risk_caps():
    sl, tp, sl_pct, tp_pct = calculate_jev_targets(
        100.0,
        "balanced",
        {"stop_loss_target": {"choice": "moderate"}, "take_profit_target": {"choice": "balanced"}},
        2.0,
    )
    assert (sl, tp) == (95.0, 108.0)
    assert (sl_pct, tp_pct) == (5.0, 8.0)

    state = {
        "current_price": 100.0,
        "equity": 100.0,
        "max_wallet_position_pct": 0.5,
        "volatility": {"atr_pct": None},
        "liquidity": {"ask_depth_usdt_l10": 60.0},
    }
    gate = DecisionGate(True, "buy", "ok", 0.9, 1.0, 1.0)
    assert calculate_entry_notional(state, gate, 100.0, mode="testnet") == 20.0