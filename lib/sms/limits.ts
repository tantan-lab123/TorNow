/**
 * Abuse limits for the customer SMS: PER DESTINATION PHONE only (nobody can be made to receive
 * a flood of messages by someone using the public booking page). The count comes from the
 * database (sms_outbox), not from memory, because every serverless instance has its own memory.
 *
 * No limit per business and none overall.
 */

/** At most this many messages to one phone in any rolling hour ... */
export const PHONE_LIMIT_PER_HOUR = 2;
/** ... and this many in any rolling 24 hours. */
export const PHONE_LIMIT_PER_DAY = 6;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Codes written to the queue row of a message that was not queued / not sent because of a limit. */
export const SKIP_PHONE_LIMIT_HOUR = "phone_limit_hour";
export const SKIP_PHONE_LIMIT_DAY = "phone_limit_day";

export interface CountOptions {
  /** Do not count this row (the message being checked itself). */
  excludeId?: string;
  /** Count only rows created at or before this instant (the rows "ahead" of the one being checked). */
  createdUpToIso?: string;
}

export interface PhoneCounter {
  /**
   * Messages to this phone created since `sinceIso` whose status is pending or sent.
   * Rows that were skipped or failed never count: they were not (and will not be) delivered.
   */
  countRecentByPhone(phone: string, sinceIso: string, opts?: CountOptions): Promise<number>;
}

/** null when the phone may receive another message, else the code of the limit that is hit. */
export async function phoneLimitHit(
  counter: PhoneCounter,
  phone: string,
  now: Date,
  opts: CountOptions = {}
): Promise<typeof SKIP_PHONE_LIMIT_HOUR | typeof SKIP_PHONE_LIMIT_DAY | null> {
  const hour = await counter.countRecentByPhone(phone, new Date(now.getTime() - HOUR_MS).toISOString(), opts);
  if (hour >= PHONE_LIMIT_PER_HOUR) return SKIP_PHONE_LIMIT_HOUR;
  const day = await counter.countRecentByPhone(phone, new Date(now.getTime() - DAY_MS).toISOString(), opts);
  if (day >= PHONE_LIMIT_PER_DAY) return SKIP_PHONE_LIMIT_DAY;
  return null;
}
