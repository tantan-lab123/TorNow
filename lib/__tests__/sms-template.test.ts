import { describe, expect, it } from "vitest";
import { buildBookedMessage, buildManageUrl } from "@/lib/sms/template";

describe("buildBookedMessage", () => {
  // 2026-11-05 13:30 UTC = 15:30 in Israel (winter time)
  const base = { businessName: "סלון נועה", start: "2026-11-05T13:30:00Z", manageUrl: "https://x.test/t/abc" };

  it("greets by first name, shows Israel date and time, link on its own last line", () => {
    expect(buildBookedMessage({ ...base, firstName: "דנה" })).toBe(
      "שלום דנה, נקבע לך תור לסלון נועה בתאריך 05/11 בשעה 15:30.\nלשינוי או ביטול:\nhttps://x.test/t/abc"
    );
  });

  it("leaves the greeting out when there is no first name", () => {
    for (const firstName of [undefined, null, "", "   "]) {
      const msg = buildBookedMessage({ ...base, firstName });
      expect(msg.startsWith("נקבע לך תור לסלון נועה")).toBe(true);
      expect(msg).not.toContain("שלום");
    }
  });

  it("falls back to the service name, then to no place at all", () => {
    expect(buildBookedMessage({ ...base, businessName: "", serviceName: "תספורת" })).toContain("לתספורת");
    expect(buildBookedMessage({ ...base, businessName: null })).toContain("נקבע לך תור בתאריך");
  });

  it("is a service message: no emoji, no promotion words", () => {
    const msg = buildBookedMessage({ ...base, firstName: "דנה" });
    expect(msg).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(msg).not.toMatch(/מבצע|הנחה|קופון|הצעה/);
    expect(msg.length).toBeLessThan(160);
  });
});

describe("buildManageUrl", () => {
  it("joins the site url and the token", () => {
    expect(buildManageUrl("tok", "https://tornow.example/")).toBe("https://tornow.example/t/tok");
  });
  it("is null without a usable site url (never a hardcoded default)", () => {
    expect(buildManageUrl("tok", "")).toBeNull();
    expect(buildManageUrl("tok", "tornow.example")).toBeNull();
  });
});
