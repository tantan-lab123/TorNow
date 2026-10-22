import crypto from "crypto";

/**
 * Checks a password against the HaveIBeenPwned "Pwned Passwords" range API using
 * k-anonymity: only the first 5 hex chars of the SHA-1 hash leave the server.
 * Fails OPEN (returns false) if the service is unreachable so sign-ups never break.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "tornow-password-check" },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [hash, count] = line.trim().split(":");
      return hash === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

export const PWNED_ERROR =
  "הסיסמה הזו הופיעה בדליפות מידע ידועות ואינה בטוחה. אנא בחר סיסמה אחרת.";
