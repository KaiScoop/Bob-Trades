# Bob Trades Backend

FastAPI API and internal worker for Bob Trades. Supabase provides Auth and
Postgres; Upstash provides Redis over its REST API. Docker Compose runs only the
API and worker, not local database or Redis containers. Mobile clients call the
API; the worker port is not published to the host.

## Current status

- The worker polls Bybit public spot tickers and candles for seven symbols and
	six timeframes every 60 seconds. It filters for closed candles, computes RSI,
	EMA, and MACD, then writes market data and a heartbeat to Upstash.
- Market API routes read that cache and return `503` when data is not available.
- Supabase Auth validates bearer tokens. Profiles and encrypted broker
	credentials are stored through user-scoped PostgREST requests and RLS.
- `GET /agent/logs` reads the Supabase log table; producing trading logs awaits
	the private trading worker.
- Broker connect validates a Bybit account and stores its credentials encrypted.
	Portfolio, holdings, and open-order reads are available after connection.
- Automated trading is not implemented. Agent start/stop return `503`; spot
	position close and TP/SL updates return `501`. Do not use this version for
	live trading.
- `/stream` currently returns a single SSE snapshot; it is not a continuous
	event stream yet.

## Requirements

- Python 3.12+ for Docker; a supported local Python installation for development
- Docker Compose for the container setup
- Supabase project and Upstash Redis database

## Configure

From this directory, create the ignored local environment file:

```sh
cp .env.example .env
```

Replace the Supabase and Upstash placeholders in `.env` with the actual project
URL, publishable key, Redis REST URL, and Redis REST token. Generate
`BROKER_ENCRYPTION_KEY` from the backend virtual environment:

```sh
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Apply [`supabase/migrations/202609260001_initial_backend.sql`](supabase/migrations/202609260001_initial_backend.sql)
once to the Supabase project using **Dashboard → SQL Editor** before using
profile, broker, or log persistence. It creates `profiles`, `broker_connections`,
`agent_settings`, `agent_logs`, and `client_order_ids`, with user-scoped RLS.
If these tables already exist, inspect the schema before running the migration.

Bybit credentials are per-user: submit them to `POST /broker/bybit` after
Supabase authentication. Do not put user Bybit credentials, a Supabase
service-role key, or the Upstash token in the mobile app or commit them. The
Jev key is reserved for the future trading worker and is not currently used.

Compose interpolates variables from `.env`. Local Python startup also loads
`.env` using `python-dotenv`; `.env.example` is a template and is not loaded.
Keep `.env` uncommitted.

## Run

Start both services with Docker Compose:

```sh
docker compose up --build
```

The API is available at `http://localhost:8080`; its health route is
`http://localhost:8080/health`. The worker listens on port `8081` inside the
Compose network only. Its market loop starts when both Upstash variables are
configured. Interactive API documentation is at `http://localhost:8080/docs`.

For local Python development, install the development requirements and run the
API and worker in separate terminals from this directory:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8080
```

```sh
. .venv/bin/activate
uvicorn worker.main:app --port 8081
```

## API surface

Public market routes:

- `GET /markets`
- `GET /markets/{symbol}/candles?tf=1m`
- `GET /markets/{symbol}/indicators?tf=1m`
- `GET /stream?symbol=BTCUSDT&tf=1m`

Protected routes require `Authorization: Bearer <Supabase access token>`:

- Auth/profile: `GET /auth/session`, `GET /me`, `PATCH /me`
- Bybit: `POST /broker/bybit`, `GET /broker/status`, `DELETE /broker/bybit`
- Account reads: `GET /portfolio`, `GET /positions`, `GET /orders`
- Agent: `POST /agent/start`, `POST /agent/stop`, `GET /agent/logs?limit=50`
- Position mutations: `POST /positions/{symbol}/close`,
	`POST /positions/{symbol}/tpsl`

Agent and position-mutation routes are listed for API compatibility but remain
disabled as described above.

## Tests and health

Run the backend tests from this directory:

```sh
. .venv/bin/activate
pytest -q
```

The suite covers route contracts and worker calculations with mocked external
services. For live dependency health, call `GET /health`; it checks Supabase
Auth, the profiles table route, and Upstash. Public market endpoints require the
worker to have populated Redis first.