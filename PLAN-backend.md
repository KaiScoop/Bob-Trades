# PLAN: Bob Trades — backend

Product name: **Bob Trades**. Decision model remains **Jev** (TypeSafe).
New product. New repo. Do not bolt this onto the Next.js paper desk.

Feed this file to the backend agent. Phase gates are binary.

---

## 0.00 Agent context pack (human should attach)

Do not paste the entire old monorepo into every prompt. Drop these into the new repo (or the first agent message) once:

| File | Why |
|---|---|
| This `PLAN-backend.md` | Contracts, phases, invariants |
| `PLAN-mobile.md` | API routes must match the app |
| Old `pipeline/schema.py` | TypeSafe question names — copy, don’t rename |
| Old indicator builders from `pipeline/` | Reuse RSI/MA/oscillator math |
| Old `pipeline/broker/` if present | Bybit adapter starting point |
| `LIVE.md` from Jev-Trades if it exists | Testnet vs mainnet notes |

Optional: **one** sample `agent_log.jsonl` row (not the 25MB file).

Do **not** attach: Next.js UI, SQLite paper ledger, Yahoo collector, full logs, API keys.

Link `https://github.com/zadescoxp/Jev-Trades` as read-only reference. New code goes in the Bob Trades backend repo.

---

## 0. Validation of the proposed shape

Approved:

- Two Docker services: `api` and `worker`
- One worker owns **public** market data + indicator math + Redis writes
- API owns auth, user profile, Bybit key connect, start/stop, portfolio reads, close / amend TP/SL
- Redis is the hot cache
- Bybit only in v1 (testnet + mainnet). No paper. No SQLite ledger as source of truth
- No manual entries

Corrected:

- **Frontend never calls the worker port.** Worker is internal. Charts and logs go `phone → api → Redis` (or api SSE).
- **Orders and Jev do not run inside an HTTP request.** `POST /agent/start` flips a flag. The **worker** (or a loop inside the worker process) consumes that flag on closed bars. If you put `create_order` in a FastAPI handler, a timeout leaves a naked live order.
- **Balances / positions are not invented in Redis.** Cache them after Bybit calls. On mismatch, Bybit wins. TTL short (5–15s) while agent is on.
- **One worker is enough for v1** if it does: (1) public WS + indicators, (2) per-user Jev on **closed bars only** for users with `agent_on=true`. Split a `trader` container later if CPU/TypeSafe becomes the bottleneck — not now.

---

## 1. Containers and managed services

```
services:
  api:      # public HTTPS
  worker:   # internal only
```

Supabase provides Auth and Postgres. Upstash provides Redis over its REST API.
They are managed external services, not Compose containers.

Ports (example):

- `api`: 8080 published
- `worker`: 8081 **not** published to the internet (health on docker network only)
- Supabase and Upstash credentials are environment variables; never bake them
  into images or commit them.

Env per service. No secrets in the image.

---

## 2. Data stores

**Supabase Postgres** (source of *your* world; Supabase Auth owns identity):

- profiles keyed by Supabase Auth user id (username, dob optional)
- broker_connections (user_id, venue=bybit, mode=testnet|mainnet, key_enc, secret_enc, status)
- agent_settings (user_id, symbol, risk_profile, max_position_pct, agent_on, armed)
- agent_logs (user_id, ts, latency_ms, request_json, response_json, intended, executed, reason)
- idempotency / client_order_ids

Use row-level security for user-owned records. The API should use the caller's
verified Supabase JWT for user-scoped operations. A Supabase service-role key
bypasses RLS: never ship it to the phone; only add a rotated server-side key to
the worker if cross-user background queries require it.

**Upstash Redis** (hot, accessed through the REST API):

```
mkt:{symbol}:{tf}:candles   # last N bars
mkt:{symbol}:ticker
mkt:{symbol}:book           # optional L10
ind:{symbol}:{tf}           # computed indicators
user:{id}:portfolio         # last Bybit snapshot + fetched_at
user:{id}:agent             # on/off, last decision
hb:market                   # last successful public tick ts
```

Invalidate / rewrite portfolio cache on: fill, close, amend TP/SL, connect, mode switch.

---

## 3. Worker (market + decide)

Loop A — public, always on:

1. CCXT/Bybit public WS (or REST poll fallback) for 7 spot pairs
2. On closed candle: compute existing indicator suite (port from `pipeline/`)
3. Write Redis `mkt:*` and `ind:*`
4. Touch `hb:market`

Loop B — private, only users with `agent_on`:

1. Every closed bar on that user’s selected symbol
2. If `hb:market` stale (>15s) → skip, log `feed_stale`
3. Build schema state from Redis indicators + Bybit snapshot (balance, position, min qty)
4. TypeSafe Jev
5. Python gates (confidence, precision, free USDT, one position, mainnet caps)
6. `create_entry` + `attach_tp_sl` via CCXT Bybit
7. Refresh Bybit → Redis portfolio + Postgres log (`latency_ms`)

Private WS per user is **not** required for v1. REST after each action + 10s poll while `agent_on` is enough.

---

## 4. API surface (mobile only talks here)

Auth:

- The mobile app signs in/up through Supabase Auth (Google, X, or email).
- Send the Supabase access token as `Authorization: Bearer <token>` to protected
  API routes; the API validates it with Supabase Auth.
- `GET /auth/session` → validated user id/email
- `GET/PATCH /me` (username, dob)

Broker:

- `POST /broker/bybit` body: `{ mode, api_key, api_secret }` → validate `fetch_balance`, encrypt, store
- `DELETE /broker/bybit`
- `GET /broker/status`

Markets (from Redis, no user key):

- `GET /markets`
- `GET /markets/{symbol}/candles?tf=`
- `GET /markets/{symbol}/indicators?tf=`
- `GET /stream` SSE: ticker + candle close for subscribed symbol

Portfolio (Bybit + cache):

- `GET /portfolio`
- `GET /positions`
- `GET /orders`
- `POST /positions/{symbol}/close`
- `POST /positions/{symbol}/tpsl` `{ tp, sl }`

Agent:

- `POST /agent/start` `{ symbol, risk, max_position_pct }`
- `POST /agent/stop`
- `GET /agent/logs?limit=`

No `POST /orders/buy`.

---

## 5. Bybit

v1 connect = paste key (testnet and mainnet separate rows). OAuth later (broker program). Encrypt at rest. Worker is the only process that uses the secret.

Sandbox: `set_sandbox_mode(True)` when mode=testnet. Never mix keys.

---

## 6. Phases

0. Repo + compose: API/worker stubs, Supabase/Upstash configuration, health
1. Worker Loop A: 7 symbols → Redis candles + indicators
2. API market routes + SSE from Redis
3. Auth + profile
4. Bybit connect + portfolio GET (no trade)
5. Worker Loop B: Jev + gates + entry/TP/SL + logs
6. Close + amend TP/SL
7. Mainnet caps + kill switch + Docker harden

Do not start Phase 5 before Phase 4 returns a real testnet balance.

---

## 7. Invariants

- Phone never holds Bybit secret, Supabase service-role key, or Upstash token
- Supabase Auth owns sign-in and sessions; API validates bearer tokens
- Worker never accepts public internet traffic
- Paper code paths deleted, not feature-flagged
- Jev question names stay additive-compatible with current schema
- One open spot position per symbol per user
- Stale market heartbeat blocks new entries
