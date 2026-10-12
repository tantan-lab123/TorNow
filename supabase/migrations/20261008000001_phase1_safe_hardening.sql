-- Phase 1: safe to apply BEFORE the new application code is deployed
-- (does not remove any access the currently deployed app relies on).

-- 0. The four core tables. They existed before migrations were tracked, so this only creates
--    what is missing: on the live database it is a no-op (and this file is already recorded
--    as applied there), while on a new database it lays the ground everything below needs.

create table if not exists public.businesses (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    name text not null,
    owner_phone text not null,
    owner_email text,
    password text, -- bcrypt hash (never plaintext)
    google_id text,
    -- Also carries _settings, _slot_interval_minutes and _date_overrides (see lib/db).
    working_hours jsonb not null default '{
        "sunday":    { "open": "09:00", "close": "19:00", "active": true, "lunch_break": { "active": true, "start": "13:00", "end": "14:00" } },
        "monday":    { "open": "09:00", "close": "19:00", "active": true, "lunch_break": { "active": true, "start": "13:00", "end": "14:00" } },
        "tuesday":   { "open": "09:00", "close": "19:00", "active": true, "lunch_break": { "active": true, "start": "13:00", "end": "14:00" } },
        "wednesday": { "open": "09:00", "close": "19:00", "active": true, "lunch_break": { "active": true, "start": "13:00", "end": "14:00" } },
        "thursday":  { "open": "09:00", "close": "20:00", "active": true, "lunch_break": { "active": true, "start": "13:00", "end": "14:00" } },
        "friday":    { "open": "08:30", "close": "14:00", "active": true, "lunch_break": { "active": false, "start": "12:00", "end": "12:30" } },
        "saturday":  { "open": "00:00", "close": "00:00", "active": false }
    }'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_businesses_slug on public.businesses (slug);

create table if not exists public.services (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    name text not null,
    duration_minutes integer not null check (duration_minutes > 0),
    buffer_minutes integer not null default 5 check (buffer_minutes >= 0),
    price numeric not null default 0 check (price >= 0),
    created_at timestamptz not null default now()
);
create index if not exists idx_services_business on public.services (business_id);

create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    phone text not null,
    first_name text not null,
    last_name text not null,
    email text,
    google_id text,
    auth_provider text default 'guest',
    created_at timestamptz not null default now(),
    constraint uq_business_client_phone unique (business_id, phone)
);
create index if not exists idx_clients_business_phone on public.clients (business_id, phone);

create table if not exists public.appointments (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    service_id uuid references public.services(id) on delete set null,
    client_id uuid not null references public.clients(id) on delete cascade,
    start_time timestamptz not null,
    end_time timestamptz not null,
    status text not null check (status in ('confirmed', 'cancelled')) default 'confirmed',
    reminder_sent boolean not null default false,
    notes text,
    created_at timestamptz not null default now(),
    constraint check_valid_time_range check (end_time > start_time)
);
create index if not exists idx_appointments_business_dates on public.appointments (business_id, start_time, end_time);
create index if not exists idx_appointments_reminders on public.appointments (reminder_sent, start_time) where status = 'confirmed';

-- Only the server (service_role, which bypasses RLS) reads or writes these tables.
alter table public.businesses enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;

-- 1. The anon/authenticated roles never need these. TRUNCATE is not covered by RLS at all.
revoke truncate, trigger, references, delete
  on public.businesses, public.services, public.clients, public.appointments
  from anon, authenticated;

-- 2. Business rows are only ever written by the server (service_role).
revoke insert, update on public.businesses from anon, authenticated;

-- 3. rls_auto_enable() is an event-trigger helper; it must not be callable via /rest/v1/rpc.
--    Only some Supabase projects have it, so skip the revoke where it does not exist.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- 4. Legacy plaintext PIN (default '1234' on every business) is unused. Remove it.
alter table public.businesses drop column if exists pin;

-- 5. Make double-booking impossible at the database level (race-condition safe).
--    Half-open ranges: back-to-back appointments are allowed.
create extension if not exists btree_gist with schema extensions;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'appointments_no_overlap' and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_no_overlap
      exclude using gist (
        business_id with =,
        tstzrange(start_time, end_time, '[)') with &&
      ) where (status = 'confirmed');
  end if;
end $$;

-- NOTE: a unique/digits-only constraint on owner_phone is intentionally NOT added here:
-- two existing rows share the non-normalised phone "055-6664314". Resolve them manually first.
