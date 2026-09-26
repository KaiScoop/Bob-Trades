import os
from typing import Any

MOVING_AVERAGE_FIELDS = (
    "ema_10",
    "sma_10",
    "ema_20",
    "sma_20",
    "ema_30",
    "sma_30",
    "ema_50",
    "sma_50",
    "ema_100",
    "sma_100",
    "ema_200",
    "sma_200",
    "ichimoku_base_line_9_26_52_26",
    "vwma_20",
    "hull_ma_9",
)
OSCILLATOR_FIELDS = (
    "relative_strength_index_14",
    "stochastic_percent_k_14_3_3",
    "commodity_channel_index_20",
    "average_directional_index_14",
    "awesome_oscillator",
    "momentum_10",
    "macd_level_12_26",
    "stochastic_rsi_fast_3_3_14_14",
    "williams_percent_range_14",
    "bull_bear_power",
    "ultimate_oscillator_7_14_28",
)


def _legacy_symbol(symbol: str) -> str:
    return f"{symbol[:-4]}-USD" if symbol.endswith("USDT") else symbol


def build_jev_state(
    symbol: str,
    settings: dict[str, Any],
    candles: list[dict[str, Any]],
    indicators: dict[str, Any],
    ticker: dict[str, Any],
    book: dict[str, Any],
    balance: dict[str, Any],
    holdings: dict[str, float],
    execution: dict[str, Any],
) -> dict[str, Any]:
    if not candles:
        raise ValueError("A closed candle is required to build Jev state")
    close = float(candles[-1]["close"])
    current_price = float(ticker.get("lastPrice") or close)
    high = float(ticker.get("highPrice24h") or max(float(row["high"]) for row in candles))
    low = float(ticker.get("lowPrice24h") or min(float(row["low"]) for row in candles))
    open_price = float(ticker.get("prevPrice24h") or candles[0]["open"])
    volume_rows = candles[-20:]
    volumes = [float(row.get("volume") or 0) for row in volume_rows]
    last_bar_volume = volumes[-1] if volumes else 0.0
    volume_average = sum(volumes) / len(volumes) if volumes else None
    volume_ratio = last_bar_volume / volume_average if volume_average else None
    usdt = balance.get("USDT", {})
    free_usdt = float(usdt.get("free") or 0.0)
    used_usdt = float(usdt.get("used") or 0.0)
    total_usdt = float(usdt.get("total") or free_usdt + used_usdt)
    quantity = float(holdings.get("total") or 0.0)
    position = "Long" if quantity > 0 else "None"
    market_symbol = _legacy_symbol(symbol)
    ratio_24h = float(ticker.get("price24hPcnt") or 0.0)
    indicators = {name: indicators.get(name) for name in indicators}
    return {
        "symbol": market_symbol,
        "current_price": current_price,
        "oscillators": {name: indicators.get(name) for name in OSCILLATOR_FIELDS},
        "moving_averages": {name: indicators.get(name) for name in MOVING_AVERAGE_FIELDS},
        "position": position,
        "quantity": quantity,
        "time_frame": "1 minute",
        "cash_balance": free_usdt,
        "capital": total_usdt,
        "equity": total_usdt,
        "available_cash": free_usdt,
        "position_quantity": quantity,
        "average_entry_price": None,
        "unrealized_pnl_pct": 0.0,
        "stop_loss_price": None,
        "take_profit_price": None,
        "stop_loss_pct": None,
        "take_profit_pct": None,
        "position_age_bars": 0,
        "max_wallet_position_pct": float(settings["max_position_pct"]),
        "risk_appetite": settings["risk_profile"],
        "price": {
            "change_percent": ratio_24h * 100,
            "day_high": high,
            "day_low": low,
            "open_price": open_price,
            "day_volume": float(ticker.get("volume24h") or 0.0),
            "atr14": indicators.get("atr14"),
        },
        "liquidity": {
            "bid": book.get("bid"),
            "ask": book.get("ask"),
            "spread_bps": book.get("spread_bps"),
            "mid": book.get("mid"),
            "bid_depth_usdt_l1": book.get("bid_depth_usdt_l1"),
            "ask_depth_usdt_l1": book.get("ask_depth_usdt_l1"),
            "bid_depth_usdt_l10": book.get("bid_depth_usdt_l10"),
            "ask_depth_usdt_l10": book.get("ask_depth_usdt_l10"),
            "book_imbalance": book.get("book_imbalance"),
        },
        "volume": {
            "last_bar_base": last_bar_volume,
            "last_bar_quote": last_bar_volume * current_price,
            "volume_sma_20": volume_average,
            "volume_ratio": volume_ratio,
            "day_volume_quote": float(ticker.get("turnover24h") or 0.0),
        },
        "volatility": {
            "atr14": indicators.get("atr14"),
            "atr_pct": indicators.get("atr_pct"),
            "realized_vol_20": indicators.get("realized_vol_20"),
            "range_pct": round((high - low) / low * 100, 4) if low > 0 else None,
        },
        "execution": execution,
    }


def calculate_jev_targets(
    price: float,
    risk_profile: str,
    answers: dict[str, Any],
    atr: float | None,
) -> tuple[float, float, float, float]:
    stop_choice = answers.get("stop_loss_target", {}).get("choice", "moderate")
    profit_choice = answers.get("take_profit_target", {}).get("choice", "balanced")
    stop_risk = {"conservative": 0.8, "balanced": 1.0, "aggressive": 1.3}.get(risk_profile, 1.0)
    profit_risk = {"conservative": 0.9, "balanced": 1.0, "aggressive": 1.2}.get(risk_profile, 1.0)

    if atr is not None and atr > 0:
        stop_distance = atr * {"tight": 1.5, "moderate": 2.5, "wide": 4.0}.get(stop_choice, 2.5) * stop_risk
        profit_distance = atr * {"conservative": 2.0, "balanced": 4.0, "aggressive": 8.0}.get(profit_choice, 4.0) * profit_risk
        stop_pct = stop_distance / price * 100
        profit_pct = profit_distance / price * 100
    else:
        stop_pct = {"tight": 1.5, "moderate": 3.0, "wide": 5.0}.get(stop_choice, 3.0) * stop_risk
        profit_pct = {"conservative": 3.0, "balanced": 6.0, "aggressive": 10.0}.get(profit_choice, 6.0) * profit_risk
        stop_distance = price * stop_pct / 100
        profit_distance = price * profit_pct / 100
    return price - stop_distance, price + profit_distance, stop_pct, profit_pct


def calculate_entry_notional(
    state: dict[str, Any],
    gate: Any,
    free_usdt: float,
    *,
    mode: str,
) -> float:
    price = float(state["current_price"])
    equity = float(state.get("equity") or free_usdt)
    position_cap = equity * float(state["max_wallet_position_pct"])
    notional = min(free_usdt * 0.95, position_cap * gate.risk_multiplier * gate.size_fraction)
    atr_pct = state.get("volatility", {}).get("atr_pct")
    if atr_pct is not None and float(atr_pct) > 0:
        volatility_discount = max(0.2, min(1.0, 1.5 / (float(atr_pct) * 100)))
        notional *= volatility_discount
    ask_depth = state.get("liquidity", {}).get("ask_depth_usdt_l10")
    if ask_depth is not None and float(ask_depth) < notional * 3:
        notional = min(notional, float(ask_depth) / 3)
    if mode == "mainnet":
        notional = min(notional, float(os.environ["LIVE_MAX_NOTIONAL_USDT"]))
    if price <= 0:
        return 0.0
    return max(0.0, notional)