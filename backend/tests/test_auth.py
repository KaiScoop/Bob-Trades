import asyncio

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import auth
from app import main
from app.main import BybitClient, app


class StubAuthClient:
    def __init__(self, response: httpx.Response):
        self.response = response
        self.request_headers = None
        self.request_url = None
        self.request_json = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def get(self, url, headers):
        self.request_url = url
        self.request_headers = headers
        return self.response

    async def post(self, url, headers, json):
        self.request_url = url
        self.request_headers = headers
        self.request_json = json
        return self.response


def test_session_requires_bearer_token():
    response = TestClient(app).get("/auth/session")

    assert response.status_code == 401


def test_auth_session_validates_access_token_with_supabase(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    stub = StubAuthClient(
        httpx.Response(200, json={"id": "user-123", "email": "user@example.com"})
    )
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: stub)

    response = TestClient(app).get(
        "/auth/session",
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"user_id": "user-123", "email": "user@example.com"}
    assert stub.request_url == "https://project.supabase.co/auth/v1/user"
    assert stub.request_headers == {
        "apikey": "sb_publishable_test",
        "Authorization": "Bearer access-token",
    }


def test_auth_session_rejects_invalid_access_token(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    stub = StubAuthClient(httpx.Response(401, json={"msg": "Invalid token"}))
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: stub)

    response = TestClient(app).get(
        "/auth/session",
        headers={"Authorization": "Bearer invalid-access-token"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired access token"


def test_signup_and_signin_request_email_magic_links_from_supabase(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    stub = StubAuthClient(httpx.Response(200, json={"message_id": "message-123"}))
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: stub)
    client = TestClient(app)
    email = {"email": "user@example.com"}

    signup = client.post("/auth/signup", json=email)
    assert signup.status_code == 200
    assert stub.request_url == "https://project.supabase.co/auth/v1/otp"
    assert stub.request_headers == {"apikey": "sb_publishable_test"}
    assert stub.request_json == {"email": email["email"], "create_user": True}

    signin = client.post("/auth/signin", json=email)
    assert signin.status_code == 200
    assert stub.request_url == "https://project.supabase.co/auth/v1/otp"
    assert stub.request_json == {"email": email["email"], "create_user": False}
    assert signin.json() == {"message_id": "message-123"}


def test_auth_refresh_exchanges_refresh_token_with_supabase(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    rotated_tokens = {
        "access_token": "new-access-token",
        "refresh_token": "new-refresh-token",
        "token_type": "bearer",
    }
    stub = StubAuthClient(httpx.Response(200, json=rotated_tokens))
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: stub)

    response = TestClient(app).post(
        "/auth/refresh",
        json={"refresh_token": "old-refresh-token"},
    )

    assert response.status_code == 200
    assert stub.request_url == (
        "https://project.supabase.co/auth/v1/token?grant_type=refresh_token"
    )
    assert stub.request_headers == {"apikey": "sb_publishable_test"}
    assert stub.request_json == {"refresh_token": "old-refresh-token"}
    assert response.json() == rotated_tokens


def test_auth_refresh_returns_supabase_rejection(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    stub = StubAuthClient(httpx.Response(400, json={"msg": "Invalid Refresh Token"}))
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: stub)

    response = TestClient(app).post(
        "/auth/refresh",
        json={"refresh_token": "invalid-refresh-token"},
    )

    assert response.status_code == 400
    assert response.json() == {"msg": "Invalid Refresh Token"}


def test_auth_signup_returns_supabase_validation_error(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    stub = StubAuthClient(httpx.Response(422, json={"msg": "Email address is invalid"}))
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: stub)

    response = TestClient(app).post("/auth/signup", json={"email": "invalid"})

    assert response.status_code == 422
    assert response.json() == {"msg": "Email address is invalid"}


def test_markets_returns_supported_symbol_list():
    response = TestClient(app).get("/markets")

    assert response.status_code == 200
    data = response.json()
    assert "symbols" in data
    assert "BTCUSDT" in data["symbols"]


def stub_market_cache(monkeypatch):
    def get_cached_json(key):
        if key.endswith(":candles"):
            return [{"ts": 1, "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.5, "volume": 100.0}]
        if key.startswith("ind:"):
            return {"rsi": 52.4, "ema_fast": 10.5, "ema_slow": 10.4, "macd": 0.1, "signal": "bullish"}
        if key.endswith(":ticker"):
            return {"lastPrice": "10.5"}
        raise KeyError(key)

    monkeypatch.setattr("app.main.get_cached_json", get_cached_json)


def stub_supabase_storage(monkeypatch):
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii"))
    tables = {}
    requests = []

    def fake_request(method, url, **kwargs):
        requests.append((method, url, kwargs))
        table = url.split("/rest/v1/", 1)[1].split("?", 1)[0]
        rows = tables.setdefault(table, [])
        if method == "POST":
            rows[:] = [kwargs["json"]]
            return httpx.Response(201, json=rows)
        if method == "GET":
            return httpx.Response(200, json=rows)
        if method == "DELETE":
            rows.clear()
            return httpx.Response(204)
        return httpx.Response(200, json=[])

    monkeypatch.setattr("app.main.httpx.request", fake_request)
    return tables, requests


def test_market_candles_endpoint_returns_symbol_and_tf(monkeypatch):
    stub_market_cache(monkeypatch)
    response = TestClient(app).get("/markets/BTCUSDT/candles", params={"tf": "1m"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["symbol"] == "BTCUSDT"
    assert payload["tf"] == "1m"
    assert isinstance(payload["candles"], list)


def test_market_endpoints_fail_without_redis_instead_of_returning_fake_data(monkeypatch):
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.delenv("UPSTASH_REDIS_REST_TOKEN", raising=False)

    response = TestClient(app).get("/markets/BTCUSDT/candles")

    assert response.status_code == 503
    assert response.json()["detail"] == "Market data is unavailable"


def test_market_indicators_and_invalid_market_inputs(monkeypatch):
    stub_market_cache(monkeypatch)
    client = TestClient(app)

    indicators = client.get("/markets/BTCUSDT/indicators", params={"tf": "5m"})
    assert indicators.status_code == 200
    assert indicators.json()["indicators"]["rsi"] is not None

    unsupported_symbol = client.get("/markets/UNKNOWN/candles")
    assert unsupported_symbol.status_code == 404

    unsupported_timeframe = client.get("/markets/BTCUSDT/candles", params={"tf": "2m"})
    assert unsupported_timeframe.status_code == 422


def test_market_stream_sends_updates_until_client_disconnects(monkeypatch):
    tickers = iter([{"lastPrice": "10"}, {"lastPrice": "11"}])
    candles = [{"ts": 1, "close": 10.0}]

    def market_cache(key):
        return next(tickers) if key.endswith(":ticker") else candles

    disconnected = iter([False, False, True])

    async def is_disconnected():
        return next(disconnected)

    async def run_inline(function, *args):
        return function(*args)

    async def no_wait(_seconds):
        return None

    request = Request({"type": "http", "method": "GET", "path": "/stream", "headers": []})
    request.is_disconnected = is_disconnected
    monkeypatch.setattr(main, "_market_cache", market_cache)
    monkeypatch.setattr(main.asyncio, "to_thread", run_inline)
    monkeypatch.setattr(main.asyncio, "sleep", no_wait)

    async def read_events():
        response = main.market_stream(request, "BTCUSDT", "1m")
        iterator = response.body_iterator
        snapshot = await anext(iterator)
        update = await anext(iterator)
        with pytest.raises(StopAsyncIteration):
            await anext(iterator)
        return response, snapshot, update

    response, snapshot, update = asyncio.run(read_events())

    assert response.media_type == "text/event-stream"
    assert response.headers["X-Accel-Buffering"] == "no"
    assert snapshot.startswith("event: snapshot\ndata: ")
    assert update.startswith("event: update\ndata: ")


def test_market_stream_can_send_multiple_tickers(monkeypatch):
    disconnected = iter([False, True])

    async def is_disconnected():
        return next(disconnected)

    async def run_inline(function, *args):
        return function(*args)

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(main, "_market_cache", lambda key: {"lastPrice": key.split(":")[1]})
    monkeypatch.setattr(main.asyncio, "to_thread", run_inline)
    monkeypatch.setattr(main.asyncio, "sleep", no_wait)
    request = Request({"type": "http", "method": "GET", "path": "/stream", "headers": []})
    request.is_disconnected = is_disconnected

    async def read_event():
        response = main.market_stream(request, "BTCUSDT", "1m", "BTCUSDT,ETHUSDT")
        return response, await anext(response.body_iterator)

    response, event = asyncio.run(read_event())

    assert response.media_type == "text/event-stream"
    assert '"symbol": "BTCUSDT"' in event
    assert '"lastPrice": "ETHUSDT"' in event


def test_broker_connect_and_portfolio(monkeypatch):
    storage_tables, storage_requests = stub_supabase_storage(monkeypatch)
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-123", "email": "user@example.com"})),
    )

    class FakeBybitClient:
        def __init__(self, api_key, api_secret, mode):
            self.api_key = api_key
            self.api_secret = api_secret
            self.mode = mode

        def fetch_balance(self):
            return {
                "info": {
                    "result": {
                        "list": [{
                            "totalWalletBalance": "1299.00",
                            "totalEquity": "1300.00",
                            "coin": [
                                {"coin": "USDT", "usdValue": "1244.56"},
                                {"coin": "BTC", "usdValue": "55.44"},
                            ],
                        }],
                    },
                },
                "USDT": {"free": 1234.56, "used": 10.0, "total": 1244.56},
                "BTC": {"free": 0.001, "total": 0.0015},
                "DOGE": {"free": 0.0, "used": 0.0, "total": 0.0},
            }

    created_clients = []

    def fake_bybit_client(mode, api_key, api_secret):
        client = FakeBybitClient(api_key, api_secret, mode)
        created_clients.append(client)
        return client

    monkeypatch.setattr("app.main.create_bybit_client", fake_bybit_client)

    connect_response = TestClient(app).post(
        "/broker/bybit",
        headers={"Authorization": "Bearer user-access-token"},
        json={"mode": "testnet", "api_key": "demo-key", "api_secret": "demo-secret"},
    )

    assert connect_response.status_code == 200
    assert connect_response.json()["status"] == "connected"
    stored_row = storage_tables["broker_connections"][0]
    assert stored_row["key_enc"] != "demo-key"
    assert stored_row["secret_enc"] != "demo-secret"
    assert storage_requests[0][2]["headers"]["Authorization"] == "Bearer user-access-token"

    portfolio_response = TestClient(app).get(
        "/portfolio",
        headers={"Authorization": "Bearer user-access-token"},
    )

    assert portfolio_response.status_code == 200
    assert portfolio_response.json()["balance"] == 1234.56
    assert portfolio_response.json()["mode"] == "testnet"
    assert portfolio_response.json()["equity"] == 1300.0
    assert portfolio_response.json()["assets"] == [
        {"currency": "USDT", "total": 1244.56, "available": 1234.56, "locked": 10.0, "usd_value": 1244.56},
        {"currency": "BTC", "total": 0.0015, "available": 0.001, "locked": 0.0005, "usd_value": 55.44},
    ]
    assert created_clients[-1].api_key == "demo-key"
    assert created_clients[-1].api_secret == "demo-secret"


def test_bybit_client_reads_unified_balance_positions_and_orders(monkeypatch):
    requests = []
    wallet = {
        "retCode": 0,
        "result": {
            "list": [
                {
                    "accountType": "UNIFIED",
                    "coin": [
                        {"coin": "USDT", "availableToWithdraw": "125.5", "walletBalance": "150"},
                        {"coin": "BTC", "availableToWithdraw": "", "walletBalance": "0.02", "locked": "0.005", "usdValue": "1234.5"},
                    ],
                }
            ]
        },
    }

    def fake_get(url, **kwargs):
        requests.append((url, kwargs))
        if "/wallet-balance" in url:
            return httpx.Response(200, json=wallet)
        return httpx.Response(200, json={"retCode": 0, "result": {"list": [{"orderId": "order-2"}]}})

    monkeypatch.setattr("app.main.httpx.get", fake_get)
    client = BybitClient("testnet", "key", "secret")

    balance = client.fetch_balance()
    positions = client.fetch_positions()
    orders = client.fetch_orders()

    assert balance["USDT"]["free"] == 125.5
    assert positions == [{"symbol": "BTCUSDT", "side": "Buy", "size": 0.02, "free": 0.015, "locked": 0.005, "usdValue": 1234.5}]
    assert orders == [{"orderId": "order-2"}]
    assert all("X-BAPI-SIGN" in request[1]["headers"] for request in requests)


def test_bybit_client_fetches_paginated_order_activity_by_product(monkeypatch):
    client = BybitClient("testnet", "key", "secret")
    requests = []

    def fake_private_get(path, params):
        requests.append((path, dict(params)))
        category = params["category"]
        cursor = params.get("cursor")
        return {
            "list": [{"symbol": category, "createdTime": "200" if category == "inverse" else "100"}],
            "nextPageCursor": None if cursor else f"{category}-next",
        }

    monkeypatch.setattr(client, "_private_get", fake_private_get)

    first_page = client.fetch_order_activity("futures", "history", None, 50)
    assert first_page["supported"] is True
    assert first_page["count"] == 2
    assert [record["symbol"] for record in first_page["records"]] == ["inverse", "linear"]
    assert requests[0][0] == "/v5/order/history"
    assert requests[0][1]["category"] == "linear"
    assert requests[0][1]["settleCoin"] == "USDT"
    assert requests[1][1]["category"] == "inverse"
    assert requests[1][1]["settleCoin"] == "USD"

    second_page = client.fetch_order_activity("futures", "history", first_page["next_cursor"], 50)
    assert second_page["count"] == 2
    assert requests[2][1]["cursor"] == "linear-next"
    assert requests[3][1]["cursor"] == "inverse-next"
    assert second_page["next_cursor"] is None

    client.fetch_order_activity("spot", "open", None, 50)
    assert requests[4][0] == "/v5/order/realtime"
    assert requests[4][1]["openOnly"] == "0"
    client.fetch_order_activity("options", "trades", None, 50)
    assert requests[5][0] == "/v5/execution/list"
    assert requests[5][1]["category"] == "option"
    assert requests[5][1]["execType"] == "Trade"

    request_count = len(requests)
    stocks = client.fetch_order_activity("stocks", "open", None, 50)
    assert stocks["supported"] is False
    assert stocks["records"] == []
    assert len(requests) == request_count


def test_order_activity_endpoint_returns_records_and_cursor(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-orders", "email": "orders@example.com"})),
    )

    class FakeBybitClient:
        def fetch_order_activity(self, product, view, cursor, limit):
            return {
                "supported": True,
                "message": None,
                "records": [{"symbol": "BTCUSDT", "orderStatus": "New"}],
                "count": 1,
                "next_cursor": "page-two",
            }

    monkeypatch.setattr("app.main._get_user_client", lambda _user: FakeBybitClient())
    response = TestClient(app).get(
        "/orders/spot/open?limit=25",
        headers={"Authorization": "Bearer user-access-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "supported": True,
        "message": None,
        "records": [{"symbol": "BTCUSDT", "orderStatus": "New"}],
        "count": 1,
        "next_cursor": "page-two",
    }


def test_broker_status_requires_connection(monkeypatch):
    stub_supabase_storage(monkeypatch)
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-456", "email": "other@example.com"})),
    )

    response = TestClient(app).get("/broker/status", headers={"Authorization": "Bearer user-access-token"})

    assert response.status_code == 200
    assert response.json()["connected"] is False


def test_me_profile_round_trip(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "must-not-be-used")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-789", "email": "profile@example.com"})),
    )

    requests = []

    def fake_request(method, url, **kwargs):
        requests.append((method, url, kwargs))
        if method == "GET":
            return httpx.Response(200, json=[{
                "user_id": "user-789",
                "username": "bob",
                "dob": "1999-01-01",
                "avatar_url": "https://i.pinimg.com/1200x/37/6d/8f/376d8f204dfadac0940b289c24e7ac0e.jpg",
            }])
        if method == "POST":
            return httpx.Response(200, json=[{
                "user_id": "user-789",
                "username": "bobby",
                "dob": "2000-02-02",
                "avatar_url": "https://i.pinimg.com/736x/0a/85/64/0a85642c09f1af906069b759e07d1b96.jpg",
            }])
        return httpx.Response(200, json=[])

    monkeypatch.setattr("app.main.httpx.request", fake_request)

    get_response = TestClient(app).get("/me", headers={"Authorization": "Bearer user-access-token"})
    assert get_response.status_code == 200
    assert get_response.json() == {
        "user_id": "user-789",
        "username": "bob",
        "dob": "1999-01-01",
        "avatar_url": "https://i.pinimg.com/1200x/37/6d/8f/376d8f204dfadac0940b289c24e7ac0e.jpg",
    }

    patch_response = TestClient(app).patch(
        "/me",
        headers={"Authorization": "Bearer user-access-token"},
        json={"username": "bobby", "dob": "2000-02-02", "avatar_url": "https://i.pinimg.com/736x/0a/85/64/0a85642c09f1af906069b759e07d1b96.jpg"},
    )
    assert patch_response.status_code == 200
    assert patch_response.json() == {
        "user_id": "user-789",
        "username": "bobby",
        "dob": "2000-02-02",
        "avatar_url": "https://i.pinimg.com/736x/0a/85/64/0a85642c09f1af906069b759e07d1b96.jpg",
    }
    assert requests[1][0] == "POST"
    assert requests[1][2]["headers"]["Prefer"] == "resolution=merge-duplicates,return=representation"
    assert requests[0][2]["headers"]["Authorization"] == "Bearer user-access-token"


def test_me_assigns_random_default_avatar_when_missing(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "must-not-be-used")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-random-avatar", "email": "avatar@example.com"})),
    )

    requests = []

    def fake_request(method, url, **kwargs):
        requests.append((method, url, kwargs))
        if method == "GET":
            return httpx.Response(200, json=[{"user_id": "user-random-avatar", "username": "bob", "dob": "1999-01-01"}])
        if method == "POST":
            payload = kwargs["json"]
            return httpx.Response(200, json=[{"user_id": "user-random-avatar", "username": payload["username"], "dob": payload["dob"], "avatar_url": payload["avatar_url"]}])
        return httpx.Response(200, json=[])

    monkeypatch.setattr("app.main.httpx.request", fake_request)

    response = TestClient(app).get("/me", headers={"Authorization": "Bearer user-access-token"})

    assert response.status_code == 200
    assert response.json()["avatar_url"] in main.DEFAULT_AVATAR_URLS
    assert any(request[0] == "POST" for request in requests)


def test_profile_endpoints_fail_cleanly_when_supabase_is_not_configured(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    monkeypatch.setitem(
        app.dependency_overrides,
        auth.get_authenticated_user,
        lambda: auth.AuthenticatedUser(id="user-unconfigured", token="access-token"),
    )

    client = TestClient(app)
    get_response = client.get("/me")
    patch_response = client.patch("/me", json={"username": "bob"})

    assert get_response.status_code == 503
    assert patch_response.status_code == 503


def test_testnet_agent_start_and_stop_persist_settings(monkeypatch):
    storage_tables, _requests = stub_supabase_storage(monkeypatch)
    monkeypatch.setenv("TRADING_WORKER_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-start", "email": "start@example.com"})),
    )

    class FakeBybitClient:
        def __init__(self, api_key, api_secret, mode):
            self.api_key = api_key
            self.api_secret = api_secret
            self.mode = mode

        def fetch_balance(self):
            return {"USDT": {"free": 100.0}}

    monkeypatch.setattr(
        "app.main.create_bybit_client",
        lambda mode, api_key, api_secret: FakeBybitClient(api_key, api_secret, mode),
    )
    client = TestClient(app)
    headers = {"Authorization": "Bearer user-access-token"}
    assert client.post(
        "/broker/bybit",
        headers=headers,
        json={"mode": "testnet", "api_key": "agent-key", "api_secret": "agent-secret"},
    ).status_code == 200

    start = client.post(
        "/agent/start",
        headers=headers,
        json={"symbol": "BTCUSDT", "risk": "medium", "max_position_pct": 0.2},
    )
    assert start.status_code == 200
    assert start.json()["armed"] is True
    assert storage_tables["agent_settings"][0]["agent_on"] is True
    assert storage_tables["agent_settings"][0]["risk_profile"] == "balanced"

    stop = client.post("/agent/stop", headers=headers)
    assert stop.status_code == 200
    assert storage_tables["agent_settings"][0]["agent_on"] is False
    assert storage_tables["agent_settings"][0]["armed"] is False


def test_global_kill_switch_requires_admin_and_arms_upstash(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("TRADING_ADMIN_USER_IDS", "user-kill-admin")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-kill-admin", "email": "admin@example.com"})),
    )
    writes = []
    monkeypatch.setattr("app.main.set_cached_json", lambda *args: writes.append(args))

    response = TestClient(app).post(
        "/agent/kill-switch",
        headers={"Authorization": "Bearer user-access-token"},
    )

    assert response.status_code == 200
    assert response.json()["active"] is True
    assert writes[0][0] == "kill:trading"
    assert writes[0][1]["active"] is True


def test_global_kill_switch_rejects_non_admin(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("TRADING_ADMIN_USER_IDS", "other-user")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "regular-user", "email": "user@example.com"})),
    )

    response = TestClient(app).post(
        "/agent/kill-switch",
        headers={"Authorization": "Bearer user-access-token"},
    )

    assert response.status_code == 403


def test_session_validates_bearer_with_supabase(monkeypatch):
    stub_client = StubAuthClient(
        httpx.Response(200, json={"id": "user-123", "email": "user@example.com"})
    )
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(auth.httpx, "AsyncClient", lambda **_kwargs: stub_client)

    response = TestClient(app).get(
        "/auth/session",
        headers={"Authorization": "Bearer user-access-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"user_id": "user-123", "email": "user@example.com"}
    assert stub_client.request_headers == {
        "apikey": "sb_publishable_test",
        "Authorization": "Bearer user-access-token",
    }


def test_session_rejects_expired_token(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(401, json={"message": "expired"})),
    )

    response = TestClient(app).get(
        "/auth/session",
        headers={"Authorization": "Bearer expired-token"},
    )

    assert response.status_code == 401


def test_agent_and_position_lifecycle(monkeypatch):
    stub_supabase_storage(monkeypatch)
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **_kwargs: StubAuthClient(httpx.Response(200, json={"id": "user-agent", "email": "agent@example.com"})),
    )

    class FakeBybitClient:
        def __init__(self, api_key, api_secret, mode):
            self.api_key = api_key
            self.api_secret = api_secret
            self.mode = mode

        def fetch_balance(self):
            return {"info": {"totalWalletBalance": "1000.0"}, "USDT": {"free": 1000.0}}

        def fetch_positions(self):
            return [{"symbol": "BTCUSDT", "side": "Buy", "size": 0.25, "entryPrice": 62000.0}]

        def fetch_orders(self):
            return [{"symbol": "BTCUSDT", "side": "Buy", "status": "New", "orderId": "order-1"}]

    monkeypatch.setattr("app.main.create_bybit_client", lambda mode, api_key, api_secret: FakeBybitClient(api_key, api_secret, mode))

    class FakeExecution:
        def fetch_balance(self):
            return {"USDT": {"free": 100.0, "total": 100.0}}

        def fetch_holdings(self, _symbol):
            return {"free": 0.0, "total": 0.0}

        def close_position(self, symbol):
            return {"symbol": symbol, "closed": True}

        def update_tp_sl(self, symbol, tp, sl):
            return {"symbol": symbol, "tp": tp, "sl": sl}

    monkeypatch.setattr("app.main.create_bybit_execution", lambda *_args: FakeExecution())

    client = TestClient(app)

    connect = client.post(
        "/broker/bybit",
        headers={"Authorization": "Bearer user-access-token"},
        json={"mode": "testnet", "api_key": "agent-key", "api_secret": "agent-secret"},
    )
    assert connect.status_code == 200

    start = client.post(
        "/agent/start",
        headers={"Authorization": "Bearer user-access-token"},
        json={"symbol": "BTCUSDT", "risk": "medium", "max_position_pct": 0.2},
    )
    assert start.status_code == 503

    positions = client.get("/positions", headers={"Authorization": "Bearer user-access-token"})
    assert positions.status_code == 200
    assert positions.json()["positions"][0]["symbol"] == "BTCUSDT"

    orders = client.get("/orders", headers={"Authorization": "Bearer user-access-token"})
    assert orders.status_code == 200
    assert orders.json()["orders"][0]["orderId"] == "order-1"

    close = client.post(
        "/positions/BTCUSDT/close",
        headers={"Authorization": "Bearer user-access-token"},
        json={},
    )
    assert close.status_code == 200

    tpsl = client.post(
        "/positions/BTCUSDT/tpsl",
        headers={"Authorization": "Bearer user-access-token"},
        json={"tp": 64000.0, "sl": 60000.0},
    )
    assert tpsl.status_code == 200

    logs = client.get("/agent/logs", headers={"Authorization": "Bearer user-access-token"})
    assert logs.status_code == 200
    assert logs.json()["logs"] == []

    stop = client.post("/agent/stop", headers={"Authorization": "Bearer user-access-token"})
    assert stop.status_code == 200
    assert stop.json()["status"] == "stopped"

    deleted = client.delete("/broker/bybit", headers={"Authorization": "Bearer user-access-token"})
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}

    status = client.get("/broker/status", headers={"Authorization": "Bearer user-access-token"})
    assert status.status_code == 200
    assert status.json()["connected"] is False