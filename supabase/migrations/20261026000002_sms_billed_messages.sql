-- SMS billing units: what 019 bills is not the carrier segment count.
-- Checked by hand in the 019 panel (Hebrew): up to 201 characters = 1 billed message, 202 = 2, 402 = 2, 403 = 3,
-- so billed = ceil(characters / 201). The application computes it (lib/sms/message.ts, billedMessages) at SEND
-- time and stores it here; this migration only adds the column, fills it once for messages that were already
-- sent, and gives the two dashboard functions a "billed" column.
--
-- Additive and safe to run again. Run it before (or together with) the release that writes the column; until it
-- has run, the application still works (it writes the message without the number).

alter table public.sms_outbox add column if not exists billed_messages integer;

-- One-time fill for messages sent before this column existed: a segment is 67 characters in Hebrew, so a
-- message of n segments is about n/3 billed messages (201 = 3 x 67). An estimate, only for the history; at
-- least 1. Rows that already have a number, and every row that was not sent, are not touched.
update public.sms_outbox
   set billed_messages = ceil(coalesce(segments, 1) / 3.0)::int
 where status = 'sent'
   and billed_messages is null;

-- The return types change (a new column), so the functions are dropped and created again.
drop function if exists public.admin_business_rollup(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text);
drop function if exists public.admin_sms_series(timestamptz, text[], uuid[]);

create function public.admin_business_rollup(
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
    sms_billed_30d         integer,
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
               coalesce(sum(coalesce(o.billed_messages, 1)) filter (where o.status = 'sent'), 0)::int as billed_30d,
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
           coalesce(sm.billed_30d, 0),
           coalesce(sm.failed_30d, 0)
    from public.businesses b
    left join a  on a.bid  = b.id
    left join sv on sv.bid = b.id
    left join sm on sm.bid = b.id
    order by b.created_at
$$;

-- SMS counts per Israel calendar day, kind, status and (for skipped / failed) reason, from p_from on.
-- Messages of the demo businesses (given by slug or id) are left out. "delivered" counts sent messages with a delivery report.
-- "billed" is the sum of billed_messages over SENT messages (a sent row without the number counts 1); 0 for the other statuses.
create function public.admin_sms_series(
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
    billed     integer,
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
           coalesce(sum(coalesce(o.billed_messages, 1)) filter (where o.status = 'sent'), 0)::int,
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

-- Server only: service_role may execute them, nobody else (dropping a function also dropped its grants).
revoke all on function public.admin_business_rollup(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text)
    from public, anon, authenticated;
grant execute on function public.admin_business_rollup(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text)
    to service_role;

revoke all on function public.admin_sms_series(timestamptz, text[], uuid[]) from public, anon, authenticated;
grant execute on function public.admin_sms_series(timestamptz, text[], uuid[]) to service_role;
