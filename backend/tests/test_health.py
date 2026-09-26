import httpx

from common import health


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
    assert requests[1][1] == "https://project.supabase.co/rest/v1/"
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