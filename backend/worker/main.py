import asyncio
import logging
import os
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Response

from common import config
from common.health import check_dependencies
from common.market_data import SUPPORTED_SYMBOLS, collect_fast_market_cycle, collect_market_cycle
from worker.trading import run_trading_cycle

logger = logging.getLogger(__name__)


async def _market_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(collect_market_cycle, SUPPORTED_SYMBOLS)
        except Exception:
            logger.exception("Market data collection failed")
        await asyncio.sleep(60)


async def _fast_market_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(collect_fast_market_cycle, SUPPORTED_SYMBOLS)
        except Exception:
            logger.exception("Fast market refresh failed")
        await asyncio.sleep(5)


async def _trading_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(run_trading_cycle)
        except Exception:
            logger.exception("Private trading cycle failed")
        await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    tasks = []
    if os.environ.get("UPSTASH_REDIS_REST_URL") and os.environ.get("UPSTASH_REDIS_REST_TOKEN"):
        tasks.extend(
            [
                asyncio.create_task(_market_loop()),
                asyncio.create_task(_fast_market_loop()),
            ]
        )
    if os.environ.get("TRADING_WORKER_ENABLED", "false").lower() in {"1", "true"}:
        tasks.append(asyncio.create_task(_trading_loop()))
    yield
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


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