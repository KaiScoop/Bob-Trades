# Bob Trades — handover for developers

Read this once before touching code. It is the product, the market, and the stack in plain language.

Repo: https://github.com/zadescoxp/Bob-Trades

---

## 1. What this product is

Bob Trades is a mobile app where a user connects **their own Bybit account** and lets an AI named **Jev** (we brand it as **Bob** in the UI) decide when to buy or hold spot crypto.

The user does **not** tap Buy / Sell. They pick:

- which coin
- how aggressive (low / medium / high risk)
- how big a slice of their balance Bob may use

Then they press **Start Bob**. A backend worker watches the market, asks Jev for a structured decision, and — only if Python risk checks pass — places the order on Bybit.

The user can still **close** a position or **change take-profit / stop-loss**. That is the only manual trading.

There is no fake “paper wallet” in this product. Money is either Bybit **testnet** (fake coins for practice) or Bybit **mainnet** (real money).

---

## 2. Crypto trading in five minutes

### Spot (what we do)

You buy a coin with USDT (a dollar-pegged stablecoin). You own that coin. You sell it later. No borrowed money. No shorting in v1. One position per coin.

Example: user has 100 USDT on Bybit. Bob buys 0.01 ETH. That ETH sits in their Bybit spot wallet until Bob (or the user) sells it.

### Testnet vs mainnet

| | Testnet | Mainnet |
|---|---|---|
| Money | Fake USDT from Bybit’s faucet | Real USDT the user deposited |
| Keys | Created on testnet.bybit.com | Created on bybit.com |
| Risk | None financially | Real |

Same app, same API shape, different keys and a safety switch (`arm_live`) for mainnet.

### Charts and timeframes

A **candle** is one bar: open, high, low, close, volume for a slice of time.

We support: `1m 5m 15m 1h 4h 1d`.

Jev usually decides on a **closed** candle (the bar that just finished), not on every tick. That keeps API cost and noise down.

### Indicators (already computed on the worker)

- **RSI** — is price stretched up or down?
- **EMA** — smoothed average price (fast 20, slow 50)
- **MACD** — momentum
- **ATR** — how wild the swings are (used for stops)

You do not need to reimplement these in the app. The API returns them.

### TP / SL

- **Take profit (TP)** — sell if price goes up to X
- **Stop loss (SL)** — sell if price goes down to Y

Bob proposes these. The user can edit them later. The exchange (or our worker fallback) is supposed to hold those orders.

### What “liquidity / volume / volatility” means

- **Volume** — how much traded recently. Dead volume → Jev should hold.
- **Spread** — gap between buy and sell price. Wide spread eats the trade.
- **Volatility** — how jumpy price is. Too quiet or too insane both change sizing.

---

## 3. Who is Jev / Bob

**Jev** is a TypeSafe AI model. It is fast (milliseconds) and it only answers a **fixed form**, not a chat.

Typical fields (simplified):

- `action_choice`: buy / hold / sell
- confidence-style scores
- quantity suggestion
- stop / take-profit suggestion

The model does **not** talk to Bybit.  
Python does **not** let a “buy” through just because Jev said buy. Gates check:

- Is the market feed fresh?
- Is the user connected?
- Is testnet / mainnet armed correctly?
- Enough free USDT?
- Size above Bybit’s minimum?
- Daily loss / max notional / kill switch?

If any gate fails, the log says hold and why (`reason`).

---

## 4. What the user sees (app)

Brand: black UI, white text, blue gradient `#0C31B3 → #0947BD`.  
Fonts: Instrument Sans on titles, Google Sans Flex on the rest.  
Logo: white rounded mark with two vertical pills.

Tabs, left to right:

1. **Home** — “Hello, {username}”, USDT balance, list of 7 coins  
2. **Positions** — open positions + history; Close and edit TP/SL  
3. **Trade** — pick coin, chart, risk, max %, Start / Stop Bob  
4. **Activity** — Jev logs (time, reason, latency_ms, tap for JSON)  
5. **Profile** — account, Bybit connect/disconnect, sign out

Auth today: **email magic link** (no password).  
`POST /auth/signup` and `POST /auth/signin` send a link. After the user opens it, the app stores the Supabase access token and calls our API with `Authorization: Bearer …`.

Onboarding: username required, date of birth optional.

Connect Bybit: paste API key + secret + mode (`testnet` | `mainnet`). Secrets live encrypted on the server. The phone must never keep the Bybit secret.

---

## 5. Coins we trade

Exact API symbols (do not send `ETH-USD`):

```
BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT ADAUSDT LINKUSDT
```

Icons: bundle locally. Source pattern:

```
https://cdn.jsdelivr.net/gh/simplr-sh/coin-logos/images/{id}/standard.png
```

ids: `bitcoin`, `ethereum`, `solana`, `binancecoin`, `ripple`, `cardano`, `chainlink`

---

## 6. How the system is wired

```
Phone (Expo / React Native)
        |
        | HTTPS only
        v
API  :8080   FastAPI
        |-- Supabase Auth + Postgres (users, keys encrypted, logs)
        |-- Upstash Redis (hot candles, indicators, cached portfolio)
        |
Worker :8081  (not public)
        |-- polls Bybit public market → Redis
        |-- for users with agent ON, on new closed candle:
              build state → Jev → gates → Bybit private order
```

**Rule:** the phone never talks to the worker, Redis, Bybit, or Supabase tables directly. One base URL.

Two Docker services: `api` and `worker`. Redis and Postgres are hosted (Upstash + Supabase).

---

## 7. Repo map

```
Bob-Trades/
  backend/          Python API + worker   ← product brain
    app/            public routes
    worker/         market loop + Jev + orders
    common/         Bybit, Redis, shared types
    API.md          contract for the app
    compose.yaml
  frontend/         Expo app              ← still catching up to API.md
  PLAN-backend.md
  PLAN-mobile.md
```

Older cousin (do not merge into this app):  
https://github.com/zadescoxp/Jev-Trades  
That was a single-user paper desk with a Next.js UI and SQLite. Bob Trades is multi-user, real broker, no paper ledger.

---

## 8. Backend status (what already works in code)

Implemented (mocked tests pass; live testnet smoke still required):

- Magic-link auth routes + bearer checks  
- Profile get/patch  
- Bybit connect / status / disconnect, secrets Fernet-encrypted  
- Portfolio, positions, orders reads  
- Market list, candles, indicators  
- Stream endpoint for live chart updates  
- Agent start / stop / logs  
- Close position, update TP/SL  
- Worker: poll 7 symbols, indicators, Jev loop, risk gates, candle dedupe  
- Kill switch (admin)  
- Docker compose  

Not done / not proven live:

- Real Bybit + Jev + Supabase smoke test on testnet  
- Production WS market feed (polling is fine for v1)  
- Mainnet hardening (rate limits, metrics, secret rotation)  
- Frontend fully wired to a running API  

**Do not turn on mainnet** (`LIVE_ARMED` / `arm_live`) until a testnet fill has been seen on Bybit’s own site.

---

## 9. Frontend status

Expo + TypeScript app exists. Design and screen plan are in `PLAN-frontend.md` / conversation. The friend should implement against **`backend/API.md`**, not invent routes.

While `/stream` is flaky, poll candles every ~5 seconds. Charts: TradingView Lightweight Charts.

---

## 10. Important API facts

Base: `http://localhost:8080`  
Docs: `/docs` and `backend/API.md`

Protected routes need:

```
Authorization: Bearer <supabase-access-token>
```

There is **no** `POST /orders/buy`.

Start agent body:

```json
{
  "symbol": "ETHUSDT",
  "risk": "medium",
  "max_position_pct": 0.2,
  "arm_live": false
}
```

Testnet starts without arm. Mainnet needs `arm_live: true`.

Logs: `GET /agent/logs?limit=50` — newest first, includes `latency_ms` and `reason`.

---

## 11. Who owns what

| Person | Owns |
|---|---|
| Backend (Zade) | API, worker, Jev, Bybit, Redis, schema |
| Frontend friend | Expo screens, theme, charts, calling API.md only |
| Nobody on the phone | Bybit keys, TypeSafe/Jev key, service role key |

If the UI needs a new field, add it on the API first, then the app.

---

## 12. Safety rules (non-negotiable)

1. No manual buy/sell in the app.  
2. No Bybit secret in the client.  
3. Worker port is not on the public internet.  
4. Stale market heartbeat → no new entries.  
5. Mainnet is a second, explicit confirm.  
6. Disconnect Bybit also stops the agent.

---

## 13. How to run (local)

Backend:

```bash
cd backend
cp .env.example .env   # fill Supabase, Upstash, Fernet key, optional Jev key
uvicorn app.main:app --reload --port 8080
uvicorn worker.main:app --port 8081
```

Trading loop only runs if `TRADING_WORKER_ENABLED=true`.

Frontend:

```bash
cd frontend
npm install
npx expo start
```

Point the app at the machine’s LAN IP, not only `localhost`, if you use a physical phone.

---

## 14. One-sentence pitch

Bob Trades is a dark mobile desk that connects a user’s Bybit account and lets a fast structured model trade spot crypto under Python risk gates — practice on testnet, real funds later, no buy button.
