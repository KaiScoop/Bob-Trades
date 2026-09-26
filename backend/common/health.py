import os

import httpx


def check_dependencies() -> dict[str, bool]:
    checks = {
        "supabase_auth": False,
        "supabase_database": False,
        "upstash_redis": False,
    }
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    if supabase_url and publishable_key:
        for dependency, path in (
            ("supabase_auth", "/auth/v1/health"),
            ("supabase_database", "/rest/v1/profiles?select=user_id&limit=0"),
        ):
            try:
                response = httpx.get(
                    f"{supabase_url}{path}",
                    headers={"apikey": publishable_key},
                    timeout=5,
                )
                checks[dependency] = response.is_success
            except httpx.HTTPError:
                pass

    upstash_url = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
    upstash_token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if upstash_url and upstash_token:
        try:
            response = httpx.post(
                upstash_url,
                json=["PING"],
                headers={"Authorization": f"Bearer {upstash_token}"},
                timeout=5,
            )
            result = response.json()
            checks["upstash_redis"] = response.is_success and (
                isinstance(result, dict) and result.get("result") == "PONG"
            )
        except (httpx.HTTPError, ValueError):
            pass

    return checks