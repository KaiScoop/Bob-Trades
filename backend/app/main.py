from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from typing import Any, Literal
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

logger = logging.getLogger(__name__)
app = FastAPI(title="Bob Trades API", version="0.1.0")

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:8000,http://localhost:8082,http://localhost:19006,http://127.0.0.1:8000,http://127.0.0.1:8082,http://127.0.0.1:19006",
    ).split(",")
    if origin.strip()
]
cors_origins.extend(("http://localhost:8081", "http://127.0.0.1:8081"))
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
    mobile_app: bool = False


class AuthRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


DEFAULT_AVATAR_URLS = [
    "https://i.pinimg.com/1200x/37/6d/8f/376d8f204dfadac0940b289c24e7ac0e.jpg",
    "https://i.pinimg.com/736x/0a/85/64/0a85642c09f1af906069b759e07d1b96.jpg",
    "https://i.pinimg.com/736x/a6/fe/b7/a6feb7bac92723e3940999e610b6773a.jpg",
    "https://i.pinimg.com/736x/fb/ae/69/fbae698674f40b5b3bd97e4399fb19ed.jpg",
    "https://i.pinimg.com/736x/92/46/33/9246333f7d3625fac1ba1267a7d18dff.jpg",
]


def _random_avatar_url() -> str:
    return random.choice(DEFAULT_AVATAR_URLS)


class ProfilePatchRequest(BaseModel):
    username: str | None = None
    dob: str | None = None
    avatar_url: str | None = None


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
                locked = float(coin.get("locked") or 0.0)
                positions.append(
                    {
                        "symbol": symbol,
                        "side": "Buy",
                        "size": size,
                        "free": max(size - locked, 0.0),
                        "locked": locked,
                        "usdValue": float(coin["usdValue"]) if coin.get("usdValue") else None,
                    }
                )
        return positions

    def fetch_orders(self) -> list[dict[str, Any]]:
        result = self._private_get(
            "/v5/order/realtime",
            {"category": "spot", "openOnly": "0", "limit": "50"},
        )
        return result.get("list", [])

    def fetch_order_activity(
        self,
        product: Literal["stocks", "spot", "futures", "options"],
        view: Literal["open", "history", "trades"],
        cursor: str | None,
        limit: int,
    ) -> dict[str, Any]:
        if product == "stocks":
            return {
                "supported": False,
                "message": "Stocks (TradFi) are not supported by the current Bybit integration.",
                "records": [],
                "count": 0,
                "next_cursor": None,
            }

        categories = {
            "spot": [("spot", {})],
            "futures": [("linear", {"settleCoin": "USDT"}), ("inverse", {"settleCoin": "USD"})],
            "options": [("option", {})],
        }[product]
        path = {
            "open": "/v5/order/realtime",
            "history": "/v5/order/history",
            "trades": "/v5/execution/list",
        }[view]

        cursor_state: dict[str, str] = {}
        if cursor:
            try:
                parsed_cursor = json.loads(cursor)
            except json.JSONDecodeError as error:
                raise ValueError("Invalid order activity cursor") from error
            if not isinstance(parsed_cursor, dict) or not all(
                isinstance(key, str) and isinstance(value, str)
                for key, value in parsed_cursor.items()
            ):
                raise ValueError("Invalid order activity cursor")
            cursor_state = parsed_cursor

        records: list[dict[str, Any]] = []
        next_cursors: dict[str, str] = {}
        for category, filters in categories:
            if cursor and category not in cursor_state:
                continue
            params = {"category": category, "limit": str(limit), **filters}
            if view == "open":
                params["openOnly"] = "0"
            elif view == "trades":
                params["execType"] = "Trade"
            if category in cursor_state:
                params["cursor"] = cursor_state[category]

            result = self._private_get(path, params)
            page_records = result.get("list", [])
            if isinstance(page_records, list):
                records.extend(record for record in page_records if isinstance(record, dict))
            next_page = result.get("nextPageCursor")
            if isinstance(next_page, str) and next_page:
                next_cursors[category] = next_page

        timestamp_fields = ("createdTime", "execTime", "updatedTime")
        records.sort(
            key=lambda record: next(
                (int(record[field]) for field in timestamp_fields if str(record.get(field, "")).isdigit()),
                0,
            ),
            reverse=True,
        )
        return {
            "supported": True,
            "message": None,
            "records": records,
            "count": len(records),
            "next_cursor": json.dumps(next_cursors, separators=(",", ":")) if next_cursors else None,
        }

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


@app.get("/markets/{symbol}/book")
def get_market_book(symbol: str) -> dict[str, object]:
    normalized = _ensure_symbol(symbol)
    return {
        "symbol": normalized,
        "book": _market_cache(f"mkt:{normalized}:book"),
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


async def _supabase_auth_request(
    path: str,
    body: dict[str, str | bool],
    params: dict[str, str] | None = None,
) -> Response:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{_get_supabase_url()}/auth/v1/{path}",
                headers={"apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"]},
                json=body,
                params=params,
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
    params = _mobile_auth_redirect_params(body)
    return await _supabase_auth_request(
        "otp", {"email": body.email, "create_user": True}, params
    )


@app.post("/auth/signin")
async def auth_signin(body: AuthEmail) -> Response:
    params = _mobile_auth_redirect_params(body)
    return await _supabase_auth_request(
        "otp", {"email": body.email, "create_user": False}, params
    )


def _mobile_auth_redirect_params(body: AuthEmail) -> dict[str, str] | None:
    if not body.mobile_app:
        return None
    redirect_url = os.environ.get("SUPABASE_AUTH_REDIRECT_URL", "").strip()
    if not redirect_url:
        raise HTTPException(status_code=503, detail="Mobile auth redirect is not configured")
    return {"redirect_to": redirect_url}


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


def _portfolio_details(mode: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    balance = snapshot.get("balance")
    if not isinstance(balance, dict):
        balance = {}

    info = balance.get("info")
    if not isinstance(info, dict):
        info = {}
    result = info.get("result")
    account_list = result.get("list") if isinstance(result, dict) else None
    account_summary = account_list[0] if isinstance(account_list, list) and account_list else {}
    if not isinstance(account_summary, dict):
        account_summary = {}

    equity_value = info.get("totalEquity") or info.get("totalWalletBalance")
    if equity_value is None:
        equity_value = account_summary.get("totalEquity") or account_summary.get("totalWalletBalance")

    usd_values: dict[str, float] = {}
    coin_details = account_summary.get("coin")
    if isinstance(coin_details, list):
        for coin in coin_details:
            if not isinstance(coin, dict) or coin.get("usdValue") is None:
                continue
            currency = coin.get("coin")
            if isinstance(currency, str):
                usd_values[currency] = float(coin["usdValue"])

    metadata_keys = {"free", "used", "total", "info", "timestamp", "datetime"}
    assets: list[dict[str, float | str | None]] = []
    for currency, amounts in balance.items():
        if currency in metadata_keys or not isinstance(amounts, dict):
            continue
        available = float(amounts.get("free") or 0.0)
        used_value = amounts.get("used")
        total_value = amounts.get("total")
        total = float(total_value) if total_value is not None else available + float(used_value or 0.0)
        locked = float(used_value) if used_value is not None else max(total - available, 0.0)
        if total <= 0:
            continue
        assets.append({
            "currency": currency,
            "total": total,
            "available": available,
            "locked": locked,
            "usd_value": usd_values.get(currency),
        })
    assets.sort(key=lambda item: (item["currency"] != "USDT", str(item["currency"])))

    return {
        "mode": mode,
        "balance": _cached_usdt_free({"balance": balance}),
        "asset": "USDT",
        "equity": float(equity_value) if equity_value is not None else None,
        "assets": assets,
    }


def _refresh_portfolio(user: AuthenticatedUser, mode: str, broker: BybitSpotExecution, symbol: str) -> None:
    balance = broker.fetch_balance()
    holdings = broker.fetch_holdings(symbol)
    _cache_portfolio(user.id, mode, balance, {symbol: holdings})


@app.get("/me")
def get_me(user: AuthenticatedUser = Depends(get_authenticated_user)) -> dict[str, Any]:
    response = _supabase_request(
        user,
        "GET",
        f"profiles?user_id=eq.{user.id}&select=user_id,username,dob,avatar_url",
        headers={"Accept": "application/json"},
    )
    rows = response.json()
    profile = rows[0] if rows else {"user_id": user.id, "username": None, "dob": None, "avatar_url": _random_avatar_url()}
    missing_avatar = not bool(profile.get("avatar_url"))
    if missing_avatar:
        profile["avatar_url"] = _random_avatar_url()
    if not rows or missing_avatar:
        _supabase_request(
            user,
            "POST",
            "profiles?on_conflict=user_id",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
            json={
                "user_id": user.id,
                "username": profile.get("username"),
                "dob": profile.get("dob"),
                "avatar_url": profile["avatar_url"],
            },
        )
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
    if body.avatar_url is not None:
        data["avatar_url"] = body.avatar_url
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
        return _portfolio_details(connection["mode"], cached)

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
    return _portfolio_details(connection["mode"], {"balance": balance})


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


@app.get("/orders/{product}/{view}")
def get_order_activity(
    product: Literal["stocks", "spot", "futures", "options"],
    view: Literal["open", "history", "trades"],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=50),
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    client = _get_user_client(user)
    try:
        return client.fetch_order_activity(product, view, cursor, limit)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except NotImplementedError as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    except (httpx.HTTPError, RuntimeError) as error:
        raise HTTPException(status_code=502, detail="Bybit order activity request failed") from error


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


@app.get("/agent/status")
def get_agent_status(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, Any]:
    connection = None
    try:
        connection = _load_broker_connection(user)
    except HTTPException:
        connection = None

    response = _supabase_request(
        user,
        "GET",
        f"agent_settings?user_id=eq.{user.id}&select=user_id,symbol,risk_profile,max_position_pct,agent_on,armed,updated_at&limit=1",
        headers={"Accept": "application/json"},
    )
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        return {
            "status": "stopped",
            "running": False,
            "symbol": None,
            "risk": None,
            "max_position_pct": None,
            "mode": connection["mode"] if connection else None,
            "armed": False,
            "updated_at": None,
        }

    settings = rows[0]
    return {
        "status": "running" if settings.get("agent_on") else "stopped",
        "running": bool(settings.get("agent_on", False)),
        "symbol": settings.get("symbol"),
        "risk": settings.get("risk_profile"),
        "max_position_pct": settings.get("max_position_pct"),
        "mode": connection["mode"] if connection else None,
        "armed": bool(settings.get("armed", False)),
        "updated_at": settings.get("updated_at"),
    }


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
    except ExecutionBlocked as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (ccxt.BaseError, RuntimeError) as error:
        logger.exception("Bybit position close failed for %s", normalized)
        raise HTTPException(status_code=502, detail="Bybit position close failed") from error
    try:
        _refresh_portfolio(user, connection["mode"], broker, normalized)
    except (ccxt.BaseError, httpx.HTTPError, RuntimeError, ValueError):
        logger.exception("Position %s closed but portfolio refresh failed", normalized)
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