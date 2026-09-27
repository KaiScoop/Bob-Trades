import os
import uuid
from typing import Any

import ccxt

from common.market_data import SUPPORTED_SYMBOLS, get_cached_json


class ExecutionBlocked(RuntimeError):
    pass


class BybitSpotExecution:
    def __init__(self, api_key: str, api_secret: str, mode: str):
        if mode not in {"testnet", "mainnet"}:
            raise ValueError("mode must be 'testnet' or 'mainnet'")
        self.mode = mode
        self.exchange = ccxt.bybit(
            {
                "apiKey": api_key,
                "secret": api_secret,
                "enableRateLimit": True,
                "options": {"defaultType": "spot"},
            }
        )
        if mode == "testnet":
            self.exchange.set_sandbox_mode(True)
        self.exchange.load_markets()

    @staticmethod
    def _exchange_symbol(symbol: str) -> str:
        normalized = symbol.upper().replace("-USD", "USDT")
        if normalized not in SUPPORTED_SYMBOLS:
            raise ValueError(f"Unsupported spot symbol: {symbol}")
        return f"{normalized[:-4]}/USDT"

    @staticmethod
    def _client_order_id(kind: str) -> str:
        return f"bt-{kind}-{uuid.uuid4().hex[:20]}"

    def _assert_order_allowed(self, symbol: str, *, closing: bool = False) -> None:
        self._exchange_symbol(symbol)
        if closing:
            return
        if os.getenv("LIVE_KILL_SWITCH", "0").lower() in {"1", "true"}:
            raise ExecutionBlocked("kill_switch_active")
        if self.mode == "mainnet":
            if os.getenv("LIVE_ARMED", "0").lower() not in {"1", "true"}:
                raise ExecutionBlocked("mainnet_unarmed")
            try:
                if float(os.getenv("LIVE_MAX_NOTIONAL_USDT", "")) <= 0:
                    raise ValueError
                if float(os.getenv("LIVE_DAILY_LOSS_USDT", "")) <= 0:
                    raise ValueError
            except ValueError as error:
                raise ExecutionBlocked("mainnet_caps_missing_or_invalid") from error
            allowed = {item.strip().upper() for item in os.getenv("LIVE_SYMBOLS", "").split(",") if item.strip()}
            legacy = symbol.upper().removesuffix("USDT") + "-USD"
            if symbol.upper() not in allowed and legacy not in allowed:
                raise ExecutionBlocked("symbol_not_armed_for_mainnet")
        redis_configured = bool(
            os.getenv("UPSTASH_REDIS_REST_URL") and os.getenv("UPSTASH_REDIS_REST_TOKEN")
        )
        if self.mode == "mainnet" and not redis_configured:
            raise ExecutionBlocked("mainnet_kill_switch_store_unavailable")
        if redis_configured:
            try:
                kill = get_cached_json("kill:trading")
            except KeyError:
                kill = None
            except Exception as error:
                raise ExecutionBlocked("kill_switch_state_unavailable") from error
            if kill is True or isinstance(kill, dict) and kill.get("active") is True:
                raise ExecutionBlocked("kill_switch_active")

    def _maximum_notional(self) -> float:
        variable = "LIVE_MAX_NOTIONAL_USDT" if self.mode == "mainnet" else "TESTNET_MAX_NOTIONAL_USDT"
        default = "" if self.mode == "mainnet" else "25"
        try:
            maximum = float(os.getenv(variable, default))
        except ValueError as error:
            raise ExecutionBlocked(f"{variable}_invalid") from error
        if maximum <= 0:
            raise ExecutionBlocked(f"{variable}_required")
        return maximum

    def _confirm_order(self, order: dict[str, Any], symbol: str) -> dict[str, Any]:
        if not order or not order.get("id"):
            raise RuntimeError("Bybit did not return an order id")
        filled = float(order.get("filled") or 0.0)
        if filled > 0:
            return order
        if str(order.get("status", "")).lower() == "closed":
            order["filled"] = float(order.get("amount") or 0.0)
            return order
        try:
            confirmed = self.exchange.fetch_order(order["id"], self._exchange_symbol(symbol))
        except Exception as error:
            raise RuntimeError("Could not confirm Bybit market-order fill") from error
        if float(confirmed.get("filled") or 0.0) <= 0:
            raise RuntimeError("Bybit market order was not filled")
        return confirmed

    def _precise_amount(self, symbol: str, amount: float, price: float, *, buy: bool) -> float:
        if amount <= 0 or price <= 0:
            raise ValueError("Order amount and price must be positive")
        market_symbol = self._exchange_symbol(symbol)
        market = self.exchange.market(market_symbol)
        amount = min(amount, self._maximum_notional() / price) if buy else amount
        precise = float(self.exchange.amount_to_precision(market_symbol, amount))
        minimum_amount = float((market.get("limits", {}).get("amount") or {}).get("min") or 0)
        minimum_cost = float((market.get("limits", {}).get("cost") or {}).get("min") or 0)
        notional = precise * price
        if precise <= 0 or precise < minimum_amount:
            raise ValueError("Order amount is below the exchange minimum")
        if minimum_cost and notional < minimum_cost:
            raise ValueError("Order notional is below the exchange minimum")
        if buy and notional > self._maximum_notional() + 1e-8:
            raise ValueError("Order exceeds the configured notional cap")
        return precise

    def fetch_balance(self) -> dict[str, Any]:
        return self.exchange.fetch_balance()

    def fetch_open_orders(self, symbol: str) -> list[dict[str, Any]]:
        return self.exchange.fetch_open_orders(self._exchange_symbol(symbol))

    def fetch_holdings(self, symbol: str) -> dict[str, float]:
        market_symbol = self._exchange_symbol(symbol)
        base = market_symbol.split("/")[0]
        balance = self.exchange.fetch_balance().get(base, {})
        return {
            "free": float(balance.get("free") or 0.0),
            "total": float(balance.get("total") or 0.0),
        }

    def create_market_order(self, symbol: str, side: str, amount: float) -> dict[str, Any]:
        closing = side.lower() == "sell"
        self._assert_order_allowed(symbol, closing=closing)
        market_symbol = self._exchange_symbol(symbol)
        ticker = self.exchange.fetch_ticker(market_symbol)
        price = float(
            (ticker.get("ask") or ticker.get("last") or 0.0)
            if side.lower() == "buy"
            else (ticker.get("bid") or ticker.get("last") or 0.0)
        )
        if price <= 0:
            price = float(ticker.get("last") or 0)
        precise = self._precise_amount(symbol, amount, price, buy=not closing)
        order = self.exchange.create_order(
            market_symbol,
            "market",
            side.lower(),
            precise,
            None,
            {"clientOrderId": self._client_order_id("entry"), "marketUnit": "baseCoin"},
        )
        return self._confirm_order(order, symbol)

    def attach_tp_sl(
        self,
        symbol: str,
        amount: float,
        take_profit: float,
        stop_loss: float,
    ) -> list[dict[str, Any]]:
        if take_profit <= 0 and stop_loss <= 0:
            raise ValueError("At least one TP or SL price is required")
        self._assert_order_allowed(symbol)
        market_symbol = self._exchange_symbol(symbol)
        ticker = self.exchange.fetch_ticker(market_symbol)
        price = float(ticker.get("last") or ticker.get("bid") or 0)
        precise = self._precise_amount(symbol, amount, price, buy=False)
        placed: list[dict[str, Any]] = []
        try:
            for kind, trigger_price in (("tp", take_profit), ("sl", stop_loss)):
                if trigger_price <= 0:
                    continue
                param_name = "takeProfitPrice" if kind == "tp" else "stopLossPrice"
                order = self.exchange.create_order(
                    market_symbol,
                    "market",
                    "sell",
                    precise,
                    None,
                    {
                        param_name: self.exchange.price_to_precision(market_symbol, trigger_price),
                        "triggerBy": "LastPrice",
                        "orderFilter": "StopOrder",
                        "clientOrderId": self._client_order_id(kind),
                    },
                )
                if not order or not order.get("id"):
                    raise RuntimeError(f"Bybit did not acknowledge the {kind.upper()} order")
                placed.append(order)
        except Exception:
            for order in placed:
                try:
                    self.exchange.cancel_order(order["id"], market_symbol)
                except Exception:
                    pass
            raise
        if len(placed) != sum(price > 0 for price in (take_profit, stop_loss)):
            raise RuntimeError("TP/SL protection is incomplete")
        return placed

    def close_position(self, symbol: str) -> dict[str, Any]:
        self._assert_order_allowed(symbol, closing=True)
        self.cancel_agent_protection_orders(symbol)
        holdings = self.fetch_holdings(symbol)
        if holdings["free"] <= 0:
            raise ValueError("No free spot holdings to close")
        market_symbol = self._exchange_symbol(symbol)
        amount = float(self.exchange.amount_to_precision(market_symbol, holdings["free"]))
        order = self.create_market_order(symbol, "sell", amount)
        return order

    def cancel_agent_protection_orders(self, symbol: str) -> None:
        market_symbol = self._exchange_symbol(symbol)
        for order in self.fetch_open_orders(symbol):
            info = order.get("info", {})
            client_id = str(order.get("clientOrderId") or info.get("orderLinkId") or "")
            if client_id.startswith("bt-"):
                self.exchange.cancel_order(order["id"], market_symbol)

    def update_tp_sl(self, symbol: str, take_profit: float, stop_loss: float) -> list[dict[str, Any]]:
        self._assert_order_allowed(symbol, closing=True)
        self.cancel_agent_protection_orders(symbol)
        holdings = self.fetch_holdings(symbol)
        if holdings["free"] <= 0:
            raise ValueError("No free spot holdings to protect")
        return self.attach_tp_sl(symbol, holdings["free"], take_profit, stop_loss)