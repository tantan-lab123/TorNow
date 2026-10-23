-- Per-business SMS usage: which business a message belongs to and how many SMS segments it used.
-- Additive only (nullable columns, one index). Nothing existing is changed or removed.
-- Run this BEFORE deploying the code that writes them (the code also works without, as a safety net).

alter table public.sms_outbox
    add column business_id uuid references public.businesses(id) on delete cascade,
    add column segments    integer;

-- Messages queued so far get their business from the appointment.
update public.sms_outbox o
   set business_id = a.business_id
  from public.appointments a
 where a.id = o.appointment_id
   and o.business_id is null;

-- "How many did this business send this month"
create index idx_sms_outbox_business_created
    on public.sms_outbox (business_id, created_at);
