import { randomInt } from "crypto";

// No look-alike characters (0/o, 1/l/i), so a link read aloud or typed from a printout is safe.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const RESERVED = new Set(["admin", "api", "cancel", "login", "logout", "reset", "tornow", "torli"]);

/** An unguessable-enough, collision-resistant public booking address (e.g. "k7m2xqa"). */
export function randomBusinessSlug(length = 7): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    if (!RESERVED.has(s)) return s;
  }
}
