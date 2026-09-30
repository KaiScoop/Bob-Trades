# Bob Trades Frontend

The Bob Trades mobile and web client is built with Expo, React Native,
TypeScript, and Expo Router. It uses the FastAPI backend contract in
[`../backend/API.md`](../backend/API.md); the app does not connect directly to
Bybit, Supabase PostgREST, Redis, or the worker.

## Setup

Install dependencies from this directory:

```sh
npm install
```

The API defaults to `http://localhost:8080`. Override it in the local Expo
environment when the API runs elsewhere:

```text
EXPO_PUBLIC_API_URL=http://localhost:8080
EXPO_PUBLIC_WEB_API_URL=http://localhost:8080
```

Native clients use `EXPO_PUBLIC_API_URL`; web uses
`EXPO_PUBLIC_WEB_API_URL`.

Start Expo:

```sh
npx expo start
```

For web, run `npx expo start --web`. The backend API and worker setup is
documented in [`../backend/README.md`](../backend/README.md).

## App areas

- **Home**: market list, live prices, movers, and watchlist.
- **Market detail**: ticker stats, price chart, cached order-book depth, and
  calculated technical indicators. The Trade action opens trade setup with the
  selected market.
- **Trade**: choose the asset, risk profile, and capital percentage before
  starting or stopping Bob.
- **Positions and Activity**: inspect holdings, orders, and agent decisions.
- **Profile**: account and broker controls, account equity, available funds,
  asset values and allocation, plus device-local display settings.

The profile settings mask displayed quantities/values or filter holdings valued
below `$1.00`. Those preferences are stored locally and are not sent to the API.
Sign-out clears the stored authentication tokens. Bybit credentials are entered
only through the backend connection API and are never stored in frontend
preferences.

## Validation

```sh
npx tsc --noEmit
npx expo lint
```