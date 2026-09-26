import pytest

from common.bybit_execution import BybitSpotExecution, ExecutionBlocked


class FakeExchange:
    def __init__(self):
        self.orders = []
        self.canceled = []
        self.sandbox = False

    def set_sandbox_mode(self, enabled):
        self.sandbox = enabled

    def load_markets(self):
        return None

    def market(self, _symbol):
        return {"limits": {"amount": {"min": 0.001}, "cost": {"min": 5}}}

    def amount_to_precision(self, _symbol, amount):
        return f"{amount:.3f}"

    def price_to_precision(self, _symbol, price):
        return f"{price:.2f}"

    def fetch_ticker(self, _symbol):
        return {"ask": 100.0, "bid": 99.9, "last": 100.0}

    def fetch_balance(self):
        return {"BTC": {"free": 0.02, "total": 0.02}}

    def fetch_open_orders(self, _symbol):
        return []

    def create_order(self, symbol, order_type, side, amount, price, params):
        order = {"id": f"order-{len(self.orders) + 1}", "symbol": symbol, "type": order_type, "side": side, "amount": amount, "filled": amount, "status": "closed", "price": price, "params": params}
        self.orders.append(order)
        return order

    def cancel_order(self, order_id, _symbol):
        self.canceled.append(order_id)


def broker(monkeypatch, mode="testnet"):
    exchange = FakeExchange()
    monkeypatch.setattr("common.bybit_execution.ccxt.bybit", lambda _config: exchange)
    monkeypatch.setattr("common.bybit_execution.get_cached_json", lambda _key: (_ for _ in ()).throw(KeyError(_key)))
    instance = BybitSpotExecution("key", "secret", mode)
    return instance, exchange


def test_testnet_market_entry_applies_precision_and_testnet_mode(monkeypatch):
    instance, exchange = broker(monkeypatch)

    result = instance.create_market_order("BTCUSDT", "buy", 0.059876)

    assert exchange.sandbox is True
    assert result["amount"] == 0.06
    assert result["params"]["marketUnit"] == "baseCoin"


def test_entry_rejects_orders_below_exchange_minimum(monkeypatch):
    instance, _exchange = broker(monkeypatch)

    with pytest.raises(ValueError, match="minimum"):
        instance.create_market_order("BTCUSDT", "buy", 0.001)


def test_tp_sl_orders_are_both_required_and_cleaned_on_partial_failure(monkeypatch):
    instance, exchange = broker(monkeypatch)

    orders = instance.attach_tp_sl("BTCUSDT", 0.06, 110.0, 90.0)

    assert len(orders) == 2
    assert {order["params"]["orderFilter"] for order in exchange.orders} == {"StopOrder"}
    assert {order["side"] for order in exchange.orders} == {"sell"}


def test_mainnet_entry_fails_closed_without_arming(monkeypatch):
    instance, _exchange = broker(monkeypatch, mode="mainnet")

    with pytest.raises(ExecutionBlocked, match="mainnet_unarmed"):
        instance.create_market_order("BTCUSDT", "buy", 0.02)