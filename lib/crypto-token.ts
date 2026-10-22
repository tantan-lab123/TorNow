import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Encrypts secrets (Google refresh tokens) before they are written to the database.
 *
 * AES-256-GCM with a key that lives only in the server environment, so a copy of the database
 * alone does not expose the tokens. `aad` (the business id) is authenticated together with the
 * ciphertext, so a value copied from one business's row to another's fails to decrypt.
 *
 * Format: "v1:<iv>:<tag>:<ciphertext>" (base64url). The version prefix allows key rotation later.
 */
const VERSION = "v1";

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

function getKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new TokenCryptoError("GOOGLE_TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new TokenCryptoError("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  }
  return key;
}

export function encryptToken(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptToken(payload: string, aad: string): string {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new TokenCryptoError("unsupported token format");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof TokenCryptoError) throw err;
    // wrong key, wrong business, or tampered data: never echo details
    throw new TokenCryptoError("token could not be decrypted");
  }
}
