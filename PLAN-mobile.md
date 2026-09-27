# PLAN: Bob Trades — React Native

Product name: **Bob Trades**. Agent inside the product is still **Jev**.
Friend-owned UI. Uses Supabase Auth for identity and the public API for product
data. Never talks to Redis, worker, or Bybit.

---

## 0. Hard rules

- Product data uses `API_URL` only (one backend host); sign-in uses Supabase Auth.
- Supabase client config: `EXPO_PUBLIC_SUPABASE_URL` and
	`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- No Bybit SDK in the app.
- No TypeSafe key in the app.
- Never bundle the Supabase service-role key or Upstash token.
- Keep the Supabase Auth session in secure storage and send its access token to
	the API as `Authorization: Bearer <token>`.
- No Buy / Sell / Short buttons.

---

## 0.1 Design references (human will drop these)

The user will attach mockups, screenshots, Figma exports, color tokens, or font notes in the agent chat or a `design/` folder.

Rules for the coding agent:

- Those files **win** on layout, type, color, spacing, and component look.
- This plan still wins on **behavior** (no manual buy, API-only, chart data path).
- If a mock shows a Buy button, **do not implement it**. Keep the visual system, drop the action.
- If a mock and this plan conflict on screens, ask once, then follow the mock for UI and this plan for data.
- Put reusable tokens in one theme file (`theme.ts`) extracted from the references. Do not hard-code random hex on each screen.
- Do not invent a second visual language while waiting for mocks. Use a neutral shell until the first reference lands, then restyle to match.

Expected drop pattern: `design/logo.png` (or svg), `design/auth.png`, `design/markets.png`, `design/symbol.png`, `design/positions.png`, plus any dark-mode variants.

## 0.2 Branding and coin art

- App display name: **Bob Trades**. Bundle id / slug: `bobtrades`.
- User-supplied **logo** in `design/` is the splash + header mark. Do not invent a wordmark if a file is present.
- Coin icons (7 assets only): prefer **bundled local PNGs** after first fetch so the list does not depend on a third-party CDN at runtime.

Free sources the agent may use to seed `assets/coins/`:

| Coin | CoinGecko id | CDN (jsDelivr, no key) |
|---|---|---|
| BTC | bitcoin | `https://cdn.jsdelivr.net/gh/simplr-sh/coin-logos/images/bitcoin/standard.png` |
| ETH | ethereum | `.../images/ethereum/standard.png` |
| SOL | solana | `.../images/solana/standard.png` |
| BNB | binancecoin | `.../images/binancecoin/standard.png` |
| XRP | ripple | `.../images/ripple/standard.png` |
| ADA | cardano | `.../images/cardano/standard.png` |
| LINK | chainlink | `.../images/chainlink/standard.png` |

Also valid: CoinGecko `image.small` on `/coins/{id}` (rate-limited), or `https://logo.octav.fi/api/icon/eth.png`.

Do not call CoinGecko from every list render. Download once into the repo. If the user drops custom coin art, those files win.

---

## 1. Screens

1. Auth — Google / X / email via Supabase Auth
2. Profile setup — username (required), DOB optional
3. Home — Testnet | Mainnet toggle (disabled until Bybit connected for that mode)
4. Connect Bybit — in-app checklist + key/secret fields + “Test connection”
5. Markets — 7 assets from `GET /markets`; live ticker prices via one API SSE
	subscription per displayed symbol
6. Symbol — Lightweight Charts, TF chips, Start Jev panel
7. Agent — start/stop, risk, max %, live log with `latency_ms`
8. Positions — open from Bybit, Close, Edit TP/SL
9. History — recent Bybit orders + agent decisions. The backend does not expose
	full fill history yet.

---

## 2. Chart data

On open symbol:

1. `GET /markets/ETHUSDT/candles?tf=1m` → paint the candle history
2. `GET /markets/ETHUSDT/indicators?tf=1m` → populate indicator values
3. Open `GET /stream?symbol=ETHUSDT&tf=1m` using Server-Sent Events (SSE)
4. Render the initial `snapshot`, then apply `update` events. Each event has
	`symbol`, `tf`, `ticker`, the most recent three `candles`, and `event`.

Do not open a Bybit WebSocket from the phone.

Supported symbols are `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `XRPUSDT`,
`ADAUSDT`, and `LINKUSDT`. Supported timeframes are `1m`, `5m`, `15m`, `1h`,
`4h`, and `1d`. `GET /markets` returns symbols only, not prices.

Switch TF → new candle/indicator REST bootstrap + resubscribe. One SSE
subscription at a time. The stream polls cached data and emits updates when it
changes; it is not a raw-tick stream.

---

## 3. Start Jev

Required before start:

- Broker connected for current mode
- Testnet: balance > 0 shown from `GET /portfolio`
- Mainnet: extra confirm + `armed` understood

Then `POST /agent/start`. Poll `GET /agent/logs?limit=50` for decisions and
execution status. The mobile app must not read `user:{id}:agent` from Redis.
Starting an agent requires `TRADING_WORKER_ENABLED=true` in the backend API and
worker environment; the worker must be running. A disabled worker returns
`503`. Testnet starts are armed automatically; mainnet requires
`arm_live: true` and is subject to backend risk gates.

---

## 4. Positions

Render `GET /positions`. Actions:

- Close → `POST /positions/{symbol}/close`
- TP/SL → `POST /positions/{symbol}/tpsl`

If empty, say “Jev has no open position” — not “place a trade.”

---

## 5. Out of scope v1

- Multi-broker picker
- Paper mode
- Manual order ticket
- OAuth Bybit button (show “coming soon” if you want)
- Push notifications (nice later)

---

## 6. Contract with backend

Sign-up, sign-in, and token refresh use the Supabase Auth SDK. Keep its session
in secure storage and send the access token on protected backend requests.
Supabase redirects may return tokens in a URL fragment; the app must parse the
fragment because browsers do not send it to the server. `GET /auth/session`
confirms the API recognizes the access token. Use the Supabase SDK to refresh
tokens; it handles refresh-token rotation.

The complete API contract is `backend/API.md`. If a field is missing, add it on
the API — do not call Supabase PostgREST, Bybit, Redis, or the worker from RN.

### Backend route inventory

All product data uses `API_URL`. Routes marked **protected** require
`Authorization: Bearer <access-token>`.

Public:

- `GET /health` — API/dependency health.
- `GET /markets` — supported symbol list; does not return prices.
- `GET /markets/{symbol}/candles?tf=1m` — candle history.
- `GET /markets/{symbol}/indicators?tf=1m` — indicators.
- `GET /stream?symbol=BTCUSDT&tf=1m` — SSE snapshot and changed-data updates.
- `POST /auth/signup` — request an email signup link; body `{ "email": "..." }`.
- `POST /auth/signin` — request an existing-user magic link; body `{ "email": "..." }`.
- `POST /auth/refresh` — exchange a refresh token; body `{ "refresh_token": "..." }`.
	The app uses the Supabase SDK for these auth operations per the hard rules.

Protected:

- `GET /auth/session` — validate the current access token and return user id/email.
- `GET /me` — read profile; `PATCH /me` — update username and/or DOB.
- `POST /broker/bybit` — connect `{ "mode", "api_key", "api_secret" }`.
- `GET /broker/status` — connection state and mode.
- `DELETE /broker/bybit` — disconnect Bybit and stop the user's agent.
- `GET /portfolio` — cached/refreshed USDT balance.
- `GET /positions` — current Bybit spot positions.
- `GET /orders` — recent/open Bybit orders, not a complete fill-history endpoint.
- `POST /agent/start` — `{ "symbol", "risk", "max_position_pct", "arm_live" }`.
- `POST /agent/stop` — stop the user's agent.
- `GET /agent/logs?limit=50` — newest-first agent decision logs.
- `POST /positions/{symbol}/close` — close a position.
- `POST /positions/{symbol}/tpsl` — update `{ "tp", "sl" }`.
- `POST /agent/kill-switch` — admin-only global trading kill switch.
