import asyncio
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
import ccxt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.auth import AuthenticatedUser, get_authenticated_user
from common import config
from common.bybit_execution import BybitSpotExecution, ExecutionBlocked
from common.health import check_dependencies
from common.market_data import SUPPORTED_SYMBOLS, delete_cached_json, get_cached_json, set_cached_json
from worker.decision import RISK_ALIASES, _mainnet_block_reason

app = FastAPI(title="Bob Trades API", version="0.1.0")

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:8082,http://localhost:19006,http://127.0.0.1:8082,http://127.0.0.1:19006",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _ensure_symbol(symbol: str) -> str:
    normalized = symbol.upper()
    if normalized not in SUPPORTED_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} is not supported")
    return normalized


class BybitConnectRequest(BaseModel):
    mode: str = Field(default="testnet")
    api_key: str
    api_secret: str


class AuthEmail(BaseModel):
    email: str


class AuthRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class ProfilePatchRequest(BaseModel):
    username: str | None = None
    dob: str | None = None


class AgentStartRequest(BaseModel):
    symbol: str
    risk: str = "medium"
    max_position_pct: float = Field(default=0.2, gt=0, le=1)
    arm_live: bool = False


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


def create_bybit_execution(mode: str, api_key: str, api_secret: str) -> BybitSpotExecution:
    return BybitSpotExecution(api_key=api_key, api_secret=api_secret, mode=mode)


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
    request: Request,
    symbol: str = Query(default="BTCUSDT"),
    tf: str = Query(default="1m", pattern=r"^(1m|5m|15m|1h|4h|1d)$"),
    symbols: str | None = None,
) -> StreamingResponse:
    normalized = _ensure_symbol(symbol)
    normalized_symbols = (
        list(dict.fromkeys(_ensure_symbol(item) for item in symbols.split(",") if item))
        if symbols is not None
        else None
    )
    if normalized_symbols is not None and not normalized_symbols:
        raise HTTPException(status_code=422, detail="symbols must include at least one market")

    async def event_generator():
        previous_snapshot = None
        last_keepalive = asyncio.get_running_loop().time()
        while not await request.is_disconnected():
            if normalized_symbols is not None:
                tickers = await asyncio.gather(
                    *(
                        asyncio.to_thread(_market_cache, f"mkt:{market}:ticker")
                        for market in normalized_symbols
                    )
                )
                snapshot = {
                    "markets": [
                        {"symbol": market, "ticker": ticker}
                        for market, ticker in zip(normalized_symbols, tickers)
                    ]
                }
            else:
                ticker = await asyncio.to_thread(_market_cache, f"mkt:{normalized}:ticker")
                candles = await asyncio.to_thread(_market_cache, f"mkt:{normalized}:{tf}:candles")
                snapshot = {
                    "symbol": normalized,
                    "tf": tf,
                    "ticker": ticker,
                    "candles": candles[-3:],
                }
            fingerprint = json.dumps(snapshot, sort_keys=True)
            if fingerprint != previous_snapshot:
                event = "snapshot" if previous_snapshot is None else "update"
                yield f"event: {event}\ndata: {json.dumps({**snapshot, 'event': event})}\n\n"
                previous_snapshot = fingerprint
                last_keepalive = asyncio.get_running_loop().time()
            elif asyncio.get_running_loop().time() - last_keepalive >= 15:
                yield ": keep-alive\n\n"
                last_keepalive = asyncio.get_running_loop().time()
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
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


async def _supabase_auth_request(path: str, body: dict[str, str | bool]) -> Response:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{_get_supabase_url()}/auth/v1/{path}",
                headers={"apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"]},
                json=body,
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase Auth is unavailable") from error

    try:
        payload = response.json()
    except ValueError as error:
        raise HTTPException(status_code=503, detail="Invalid Supabase Auth response") from error
    if response.status_code >= 500:
        upstream_message = payload.get("msg") or payload.get("message") if isinstance(payload, dict) else None
        detail = "Supabase Auth request failed"
        if isinstance(upstream_message, str):
            detail = f"Supabase Auth request failed: {upstream_message}"
        raise HTTPException(status_code=503, detail=detail)
    return JSONResponse(status_code=response.status_code, content=payload)


@app.post("/auth/signup")
async def auth_signup(body: AuthEmail) -> Response:
    return await _supabase_auth_request("otp", {"email": body.email, "create_user": True})


@app.post("/auth/signin")
async def auth_signin(body: AuthEmail) -> Response:
    return await _supabase_auth_request("otp", {"email": body.email, "create_user": False})


@app.post("/auth/refresh")
async def auth_refresh(body: AuthRefreshRequest) -> Response:
    return await _supabase_auth_request(
        "token?grant_type=refresh_token",
        {"refresh_token": body.refresh_token},
    )


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


def _portfolio_cache(user_id: str, mode: str) -> dict[str, Any] | None:
    try:
        cached = get_cached_json(f"user:{user_id}:portfolio")
    except (httpx.HTTPError, KeyError, RuntimeError, ValueError):
        return None
    if not isinstance(cached, dict) or cached.get("mode") != mode:
        return None
    age_ms = int(time.time() * 1000) - int(cached.get("fetched_at", 0))
    return cached if 0 <= age_ms <= 10_000 else None


def _cache_portfolio(user_id: str, mode: str, balance: dict[str, Any], holdings: dict[str, Any] | None = None) -> None:
    try:
        set_cached_json(
            f"user:{user_id}:portfolio",
            {"mode": mode, "balance": balance, "holdings": holdings or {}, "fetched_at": int(time.time() * 1000)},
            10,
        )
    except (httpx.HTTPError, RuntimeError, ValueError):
        return


def _cached_usdt_free(snapshot: dict[str, Any]) -> float:
    return float((snapshot.get("balance", {}).get("USDT") or {}).get("free") or 0.0)


def _refresh_portfolio(user: AuthenticatedUser, mode: str, broker: BybitSpotExecution, symbol: str) -> None:
    balance = broker.fetch_balance()
    holdings = broker.fetch_holdings(symbol)
    _cache_portfolio(user.id, mode, balance, {symbol: holdings})


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
    _cache_portfolio(user.id, request.mode, balance)
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
        "balance": _cached_usdt_free(_portfolio_cache(user.id, connection["mode"]) or {}),
    }


@app.get("/portfolio")
def portfolio(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    connection = _load_broker_connection(user)
    if connection is None:
        raise HTTPException(status_code=404, detail="No Bybit connection found")

    cached = _portfolio_cache(user.id, connection["mode"])
    if cached is not None:
        return {
            "mode": connection["mode"],
            "balance": _cached_usdt_free(cached),
            "asset": "USDT",
        }

    client = create_bybit_client(
        connection["mode"],
        _decrypt_broker_secret(connection["key_enc"]),
        _decrypt_broker_secret(connection["secret_enc"]),
    )
    try:
        balance = client.fetch_balance()
    except (httpx.HTTPError, RuntimeError) as error:
        raise HTTPException(status_code=502, detail="Bybit balance request failed") from error
    _cache_portfolio(user.id, connection["mode"], balance)
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
    if os.getenv("TRADING_WORKER_ENABLED", "false").lower() not in {"1", "true"}:
        raise HTTPException(status_code=503, detail="Trading worker is disabled")
    symbol = _ensure_symbol(request.symbol)
    risk_profile = RISK_ALIASES.get(request.risk.lower())
    if risk_profile is None:
        raise HTTPException(status_code=422, detail="Unsupported risk profile")
    connection = _load_broker_connection(user)
    if connection is None:
        raise HTTPException(status_code=404, detail="No Bybit connection found")
    armed = connection["mode"] == "testnet"
    if connection["mode"] == "mainnet":
        if not request.arm_live:
            raise HTTPException(status_code=403, detail="Mainnet requires explicit arm_live confirmation")
        reason = _mainnet_block_reason(symbol, risk_profile)
        if reason:
            raise HTTPException(status_code=403, detail=reason)
        armed = True

    _supabase_request(
        user,
        "POST",
        "agent_settings?on_conflict=user_id",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={
            "user_id": user.id,
            "symbol": symbol,
            "risk_profile": risk_profile,
            "max_position_pct": request.max_position_pct,
            "agent_on": True,
            "armed": armed,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {
        "status": "started",
        "symbol": symbol,
        "risk": risk_profile,
        "max_position_pct": request.max_position_pct,
        "mode": connection["mode"],
        "armed": armed,
    }


@app.post("/agent/stop")
def stop_agent(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    _supabase_request(
        user,
        "POST",
        "agent_settings?on_conflict=user_id",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={
            "user_id": user.id,
            "agent_on": False,
            "armed": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"status": "stopped"}


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


@app.post("/agent/kill-switch")
def activate_kill_switch(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    admins = {value.strip() for value in os.getenv("TRADING_ADMIN_USER_IDS", "").split(",") if value.strip()}
    if user.id not in admins:
        raise HTTPException(status_code=403, detail="User is not authorized to arm the global kill switch")
    set_cached_json(
        "kill:trading",
        {"active": True, "reason": "admin_requested", "user_id": user.id, "armed_at": int(time.time() * 1000)},
        7 * 86_400,
    )
    return {"active": True, "expires_in_seconds": 7 * 86_400}


@app.post("/positions/{symbol}/close")
def close_position(
    symbol: str,
    body: dict[str, Any] | None = None,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    normalized = _ensure_symbol(symbol)
    try:
        connection = _load_broker_connection(user)
        if connection is None:
            raise HTTPException(status_code=404, detail="No Bybit connection found")
        broker = create_bybit_execution(
            connection["mode"],
            _decrypt_broker_secret(connection["key_enc"]),
            _decrypt_broker_secret(connection["secret_enc"]),
        )
        result = broker.close_position(normalized)
        _refresh_portfolio(user, connection["mode"], broker, normalized)
    except ExecutionBlocked as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except HTTPException:
        raise
    except (ccxt.BaseError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Bybit position close failed") from error
    return {"status": "closed", "symbol": normalized, "result": result}


@app.post("/positions/{symbol}/tpsl")
def update_position_tpsl(
    symbol: str,
    body: TpslUpdateRequest,
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    normalized = _ensure_symbol(symbol)
    try:
        connection = _load_broker_connection(user)
        if connection is None:
            raise HTTPException(status_code=404, detail="No Bybit connection found")
        broker = create_bybit_execution(
            connection["mode"],
            _decrypt_broker_secret(connection["key_enc"]),
            _decrypt_broker_secret(connection["secret_enc"]),
        )
        result = broker.update_tp_sl(normalized, float(body.tp), float(body.sl))
        _refresh_portfolio(user, connection["mode"], broker, normalized)
    except ExecutionBlocked as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except HTTPException:
        raise
    except (ccxt.BaseError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Bybit TP/SL update failed") from error
    return {"status": "updated", "symbol": normalized, "tp": float(body.tp), "sl": float(body.sl), "result": result}


@app.delete("/broker/bybit")
def disconnect_bybit(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, bool]:
    _supabase_request(
        user,
        "POST",
        "agent_settings?on_conflict=user_id",
        headers={
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={"user_id": user.id, "agent_on": False, "armed": False},
    )
    _supabase_request(
        user,
        "DELETE",
        f"broker_connections?user_id=eq.{user.id}&venue=eq.bybit",
        headers={"Prefer": "return=minimal"},
    )
    try:
        delete_cached_json(f"user:{user.id}:portfolio")
    except (httpx.HTTPError, RuntimeError):
        pass
    return {"deleted": True}