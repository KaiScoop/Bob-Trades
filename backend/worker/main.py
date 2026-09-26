from fastapi import FastAPI, Response

from common.health import check_dependencies

app = FastAPI(title="Bob Trades Worker", version="0.1.0")


@app.get("/health")
def health(response: Response) -> dict[str, object]:
    dependencies = check_dependencies()
    ready = all(dependencies.values())
    if not ready:
        response.status_code = 503
    return {
        "status": "ok" if ready else "degraded",
        "service": "worker",
        "dependencies": dependencies,
    }