create table public.profiles (
    user_id uuid primary key references auth.users (id) on delete cascade,
    username text,
    dob date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.broker_connections (
    user_id uuid not null references auth.users (id) on delete cascade,
    venue text not null check (venue = 'bybit'),
    mode text not null check (mode in ('testnet', 'mainnet')),
    key_enc text not null,
    secret_enc text not null,
    status text not null default 'connected',
    updated_at timestamptz not null default now(),
    primary key (user_id, venue, mode)
);

create table public.agent_settings (
    user_id uuid primary key references auth.users (id) on delete cascade,
    symbol text not null default 'BTCUSDT',
    risk_profile text not null default 'medium',
    max_position_pct numeric not null default 0.1 check (max_position_pct > 0 and max_position_pct <= 1),
    agent_on boolean not null default false,
    armed boolean not null default false,
    updated_at timestamptz not null default now()
);

create table public.agent_logs (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    ts timestamptz not null default now(),
    latency_ms integer,
    request_json jsonb,
    response_json jsonb,
    intended boolean,
    executed boolean,
    reason text
);

create index agent_logs_user_ts_idx on public.agent_logs (user_id, ts desc);

create table public.client_order_ids (
    user_id uuid not null references auth.users (id) on delete cascade,
    client_order_id text not null,
    order_id text,
    created_at timestamptz not null default now(),
    primary key (user_id, client_order_id)
);

alter table public.profiles enable row level security;
alter table public.broker_connections enable row level security;
alter table public.agent_settings enable row level security;
alter table public.agent_logs enable row level security;
alter table public.client_order_ids enable row level security;

create policy profiles_user_access on public.profiles
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy broker_connections_user_access on public.broker_connections
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy agent_settings_user_access on public.agent_settings
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy agent_logs_user_access on public.agent_logs
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy client_order_ids_user_access on public.client_order_ids
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.broker_connections to authenticated;
grant select, insert, update, delete on public.agent_settings to authenticated;
grant select, insert, update, delete on public.agent_logs to authenticated;
grant select, insert, update, delete on public.client_order_ids to authenticated;
grant usage, select on sequence public.agent_logs_id_seq to authenticated;