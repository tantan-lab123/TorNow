import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";
import {
  BRAND_STEPS,
  DEFAULT_THEME_ID,
  ON_BRAND,
  THEME_PRESETS,
  contrastRatio,
  generateBrandScale,
  getTheme,
  hexToRgb,
  isThemeColorId,
  rgbChannels,
  themeConfettiColors,
  themeCssVars,
} from "@/lib/theme";
import { sanitizeSettings } from "@/lib/validation";
import { toPublicBusiness } from "@/lib/auth";
import type { Business } from "@/lib/types";

const HEX = /^#[0-9A-F]{6}$/;

describe("the presets", () => {
  it("there are at least 8, with unique ids and unique Hebrew names; forest is the default and first", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
    expect(new Set(THEME_PRESETS.map((p) => p.label)).size).toBe(THEME_PRESETS.length);
    expect(THEME_PRESETS[0].id).toBe("forest");
    expect(DEFAULT_THEME_ID).toBe("forest");
    for (const p of THEME_PRESETS) expect(p.label).toMatch(/[א-ת]/);
    for (const id of ["ocean", "indigo", "plum", "rose", "terracotta", "graphite", "teal"]) expect(isThemeColorId(id)).toBe(true);
  });

  it("every colour is a plain #rrggbb value", () => {
    for (const p of THEME_PRESETS) {
      for (const step of BRAND_STEPS) expect(p.brand[step], `${p.id} ${step}`).toMatch(HEX);
      for (const c of Object.values(p.accent)) expect(c, p.id).toMatch(HEX);
    }
  });

  describe.each(THEME_PRESETS.map((p) => [p.id, p] as const))("contrast: %s", (_id, p) => {
    it("white text on brand-600 (buttons) is at least 4.5:1", () => {
      expect(contrastRatio(ON_BRAND, p.brand[600])).toBeGreaterThanOrEqual(4.5);
    });
    it("brand-700 text on brand-50 (chips) is at least 4.5:1", () => {
      expect(contrastRatio(p.brand[700], p.brand[50])).toBeGreaterThanOrEqual(4.5);
    });
    it("the text on the accent colour is at least 4.5:1", () => {
      expect(contrastRatio(p.accent.ink, p.accent.base)).toBeGreaterThanOrEqual(4.5);
    });
    it("white on brand-700 and brand-800 are fine too (hover and pressed states)", () => {
      expect(contrastRatio(ON_BRAND, p.brand[700])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ON_BRAND, p.brand[800])).toBeGreaterThanOrEqual(4.5);
    });
    it("the scale goes from light to dark", () => {
      const lum = BRAND_STEPS.map((s) => contrastRatio("#FFFFFF", p.brand[s]));
      for (let i = 1; i < lum.length; i++) expect(lum[i]).toBeGreaterThan(lum[i - 1]);
    });
  });
});

describe("ids", () => {
  it("an unknown or missing id is the default look", () => {
    for (const bad of [undefined, null, "", "nope", "FOREST", "#ff0000", "red; background:url(x)", 5, {}]) {
      expect(getTheme(bad).id).toBe("forest");
      expect(themeCssVars(bad)).toEqual(themeCssVars("forest"));
    }
  });

  it("only exact preset ids are accepted", () => {
    expect(isThemeColorId("ocean")).toBe(true);
    for (const bad of ["Ocean", " ocean", "ocean ", "#1E4D36", "__proto__", "constructor", undefined, null, 1]) {
      expect(isThemeColorId(bad)).toBe(false);
    }
  });
});

describe("sanitizeSettings: theme_color", () => {
  it("keeps a valid id", () => {
    expect(sanitizeSettings({ theme_color: "plum" })).toEqual({ theme_color: "plum" });
  });
  it("drops an unknown id, and never lets a colour value through", () => {
    for (const bad of ["nope", "#ff0000", "rgb(1,2,3)", "red", "", null, 3, "plum; x"]) {
      expect(sanitizeSettings({ theme_color: bad })).not.toHaveProperty("theme_color");
    }
  });
});

describe("theme_color is public", () => {
  it("is in the public business JSON (next to the SMS settings that are not)", () => {
    const b = {
      id: "b",
      name: "n",
      slug: "s",
      owner_phone: "0501234567",
      settings: { theme_color: "teal", sms_confirmation_enabled: false, sms_reminder_minutes: 60 },
    } as unknown as Business;
    expect(toPublicBusiness(b).settings).toEqual({ theme_color: "teal" });
  });
});

describe("the default output equals the colours the product always had", () => {
  // the values that were hard-coded in tailwind.config.ts and globals.css before themes existed
  const ORIGINAL_BRAND = {
    50: "#EFF4EE",
    100: "#E1EBE2",
    200: "#C9DCCD",
    300: "#A3C2AB",
    400: "#5E8F6C",
    500: "#2F6B4B",
    600: "#1E4D36",
    700: "#163B29",
    800: "#112E20",
    900: "#0C2117",
    950: "#08160F",
  };

  it("forest brand scale and accent", () => {
    expect(getTheme("forest").brand).toEqual(ORIGINAL_BRAND);
    expect(getTheme("forest").accent).toEqual({ base: "#CFEA6E", ink: "#1A2E12", edge: "#B8D458", soft: "#EEF7CF" });
    expect(getTheme(undefined)).toBe(getTheme("forest"));
  });

  it("the CSS variables of forest are what app/globals.css declares on :root (the page without a theme)", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    const declared: Record<string, string> = {};
    for (const m of root.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) declared[m[1]] = m[2].trim();

    const vars = themeCssVars("forest");
    for (const [name, value] of Object.entries(vars)) {
      expect(declared[name], name).toBe(value);
    }
  });

  it("the brand colours in tailwind.config.ts are the variables, with alpha support", () => {
    const colors = (config.theme?.extend?.colors ?? {}) as Record<string, Record<string, string>>;
    for (const step of BRAND_STEPS) {
      expect(colors.brand[step]).toBe(`rgb(var(--brand-${step}) / <alpha-value>)`);
    }
    expect(colors.brand.DEFAULT).toBe("rgb(var(--brand-600) / <alpha-value>)");
    expect(colors.lime.DEFAULT).toBe("rgb(var(--lime) / <alpha-value>)");
    expect(colors.lime.ink).toBe("rgb(var(--lime-ink) / <alpha-value>)");
    // the older class names are still the brand
    expect(colors.indigo).toBe(colors.brand);
  });

  it("the confetti colours are the original ones", () => {
    expect(themeConfettiColors(undefined)).toEqual(["#1E4D36", "#CFEA6E", "#2F6B4B", "#F4F1E8"]);
  });

  it("globals.css no longer hard-codes the brand green or the lime where the public pages use them", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const body = css.slice(css.indexOf("@keyframes m-pop"));
    // the .m-stamp button, the spinners, the focus ring and the selection use the variables
    const stamp = css.slice(css.indexOf(".m-stamp {"), css.indexOf("@keyframes m-stamp"));
    expect(stamp).toContain("rgb(var(--lime))");
    expect(stamp).not.toMatch(/#CFEA6E/i);
    const spin = css.slice(css.indexOf(".m-spin {"), css.indexOf("@keyframes m-rot"));
    expect(spin).not.toMatch(/#CFEA6E|#1E4D36/i);
    expect(css.slice(css.indexOf(":focus-visible"), css.indexOf("::selection") + 120)).not.toMatch(/#1E4D36|#CFEA6E/i);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("generated scales", () => {
  it("are deterministic and valid", () => {
    expect(generateBrandScale("#1F5E8A")).toEqual(generateBrandScale("#1F5E8A"));
    const scale = generateBrandScale("#6B2D5C");
    expect(scale[600]).toBe("#6B2D5C");
    for (const step of BRAND_STEPS) expect(scale[step]).toMatch(HEX);
  });

  it("colour helpers", () => {
    expect(hexToRgb("#1E4D36")).toEqual([30, 77, 54]);
    expect(rgbChannels("#CFEA6E")).toBe("207 234 110");
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(() => hexToRgb("red")).toThrow();
  });

  it("the CSS variables contain nothing but numbers and preset hex colours", () => {
    for (const p of THEME_PRESETS) {
      for (const [name, value] of Object.entries(themeCssVars(p.id))) {
        expect(name).toMatch(/^--[a-z0-9-]+$/);
        expect(value, `${p.id} ${name}`).toMatch(/^(\d{1,3} \d{1,3} \d{1,3}|#[0-9A-F]{6})$/);
      }
    }
  });
});
