from types import SimpleNamespace

from worker import jev


def test_jev_question_ids_match_reference_schema():
    assert set(jev.QUESTIONS) == {
        "action_choice",
        "trend_alignment",
        "overbought_condition",
        "volatility_regime",
        "signal_confluence",
        "buying_quantity",
        "selling_quantity",
        "stop_loss_target",
        "take_profit_target",
        "low_reliability_setup",
        "conviction_level",
        "liquidity_regime",
        "volume_regime",
        "spread_too_wide",
    }


def test_evaluate_jev_uses_server_key_and_preserves_raw_answers(monkeypatch):
    monkeypatch.setenv("JEV_API_KEY", "test-key")
    requests = []
    response = {"answers": {"action_choice": {"choice": "hold", "confidence": 0.9}}}

    class FakeClient:
        def __init__(self, **kwargs):
            requests.append({"client": kwargs})

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def system_one(self, *, state, questions):
            requests.append({"state": state, "questions": questions})
            return SimpleNamespace(raw_http_response=SimpleNamespace(json=lambda: response))

    monkeypatch.setattr(jev, "TypeSafeClient", FakeClient)
    state = {"symbol": "BTC-USD", "current_price": 100.0}

    result = jev.evaluate_jev(state)

    assert result == response
    assert requests[0]["client"] == {"api_key": "test-key", "model": jev.JEV_MODEL}
    assert requests[1]["state"] == state
    assert requests[1]["questions"] is jev.QUESTIONS