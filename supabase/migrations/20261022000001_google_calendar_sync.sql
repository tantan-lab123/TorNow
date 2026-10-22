-- One-way sync of appointments to the business owner's Google Calendar.
-- Additive only: no existing column or row is changed. Existing appointments get
-- sync_status = 'not_connected' (a constant default, so the table is not rewritten).

create table public.google_calendar_connections (
    business_id             uuid primary key references public.businesses(id) on delete cascade,
    google_email            text not null,
    refresh_token_encrypted text not null,                 -- AES-256-GCM, key lives in the server environment
    calendar_id             text not null default 'primary', -- 'primary' or the id of the dedicated TorNow calendar
    status                  text not null default 'active'
                            check (status in ('active', 'needs_reconnect')),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

-- Server only: no policies, and browser roles get no privileges at all (same as every other table).
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from anon, authenticated;

alter table public.appointments
    add column google_event_id      text,
    add column sync_status          text not null default 'not_connected'
                                    check (sync_status in ('pending', 'synced', 'failed', 'not_connected')),
    add column sync_error           text,
    add column sync_retry_count     integer not null default 0,
    add column sync_next_attempt_at timestamptz;            -- when the next retry is due (backoff)

-- The retry job only looks at rows that still need work.
create index idx_appointments_sync_due
    on public.appointments (sync_next_attempt_at)
    where sync_status in ('pending', 'failed');
