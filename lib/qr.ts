// QR codes are drawn in the browser. The old setup sent every booking address to a third-party
// QR service and showed an empty box whenever that service was slow or blocked.

export interface QrOptions {
  /** Pixel width of the PNG (before the page scales it). */
  size?: number;
  dark?: string;
  light?: string;
  /** Quiet-zone width in modules. */
  margin?: number;
}

/** Returns a `data:image/png` URL for the text, or null if it can not be encoded. */
export async function qrDataUrl(text: string, options: QrOptions = {}): Promise<string | null> {
  try {
    const { toDataURL } = await import("qrcode");
    return await toDataURL(text, {
      width: options.size ?? 320,
      margin: options.margin ?? 2,
      errorCorrectionLevel: "M",
      color: { dark: options.dark ?? "#17201A", light: options.light ?? "#FFFFFF" },
    });
  } catch {
    return null;
  }
}
