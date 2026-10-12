"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useMedia } from "./hooks";
import { qrDataUrl } from "@/lib/qr";

const noSubscribe = () => () => {};

/**
 * A QR code that opens the demo booking page on the visitor's phone. Drawn in the browser,
 * only on wide screens, and falls back to the plain address if it can not be drawn.
 */
export function DemoQr({ path }: { path: string }) {
  const host = useSyncExternalStore(
    noSubscribe,
    () => window.location.host,
    () => null
  );
  const wide = useMedia("(min-width: 1024px)");
  const [image, setImage] = useState<{ url: string; src: string | null } | null>(null);
  const url = host ? `${window.location.protocol}//${host}${path}` : null;

  useEffect(() => {
    if (!url || !wide) return;
    let alive = true;
    qrDataUrl(url, { size: 248, margin: 0, dark: "#1A2E12", light: "#CFEA6E" }).then((src) => {
      if (alive) setImage({ url, src });
    });
    return () => {
      alive = false;
    };
  }, [url, wide]);

  const src = image && image.url === url ? image.src : undefined; // undefined: still drawing, null: failed
  const failed = src === null;

  return (
    <div className="grid h-[148px] w-[148px] place-items-center border border-lime-edge bg-lime p-3">
      {url && wide && src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="קוד QR לעמוד ההזמנה לדוגמה"
          width={124}
          height={124}
          className="h-[124px] w-[124px]"
        />
      )}
      {host && failed && (
        <span dir="ltr" className="break-all text-center text-[13px] font-bold leading-snug text-lime-ink">
          {host}
          {path}
        </span>
      )}
    </div>
  );
}
