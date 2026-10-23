import { createHash, randomBytes } from "crypto";

/**
 * Appointment-management tokens (the secret part of the SMS link).
 * The raw token exists only in the SMS; the database keeps its SHA-256 hash.
 */

// 24 random bytes = 192 bits, base64url = 32 characters
const TOKEN_BYTES = 24;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export function generateManageToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before touching the database. Anything else gets the generic 404. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** A token lives until the end of its appointment. */
export function isTokenExpired(expiresAtIso: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAtIso) return true;
  const t = new Date(expiresAtIso).getTime();
  return Number.isNaN(t) || t <= now;
}
