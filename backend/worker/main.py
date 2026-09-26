import asyncio
import logging
import os
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Response

from common import config
from common.health import check_dependencies
from common.market_data import SUPPORTED_SYMBOLS, collect_market_cycle

logger = logging.getLogger(__name__)


async def _market_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(collect_market_cycle, SUPPORTED_SYMBOLS)
        except Exception:
            logger.exception("Market data collection failed")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    task = None
    if os.environ.get("UPSTASH_REDIS_REST_URL") and os.environ.get("UPSTASH_REDIS_REST_TOKEN"):
        task = asyncio.create_task(_market_loop())
    yield
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Bob Trades Worker", version="0.1.0", lifespan=lifespan)


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