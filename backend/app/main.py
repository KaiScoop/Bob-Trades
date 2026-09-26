from fastapi import Depends, FastAPI, Response

from app.auth import AuthenticatedUser, get_authenticated_user
from common.health import check_dependencies

app = FastAPI(title="Bob Trades API", version="0.1.0")


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


@app.get("/auth/session")
def auth_session(
    user: AuthenticatedUser = Depends(get_authenticated_user),
) -> dict[str, str | None]:
    return {"user_id": user.id, "email": user.email}