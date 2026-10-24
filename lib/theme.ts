/**
 * Colour themes of the public pages (the booking page /[slug] and the manage page /t/[token]).
 * The owner picks one preset by id; there is no free colour input, so contrast is guaranteed by
 * the presets (a unit test checks all of them) and nothing the owner types ever reaches the CSS.
 *
 * The brand and accent colours are CSS variables (see tailwind.config.ts and app/globals.css). The
 * pages set them server-side on a wrapper element; everything else (the admin app) keeps the defaults,
 * which are the "forest" preset.
 */

export const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type BrandStep = (typeof BRAND_STEPS)[number];
export type BrandScale = Record<BrandStep, string>;

export interface ThemeAccent {
  /** The accent colour itself (the "lime" of the default theme) */
  base: string;
  /** Text and icons on the accent */
  ink: string;
  edge: string;
  soft: string;
}

export interface ThemePreset {
  id: string;
  /** Hebrew name, shown on the swatch */
  label: string;
  brand: BrandScale;
  accent: ThemeAccent;
}

/** Text colour on the brand colour (the page's white). */
export const ON_BRAND = "#FFFDF9";

// ------------------------------------------------------------------ colour maths

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** "#1E4D36" -> "30 77 54": the form the tailwind rgb(var(--x) / alpha) pattern needs. */
export function rgbChannels(hex: string): string {
  return hexToRgb(hex).join(" ");
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

function fromHsl(h: number, s: number, l: number): string {
  const S = Math.min(1, Math.max(0, s / 100));
  const L = Math.min(1, Math.max(0, l / 100));
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The 11-step brand scale around one base colour (the 600 step). Light steps are the base hue,
 * strongly desaturated; dark steps are the same hue getting darker. Pure: same input, same output.
 */
export function generateBrandScale(base600: string): BrandScale {
  const [h, s, l] = toHsl(hexToRgb(base600));
  const at = (sat: number, light: number) => fromHsl(h, s * sat, light);
  return {
    50: at(0.35, 95),
    100: at(0.4, 91),
    200: at(0.45, 83),
    300: at(0.5, 71),
    400: at(0.65, Math.min(l + 24, 62)),
    500: at(0.9, Math.min(l + 9, 50)),
    600: base600.toUpperCase(),
    700: at(0.95, l * 0.78),
    800: at(0.9, l * 0.62),
    900: at(0.85, l * 0.45),
    950: at(0.8, l * 0.3),
  };
}

// ------------------------------------------------------------------ presets

/** The current look of the product, written out so that "no theme" is exactly what it always was. */
const FOREST_BRAND: BrandScale = {
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
const FOREST_ACCENT: ThemeAccent = { base: "#CFEA6E", ink: "#1A2E12", edge: "#B8D458", soft: "#EEF7CF" };

function preset(id: string, label: string, base600: string, accent: ThemeAccent): ThemePreset {
  return { id, label, brand: generateBrandScale(base600), accent };
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "forest", label: "יער", brand: FOREST_BRAND, accent: FOREST_ACCENT },
  preset("ocean", "אוקיינוס", "#1F5E8A", { base: "#BDE3F5", ink: "#0C2D42", edge: "#8CC8E6", soft: "#E6F4FA" }),
  preset("indigo", "אינדיגו", "#3F3F9E", { base: "#D6D4FA", ink: "#1D1B5A", edge: "#B3B0F0", soft: "#EEEDFD" }),
  preset("plum", "שזיף", "#6B2D5C", { base: "#F0CFE8", ink: "#3A1030", edge: "#E2A8D4", soft: "#FAEAF6" }),
  preset("rose", "ורד", "#A32850", { base: "#F9CFDB", ink: "#5A0F27", edge: "#F0A6BC", soft: "#FDEBF0" }),
  preset("terracotta", "טרקוטה", "#9C4524", { base: "#F5D3BC", ink: "#4A1F0C", edge: "#E8B08C", soft: "#FBEBDF" }),
  preset("graphite", "גרפיט", "#3B434C", { base: "#DDE2E8", ink: "#1B1F24", edge: "#BCC4CD", soft: "#F0F2F5" }),
  preset("teal", "טורקיז", "#12706A", { base: "#B9EEE6", ink: "#083C38", edge: "#86D9CD", soft: "#E3F8F4" }),
];

export const DEFAULT_THEME_ID = "forest";

export function isThemeColorId(v: unknown): v is string {
  return typeof v === "string" && THEME_PRESETS.some((p) => p.id === v);
}

/** The preset for an id; anything unknown (or missing) is the default look. */
export function getTheme(id: unknown): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

/**
 * The CSS variables of a theme, for a style attribute. Only values from the preset table (never
 * from user input) end up here.
 */
export function themeCssVars(id: unknown): Record<string, string> {
  const t = getTheme(id);
  const vars: Record<string, string> = {};
  for (const step of BRAND_STEPS) vars[`--brand-${step}`] = rgbChannels(t.brand[step]);
  vars["--lime"] = rgbChannels(t.accent.base);
  vars["--lime-ink"] = rgbChannels(t.accent.ink);
  vars["--lime-edge"] = rgbChannels(t.accent.edge);
  vars["--lime-soft"] = rgbChannels(t.accent.soft);
  vars["--primary"] = t.brand[600];
  vars["--primary-foreground"] = ON_BRAND;
  vars["--ring"] = t.brand[600];
  vars["--accent"] = t.accent.base;
  return vars;
}

/** Confetti colours for the booking page, from the theme. */
export function themeConfettiColors(id: unknown): string[] {
  const t = getTheme(id);
  return [t.brand[600], t.accent.base, t.brand[500], "#F4F1E8"];
}
