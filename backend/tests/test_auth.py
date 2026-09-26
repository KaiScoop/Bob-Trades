import httpx
from fastapi.testclient import TestClient

from app import auth
from app.main import app


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