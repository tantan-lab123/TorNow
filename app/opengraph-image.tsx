import { brandedCard, OG_SIZE } from "@/lib/og";

export const alt = "TorNow | יומן תורים אונליין לעסקים";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return brandedCard("TorNow", "יומן תורים אונליין לעסקים");
}
