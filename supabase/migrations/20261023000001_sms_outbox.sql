-- Service SMS to customers (booking confirmation with a manage link), sent through 019sms.
-- Additive only. Same pattern as the Google Calendar sync: a durable queue row per message,
-- sent right after the booking response and retried by a cron job.

create table public.sms_outbox (
    id                    uuid primary key default gen_random_uuid(),   -- also the 019 external_id (comes back in the delivery report)
    appointment_id        uuid not null references public.appointments(id) on delete cascade,
    kind                  text not null default 'booked'
                          check (kind in ('booked', 'rescheduled', 'cancelled', 'reminder')),
    to_phone              text not null,                               -- normalized 5xxxxxxxx (raw digits when the number was invalid)
    status                text not null default 'pending'
                          check (status in ('pending', 'sent', 'failed', 'skipped')),
    attempts              integer not null default 0,
    next_attempt_at       timestamptz not null default now(),           -- when it is next due; also the lease while a send is in flight
    last_error_code       text,
    last_error_message    text,
    provider_shipment_id  text,
    delivery_status       text,                                         -- raw 019 delivery-report code
    delivered_at          timestamptz,
    -- Manage-link token. Only the SHA-256 hash is stored; a resend creates a new token.
    manage_token_hash     text,
    manage_token_expires_at timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    -- one message of each kind per appointment (idempotent enqueue)
    constraint sms_outbox_appointment_kind_key unique (appointment_id, kind)
);

-- The send job only looks at rows that still need work.
create index idx_sms_outbox_due
    on public.sms_outbox (status, next_attempt_at)
    where status = 'pending';

-- The public manage page finds the appointment by the hash of the token in the link.
create unique index idx_sms_outbox_token_hash
    on public.sms_outbox (manage_token_hash)
    where manage_token_hash is not null;

-- Server only: no policies, and browser roles get no privileges at all (same as every other table).
alter table public.sms_outbox enable row level security;
revoke all on public.sms_outbox from anon, authenticated;
