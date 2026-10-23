import { describe, expect, it } from "vitest";
import { generateManageToken, hashManageToken, isTokenExpired, isWellFormedToken } from "@/lib/sms/manage-token";
import { applyDlr, parseDlrDate, parseDlrStatus } from "@/lib/sms/dlr";

describe("manage token", () => {
  it("is random, url-safe and at least 128 bits", () => {
    const a = generateManageToken();
    const b = generateManageToken();
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
    expect(Buffer.from(a, "base64url").length).toBeGreaterThanOrEqual(16);
  });

  it("hashes to a stable SHA-256 hex; a new token (rotation) gets a new hash", () => {
    const t1 = generateManageToken();
    const t2 = generateManageToken();
    expect(hashManageToken(t1)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashManageToken(t1)).toBe(hashManageToken(t1));
    expect(hashManageToken(t1)).not.toBe(t1);
    expect(hashManageToken(t1)).not.toBe(hashManageToken(t2));
  });

  it("rejects malformed tokens before any lookup", () => {
    const bad = ["", "short", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "!", "../etc/passwd", null, 5];
    for (const t of bad) expect(isWellFormedToken(t)).toBe(false);
  });

  it("expires at the end of the appointment", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(isTokenExpired("2026-11-05T12:00:01Z", now)).toBe(false);
    expect(isTokenExpired("2026-11-05T12:00:00Z", now)).toBe(true);
    expect(isTokenExpired(null, now)).toBe(true);
    expect(isTokenExpired("garbage", now)).toBe(true);
  });
});

describe("DLR status mapping", () => {
  it("0 and 102 are delivered, -1 is sent without confirmation, the rest failed (raw code kept)", () => {
    expect(parseDlrStatus("0")).toEqual({ rawCode: "0", outcome: "delivered" });
    expect(parseDlrStatus("102")).toEqual({ rawCode: "102", outcome: "delivered" });
    expect(parseDlrStatus("-1")).toEqual({ rawCode: "-1", outcome: "sent_unconfirmed" });
    for (const code of ["1", "7", "14", "101", "103", "132", "201", "747", "998", "999"]) {
      expect(parseDlrStatus(code)).toEqual({ rawCode: code, outcome: "failed" });
    }
  });
  it("ignores junk", () => {
    for (const bad of [undefined, null, "", "abc", "1.5", "12345"]) expect(parseDlrStatus(bad)).toBeNull();
  });
  it("reads 019's dd/mm/yy hh:mm as Israel time", () => {
    expect(parseDlrDate("05/11/26 15:30")?.toISOString()).toBe("2026-11-05T13:30:00.000Z");
    expect(parseDlrDate("nonsense")).toBeNull();
  });
});

describe("applyDlr ordering", () => {
  const at = new Date("2026-11-05T13:31:00Z");
  const empty = { deliveryStatus: null, deliveredAt: null };

  it("records a delivery", () => {
    expect(applyDlr(empty, parseDlrStatus("0")!, at)).toEqual({ deliveryStatus: "0", deliveredAt: at.toISOString() });
  });
  it("never goes back from delivered to sent or failed", () => {
    const delivered = applyDlr(empty, parseDlrStatus("0")!, at);
    expect(applyDlr(delivered, parseDlrStatus("-1")!, new Date())).toEqual(delivered);
    expect(applyDlr(delivered, parseDlrStatus("14")!, new Date())).toEqual(delivered);
  });
  it("a failure can still be upgraded by a later delivery, and repeats change nothing", () => {
    const failed = applyDlr(empty, parseDlrStatus("14")!, at);
    expect(failed.deliveredAt).toBeNull();
    const delivered = applyDlr(failed, parseDlrStatus("102")!, at);
    expect(delivered.deliveredAt).toBe(at.toISOString());
    expect(applyDlr(delivered, parseDlrStatus("102")!, new Date())).toEqual(delivered);
  });
});
