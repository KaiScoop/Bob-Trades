# Bob Trades Backend

Phase 0 provides the API and internal worker health endpoints. Supabase Auth
and Postgres, plus Upstash Redis, are managed external services; Compose does
not start local database or cache containers. The worker has no published host
port, and mobile clients communicate with the API for application data.

## Run locally

```sh
cp .env.example .env
# Set the rotated Supabase and Upstash values in .env.
docker compose up --build
```

The API health endpoint is available at `http://localhost:8080/health` and
reports whether Supabase Auth, Supabase PostgREST, and Upstash Redis are
reachable. `/auth/session` validates a Supabase access token sent as a bearer
token.

The Supabase publishable key is safe for client use. Never put a Supabase
service-role key or Upstash REST token in the mobile app or commit them. A
service-role key is not required for this phase; add a rotated key only to the
worker environment if a later cross-user worker operation requires it.