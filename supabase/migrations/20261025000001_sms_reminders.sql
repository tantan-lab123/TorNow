-- Reminder SMS before the appointment, and the per-phone abuse limit.
-- Additive: one new nullable column, three indexes, one constraint swapped (new indexes first), one
-- check. No row is changed or deleted. Safe to run once; every statement is also safe to repeat.
--
-- What it does, in order:
--   1. sms_outbox.for_start_time (timestamptz, nullable): for a reminder, the appointment start the
--      reminder was made for. A moved appointment gets a new reminder for its new time, and the old
--      row (sent, or skipped as "appointment_moved") is kept.
--   2. Two partial unique indexes REPLACE the old unique (appointment_id, kind):
--        one message per appointment for every kind except reminders,
--        one reminder per appointment per appointment time.
--      The new indexes are created BEFORE the old constraint is dropped, so there is never a moment
--      without protection against double sends. All existing rows are confirmations (kind 'booked'),
--      which were already unique per appointment, so the new index can be built on them.
--   3. A check that a reminder row always has its for_start_time.
--   4. Index (to_phone, created_at): the per-phone limit (2 per hour, 6 per day) counts rows of one
--      phone in a time window on every booking.

alter table public.sms_outbox
    add column if not exists for_start_time timestamptz;

create unique index if not exists sms_outbox_one_per_kind
    on public.sms_outbox (appointment_id, kind)
    where kind <> 'reminder';

create unique index if not exists sms_outbox_one_reminder_per_start
    on public.sms_outbox (appointment_id, for_start_time)
    where kind = 'reminder';

alter table public.sms_outbox
    drop constraint if exists sms_outbox_appointment_kind_key;

alter table public.sms_outbox
    drop constraint if exists sms_outbox_reminder_has_start;
alter table public.sms_outbox
    add constraint sms_outbox_reminder_has_start
    check (kind <> 'reminder' or for_start_time is not null);

create index if not exists idx_sms_outbox_phone_created
    on public.sms_outbox (to_phone, created_at);
