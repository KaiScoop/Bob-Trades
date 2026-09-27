# Bob Trades API

Frontend integration contract for the public FastAPI service.

## Base URL

Local development:

```text
http://localhost:8080
```

The frontend must use one configured API base URL. It must not call the worker,
Bybit, Supabase PostgREST, Redis, or Upstash directly.

## Authentication

Supabase Auth owns the user accounts and issues the access tokens. Create
accounts with `POST /auth/signup` and authenticate with `POST /auth/signin`.
Send the resulting access token on every protected request:

```http
Authorization: Bearer <supabase-access-token>
```

Supabase may return tokens in a redirect URL fragment such as `#access_token=...`.
Fragments are not sent to the server in HTTP requests; the client must parse
them and send the access token in the `Authorization` header. Send refresh
tokens only in the JSON body of `POST /auth/refresh`, never in a URL.

Public routes are `POST /auth/signup`, `POST /auth/signin`, `GET /health`,
`GET /markets`, the market candle and indicator routes, and `GET /stream`. All
other routes require authentication.

Common authentication failures:

| Status | Meaning |
|---|---|
| 401 | Missing, malformed, expired, or invalid bearer token |
| 403 | Authenticated user is not allowed to perform the operation |
| 404 | User resource or connected Bybit account does not exist |
| 422 | Request validation failed |
| 502 | Upstream Bybit request failed |
| 503 | Supabase, Redis, Bybit configuration, or the trading worker is unavailable |

FastAPI also returns its standard validation shape for `422` responses:

```json
{"detail":[{"loc":["body","field"],"msg":"...","type":"..."}]}
```

## Shared values

Supported symbols are:

```text
BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT ADAUSDT LINKUSDT
```

Use these exact `USDT` symbols. `ETH-USD` and other dash-separated symbols are
not accepted.

Supported `tf` values:

```text
1m 5m 15m 1h 4h 1d
```

## Health and markets

### `GET /health`

Returns service and dependency readiness. The HTTP status is `200` when all
checks pass and `503` when the API is degraded.

```json
{
  "status": "ok",
  "service": "api",
  "dependencies": {
    "supabase_auth": true,
    "supabase_profiles": true,
    "upstash_redis": true
  }
}
```

### `GET /markets`

```json
{"symbols":["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","LINKUSDT"]}
```

### `GET /markets/{symbol}/candles?tf=1m`

```json
{
  "symbol": "BTCUSDT",
  "tf": "1m",
  "candles": [
    {
      "ts": 1790447700000,
      "open": 100.0,
      "high": 101.0,
      "low": 99.0,
      "close": 100.5,
      "volume": 20.0
    }
  ]
}
```

`ts` is Unix milliseconds. Market data may be unavailable until the worker has
populated Redis; that condition returns `503`.

### `GET /markets/{symbol}/indicators?tf=1m`

```json
{
  "symbol": "BTCUSDT",
  "tf": "1m",
  "indicators": {
    "rsi14": 52.1,
    "ema20": 100.2,
    "ema50": 99.8,
    "macd": 0.12,
    "macd_signal": 0.09,
    "atr14": 1.4
  }
}
```

The indicator object can gain additional calculated fields. Frontend consumers
should ignore unknown fields.

### `GET /stream?symbol=BTCUSDT&tf=1m`

Returns `Content-Type: text/event-stream`, first with a snapshot and then with
an update whenever the cached ticker or recent candles change:

```text
event: snapshot
data: {"symbol":"BTCUSDT","tf":"1m","ticker":{},"candles":[...],"event":"snapshot"}

event: update
data: {"symbol":"BTCUSDT","tf":"1m","ticker":{},"candles":[...],"event":"update"}

```

The connection polls the worker-populated cache once per second and remains open
until the client disconnects. It sends keep-alive comments when market data has
not changed. Use the candle endpoint for bootstrap; the worker refreshes fast
market data every five seconds.

To receive current tickers for multiple markets on one connection, pass a
comma-separated `symbols` query parameter:

```text
GET /stream?symbols=BTCUSDT,ETHUSDT,SOLUSDT
```

The snapshot and update data then contains a `markets` array with one
`{ "symbol": "...", "ticker": { ... } }` entry per requested market. The
single-symbol response remains unchanged when `symbols` is omitted.

## Session and profile

### `POST /auth/signup`

Requests a Supabase email signup link. No password is required. The user must
follow the emailed link before an authenticated session is available.

```json
{"email":"user@example.com"}
```

The response is Supabase's OTP response; it does not contain an access token.

### `POST /auth/signin`

Requests a sign-in magic link for an existing user. No password is required.

```json
{"email":"user@example.com"}
```

After the user follows the link, the client obtains the Supabase session and
uses its `access_token` as the bearer token for protected API routes.

### `GET /auth/session`

Validates the bearer access token by asking Supabase Auth for the current user.
Invalid or expired tokens return `401`.

```http
Authorization: Bearer <access-token>
```

### `POST /auth/refresh`

Exchanges a Supabase refresh token with Supabase Auth. Supabase validates it and
returns a rotated token pair; clients must replace both stored tokens with the
returned values. Invalid or expired refresh tokens return Supabase's auth error.

```json
{"refresh_token":"<refresh-token>"}
```

The response contains Supabase's token response, including the new
`access_token` and `refresh_token`.

`GET /auth/session` returns the validated user identity:

```json
{"user_id":"auth-user-id","email":"user@example.com"}
```

### `GET /me`

```json
{"user_id":"auth-user-id","username":"bob","dob":"1990-01-01"}
```

A new profile returns `username: null` and `dob: null`.

### `PATCH /me`

Request fields are optional; send only fields being changed:

```json
{"username":"bob","dob":"1990-01-01"}
```

Response is the stored profile in the same shape as `GET /me`.

## Bybit connection and account

### `POST /broker/bybit`

Request:

```json
{"mode":"testnet","api_key":"...","api_secret":"..."}
```

`mode` is `testnet` or `mainnet`. The API validates the credentials before
storing encrypted credentials. Secrets are never returned.

Response:

```json
{"status":"connected","mode":"testnet","balance":100.0}
```

### `GET /broker/status`

```json
{"connected":true,"mode":"testnet","balance":100.0}
```

When disconnected, `mode` is `null` and `balance` is `0.0`.

### `DELETE /broker/bybit`

Stops the agent, removes the user's Bybit connection, and clears the cached
portfolio.

```json
{"deleted":true}
```

### `GET /portfolio`

```json
{"mode":"testnet","balance":100.0,"asset":"USDT"}
```

### `GET /positions`

```json
{
  "positions": [
    {"symbol":"BTCUSDT","side":"Buy","size":0.01,"free":0.01}
  ],
  "count": 1
}
```

### `GET /orders`

Returns the open/recent Bybit order records without reshaping the exchange
payload:

```json
{"orders":[],"count":0}
```

The frontend should treat unknown order fields as optional.

## Agent

### `POST /agent/start`

Requires a connected Bybit account. Testnet starts are armed automatically.
Mainnet requires `arm_live: true` and may be rejected by safety caps.

Request:

```json
{
  "symbol":"BTCUSDT",
  "risk":"medium",
  "max_position_pct":0.2,
  "arm_live":false
}
```

`risk` accepts `low`, `medium`, or `high` plus the backend's supported aliases.
The API returns `422` for an unsupported risk profile.

Response:

```json
{
  "status":"started",
  "symbol":"BTCUSDT",
  "risk":"balanced",
  "max_position_pct":0.2,
  "mode":"testnet",
  "armed":true
}
```

### `POST /agent/stop`

```json
{"status":"stopped"}
```

### `GET /agent/logs?limit=50`

`limit` is from 1 through 200; results are newest first.

```json
{
  "logs": [
    {
      "id": 1,
      "ts":"2026-09-27T12:00:00+00:00",
      "latency_ms":120,
      "request_json":{},
      "response_json":{},
      "intended":false,
      "executed":false,
      "reason":"jev_hold"
    }
  ]
}
```

### `POST /agent/kill-switch`

Admin-only route. A non-admin receives `403`.

```json
{"active":true,"expires_in_seconds":604800}
```

## Position actions

### `POST /positions/{symbol}/close`

Closes the selected spot position and refreshes the portfolio cache. The body
is optional.

```json
{"status":"closed","symbol":"BTCUSDT","result":{}}
```

### `POST /positions/{symbol}/tpsl`

Request:

```json
{"tp":105.0,"sl":98.0}
```

Response:

```json
{"status":"updated","symbol":"BTCUSDT","tp":105.0,"sl":98.0,"result":{}}
```

## Frontend integration sequence

1. Authenticate with Supabase Auth and retain its access token securely.
2. Call `GET /auth/session` to verify the API session.
3. Call `GET /markets` and use an exact returned symbol.
4. Bootstrap charts with `GET /markets/{symbol}/candles` and indicators with
   `GET /markets/{symbol}/indicators`.
5. Connect Bybit through `POST /broker/bybit`; never send credentials anywhere
   except this API route.
6. Read `GET /portfolio` before showing the start-agent action.
7. Start or stop Jev with the agent routes and refresh `GET /agent/logs`.
8. Render positions from `GET /positions`; use the close and TP/SL routes for
   actions. There is no manual buy or sell endpoint.

## Current verification boundary

The backend unit and contract tests run against mocked external services. They
verify request validation and route behavior but do not prove live Supabase,
Upstash, or Bybit connectivity. A testnet smoke test with real configured
services is required before enabling live user traffic.
