import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "crypto";
import { decryptToken, encryptToken, TokenCryptoError } from "@/lib/crypto-token";

const original = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(() => {
  if (original === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = original;
});

describe("crypto-token", () => {
  it("round-trips a token", () => {
    const enc = encryptToken("1//refresh-token-value", "biz-1");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("refresh-token-value");
    expect(decryptToken(enc, "biz-1")).toBe("1//refresh-token-value");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptToken("same", "biz-1")).not.toBe(encryptToken("same", "biz-1"));
  });

  it("fails for a different business (AAD mismatch)", () => {
    const enc = encryptToken("secret", "biz-1");
    expect(() => decryptToken(enc, "biz-2")).toThrow(TokenCryptoError);
  });

  it("fails when the ciphertext is tampered with", () => {
    const [v, iv, tag, ct] = encryptToken("secret", "biz-1").split(":");
    const flipped = ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptToken([v, iv, tag, flipped].join(":"), "biz-1")).toThrow(TokenCryptoError);
  });

  it("fails with a different key", () => {
    const enc = encryptToken("secret", "biz-1");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(enc, "biz-1")).toThrow(TokenCryptoError);
  });

  it("refuses to run without a valid key", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x", "biz-1")).toThrow(/not set/);
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptToken("x", "biz-1")).toThrow(/32 bytes/);
  });

  it("rejects unknown formats", () => {
    expect(() => decryptToken("v9:a:b:c", "biz-1")).toThrow(/unsupported/);
    expect(() => decryptToken("plaintext", "biz-1")).toThrow(/unsupported/);
  });
});
