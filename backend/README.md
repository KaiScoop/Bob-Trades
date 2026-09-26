# Bob Trades Backend

Backend services for Bob Trades. The backend has two processes:

- `api`: public FastAPI service on port `8080`; the mobile app talks only to this
	service.
- `worker`: internal FastAPI process on port `8081`; it owns public market data,
	indicators, and background agent execution. Its port is exposed only inside
	the Docker network.

Supabase provides authentication and Postgres. Upstash provides Redis over its
REST API. Bybit is the only supported broker in v1. There is no paper-trading
ledger and no direct mobile-to-Bybit, Redis, worker, or Postgres connection.

## Current implementation

Implemented:

- Supabase bearer-token validation for protected API routes.
- User profile reads and updates through RLS-protected Supabase requests.
- Bybit testnet/mainnet credential validation and Fernet encryption at rest.
- Cached portfolio, positions, and order reads.
- Seven supported USDT spot symbols and six timeframes.
- Worker market polling with closed-candle filtering, RSI, EMA, MACD, and
	heartbeat writes to Upstash Redis.
- Worker agent state construction, Jev evaluation, Python risk gates, daily-loss
	checks, kill-switch checks, candle deduplication, and decision logging.
- Agent start/stop, decision-log, position-close, TP/SL, and admin kill-switch
	API routes.
- Atomic candle claiming before snapshot processing, preventing duplicate work
	when multiple worker iterations see the same candle.
- API documentation in [`API.md`](API.md), generated OpenAPI at `/openapi.json`,
	and interactive Swagger UI at `/docs`.
- Automated tests covering API contracts, authentication, market data,
	execution, risk, Jev, agent state, and the trading loop.

Not yet complete or not yet production-verified:

- `/stream` currently returns one SSE snapshot and closes; continuous market
	events are not implemented.
- External Supabase, Upstash, Bybit, and Jev integration tests use mocks in the
	local suite. A real testnet smoke test is still required.
- API responses are mostly typed as dictionaries; generated OpenAPI schemas need
	dedicated response models before treating OpenAPI as the sole contract.
- The worker still uses polling rather than a production-grade public WebSocket
	feed and reconnect strategy.
- Portfolio refresh and private account polling need real testnet verification
	under worker restart and network-failure conditions.
- Mainnet deployment hardening, secret rotation, observability, rate limiting,
	and rollback procedures remain operational work.
- The mobile frontend still needs to consume and verify this contract against a
	running backend.

Do not enable live trading until the real testnet smoke test, failure handling,
and deployment checks have passed.

## Architecture

```text
Supabase Auth ----------------+
															v
Mobile app -- HTTPS --> API (8080) --> Supabase Postgres
															|      +--> Upstash Redis
															|      +--> Bybit account reads/actions
															v
												Worker (8081 internal)
													+-- Bybit public market polling
													+-- candle and indicator cache writes
													+-- per-user Jev trading loop
```

Redis keys used by the services include:

```text
mkt:{symbol}:{tf}:candles
mkt:{symbol}:ticker
mkt:{symbol}:book
ind:{symbol}:{tf}
user:{id}:portfolio
user:{id}:agent
hb:market
kill:trading
```

The Supabase migration creates `profiles`, `broker_connections`,
`agent_settings`, `agent_logs`, and `client_order_ids`, with user-scoped RLS.

## Repository structure

```text
app/                    FastAPI application, auth, and API routes
common/                 Config, health, Redis, market data, and Bybit execution
worker/                 Market worker, Jev state, decisions, risk, and trading
supabase/migrations/     Postgres schema and RLS migration
tests/                  Unit and API contract tests
API.md                  Frontend endpoint contract and JSON examples
compose.yaml             API and worker Docker services
Dockerfile               Shared Python service image
requirements*.txt       Runtime and development dependencies
```

Generated local directories should not be committed:

```text
.venv/                  Local Python environment
.pytest_cache/          Pytest cache
__pycache__/            Python bytecode cache
```

## Requirements

- Python 3.12 or newer for the Docker image; Python 3.14 is currently used
	locally.
- Docker and Docker Compose for the container setup.
- A Supabase project with Auth and Postgres.
- An Upstash Redis database with REST URL and token.
- Bybit testnet credentials for integration verification.
- A Jev/TypeSafe API key when the trading worker is enabled.

## Configuration

From this directory:

```sh
cp .env.example .env
```

Set the Supabase and Upstash values, then generate the broker encryption key:

```sh
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Important environment variables:

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | API, worker | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | API, worker | User-scoped Supabase requests |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker only | Cross-user background queries |
| `UPSTASH_REDIS_REST_URL` | API, worker | Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | API, worker | Redis REST authentication |
| `BROKER_ENCRYPTION_KEY` | API, worker | Fernet key for Bybit secrets |
| `JEV_API_KEY` | Worker | Jev evaluation |
| `TRADING_WORKER_ENABLED` | API, worker | Enables agent execution |
| `LIVE_ARMED` | API, worker | Mainnet safety arm |
| `LIVE_MAX_NOTIONAL_USDT` | API, worker | Mainnet notional cap |
| `LIVE_DAILY_LOSS_USDT` | API, worker | Daily-loss limit |
| `LIVE_SYMBOLS` | API, worker | Mainnet symbol allowlist |
| `LIVE_KILL_SWITCH` | API, worker | Global live-trading block |
| `TRADING_ADMIN_USER_IDS` | API | Kill-switch administrator IDs |
| `TESTNET_MAX_NOTIONAL_USDT` | API, worker | Testnet notional cap |

Apply [`supabase/migrations/202609260001_initial_backend.sql`](supabase/migrations/202609260001_initial_backend.sql)
once through the Supabase SQL editor. Never commit `.env`, broker credentials,
service-role keys, Redis tokens, or Jev keys. The mobile app receives none of
these secrets.

## Run locally

Install dependencies:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
```

Run the API and worker in separate terminals from `backend/`:

```sh
. .venv/bin/activate
uvicorn app.main:app --reload --port 8080
```

```sh
. .venv/bin/activate
uvicorn worker.main:app --port 8081
```

API URLs:

- `http://localhost:8080/health`
- `http://localhost:8080/docs`
- `http://localhost:8080/openapi.json`

## Run with Docker Compose

```sh
docker compose up --build
```

The API is published on `localhost:8080`. The worker is available on port
`8081` only to other Compose services. Both services restart automatically and
have health checks.

## API contract

Read [`API.md`](API.md) for the frontend integration contract. It documents:

- Public market routes and supported symbols/timeframes.
- Supabase bearer authentication.
- Profile and Bybit connection flows.
- Portfolio, positions, and order reads.
- Agent start/stop/log routes.
- Position close and TP/SL actions.
- Request/response examples and error statuses.
- The current one-shot SSE limitation.

Protected requests require:

```http
Authorization: Bearer <supabase-access-token>
```

There is no manual buy or sell endpoint. The frontend must not call the worker,
Bybit, Redis, or Supabase PostgREST directly.

## Tests and validation

Run the complete local suite:

```sh
. .venv/bin/activate
pytest -q
```

The tests use mocked external services and cover route validation, auth,
market-data calculations, health checks, Bybit execution, agent state,
decisions, risk, Jev responses, and trading-loop ordering. A passing suite does
not prove that the configured Supabase, Upstash, Bybit, or Jev services work.

Before any live deployment, perform a testnet smoke test covering:

1. Authenticated session and profile read/write.
2. Bybit testnet credential connect and balance retrieval.
3. Market cache population and candle/indicator reads.
4. Agent start, closed-candle decision, deduplication, and log persistence.
5. Position close and TP/SL update with portfolio refresh.
6. Worker restart, stale heartbeat, upstream outage, and kill-switch behavior.

## Remaining work checklist

- [ ] Implement continuous SSE market updates.
- [ ] Add dedicated Pydantic response models for stable generated OpenAPI.
- [ ] Add real testnet smoke tests and document required test data.
- [ ] Verify worker restart/idempotency behavior against live external services.
- [ ] Add production logging, metrics, alerting, rate limits, and request IDs.
- [ ] Review secret rotation and service-role access procedures.
- [ ] Harden Docker deployment and define rollback/runbook procedures.
- [ ] Complete frontend integration and device-level API verification.
- [ ] Keep API.md, OpenAPI output, and this README synchronized as routes evolve.