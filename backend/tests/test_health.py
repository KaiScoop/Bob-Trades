import httpx
from fastapi.testclient import TestClient

from app import main
from common import health
from worker import main as worker_main


def test_health_checks_supabase_and_upstash(monkeypatch):
    requests = []
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://redis.upstash.io/")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "test-token")

    def get(url, **kwargs):
        requests.append(("GET", url, kwargs))
        return httpx.Response(200)

    def post(url, **kwargs):
        requests.append(("POST", url, kwargs))
        return httpx.Response(200, json={"result": "PONG"})

    monkeypatch.setattr(health.httpx, "get", get)
    monkeypatch.setattr(health.httpx, "post", post)

    assert health.check_dependencies() == {
        "supabase_auth": True,
        "supabase_database": True,
        "upstash_redis": True,
    }
    assert requests[0][1] == "https://project.supabase.co/auth/v1/health"
    assert requests[1][1] == "https://project.supabase.co/rest/v1/profiles?select=user_id&limit=0"
    assert requests[2][2]["json"] == ["PING"]
    assert requests[2][2]["headers"]["Authorization"] == "Bearer test-token"


def test_health_marks_unconfigured_services_unavailable(monkeypatch):
    for name in (
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)

    assert health.check_dependencies() == {
        "supabase_auth": False,
        "supabase_database": False,
        "upstash_redis": False,
    }


def test_health_endpoint_reports_degraded_dependencies(monkeypatch):
    monkeypatch.setattr(
        main,
        "check_dependencies",
        lambda: {"supabase_auth": False, "supabase_database": False, "upstash_redis": False},
    )

    response = TestClient(main.app).get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_api_allows_expo_web_cors_preflight():
    response = TestClient(main.app).options(
        "/markets",
        headers={
            "Origin": "http://localhost:8082",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8082"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_worker_health_endpoint(monkeypatch):
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.delenv("UPSTASH_REDIS_REST_TOKEN", raising=False)
    monkeypatch.setattr(
        worker_main,
        "check_dependencies",
        lambda: {"supabase_auth": True, "supabase_database": True, "upstash_redis": True},
    )

    response = TestClient(worker_main.app).get("/health")

    assert response.status_code == 200
    assert response.json()["service"] == "worker"