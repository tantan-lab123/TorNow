import { ImageResponse } from "next/og";
import bidiFactory from "bidi-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Link-preview cards (WhatsApp, Facebook, Telegram...). Drawn on the server with the brand colors.
//
// The image renderer (Satori) lays text out left to right only: Hebrew would come out with its
// letters reversed. So every line is put into visual order here first (Unicode bidi algorithm)
// and drawn left-to-right, right-aligned. Heebo (Hebrew + Latin) is bundled in assets/og.

export const OG_SIZE = { width: 1200, height: 630 };

const bidi = bidiFactory();

/** The characters of a line in the order they appear on screen, for a right-to-left paragraph. */
export function toVisualOrder(text: string): string {
  // emoji and other characters beyond the basic plane are left out: the font has no glyph for them
  const clean = text.replace(/[\u{10000}-\u{10FFFF}]/gu, "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const levels = bidi.getEmbeddingLevels(clean, "rtl");
  const chars = clean.split("");
  // (the library's type file says Uint8Array here, but its code and docs take the whole result)
  const segments = bidi.getReorderSegments(clean, levels as never);
  for (const [start, end] of segments) {
    for (let i = start, j = end; i < j; i++, j--) [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  bidi.getMirroredCharactersMap(clean, levels as never).forEach((mirrored, index) => {
    chars[index] = mirrored;
  });
  return chars.join("");
}

/** Greedy word wrap by an estimated glyph width, at most `maxLines` lines (the last one is cut with …). */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
    return kept;
  }
  return lines;
}

let fontPromise: Promise<Buffer> | null = null;
const loadFont = () => (fontPromise ??= readFile(join(process.cwd(), "assets/og/Heebo_800ExtraBold.ttf")));

const GREEN = "#1E4D36";
const GREEN_DARK = "#163B29";
const LIME = "#CFEA6E";
const PAPER = "#F4F1E8";

/** The card shown when a business has not uploaded its own picture. */
export async function brandedCard(title: string, subtitle: string, headers?: Record<string, string>) {
  const fontSize = title.length > 60 ? 60 : title.length > 36 ? 72 : title.length > 20 ? 88 : 108;
  const maxChars = Math.floor(1040 / (fontSize * 0.45)); // Heebo ExtraBold averages about 0.42em per character
  const titleLines = wrap(title, maxChars, 3).map(toVisualOrder);
  const line = (text: string, size: number, color: string) => (
    <div style={{ display: "flex", justifyContent: "flex-end", fontSize: size, color, lineHeight: 1.12 }}>{text}</div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `linear-gradient(135deg, ${GREEN} 0%, ${GREEN_DARK} 100%)`,
          padding: "64px 80px",
          fontFamily: "Heebo",
          color: PAPER,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 40, color: LIME }}>TorNow</div>
          <div style={{ display: "flex", width: 24, height: 24, borderRadius: 24, background: LIME }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {titleLines.map((text, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                {line(text, fontSize, "#ffffff")}
              </div>
            ))}
          </div>
          {line(toVisualOrder(subtitle), 46, LIME)}
        </div>

        {line(toVisualOrder("בוחרים שירות ושעה, בלי שיחת טלפון"), 32, "#A3C2AB")}
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "Heebo", data: await loadFont(), weight: 800, style: "normal" }],
      headers,
    }
  );
}
