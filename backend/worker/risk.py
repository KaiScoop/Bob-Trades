import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from common.market_data import SUPPORTED_SYMBOLS, get_cached_json, set_cached_json


def kill_switch_reason() -> str | None:
    if os.getenv("LIVE_KILL_SWITCH", "false").lower() in {"1", "true"}:
        return "environment_kill_switch"
    try:
        cached = get_cached_json("kill:trading")
    except KeyError:
        return None
    except Exception:
        return "kill_switch_state_unavailable"
    if cached is True or isinstance(cached, dict) and cached.get("active") is True:
        return str(cached.get("reason", "global_kill_switch")) if isinstance(cached, dict) else "global_kill_switch"
    return None


def arm_kill_switch(reason: str, user_id: str | None = None) -> None:
    set_cached_json(
        "kill:trading",
        {"active": True, "reason": reason, "user_id": user_id, "armed_at": int(time.time() * 1000)},
        7 * 86_400,
    )


def _account_equity_usdt(balance: dict[str, Any]) -> float:
    equity = float((balance.get("USDT") or {}).get("total") or 0.0)
    for asset, amounts in balance.items():
        if asset in {"USDT", "info", "timestamp", "datetime", "free", "used", "total"}:
            continue
        if not isinstance(amounts, dict):
            continue
        quantity = float(amounts.get("total") or 0.0)
        if quantity <= 0:
            continue
        symbol = f"{asset}USDT"
        if symbol not in SUPPORTED_SYMBOLS:
            continue
        ticker = get_cached_json(f"mkt:{symbol}:ticker")
        price = float(ticker.get("lastPrice") or 0.0)
        if price <= 0:
            raise RuntimeError(f"No valid market price for daily equity: {symbol}")
        equity += quantity * price
    return equity


def check_daily_loss(user_id: str, mode: str, balance: dict[str, Any]) -> str | None:
    if mode != "mainnet":
        return None
    reason = kill_switch_reason()
    if reason:
        return reason
    try:
        max_daily_loss = float(os.getenv("LIVE_DAILY_LOSS_USDT", ""))
    except ValueError:
        return "daily_loss_cap_missing_or_invalid"
    if max_daily_loss <= 0:
        return "daily_loss_cap_missing_or_invalid"

    now = datetime.now(timezone.utc)
    date_key = now.strftime("%Y%m%d")
    baseline_key = f"risk:equity-start:{user_id}:{date_key}"
    current_equity = _account_equity_usdt(balance)
    try:
        baseline = float(get_cached_json(baseline_key))
    except KeyError:
        seconds_to_midnight = (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1) - now).total_seconds()
        set_cached_json(baseline_key, current_equity, int(seconds_to_midnight) + 60)
        return None
    loss = baseline - current_equity
    if loss >= max_daily_loss:
        arm_kill_switch("daily_loss_limit_exceeded", user_id)
        return "daily_loss_limit_exceeded"
    return None