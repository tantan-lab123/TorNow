import { describe, expect, it } from "vitest";
import { buildManageUrl } from "@/lib/sms/template";

describe("buildManageUrl", () => {
  it("joins the site url and the token", () => {
    expect(buildManageUrl("tok", "https://tornow.example/")).toBe("https://tornow.example/t/tok");
  });
  it("is null without a usable site url (never a hardcoded default)", () => {
    expect(buildManageUrl("tok", "")).toBeNull();
    expect(buildManageUrl("tok", "tornow.example")).toBeNull();
  });
});
