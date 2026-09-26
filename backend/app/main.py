import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth import AuthenticatedUser, get_authenticated_user
from common import config
from common.health import check_dependencies
from common.market_data import SUPPORTED_SYMBOLS, get_cached_json

app = FastAPI(title="Bob Trades API", version="0.1.0")

def _ensure_symbol(symbol: str) -> str:
    normalized = symbol.upper()
    if normalized not in SUPPORTED_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} is not supported")
    return normalized


class BybitConnectRequest(BaseModel):
    mode: str = Field(default="testnet")
    api_key: str
    api_secret: str


class ProfilePatchRequest(BaseModel):
    username: str | None = None
    dob: str | None = None


class AgentStartRequest(BaseModel):
    symbol: str
    risk: str = "medium"
    max_position_pct: float = 0.2


class TpslUpdateRequest(BaseModel):
    tp: float
    sl: float


def _get_user_client(user: AuthenticatedUser) -> BybitClient:
    connection = _load_broker_connection(user)
    if connection is None:
        raise HTTPException(status_code=404, detail="No Bybit connection found")
    api_key = _decrypt_broker_secret(connection["key_enc"])
    api_secret = _decrypt_broker_secret(connection["secret_enc"])
    return create_bybit_client(connection["mode"], api_key, api_secret)


class BybitClient:
    def __init__(self, mode: str, api_key: str, api_secret: str):
        self.mode = mode
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = (
            "https://api-testnet.bybit.com" if mode == "testnet" else "https://api.bybit.com"
        )

    def _get_signed_headers(self, method: str, path: str, query: str = "") -> dict[str, str]:
        timestamp = str(int(time.time() * 1000))
        recv_window = "5000"
        payload = f"{timestamp}{self.api_key}{recv_window}{query}"
        signature = hmac.new(
            self.api_secret.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "X-BAPI-API-KEY": self.api_key,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "X-BAPI-SIGN": signature,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _private_get(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        query = urlencode(params)
        response = httpx.get(
            f"{self.base_url}{path}?{query}",
            headers=self._get_signed_headers("GET", path, query),
            timeout=10,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Bybit request failed: {response.text}")
        payload = response.json()
        if payload.get("retCode") != 0:
            raise RuntimeError(payload.get("retMsg", "Bybit request failed"))
        return payload.get("result", {})

    def fetch_balance(self) -> dict[str, Any]:
        path = "/v5/account/wallet-balance"
        wallet = self._private_get(path, {"accountType": "UNIFIED"})
        accounts = wallet.get("list", []) if isinstance(wallet, dict) else []
        coins = [coin for account in accounts for coin in account.get("coin", [])]
        usdt = next((coin for coin in coins if coin.get("coin") == "USDT"), None)
        if usdt is None:
            return {"info": wallet, "USDT": {"free": 0.0}}
        free = float(usdt.get("availableToWithdraw") or usdt.get("walletBalance") or 0.0)
        return {"info": wallet, "USDT": {"free": free}}

    def fetch_positions(self) -> list[dict[str, Any]]:
        balance = self.fetch_balance()
        accounts = balance.get("info", {}).get("list", [])
        coins = [coin for account in accounts for coin in account.get("coin", [])]
        positions = []
        for coin in coins:
            symbol = f"{coin.get('coin', '')}USDT"
            size = float(coin.get("walletBalance") or 0.0)
            if symbol in SUPPORTED_SYMBOLS and size > 0:
                positions.append(
                    {
                        "symbol": symbol,
                        "side": "Buy",
                        "size": size,
                        "free": float(coin.get("availableToWithdraw") or 0.0),
                    }
                )
        return positions

    def fetch_orders(self) -> list[dict[str, Any]]:
        result = self._private_get(
            "/v5/order/realtime",
            {"category": "spot", "openOnly": "0", "limit": "50"},
        )
        return result.get("list", [])

    def close_position(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError("Spot position closing is not implemented")

    def update_tpsl(self, symbol: str, tp: float, sl: float) -> dict[str, Any]:
        raise NotImplementedError("Spot TP/SL updates are not implemented")


def create_bybit_client(mode: str, api_key: str, api_secret: str) -> BybitClient:
    mode = mode.lower()
    if mode not in {"testnet", "mainnet"}:
        raise ValueError("mode must be 'testnet' or 'mainnet'")
    if not api_key or not api_secret:
        raise ValueError("api_key and api_secret are required")
    return BybitClient(mode=mode, api_key=api_key, api_secret=api_secret)


def _market_cache(key: str) -> Any:
    try:
        return get_cached_json(key)
    except (httpx.HTTPError, KeyError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="Market data is unavailable") from error


@app.get("/health")
def health(response: Response) -> dict[str, object]:
    dependencies = check_dependencies()
    ready = all(dependencies.values())
    if not ready:
        response.status_code = 503
    return {
        "status": "ok" if ready else "degraded",
        "service": "api",
        "dependencies": dependencies,
    }


@app.get("/markets")
def get_markets() -> dict[str, list[str]]:
    return {"symbols": SUPPORTED_SYMBOLS}


@app.get("/markets/{symbol}/candles")
def get_market_candles(
    symbol: str,
    tf: str = Query(default="1m", pattern=r"^(1m|5m|15m|1h|4h|1d)$"),
) -> dict[str, str | list[dict[str, float | int | str]]]:
    normalized = _ensure_symbol(symbol)
    candles = _market_cache(f"mkt:{normalized}:{tf}:candles")
    return {"symbol": normalized, "tf": tf, "candles": candles}


@app.get("/markets/{symbol}/indicators")
def get_market_indicators(
    symbol: str,
    tf: str = Query(default="1m", pattern=r"^(1m|5m|15m|1h|4h|1d)$"),
) -> dict[str, object]:
    normalized = _ensure_symbol(symbol)
    return {
        "symbol": normalized,
        "tf": tf,
        "indicators": _market_cache(f"ind:{normalized}:{tf}"),
    }


@app.get("/stream")
def market_stream(
    symbol: str = Query(default="BTCUSDT"),
    tf: str = Query(default="1m", pattern=r"^(1m|5m|15m|1h|4h|1d)$"),
) -> StreamingResponse:
    normalized = _ensure_symbol(symbol)
    payload = {
        "symbol": normalized,
        "tf": tf,
        "ticker": _market_cache(f"mkt:{normalized}:ticker"),
        "candles": _market_cache(f"mkt:{normalized}:{tf}:candles")[-3:],
        "event": "snapshot",
    }

    async def event_generator():
        yield "event: snapshot\n"
        yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/auth/session")
def auth_session(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, str | None]:
    return {"user_id": user.id, "email": user.email}


def _supabase_headers(user: AuthenticatedUser) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {user.token}",
        "apikey": os.environ.get("SUPABASE_PUBLISHABLE_KEY", ""),
    }


def _get_supabase_url() -> str:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not supabase_url or not os.environ.get("SUPABASE_PUBLISHABLE_KEY"):
        raise HTTPException(status_code=503, detail="Supabase is not configured")
    return supabase_url


def _supabase_request(
    user: AuthenticatedUser,
    method: str,
    path: str,
    **kwargs: Any,
) -> httpx.Response:
    headers = {**_supabase_headers(user), **kwargs.pop("headers", {})}
    try:
        response = httpx.request(
            method,
            f"{_get_supabase_url()}/rest/v1/{path}",
            headers=headers,
            timeout=10,
            **kwargs,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase is unavailable") from error
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="Supabase request failed")
    return response


def _fernet() -> Fernet:
    key = os.environ.get("BROKER_ENCRYPTION_KEY", "")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as error:
        raise HTTPException(status_code=503, detail="Broker encryption is not configured") from error


def _encrypt_broker_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def _decrypt_broker_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeEncodeError) as error:
        raise HTTPException(status_code=503, detail="Stored broker credentials cannot be decrypted") from error


def _load_broker_connection(user: AuthenticatedUser) -> dict[str, Any] | None:
    response = _supabase_request(
        user,
        "GET",
        f"broker_connections?user_id=eq.{user.id}&venue=eq.bybit&select=mode,key_enc,secret_enc,status,updated_at&order=updated_at.desc&limit=1",
        headers={"Accept": "application/json"},
    )
    rows = response.json()
    if not isinstance(rows, list):
        raise HTTPException(status_code=503, detail="Invalid broker storage response")
    if not rows or rows[0].get("status") != "connected":
        return None
    return rows[0]


@app.get("/me")
def get_me(user: AuthenticatedUser = Depends(get_authenticated_user)) -> dict[str, Any]:
    response = _supabase_request(
        user,
        "GET",
        f"profiles?user_id=eq.{user.id}&select=user_id,username,dob",
        headers={"Accept": "application/json"},
    )
    rows = response.json()
    profile = rows[0] if rows else {"user_id": user.id, "username": None, "dob": None}
    return profile


@app.patch("/me")
def patch_me(
    body: ProfilePatchRequest,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    data: dict[str, str] = {}
    if body.username is not None:
        data["username"] = body.username
    if body.dob is not None:
        data["dob"] = body.dob
    if not data:
        return get_me(user)
    data["user_id"] = user.id

    response = _supabase_request(
        user,
        "POST",
        "profiles?on_conflict=user_id",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        json=data,
    )
    stored = response.json()
    profile = stored[0] if isinstance(stored, list) and stored else {"user_id": user.id, **data}
    return profile


@app.post("/broker/bybit")
def connect_bybit(
    request: BybitConnectRequest,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    if request.mode not in {"testnet", "mainnet"}:
        raise HTTPException(status_code=400, detail="mode must be 'testnet' or 'mainnet'")

    key_enc = _encrypt_broker_secret(request.api_key)
    secret_enc = _encrypt_broker_secret(request.api_secret)
    try:
        client = create_bybit_client(request.mode, request.api_key, request.api_secret)
        balance = client.fetch_balance()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Bybit is unavailable") from exc
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=401, detail="Bybit credentials rejected") from exc

    _supabase_request(
        user,
        "POST",
        "broker_connections?on_conflict=user_id,venue,mode",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={
            "user_id": user.id,
            "venue": "bybit",
            "mode": request.mode,
            "key_enc": key_enc,
            "secret_enc": secret_enc,
            "status": "connected",
        },
    )
    return {
        "status": "connected",
        "mode": request.mode,
        "balance": float(balance.get("USDT", {}).get("free", 0.0) or 0.0),
    }


@app.get("/broker/status")
def broker_status(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    connection = _load_broker_connection(user)
    if connection is None:
        return {"connected": False, "mode": None, "balance": 0.0}
    return {
        "connected": True,
        "mode": connection["mode"],
        "balance": 0.0,
    }


@app.get("/portfolio")
def portfolio(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    connection = _load_broker_connection(user)
    if connection is None:
        raise HTTPException(status_code=404, detail="No Bybit connection found")

    client = create_bybit_client(
        connection["mode"],
        _decrypt_broker_secret(connection["key_enc"]),
        _decrypt_broker_secret(connection["secret_enc"]),
    )
    try:
        balance = client.fetch_balance()
    except (httpx.HTTPError, RuntimeError) as error:
        raise HTTPException(status_code=502, detail="Bybit balance request failed") from error
    return {
        "mode": connection["mode"],
        "balance": float(balance.get("USDT", {}).get("free", 0.0) or 0.0),
        "asset": "USDT",
    }


@app.get("/positions")
def get_positions(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    client = _get_user_client(user)
    try:
        positions = client.fetch_positions()
    except NotImplementedError as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    except (httpx.HTTPError, RuntimeError) as error:
        raise HTTPException(status_code=502, detail="Bybit positions request failed") from error
    return {"positions": positions, "count": len(positions)}


@app.get("/orders")
def get_orders(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    client = _get_user_client(user)
    try:
        orders = client.fetch_orders()
    except NotImplementedError as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    except (httpx.HTTPError, RuntimeError) as error:
        raise HTTPException(status_code=502, detail="Bybit orders request failed") from error
    return {"orders": orders, "count": len(orders)}


@app.post("/agent/start")
def start_agent(
    request: AgentStartRequest,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    _get_user_client(user)
    _ensure_symbol(request.symbol)
    raise HTTPException(status_code=503, detail="Trading worker is not configured")


@app.post("/agent/stop")
def stop_agent(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    _get_user_client(user)
    raise HTTPException(status_code=503, detail="Trading worker is not configured")


@app.get("/agent/logs")
def get_agent_logs(
    user: AuthenticatedUser = Depends(get_authenticated_user),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    response = _supabase_request(
        user,
        "GET",
        f"agent_logs?user_id=eq.{user.id}&select=id,ts,latency_ms,request_json,response_json,intended,executed,reason&order=ts.desc&limit={limit}",
        headers={"Accept": "application/json"},
    )
    logs = response.json()
    if not isinstance(logs, list):
        raise HTTPException(status_code=503, detail="Invalid agent log response")
    return {"logs": logs}


@app.post("/positions/{symbol}/close")
def close_position(
    symbol: str,
    body: dict[str, Any] | None = None,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    normalized = _ensure_symbol(symbol)
    client = _get_user_client(user)
    close_method = getattr(client, "close_position", None)
    if close_method is None:
        raise HTTPException(status_code=501, detail="Spot position closing is not implemented")
    try:
        result = close_method(normalized)
    except NotImplementedError as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    return {"status": "closed", "symbol": normalized, "result": result}


@app.post("/positions/{symbol}/tpsl")
def update_position_tpsl(
    symbol: str,
    body: TpslUpdateRequest,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    normalized = _ensure_symbol(symbol)
    client = _get_user_client(user)
    update_method = getattr(client, "update_tpsl", None)
    if update_method is None:
        raise HTTPException(status_code=501, detail="Spot TP/SL updates are not implemented")
    try:
        result = update_method(normalized, float(body.tp), float(body.sl))
    except NotImplementedError as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    return {"status": "updated", "symbol": normalized, "tp": float(body.tp), "sl": float(body.sl), "result": result}


@app.delete("/broker/bybit")
def disconnect_bybit(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, bool]:
    _supabase_request(
        user,
        "DELETE",
        f"broker_connections?user_id=eq.{user.id}&venue=eq.bybit",
        headers={"Prefer": "return=minimal"},
    )
    return {"deleted": True}