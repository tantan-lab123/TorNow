-- Operator dashboard (/superadmin): two small tables and three read-only functions.
-- Additive only: nothing existing is changed or removed. Idempotent (create ... if not exists / create or replace),
-- safe to run once and safe to run again.
--
-- Creates:
--   tables     public.admin_access_log   who signed in to /superadmin, and rejected attempts (no raw email, no token, no raw IP)
--              public.cron_heartbeat     when each cron job last ran (the sms-outbox job writes it)
--   index      idx_sms_outbox_created    on sms_outbox (created_at): the SMS charts read the last 6 months
--   functions  public.admin_business_rollup(...)  one row per business with its counts (businesses, appointments, services, sms_outbox)
--              public.admin_sms_series(...)       SMS counts grouped by Israel day / kind / status / reason (demo businesses left out)
--              public.admin_sms_health(...)       overdue pending SMS and failed SMS of the last 24h, as one jsonb
--
-- All of it is server only: row level security on, no policies, no privileges for anon / authenticated; the functions can be
-- executed by service_role only. The functions are STABLE and read-only, and return counts per business, never customers.

-- ---------------------------------------------------------------------------------------------------------- tables

create table if not exists public.admin_access_log (
    id          bigint generated always as identity primary key,
    at          timestamptz not null default now(),
    success     boolean not null,
    email       text,          -- only for a successful sign-in
    email_hash  text,          -- a rejected attempt: keyed hash of the email (when there is one), never the email
    reason      text,          -- rejected attempt: bad_token / not_allowed
    ip_hash     text,          -- keyed hash, never the address
    constraint admin_access_log_no_raw_email_on_reject check (success or email is null)
);
alter table public.admin_access_log enable row level security;
revoke all on public.admin_access_log from anon, authenticated;
create index if not exists idx_admin_access_log_at on public.admin_access_log (at desc);

create table if not exists public.cron_heartbeat (
    job         text primary key,
    last_run_at timestamptz not null default now(),
    ok          boolean not null default true,
    detail      text
);
alter table public.cron_heartbeat enable row level security;
revoke all on public.cron_heartbeat from anon, authenticated;

create index if not exists idx_sms_outbox_created on public.sms_outbox (created_at);

-- ------------------------------------------------------------------------------------------------------- functions

-- One row per business. The application decides who is a demo business, who is active and so on, from these counts.
-- Appointments counted are customer appointments (service_id is not null: blocked time has no service), by the time
-- they were CREATED. p_manual_note is the note the owner's "add appointment" form writes, to tell those from bookings
-- made on the public page.
create or replace function public.admin_business_rollup(
    p_today_start timestamptz,
    p_week_start  timestamptz,
    p_month_start timestamptz,
    p_since_30d   timestamptz,
    p_since_14d   timestamptz,
    p_manual_note text
)
returns table (
    business_id            uuid,
    slug                   text,
    name                   text,
    business_created_at    timestamptz,
    services_count         integer,
    appts_total            integer,
    appts_confirmed_30d    integer,
    appts_created_14d      integer,
    appts_30d              integer,
    appts_cancelled_30d    integer,
    last_appointment_at    timestamptz,
    today_total            integer,
    today_manual           integer,
    week_total             integer,
    week_manual            integer,
    month_total            integer,
    month_manual           integer,
    sms_sent_30d           integer,
    sms_segments_30d       integer,
    sms_failed_30d         integer
)
language sql
stable
set search_path = public, pg_temp
as $$
    with a as (
        select ap.business_id as bid,
               count(*)::int as total,
               count(*) filter (where ap.status = 'confirmed' and ap.created_at >= p_since_30d)::int as confirmed_30d,
               count(*) filter (where ap.created_at >= p_since_14d)::int as created_14d,
               count(*) filter (where ap.created_at >= p_since_30d)::int as n30,
               count(*) filter (where ap.created_at >= p_since_30d and ap.status = 'cancelled')::int as cancelled_30d,
               max(ap.created_at) as last_created,
               count(*) filter (where ap.created_at >= p_today_start)::int as today_total,
               count(*) filter (where ap.created_at >= p_today_start and ap.notes is not distinct from p_manual_note)::int as today_manual,
               count(*) filter (where ap.created_at >= p_week_start)::int as week_total,
               count(*) filter (where ap.created_at >= p_week_start and ap.notes is not distinct from p_manual_note)::int as week_manual,
               count(*) filter (where ap.created_at >= p_month_start)::int as month_total,
               count(*) filter (where ap.created_at >= p_month_start and ap.notes is not distinct from p_manual_note)::int as month_manual
        from public.appointments ap
        where ap.service_id is not null
        group by ap.business_id
    ),
    sv as (
        select s.business_id as bid, count(*)::int as n
        from public.services s
        group by s.business_id
    ),
    sm as (
        select coalesce(o.business_id, oa.business_id) as bid,
               count(*) filter (where o.status = 'sent')::int as sent_30d,
               coalesce(sum(o.segments) filter (where o.status = 'sent'), 0)::int as segments_30d,
               count(*) filter (where o.status = 'failed')::int as failed_30d
        from public.sms_outbox o
        left join public.appointments oa on oa.id = o.appointment_id
        where o.created_at >= p_since_30d
        group by coalesce(o.business_id, oa.business_id)
    )
    select b.id,
           b.slug,
           b.name,
           b.created_at,
           coalesce(sv.n, 0),
           coalesce(a.total, 0),
           coalesce(a.confirmed_30d, 0),
           coalesce(a.created_14d, 0),
           coalesce(a.n30, 0),
           coalesce(a.cancelled_30d, 0),
           a.last_created,
           coalesce(a.today_total, 0),
           coalesce(a.today_manual, 0),
           coalesce(a.week_total, 0),
           coalesce(a.week_manual, 0),
           coalesce(a.month_total, 0),
           coalesce(a.month_manual, 0),
           coalesce(sm.sent_30d, 0),
           coalesce(sm.segments_30d, 0),
           coalesce(sm.failed_30d, 0)
    from public.businesses b
    left join a  on a.bid  = b.id
    left join sv on sv.bid = b.id
    left join sm on sm.bid = b.id
    order by b.created_at
$$;

-- SMS counts per Israel calendar day, kind, status and (for skipped / failed) reason, from p_from on.
-- Messages of the demo businesses (given by slug or id) are left out. "delivered" counts sent messages with a delivery report.
create or replace function public.admin_sms_series(
    p_from       timestamptz,
    p_demo_slugs text[],
    p_demo_ids   uuid[]
)
returns table (
    local_day  date,
    kind       text,
    status     text,
    reason     text,
    n          integer,
    segments   integer,
    delivered  integer
)
language sql
stable
set search_path = public, pg_temp
as $$
    select (o.created_at at time zone 'Asia/Jerusalem')::date,
           o.kind,
           o.status,
           case when o.status in ('skipped', 'failed') then o.last_error_code end,
           count(*)::int,
           coalesce(sum(o.segments) filter (where o.status = 'sent'), 0)::int,
           (count(*) filter (where o.status = 'sent' and o.delivered_at is not null))::int
    from public.sms_outbox o
    left join public.appointments oa on oa.id = o.appointment_id
    left join public.businesses b on b.id = coalesce(o.business_id, oa.business_id)
    where o.created_at >= p_from
      and not (
          b.id is not null
          and (coalesce(b.slug = any (p_demo_slugs), false) or coalesce(b.id = any (p_demo_ids), false))
      )
    group by 1, 2, 3, 4
$$;

-- Overdue pending messages (their next attempt was due more than 15 minutes ago: the cron job is not keeping up)
-- and the failed messages of the last 24 hours by error code.
create or replace function public.admin_sms_health(p_now timestamptz)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'pending_overdue',
        (select count(*)::int
           from public.sms_outbox o
          where o.status = 'pending'
            and o.next_attempt_at < p_now - interval '15 minutes'),
        'failed_24h',
        coalesce(
            (select jsonb_agg(jsonb_build_object('code', t.code, 'n', t.n) order by t.n desc)
               from (select coalesce(o.last_error_code, 'unknown') as code, count(*)::int as n
                       from public.sms_outbox o
                      where o.status = 'failed'
                        and o.updated_at >= p_now - interval '24 hours'
                      group by 1) t),
            '[]'::jsonb
        )
    )
$$;

-- Server only: service_role may execute them, nobody else.
revoke all on function public.admin_business_rollup(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text)
    from public, anon, authenticated;
grant execute on function public.admin_business_rollup(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text)
    to service_role;

revoke all on function public.admin_sms_series(timestamptz, text[], uuid[]) from public, anon, authenticated;
grant execute on function public.admin_sms_series(timestamptz, text[], uuid[]) to service_role;

revoke all on function public.admin_sms_health(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_sms_health(timestamptz) to service_role;
