import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from cryptography.fernet import Fernet

from common.bybit_execution import BybitSpotExecution
from common.market_data import claim_cache_key, get_cached_json, set_cached_json
from worker.agent_state import build_jev_state, calculate_entry_notional, calculate_jev_targets
from worker.decision import gate_decision
from worker.jev import evaluate_jev
from worker.risk import check_daily_loss, kill_switch_reason

logger = logging.getLogger(__name__)


def _admin_request(method: str, path: str, *, body: dict[str, Any] | None = None) -> Any:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not service_key:
        raise RuntimeError("Worker Supabase service credentials are not configured")
    response = httpx.request(
        method,
        f"{url}/rest/v1/{path}",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
        },
        json=body,
        timeout=12,
    )
    response.raise_for_status()
    if response.status_code == 204 or not response.content:
        return None
    return response.json()


def _load_broker_connection(user_id: str) -> dict[str, Any]:
    rows = _admin_request(
        "GET",
        f"broker_connections?user_id=eq.{user_id}&venue=eq.bybit&status=eq.connected&select=mode,key_enc,secret_enc&order=updated_at.desc&limit=1",
    )
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("No connected Bybit account")
    return rows[0]


def _decrypt(value: str) -> str:
    key = os.environ.get("BROKER_ENCRYPTION_KEY", "")
    if not key:
        raise RuntimeError("Worker broker encryption is not configured")
    return Fernet(key.encode("ascii")).decrypt(value.encode("ascii")).decode("utf-8")


def _log_decision(
    user_id: str,
    latency_ms: int,
    state: dict[str, Any] | None,
    response: dict[str, Any],
    intended: bool,
    executed: bool,
    reason: str,
) -> None:
    _admin_request(
        "POST",
        "agent_logs",
        body={
            "user_id": user_id,
            "ts": datetime.now(timezone.utc).isoformat(),
            "latency_ms": latency_ms,
            "request_json": state,
            "response_json": response,
            "intended": intended,
            "executed": executed,
            "reason": reason,
        },
    )


def _cached(key: str) -> Any | None:
    try:
        return get_cached_json(key)
    except (KeyError, RuntimeError, httpx.HTTPError, ValueError):
        return None


def _log_skip(user_id: str, settings: dict[str, Any], candle_ts: int, reason: str) -> None:
    claim = f"user:{user_id}:agent:claim:{settings['symbol']}:{candle_ts}"
    if not claim_cache_key(claim, 86_400):
        return
    _log_decision(user_id, 0, None, {"event": "skipped", "reason": reason, "candle_ts": candle_ts}, False, False, reason)


def _fill_price(order: dict[str, Any]) -> float:
    return float(order.get("average") or order.get("price") or 0.0)


def _process_agent(settings: dict[str, Any]) -> dict[str, Any] | None:
    user_id = str(settings["user_id"])
    symbol = str(settings["symbol"]).upper()
    heartbeat = _cached("hb:market")
    if heartbeat is None or int(time.time() * 1000) - int(heartbeat) > 15_000:
        candles = _cached(f"mkt:{symbol}:1m:candles") or []
        candle_ts = int(candles[-1]["ts"]) if candles else int(time.time() // 60 * 60_000)
        _log_skip(user_id, settings, candle_ts, "feed_stale")
        return {"user_id": user_id, "reason": "feed_stale"}

    candles = _cached(f"mkt:{symbol}:1m:candles")
    if not candles:
        candle_ts = int(time.time() // 60 * 60_000)
        _log_skip(user_id, settings, candle_ts, "market_snapshot_incomplete")
        return {"user_id": user_id, "reason": "market_snapshot_incomplete"}

    candle_ts = int(candles[-1]["ts"])
    claim = f"user:{user_id}:agent:claim:{symbol}:{candle_ts}"
    if not claim_cache_key(claim, 86_400):
        return None

    indicators = _cached(f"ind:{symbol}:1m")
    ticker = _cached(f"mkt:{symbol}:ticker")
    book = _cached(f"mkt:{symbol}:book")
    if not indicators or not ticker or not book:
        _log_decision(
            user_id,
            0,
            None,
            {"event": "skipped", "reason": "market_snapshot_incomplete", "candle_ts": candle_ts},
            False,
            False,
            "market_snapshot_incomplete",
        )
        return {"user_id": user_id, "reason": "market_snapshot_incomplete"}

    kill_reason = kill_switch_reason()
    if kill_reason:
        _log_decision(user_id, 0, None, {"event": "blocked", "reason": kill_reason}, False, False, kill_reason)
        return {"user_id": user_id, "reason": kill_reason}

    connection = _load_broker_connection(user_id)
    broker = BybitSpotExecution(
        _decrypt(connection["key_enc"]),
        _decrypt(connection["secret_enc"]),
        connection["mode"],
    )
    balance = broker.fetch_balance()
    daily_loss_reason = check_daily_loss(user_id, connection["mode"], balance)
    if daily_loss_reason:
        _log_decision(
            user_id,
            0,
            None,
            {"event": "blocked", "reason": daily_loss_reason},
            False,
            False,
            daily_loss_reason,
        )
        return {"user_id": user_id, "reason": daily_loss_reason}
    usdt = balance.get("USDT", {})
    free_usdt = float(usdt.get("free") or 0.0)
    total_usdt = float(usdt.get("total") or free_usdt)
    holdings = broker.fetch_holdings(symbol)
    market = broker.exchange.market(broker._exchange_symbol(symbol))
    lot_size = market.get("limits", {}).get("amount", {})
    market_info = market.get("info", {}).get("lotSizeFilter", {})
    execution = {
        "venue": f"bybit-{connection['mode']}",
        "min_qty": lot_size.get("min"),
        "min_notional": market_info.get("minNotionalValue") or market.get("limits", {}).get("cost", {}).get("min"),
        "tick_size": market.get("precision", {}).get("price"),
        "taker_fee_bps": float(market.get("taker") or 0) * 10_000,
        "last_spread_bps": book.get("spread_bps"),
    }
    state = build_jev_state(
        symbol,
        settings,
        candles,
        indicators,
        ticker,
        book,
        {"USDT": {"free": free_usdt, "total": total_usdt}},
        holdings,
        execution,
    )
    started = time.perf_counter()
    try:
        result = evaluate_jev(state)
    except Exception as error:
        latency_ms = int((time.perf_counter() - started) * 1000)
        error_result = {"error_type": type(error).__name__, "candle_ts": candle_ts}
        _log_decision(user_id, latency_ms, state, error_result, False, False, "jev_request_failed")
        return {"user_id": user_id, "reason": "jev_request_failed"}
    latency_ms = int((time.perf_counter() - started) * 1000)
    answers = result.get("answers", {})
    gate = gate_decision(
        state,
        answers,
        has_position=holdings["total"] > 0,
        free_usdt=free_usdt,
        mode=connection["mode"],
    )
    response: dict[str, Any] = {"jev": result, "gate": {"allowed": gate.allowed, "action": gate.action, "reason": gate.reason}}
    executed = False
    intended = gate.action in {"buy", "sell"}
    reason = gate.reason

    if gate.allowed and gate.action == "buy":
        notional = calculate_entry_notional(state, gate, free_usdt, mode=connection["mode"])
        minimum = float(execution.get("min_notional") or 0.0)
        if notional <= 0 or notional < minimum:
            reason = "entry_below_exchange_minimum"
        else:
            amount = notional / state["current_price"]
            order = broker.create_market_order(symbol, "buy", amount)
            filled = float(order.get("filled") or 0.0)
            if filled <= 0:
                raise RuntimeError("Entry order was not filled")
            atr = state.get("volatility", {}).get("atr14")
            stop_loss, take_profit, _stop_pct, _profit_pct = calculate_jev_targets(
                state["current_price"], state["risk_appetite"], answers, atr
            )
            try:
                protection = broker.attach_tp_sl(symbol, filled, take_profit, stop_loss)
            except Exception:
                try:
                    from worker.risk import arm_kill_switch

                    arm_kill_switch("entry_protection_failed", user_id)
                    broker.close_position(symbol)
                finally:
                    raise RuntimeError("Entry protection failed; flatten was requested")
            response["order"] = order
            response["protection_orders"] = protection
            executed = True
            reason = "entry_and_protection_accepted"
    elif gate.allowed and gate.action == "sell":
        sell_amount = holdings["free"] * gate.size_fraction
        response["order"] = broker.create_market_order(symbol, "sell", sell_amount)
        remaining = broker.fetch_holdings(symbol)
        if remaining["free"] > 0:
            atr = state.get("volatility", {}).get("atr14")
            stop_loss, take_profit, _stop_pct, _profit_pct = calculate_jev_targets(
                state["current_price"], state["risk_appetite"], answers, atr
            )
            response["protection_orders"] = broker.update_tp_sl(symbol, take_profit, stop_loss)
            reason = "partial_position_reduced_and_protected"
        else:
            broker.cancel_agent_protection_orders(symbol)
            reason = "position_closed"
        executed = True

    response["gate"]["reason"] = reason
    _log_decision(user_id, latency_ms, state, response, intended, executed, reason)
    if executed:
        updated_balance = broker.fetch_balance()
        updated_holdings = broker.fetch_holdings(symbol)
        set_cached_json(
            f"user:{user_id}:portfolio",
            {"mode": connection["mode"], "balance": updated_balance, "holdings": {symbol: updated_holdings}, "fetched_at": int(time.time() * 1000)},
            10,
        )
    return {"user_id": user_id, "reason": reason, "executed": executed}


def run_trading_cycle() -> list[dict[str, Any]]:
    if os.getenv("TRADING_WORKER_ENABLED", "false").lower() not in {"1", "true"}:
        return []
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY") or not os.getenv("BROKER_ENCRYPTION_KEY"):
        return []
    if not (os.getenv("JEV_API_KEY") or os.getenv("TYPESAFE_API_KEY")):
        return []
    settings_rows = _admin_request(
        "GET",
        "agent_settings?agent_on=eq.true&armed=eq.true&select=user_id,symbol,risk_profile,max_position_pct,agent_on,armed",
    )
    if not isinstance(settings_rows, list):
        raise RuntimeError("Invalid agent settings response")
    outcomes = []
    for settings in settings_rows:
        try:
            outcome = _process_agent(settings)
            if outcome is not None:
                outcomes.append(outcome)
        except Exception as error:
            logger.exception("Agent cycle failed for user %s", settings.get("user_id"))
            outcomes.append({"user_id": settings.get("user_id"), "error_type": type(error).__name__})
    return outcomes