import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TorNow | יומן תורים",
    short_name: "TorNow",
    description: "יומן תורים אונליין לעסקים: הלקוחות קובעים לבד, אתם רואים הכל בטלפון.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    dir: "rtl",
    lang: "he",
    background_color: "#F4F1E8",
    theme_color: "#1E4D36",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
