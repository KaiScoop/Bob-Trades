import httpx
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import auth
from app.main import BybitClient, app


class StubAuthClient:
    def __init__(self, response: httpx.Response):
        self.response = response
        self.request_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def get(self, _url, headers):
        self.request_headers = headers
        return self.response


def test_session_requires_bearer_token():
    response = TestClient(app).get("/auth/session")

    assert response.status_code == 401


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
    rows = []
    requests = []

    def fake_request(method, url, **kwargs):
        requests.append((method, url, kwargs))
        if "/agent_logs?" in url:
            return httpx.Response(200, json=[])
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
    return rows, requests


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


def test_market_stream_is_sse(monkeypatch):
    stub_market_cache(monkeypatch)
    response = TestClient(app).get("/stream", params={"symbol": "BTCUSDT"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: snapshot" in response.text


def test_broker_connect_and_portfolio(monkeypatch):
    stored_rows, storage_requests = stub_supabase_storage(monkeypatch)
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
            return {"info": {"totalWalletBalance": "1234.56"}, "USDT": {"free": 1234.56}}

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
    assert stored_rows[0]["key_enc"] != "demo-key"
    assert stored_rows[0]["secret_enc"] != "demo-secret"
    assert storage_requests[0][2]["headers"]["Authorization"] == "Bearer user-access-token"

    portfolio_response = TestClient(app).get(
        "/portfolio",
        headers={"Authorization": "Bearer user-access-token"},
    )

    assert portfolio_response.status_code == 200
    assert portfolio_response.json()["balance"] == 1234.56
    assert portfolio_response.json()["mode"] == "testnet"
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
                        {"coin": "BTC", "availableToWithdraw": "0.01", "walletBalance": "0.02"},
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
    assert positions == [{"symbol": "BTCUSDT", "side": "Buy", "size": 0.02, "free": 0.01}]
    assert orders == [{"orderId": "order-2"}]
    assert all("X-BAPI-SIGN" in request[1]["headers"] for request in requests)


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
            return httpx.Response(200, json=[{"user_id": "user-789", "username": "bob", "dob": "1999-01-01"}])
        if method == "POST":
            return httpx.Response(200, json=[{"user_id": "user-789", "username": "bobby", "dob": "2000-02-02"}])
        return httpx.Response(200, json=[])

    monkeypatch.setattr("app.main.httpx.request", fake_request)

    get_response = TestClient(app).get("/me", headers={"Authorization": "Bearer user-access-token"})
    assert get_response.status_code == 200
    assert get_response.json() == {"user_id": "user-789", "username": "bob", "dob": "1999-01-01"}

    patch_response = TestClient(app).patch(
        "/me",
        headers={"Authorization": "Bearer user-access-token"},
        json={"username": "bobby", "dob": "2000-02-02"},
    )
    assert patch_response.status_code == 200
    assert patch_response.json() == {"user_id": "user-789", "username": "bobby", "dob": "2000-02-02"}
    assert requests[1][0] == "POST"
    assert requests[1][2]["headers"]["Prefer"] == "resolution=merge-duplicates,return=representation"
    assert requests[0][2]["headers"]["Authorization"] == "Bearer user-access-token"


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
    assert close.status_code == 501

    tpsl = client.post(
        "/positions/BTCUSDT/tpsl",
        headers={"Authorization": "Bearer user-access-token"},
        json={"tp": 64000.0, "sl": 60000.0},
    )
    assert tpsl.status_code == 501

    logs = client.get("/agent/logs", headers={"Authorization": "Bearer user-access-token"})
    assert logs.status_code == 200
    assert logs.json()["logs"] == []

    stop = client.post("/agent/stop", headers={"Authorization": "Bearer user-access-token"})
    assert stop.status_code == 503

    deleted = client.delete("/broker/bybit", headers={"Authorization": "Bearer user-access-token"})
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}

    status = client.get("/broker/status", headers={"Authorization": "Bearer user-access-token"})
    assert status.status_code == 200
    assert status.json()["connected"] is False