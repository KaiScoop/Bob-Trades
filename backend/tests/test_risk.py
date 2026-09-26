from worker import risk


def test_testnet_is_not_blocked_by_daily_loss(monkeypatch):
    monkeypatch.setenv("LIVE_KILL_SWITCH", "false")
    assert risk.check_daily_loss("u1", "testnet", {"USDT": {"total": 100.0}}) is None


def test_daily_loss_first_check_sets_baseline(monkeypatch):
    monkeypatch.setenv("LIVE_DAILY_LOSS_USDT", "10")
    stored = {}

    def get_value(key):
        if key not in stored:
            raise KeyError(key)
        return stored[key]

    monkeypatch.setattr(risk, "get_cached_json", get_value)
    monkeypatch.setattr(risk, "set_cached_json", lambda key, value, _ttl: stored.__setitem__(key, value))

    assert risk.check_daily_loss("u1", "mainnet", {"USDT": {"total": 100.0}}) is None
    assert any(key.startswith("risk:equity-start:u1:") for key in stored)


def test_daily_loss_arms_global_kill(monkeypatch):
    monkeypatch.setenv("LIVE_DAILY_LOSS_USDT", "10")
    stored = {}

    def get_value(key):
        if key == "kill:trading" and key in stored:
            return stored[key]
        if key.startswith("risk:equity-start:"):
            return 100.0
        raise KeyError(key)

    monkeypatch.setattr(risk, "get_cached_json", get_value)
    monkeypatch.setattr(risk, "set_cached_json", lambda key, value, _ttl: stored.__setitem__(key, value))

    reason = risk.check_daily_loss("u1", "mainnet", {"USDT": {"total": 85.0}})

    assert reason == "daily_loss_limit_exceeded"
    assert stored["kill:trading"]["active"] is True