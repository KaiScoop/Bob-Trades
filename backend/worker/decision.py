import os
from dataclasses import dataclass
from typing import Any

RISK_ALIASES = {
    "conservative": "conservative",
    "low": "conservative",
    "balanced": "balanced",
    "medium": "balanced",
    "aggressive": "aggressive",
    "high": "aggressive",
}
CONFIDENCE_FLOORS = {"conservative": 0.75, "balanced": 0.60, "aggressive": 0.50}
SIZE_FRACTIONS = ((0.67, 0.25), (1.34, 0.50))
RISK_MULTIPLIERS = {"conservative": 0.50, "balanced": 0.75, "aggressive": 1.0}


@dataclass(frozen=True)
class DecisionGate:
    allowed: bool
    action: str
    reason: str
    confidence: float
    size_fraction: float
    risk_multiplier: float


def _noul(answers: dict[str, Any], question: str) -> float | None:
    answer = answers.get(question)
    if not isinstance(answer, dict) or answer.get("type") != "noul":
        return None
    try:
        return float(answer["noul"])
    except (KeyError, TypeError, ValueError):
        return None


def _score(answers: dict[str, Any], question: str) -> float | None:
    answer = answers.get(question)
    if not isinstance(answer, dict) or answer.get("type") != "score":
        return None
    try:
        return float(answer["score"])
    except (KeyError, TypeError, ValueError):
        return None


def _blocked(action: str, reason: str, confidence: float = 0.0) -> DecisionGate:
    return DecisionGate(False, action, reason, confidence, 0.0, 0.0)


def _mainnet_block_reason(symbol: str, risk: str) -> str | None:
    if os.getenv("LIVE_ARMED", "0").lower() not in {"1", "true"}:
        return "mainnet_unarmed"
    if os.getenv("LIVE_KILL_SWITCH", "0").lower() in {"1", "true"}:
        return "kill_switch_active"
    try:
        max_notional = float(os.getenv("LIVE_MAX_NOTIONAL_USDT", ""))
        daily_loss = float(os.getenv("LIVE_DAILY_LOSS_USDT", ""))
    except ValueError:
        return "mainnet_caps_missing"
    if max_notional <= 0 or daily_loss <= 0:
        return "mainnet_caps_invalid"
    live_symbols = {value.strip().upper() for value in os.getenv("LIVE_SYMBOLS", "").split(",") if value.strip()}
    normalized = symbol.upper()
    legacy_symbol = normalized.removesuffix("USDT") + "-USD"
    if not live_symbols or not ({normalized, legacy_symbol} & live_symbols):
        return "symbol_not_armed_for_mainnet"
    if risk == "aggressive" and os.getenv("LIVE_ALLOW_AGGRESSIVE", "0").lower() not in {"1", "true"}:
        return "aggressive_risk_disabled_on_mainnet"
    return None


def gate_decision(
    state: dict[str, Any],
    answers: dict[str, Any],
    *,
    has_position: bool,
    free_usdt: float,
    mode: str,
) -> DecisionGate:
    action_answer = answers.get("action_choice")
    if not isinstance(action_answer, dict) or action_answer.get("type") != "choice":
        return _blocked("hold", "missing_action_answer")
    action = str(action_answer.get("choice", "hold")).lower()
    try:
        confidence = float(action_answer.get("confidence", 0.0))
    except (TypeError, ValueError):
        return _blocked("hold", "invalid_action_confidence")
    if action not in {"buy", "sell", "hold"}:
        return _blocked("hold", "invalid_action")
    if action == "hold":
        return _blocked(action, "jev_hold", confidence)

    raw_risk = str(state.get("risk_appetite", "balanced")).lower()
    risk = RISK_ALIASES.get(raw_risk)
    if risk is None:
        return _blocked("hold", "invalid_risk_profile", confidence)
    if confidence < CONFIDENCE_FLOORS[risk]:
        return _blocked("hold", "below_confidence_threshold", confidence)

    low_reliability = _noul(answers, "low_reliability_setup")
    spread_too_wide = _noul(answers, "spread_too_wide")
    if low_reliability is None or spread_too_wide is None:
        return _blocked("hold", "missing_safety_judgment", confidence)
    if low_reliability >= 0.5:
        return _blocked("hold", "low_reliability_setup", confidence)
    if spread_too_wide >= 0.5:
        return _blocked("hold", "spread_too_wide", confidence)
    volume_ratio = state.get("volume", {}).get("volume_ratio")
    if volume_ratio is not None and float(volume_ratio) < 0.5:
        return _blocked("hold", "dead_volume", confidence)

    symbol = str(state.get("symbol", ""))
    if mode == "mainnet":
        reason = _mainnet_block_reason(symbol, risk)
        if reason:
            return _blocked("hold", reason, confidence)
    elif mode != "testnet":
        return _blocked("hold", "unsupported_broker_mode", confidence)

    if action == "buy":
        if has_position:
            return _blocked("hold", "one_position_per_symbol", confidence)
        if free_usdt <= 0:
            return _blocked("hold", "insufficient_free_usdt", confidence)
    elif not has_position:
        return _blocked("hold", "no_position_to_reduce", confidence)

    size_question = "buying_quantity" if action == "buy" else "selling_quantity"
    size_score = _score(answers, size_question)
    if size_score is None:
        return _blocked("hold", "missing_size_judgment", confidence)
    size_fraction = next((fraction for upper, fraction in SIZE_FRACTIONS if size_score < upper), 1.0)
    return DecisionGate(
        True,
        action,
        "confidence_and_risk_gates_passed",
        confidence,
        size_fraction,
        RISK_MULTIPLIERS[risk],
    )