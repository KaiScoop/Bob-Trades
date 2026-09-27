# PLAN: Bob Trades — React Native frontend

Feed this file + `backend/API.md` + `design/logo.png` + `design/ui-inspo.png` to the VS Code agent.

Product: **Bob Trades**. Agent name on screen: **Bob** / **Jev** (use “Bob” in marketing copy, “Jev” only in Activity technical detail if the log payload uses it).

Contract source of truth:  
https://github.com/zadescoxp/Bob-Trades/blob/master/backend/API.md  
Local API: `http://localhost:8080` (override with `EXPO_PUBLIC_API_URL`).

The phone talks **only** to that API. No Bybit SDK, no Supabase PostgREST, no Redis, no worker port.

---

## 0. Design language

Inspiration board is the attached Odie-style sheet: generous white space, large type, pill buttons, simple lists, bottom tab bar, candlestick as a hero on the trade surface.

**Invert it.** Do not ship a white app.

| Token | Value |
|---|---|
| Background / primary | `#000000` |
| Surface | `#0A0A0A` cards, `#111111` raised |
| Hairline | `#1F1F1F` |
| Text primary | `#FFFFFF` |
| Text muted | `#A1A1AA` |
| Text faint | `#71717A` |
| Danger | `#EF4444` |
| Success | `#22C55E` |
| Accent start | `#0C31B3` |
| Accent end | `#0947BD` |
| Accent fill | linear `135deg`, `#0C31B3` → `#0947BD` |

**Type**

- Body / UI / numbers: **Google Sans Flex** (Regular 400, Medium 500, Semibold 600)
- Headings / splash wordmark / section titles: **Instrument Sans** (Semibold 600, Bold 700)

Splash headline is Instrument Sans. Everything else that is a sentence is Google Sans Flex.

**Logo**

User file: white rounded-square “pause / two pills” mark on black.

- Splash: logo 96–120pt, centered
- Header / tab selected: 24pt mark, no extra container
- Do not recolor the mark. It is already white-on-black.
- Do not add a wordmark next to it unless a lockup file is dropped later

**Shape**

- Radius 16 on cards, 24 on primary buttons, 999 on chips/tabs
- Primary CTA = accent gradient fill + white label
- Secondary CTA = 1px `#1F1F1F` hairline, white label
- Lists: icon 32, name + ticker, right-aligned change in green/red
- No neon, no glassmorphism, no stock “crypto purple”

**Behavior the inspo must NOT copy**

The board has Buy / Sell / Deposit / Withdraw / keypad. **Do not build those.** Bob starts the agent. User may only close or edit TP/SL.

---

## 1. Navigation

Unauthenticated stack:

1. Splash / welcome  
2. Sign up | Sign in (email magic link)  
3. Check email  
4. Onboarding (username + DOB) — only if `GET /me` has null username  

Authenticated tabs (left → right):

| Tab | Icon idea | Screen |
|---|---|---|
| Home | mark / house | Greeting + portfolio + coin list |
| Positions | briefcase | Active / History |
| Trade | pulse / chart | Pick asset + risk + Start Bob |
| Activity | list | Jev logs |
| Profile | person | Account + broker |

No sixth tab. Connect-Bybit is a full-screen pushed from Home or Profile when `GET /broker/status.connected === false`.

---

## 2. Screens and API

### 2.1 Splash / welcome (one screen)

- Full black  
- Logo  
- Heading Instrument Sans: **Let Bob Trade**  
- Subtext Google Sans Flex muted: **You set the risk. Bob takes the tape.**  
- Gradient **Sign up** → signup  
- Ghost **Sign in** → signin  

Optional 1s logo-only beat before the buttons fade in. No carousel.

### 2.2 Auth

Backend is **email magic link, no password**.

Sign up: email field → `POST /auth/signup` `{ email }` → “Check your email”  
Sign in: same field → `POST /auth/signin` `{ email }`

After the user opens the link, parse `#access_token` / session, store `access_token` + `refresh_token` in secure storage, then `GET /auth/session`.

Refresh: `POST /auth/refresh` `{ refresh_token }` on 401; replace both tokens.

Empty / error: 422 inline under the field. Do not invent a password UI.

### 2.3 Onboarding

If `GET /me` → `username` is null:

- Title: **What should Bob call you?**  
- Username (required)  
- Date of birth (optional, `YYYY-MM-DD`)  
- Gradient **Continue** → `PATCH /me`

Skip DOB if they leave it blank.

### 2.4 Connect Bybit (gate)

Show before Trade can start, and as a Home banner if disconnected.

- Mode segmented: **Testnet** | **Mainnet**  
- API key, API secret (secret field obscured)  
- Checklist: Spot trade on, Withdraw off, this mode’s site only  
- **Test connection** → `POST /broker/bybit`  
- Success: badge + `balance` from response  
- Disconnect later from Profile → `DELETE /broker/bybit`

Never log secrets. Never put them in AsyncStorage unencrypted beyond the request.

### 2.5 Home

```
Hello, {username}
[Testnet|Mainnet pill]   [balance USDT from GET /portfolio]

Portfolio card
  USDT available
  mode

Markets
  row × GET /markets symbols
  last close from candles or ticker if present
```

Tap a row → Trade preselected to that symbol (or a lightweight chart sheet). Do not open a manual order ticket.

If disconnected: portfolio card CTA **Connect Bybit**.

Pull-to-refresh: `/portfolio` + `/markets` + one candle close per symbol if cheap; otherwise portfolio + markets only.

### 2.6 Positions

Tabs: **Active** | **History**

Active = `GET /positions`  
Each row: symbol, side, size, optional free. Swipe / buttons:

- **Close** → confirm sheet → `POST /positions/{symbol}/close`  
- **TP / SL** → two numeric fields → `POST /positions/{symbol}/tpsl` `{ tp, sl }`

History: `GET /orders` (treat unknown fields as optional). Filter chips: All / Open / Filled if the payload allows; otherwise a single list.

Empty Active: **Bob hasn’t opened anything yet.** No Buy button.

### 2.7 Trade

This is **configure Bob**, not a ticket.

1. Asset picker — the 7 symbols (`BTCUSDT` … `LINKUSDT` exact strings)  
2. Chart — Lightweight Charts  
   - Bootstrap `GET /markets/{symbol}/candles?tf=`  
   - Live `GET /stream?symbol=&tf=` SSE (keep-alives are comments; ignore)  
   - TF chips: `1m 5m 15m 1h 4h 1d`  
   - Fallback if SSE flakes: poll candles every 5s  
3. Optional indicator strip from `GET /markets/{symbol}/indicators` (RSI / EMA20)  
4. Risk: Low / Medium / High → API `low` / `medium` / `high`  
5. Max position slider → `max_position_pct` `0.05–0.5` default `0.2`  
6. Mainnet only: checkbox **Arm live** → `arm_live: true`  
7. Gradient **Start Bob** → `POST /agent/start`  
8. If running: red-outline **Stop Bob** → `POST /agent/stop`

Blocked until broker connected. Testnet starts without the arm checkbox.

No market/limit toggle. No keypad amount. No Buy Now.

### 2.8 Activity

`GET /agent/logs?limit=50` (newest first).

List row:

- Time (`ts`)  
- Symbol if present in `request_json`  
- `reason`  
- `latency_ms` (e.g. **118 ms**)  
- Pills: intended / executed as yes/no  

Tap → detail: pretty-printed `request_json` / `response_json`, raw reason.

Empty: **Bob is quiet. Start a session from Trade.**

Pull to refresh. Optional 10s poll while Trade has the agent on.

### 2.9 Profile

- Avatar placeholder = first letter of username on accent gradient  
- Username, email from session, DOB  
- Broker card: connected?, mode, balance, **Disconnect**  
- Edit username  
- Sign out (clear tokens)  
- App version  
- Hide admin `POST /agent/kill-switch` unless you later add an admin flag

---

## 3. Things the human did not list — still build

- Session restore on launch: token → `/auth/session` → `/me` → onboarding or tabs  
- Global testnet / mainnet pill in Home header (from `/broker/status`)  
- 503 on candles: “Markets warming up” not a crash  
- 502 on Bybit: toast, keep local UI  
- Keyboard-avoiding on auth and connect  
- Safe area + black status bar  
- Haptics on Start / Stop / Close only  
- Skeleton cards on first Home load  
- Deep link / URL handler for the magic-link return  
- One `api.ts` client: base URL, bearer, refresh-once-on-401  

---

## 4. Data client

```
lib/api.ts
  get/post/patch/delete
  Authorization Bearer
  on 401 → refresh → retry once

lib/sse.ts     EventSource-compatible for /stream
lib/secure.ts  tokens
theme.ts       colors, radii, type
assets/logo.png
assets/coins/* bundled 7 icons
```

Display map (API id → label):

| API | Label |
|---|---|
| BTCUSDT | Bitcoin · BTC |
| ETHUSDT | Ethereum · ETH |
| SOLUSDT | Solana · SOL |
| BNBUSDT | BNB · BNB |
| XRPUSDT | XRP · XRP |
| ADAUSDT | Cardano · ADA |
| LINKUSDT | Chainlink · LINK |

Always send the `USDT` id on the wire.

---

## 5. Suggested screen files

```
app/
  (auth)/welcome.tsx
  (auth)/sign-up.tsx
  (auth)/sign-in.tsx
  (auth)/check-email.tsx
  (auth)/onboarding.tsx
  (tabs)/home.tsx
  (tabs)/positions.tsx
  (tabs)/trade.tsx
  (tabs)/activity.tsx
  (tabs)/profile.tsx
  connect-bybit.tsx
  activity/[id].tsx
```

Expo Router is fine. React Navigation is fine. Pick one.

---

## 6. Agent working rules

- Match spacing and list density of the inspiration sheet; match **color and type** of this plan.  
- If a mock shows Buy/Sell, implement the layout without those actions.  
- Do not call worker `:8081`.  
- Do not add coins.  
- Do not add password auth unless `API.md` changes.  
- Keep `API.md` field names exactly (`max_position_pct`, `arm_live`, `tf`, `reason`).  
- First milestone: welcome + auth + home shells on black with logo. Then Trade chart. Then connect + start.

---

## 7. Copy bank

- Splash sub: **You set the risk. Bob takes the tape.**  
- Home empty broker: **Connect Bybit to see your book.**  
- Positions empty: **No open positions.**  
- Activity empty: **No decisions yet.**  
- Mainnet start: **This uses real funds on Bybit.**  
- Stop: **Bob will not open new trades. Open positions stay until you close them.**
