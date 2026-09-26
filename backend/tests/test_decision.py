from worker.decision import gate_decision


def decision_fixture(action="buy", confidence=0.9):
    answers = {
        "action_choice": {"type": "choice", "choice": action, "confidence": confidence},
        "low_reliability_setup": {"type": "noul", "noul": 0.1},
        "spread_too_wide": {"type": "noul", "noul": 0.1},
        "buying_quantity": {"type": "score", "score": 1.5},
        "selling_quantity": {"type": "score", "score": 1.5},
    }
    state = {
        "symbol": "BTCUSDT",
        "risk_appetite": "balanced",
        "volume": {"volume_ratio": 1.0},
    }
    return state, answers


def test_decision_requires_confidence_and_all_safety_judgments():
    state, answers = decision_fixture(confidence=0.59)
    result = gate_decision(state, answers, has_position=False, free_usdt=100.0, mode="testnet")
    assert not result.allowed
    assert result.reason == "below_confidence_threshold"

    answers["action_choice"]["confidence"] = 0.9
    answers.pop("low_reliability_setup")
    result = gate_decision(state, answers, has_position=False, free_usdt=100.0, mode="testnet")
    assert result.reason == "missing_safety_judgment"


def test_decision_blocks_market_and_position_risks():
    state, answers = decision_fixture()
    state["volume"]["volume_ratio"] = 0.4
    result = gate_decision(state, answers, has_position=False, free_usdt=100.0, mode="testnet")
    assert result.reason == "dead_volume"

    state["volume"]["volume_ratio"] = 1.0
    result = gate_decision(state, answers, has_position=True, free_usdt=100.0, mode="testnet")
    assert result.reason == "one_position_per_symbol"

    result = gate_decision(state, answers, has_position=False, free_usdt=0.0, mode="testnet")
    assert result.reason == "insufficient_free_usdt"


def test_decision_requires_mainnet_arming_caps_and_allowed_symbol(monkeypatch):
    state, answers = decision_fixture()
    result = gate_decision(state, answers, has_position=False, free_usdt=100.0, mode="mainnet")
    assert result.reason == "mainnet_unarmed"

    monkeypatch.setenv("LIVE_ARMED", "1")
    monkeypatch.setenv("LIVE_MAX_NOTIONAL_USDT", "20")
    monkeypatch.setenv("LIVE_DAILY_LOSS_USDT", "10")
    monkeypatch.setenv("LIVE_SYMBOLS", "ETHUSDT")
    result = gate_decision(state, answers, has_position=False, free_usdt=100.0, mode="mainnet")
    assert result.reason == "symbol_not_armed_for_mainnet"

    monkeypatch.setenv("LIVE_SYMBOLS", "BTC-USD")
    result = gate_decision(state, answers, has_position=False, free_usdt=100.0, mode="mainnet")
    assert result.allowed
    assert result.size_fraction == 1.0
    assert result.risk_multiplier == 0.75