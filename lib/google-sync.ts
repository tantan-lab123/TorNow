import {
  clearGoogleSyncState,
  countGoogleSyncs,
  deleteGoogleConnection,
  getGoogleConnection,
  getGoogleSyncContext,
  listAppointmentsDueForGoogleSync,
  markAppointmentSync,
  queueFutureAppointmentsForGoogleSync,
  requeueFailedGoogleSyncs,
  setGoogleConnectionStatus,
  upsertGoogleConnection,
} from "@/lib/db";
import {
  backfillFutureAppointments,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  isGoogleCalendarConfigured,
  processDueSyncs,
  retryFailedSyncs,
  syncAppointmentSafely,
  type ConnectionRepo,
} from "@/lib/google-calendar";

/**
 * Wiring of the Google Calendar core to the real database.
 * Route handlers import from here and nowhere else.
 */
const repo: ConnectionRepo = {
  getConnection: getGoogleConnection,
  setConnectionStatus: setGoogleConnectionStatus,
  getSyncContext: getGoogleSyncContext,
  markSync: markAppointmentSync,
  upsertConnection: upsertGoogleConnection,
  deleteConnection: deleteGoogleConnection,
  clearSyncState: clearGoogleSyncState,
  queueFutureAppointments: queueFutureAppointmentsForGoogleSync,
  requeueFailed: requeueFailedGoogleSyncs,
  listDue: listAppointmentsDueForGoogleSync,
};

/** Call from `after()` after any appointment write. Never throws, never blocks the booking. */
export function syncAppointment(appointmentId: string): Promise<void> {
  return syncAppointmentSafely(appointmentId, repo);
}

export const connectCalendar = (input: { businessId: string; googleEmail: string; refreshToken: string }) =>
  connectGoogleCalendar(input, repo);

export const disconnectCalendar = (businessId: string, options: { deleteCalendar: boolean }) =>
  disconnectGoogleCalendar(businessId, repo, options);

export const backfillCalendar = (businessId: string) => backfillFutureAppointments(businessId, repo);

export const retryCalendar = (businessId: string) => retryFailedSyncs(businessId, repo);

export const runDueCalendarSyncs = (limit = 25) => processDueSyncs(repo, limit);

/** Best-effort cleanup for a business that is being deleted. Never throws. */
export async function disconnectCalendarQuietly(businessId: string): Promise<void> {
  try {
    await disconnectGoogleCalendar(businessId, repo, { deleteCalendar: true });
  } catch (err) {
    console.error("google calendar cleanup failed:", err instanceof Error ? err.name : "unknown");
  }
}

export interface GoogleCalendarStatus {
  /** The server has the credentials it needs; otherwise the connect button is disabled. */
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  email: string | null;
  failedCount: number;
  pendingCount: number;
}

/** Only non-sensitive fields: this is what the browser is allowed to see. */
export async function getCalendarStatus(businessId: string): Promise<GoogleCalendarStatus> {
  const configured = isGoogleCalendarConfigured();
  let connection = null;
  let counts = { failed: 0, pending: 0 };
  try {
    connection = await getGoogleConnection(businessId);
    if (connection) counts = await countGoogleSyncs(businessId);
  } catch {
    // migration not applied yet (or database hiccup): behave as "not connected"
  }
  return {
    configured,
    connected: connection?.status === "active",
    needsReconnect: connection?.status === "needs_reconnect",
    email: connection?.google_email ?? null,
    failedCount: counts.failed,
    pendingCount: counts.pending,
  };
}
