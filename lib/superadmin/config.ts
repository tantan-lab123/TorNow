/** Constants of the operator dashboard (/superadmin). */

export const SUPERADMIN_COOKIE = "tornow_superadmin";
export const SUPERADMIN_TTL_SECONDS = 8 * 60 * 60; // 8 hours
/** Signature domain: a superadmin cookie is never valid as anything else, and nothing else is valid as one. */
export const SUPERADMIN_SIGN_DOMAIN = "superadmin:v1";
/** Keyed hashes in the access log use their own domain too. */
export const ACCESS_LOG_HASH_DOMAIN = "superadmin-log:v1";

/** Sign-in attempts per IP per window. */
export const SESSION_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

/** The cron job whose last run the dashboard shows. */
export const HEARTBEAT_JOB_SMS = "sms-outbox";
/** No run for longer than this is red. */
export const HEARTBEAT_STALE_MINUTES = 15;

/**
 * The note the owner form for adding an appointment writes (app/admin/page.tsx). It is how an appointment
 * added by the business is told from a booking made on the public page. A test keeps the two in step.
 */
export const MANUAL_BOOKING_NOTE = "נוסף ידנית ע״י בית העסק";

/** What the health card says about the SMS setup: names only, never values. */
export const SMS_ENV_VARS = [
  "SMS_019_API_TOKEN",
  "SMS_019_USERNAME",
  "SMS_019_SOURCE",
  "SMS_019_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "CRON_SECRET",
] as const;

export const MAX_TABLE_ROWS = 200;
export const JSON_NO_STORE = { "Cache-Control": "no-store" } as const;
