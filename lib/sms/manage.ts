import { getAppointmentById } from "@/lib/db";
import { findSmsByTokenHash } from "@/lib/db/sms";
import { hashManageToken, isTokenExpired, isWellFormedToken } from "@/lib/sms/manage-token";
import type { Appointment } from "@/lib/types";
import { isBlockedTime } from "@/lib/utils";

/**
 * The appointment behind a link from the SMS, or null. "No such token", "wrong token" and
 * "expired token" are deliberately indistinguishable to the caller.
 */
export async function resolveManageToken(token: unknown): Promise<Appointment | null> {
  if (!isWellFormedToken(token)) return null;
  const found = await findSmsByTokenHash(hashManageToken(token));
  if (!found || isTokenExpired(found.expiresAt)) return null;
  const appointment = await getAppointmentById(found.appointmentId);
  if (!appointment || isBlockedTime(appointment)) return null;
  return appointment;
}
