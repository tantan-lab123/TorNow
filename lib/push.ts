import webpush from "web-push";
import { deletePushSubscription, getPushSubscriptions, getSecret, setSecretIfAbsent } from "@/lib/db";

// Free browser push notifications. The VAPID key pair is generated on first use and kept in
// the database (RLS-locked, server only), so no extra environment secret is needed.
let configured: Promise<string> | null = null;

async function ensureVapid(): Promise<string> {
  if (!configured) {
    configured = (async () => {
      let pub = await getSecret("vapid_public");
      let priv = await getSecret("vapid_private");
      if (!pub || !priv) {
        const keys = webpush.generateVAPIDKeys();
        pub = await setSecretIfAbsent("vapid_public", keys.publicKey);
        priv = await setSecretIfAbsent("vapid_private", keys.privateKey);
        // if another instance won the race, make sure we use the winning pair
        pub = (await getSecret("vapid_public")) || pub;
        priv = (await getSecret("vapid_private")) || priv;
      }
      webpush.setVapidDetails(process.env.NEXT_PUBLIC_SITE_URL || "https://tornow-eight.vercel.app", pub!, priv!);
      return pub!;
    })().catch((e) => {
      configured = null;
      throw e;
    });
  }
  return configured;
}

export async function getVapidPublicKey(): Promise<string> {
  return ensureVapid();
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Sends a notification to every device the business owner/staff subscribed. Never throws. */
export async function notifyBusiness(businessId: string, payload: PushPayload): Promise<void> {
  try {
    await ensureVapid();
    const subs = await getPushSubscriptions(businessId);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 12 }
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          // 404/410 = the browser unsubscribed; drop the dead endpoint
          if (status === 404 || status === 410) await deletePushSubscription(s.endpoint, businessId);
        }
      })
    );
  } catch (err) {
    console.error("push notify failed:", err);
  }
}
