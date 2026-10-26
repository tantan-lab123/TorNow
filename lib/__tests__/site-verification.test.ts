import { describe, expect, it, vi } from "vitest";

// the layout builds its fonts at import time; next/font only works inside the Next compiler
vi.mock("next/font/google", () => ({ Heebo: () => ({ variable: "" }) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "" }) }));
vi.mock("@/components/ui/DialogHost", () => ({ DialogHost: () => null }));
vi.mock("@/app/globals.css", () => ({}));

import { metadata } from "@/app/layout";

describe("Google Search Console verification", () => {
  it("the root layout metadata carries the token: a plain non-empty string, no quotes, spaces or markup", () => {
    const token = metadata.verification?.google;
    expect(token).toBe("BhvJ8Nk0S_w4FwJX505awOPXafEDtbfZ37JeZFVmI0c");
    expect(typeof token).toBe("string");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
