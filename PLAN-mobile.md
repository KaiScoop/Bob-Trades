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
| TRX | tron | `.../images/tron/standard.png` |

Also valid: CoinGecko `image.small` on `/coins/{id}` (rate-limited), or `https://logo.octav.fi/api/icon/eth.png`.

Do not call CoinGecko from every list render. Download once into the repo. If the user drops custom coin art, those files win.

---

## 1. Screens

1. Auth — Google / X / email via Supabase Auth
2. Profile setup — username (required), DOB optional
3. Home — Testnet | Mainnet toggle (disabled until Bybit connected for that mode)
4. Connect Bybit — in-app checklist + key/secret fields + “Test connection”
5. Markets — 7 assets, last price from `GET /markets` (Redis-backed)
6. Symbol — Lightweight Charts, TF chips, Start Jev panel
7. Agent — start/stop, risk, max %, live log with `latency_ms`
8. Positions — open from Bybit, Close, Edit TP/SL
9. History — fills + agent decisions

---

## 2. Chart data

On open symbol:

1. `GET /markets/ETH-USD/candles?tf=1m` → paint
2. Open `GET /stream?symbol=ETH-USD&tf=1m` (SSE or WS **to your API**)
3. Append ticks / closed bars

Do not open a Bybit WebSocket from the phone.

Switch TF → new REST bootstrap + resubscribe. One subscription at a time.

---

## 3. Start Jev

Required before start:

- Broker connected for current mode
- Testnet: balance > 0 shown from `GET /portfolio`
- Mainnet: extra confirm + `armed` understood

Then `POST /agent/start`. Poll or SSE `user:{id}:agent` via API for log lines.

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

Sign-up, sign-in, and token refresh use the Supabase Auth SDK. The app sends the
resulting access token on protected backend requests; `GET /auth/session` can
confirm the API recognizes the session. OpenAPI from `PLAN-backend.md` section
4 is the contract for all product data. If a field is missing, add it on the
API — do not scrape Bybit from RN.
