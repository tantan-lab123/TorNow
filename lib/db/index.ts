import {
  Business,
  Service,
  Client,
  Appointment,
  AppointmentStatus,
  WorkingHours,
} from "@/lib/types";
import {
  INITIAL_BUSINESSES,
  INITIAL_SERVICES,
  INITIAL_CLIENTS,
  createInitialAppointments,
} from "./mock-data";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";
import { hashPassword } from "@/lib/auth";
import { BLOCK_CLIENT_PHONE, BLOCK_NOTE_PREFIX } from "@/lib/utils";

// Supabase returns at most this many rows per request, so longer lists are read in pages.
const PAGE_SIZE = 1000;

// In-memory sample data for local development without Supabase
declare global {
  var __SCHEDULE_DB__:
    | {
        businesses: Business[];
        services: Service[];
        clients: Client[];
        appointments: Appointment[];
      }
    | undefined;
}

// Production never keeps data in memory: it would vanish on the next deploy or cold start and
// differ between server instances, while every sign-up and booking looked successful. Without
// Supabase config there, any read or write throws instead, so the gap shows up at once.
const memoryForbidden = !isSupabaseConfigured && process.env.NODE_ENV === "production";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "No database: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. " +
        "Production refuses to fall back to in-memory sample data."
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

function inMemory<T extends object>(store: T): T {
  if (!memoryForbidden) return store;
  return new Proxy(store, {
    get() {
      throw new DatabaseNotConfiguredError();
    },
  });
}

if (!globalThis.__SCHEDULE_DB__) {
  const useMock = !isSupabaseConfigured && process.env.NODE_ENV !== "production";
  globalThis.__SCHEDULE_DB__ = useMock
    ? {
        businesses: [...INITIAL_BUSINESSES],
        services: [...INITIAL_SERVICES],
        clients: [...INITIAL_CLIENTS],
        appointments: createInitialAppointments(),
      }
    : { businesses: [], services: [], clients: [], appointments: [] };
}

const db = inMemory(globalThis.__SCHEDULE_DB__);

// Helper to attach joined relations
function hydrateAppointment(
  app: Appointment,
  businesses: Business[],
  services: Service[],
  clients: Client[]
): Appointment {
  return {
    ...app,
    business: businesses.find((b) => b.id === app.business_id),
    service: services.find((s) => s.id === app.service_id),
    client: clients.find((c) => c.id === app.client_id),
  };
}

// ==============================================================================
// BUSINESSES
// ==============================================================================

export function normalizeBusinessRecord(raw: any): Business {
  if (!raw) return raw;
  const wh = (raw.working_hours || {}) as Record<string, any>;
  const settings = raw.settings || wh._settings || {
    show_price_and_duration: true,
    waiting_list_enabled: true,
    show_hebrew_dates: false,
    min_notice_hours: 1,
    max_future_days: 60,
    cancellation_cutoff_hours: 6,
    max_active_appointments_per_client: 3,
  };
  const slot_interval_minutes =
    raw.slot_interval_minutes || wh._slot_interval_minutes || 15;
  const date_overrides = raw.date_overrides || wh._date_overrides || [];
  const calendar_version = Number(raw.calendar_version ?? wh._calendar_version) || 0;
  // The _ keys only persist the fields above inside the jsonb column; callers get them
  // as real fields, so they never ship twice (or unfiltered) in API responses.
  const { _settings, _slot_interval_minutes, _date_overrides, _calendar_version, ...days } = wh;

  return {
    ...raw,
    working_hours: raw.working_hours ? days : raw.working_hours,
    settings,
    slot_interval_minutes,
    date_overrides,
    calendar_version,
  };
}

export async function getBusinesses(): Promise<Business[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client.from("businesses").select("*");
    if (error) throw error;
    if (data) return data.map(normalizeBusinessRecord);
  }
  return db.businesses.map(normalizeBusinessRecord);
}

export async function getBusinessBySlug(slug: string): Promise<Business | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("businesses")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (data) return normalizeBusinessRecord(data);
  }
  const found = db.businesses.find((b) => b.slug === slug);
  return found ? normalizeBusinessRecord(found) : null;
}

export async function getBusinessById(id: string): Promise<Business | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("businesses")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (data) return normalizeBusinessRecord(data);
  }
  const found = db.businesses.find((b) => b.id === id);
  return found ? normalizeBusinessRecord(found) : null;
}

const escapeLike = (v: string) =>
  v.split("\\").join("\\\\").split("%").join("\\%").split("_").join("\\_");

export async function getBusinessByPhone(phone: string): Promise<Business | null> {
  const normalized = phone.replace(/[^0-9]/g, "");
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("owner_phone", normalized)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? normalizeBusinessRecord(data) : null;
  }
  const found = db.businesses.find((b) => b.owner_phone.replace(/[^0-9]/g, "") === normalized);
  return found ? normalizeBusinessRecord(found) : null;
}

/** Login by an identity ALREADY VERIFIED by the caller (Google token check). */
export async function findBusinessByVerifiedGoogle(
  email: string,
  googleId: string
): Promise<Business | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const byId = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("google_id", googleId)
      .limit(1)
      .maybeSingle();
    if (byId.error) throw byId.error;
    if (byId.data) return normalizeBusinessRecord(byId.data);

    const byEmail = await supabaseAdmin
      .from("businesses")
      .select("*")
      .ilike("owner_email", escapeLike(email.trim()))
      .limit(1)
      .maybeSingle();
    if (byEmail.error) throw byEmail.error;
    if (byEmail.data) return normalizeBusinessRecord(byEmail.data);
    return null;
  }
  const found = db.businesses.find(
    (b) => b.google_id === googleId || b.owner_email?.toLowerCase() === email.toLowerCase()
  );
  return found ? normalizeBusinessRecord(found) : null;
}

/** Phone + password login. Returns the business (incl. hash) so the caller can verify. */
export async function getBusinessForLogin(phone: string): Promise<Business | null> {
  return getBusinessByPhone(phone);
}

export async function setBusinessPasswordHash(id: string, hash: string): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("businesses").update({ password: hash }).eq("id", id);
    if (error) throw error;
    return;
  }
  const idx = db.businesses.findIndex((b) => b.id === id);
  if (idx !== -1) db.businesses[idx].password = hash;
}

export async function updateBusiness(
  id: string,
  updates: Partial<Business>
): Promise<Business | null> {
  const existing = await getBusinessById(id);
  const currentWh = ((existing?.working_hours as any) || {}) as Record<string, any>;

  // Merge working_hours with nested _settings, _slot_interval_minutes, _date_overrides for Supabase jsonb persistence
  const nextWh = {
    ...(updates.working_hours || currentWh),
    _settings:
      updates.settings !== undefined
        ? updates.settings
        : (currentWh._settings || existing?.settings),
    _slot_interval_minutes:
      updates.slot_interval_minutes !== undefined
        ? updates.slot_interval_minutes
        : (currentWh._slot_interval_minutes || existing?.slot_interval_minutes),
    _date_overrides:
      updates.date_overrides !== undefined
        ? updates.date_overrides
        : (currentWh._date_overrides || existing?.date_overrides),
    _calendar_version:
      updates.calendar_version !== undefined
        ? updates.calendar_version
        : (currentWh._calendar_version || existing?.calendar_version || undefined),
  };

  const payload: Record<string, any> = {
    working_hours: nextWh,
  };
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.owner_phone !== undefined) payload.owner_phone = updates.owner_phone.replace(/[^0-9]/g, "");
  if (updates.owner_email !== undefined) payload.owner_email = updates.owner_email;
  if (updates.password !== undefined) payload.password = hashPassword(updates.password);

  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("businesses")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      return normalizeBusinessRecord(data);
    }
    if (error) throw error;
    return null;
  }

  const idx = db.businesses.findIndex((b) => b.id === id);
  if (idx !== -1) {
    db.businesses[idx] = {
      ...db.businesses[idx],
      ...updates,
      password: payload.password ?? db.businesses[idx].password,
      working_hours: nextWh as any,
      settings: updates.settings || db.businesses[idx].settings,
    };
    return normalizeBusinessRecord(db.businesses[idx]);
  }
  return null;
}

export async function createBusiness(input: {
  name: string;
  slug: string;
  owner_phone: string;
  owner_email?: string;
  password?: string;
  google_id?: string;
  pin?: string;
  slot_interval_minutes?: number;
  category?: "barber" | "nails" | "therapy" | "general";
  working_hours?: WorkingHours;
}): Promise<Business> {
  const normalizedSlug = input.slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");

  const defaultHours: WorkingHours = input.working_hours || {
    sunday: { open: "09:00", close: "19:00", active: true, lunch_break: { active: true, start: "13:00", end: "14:00" } },
    monday: { open: "09:00", close: "19:00", active: true, lunch_break: { active: true, start: "13:00", end: "14:00" } },
    tuesday: { open: "09:00", close: "19:00", active: true, lunch_break: { active: true, start: "13:00", end: "14:00" } },
    wednesday: { open: "09:00", close: "19:00", active: true, lunch_break: { active: true, start: "13:00", end: "14:00" } },
    thursday: { open: "09:00", close: "20:00", active: true, lunch_break: { active: true, start: "13:00", end: "14:00" } },
    friday: { open: "08:30", close: "14:00", active: true, lunch_break: { active: false, start: "12:00", end: "12:30" } },
    saturday: { open: "00:00", close: "00:00", active: false },
  };

  const newBusiness: Business = {
    id: "b-" + Math.random().toString(36).substring(2, 9),
    name: input.name.trim(),
    slug: normalizedSlug,
    owner_phone: input.owner_phone.replace(/[^0-9]/g, ""),
    owner_email: input.owner_email?.trim(),
    password: input.password ? hashPassword(input.password) : undefined,
    google_id: input.google_id,
    slot_interval_minutes: input.slot_interval_minutes || 15,
    date_overrides: [],
    working_hours: defaultHours,
    created_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("businesses")
      .insert({
        name: newBusiness.name,
        slug: newBusiness.slug,
        owner_phone: newBusiness.owner_phone,
        owner_email: newBusiness.owner_email || null,
        password: newBusiness.password || null,
        google_id: newBusiness.google_id || null,
        working_hours: newBusiness.working_hours,
      })
      .select()
      .single();
    if (error) throw error;
    newBusiness.id = data.id;
  } else {
    db.businesses.push(newBusiness);
  }

  // Seed default starter services according to category
  const cat = input.category || "barber";
  const defaultServicesMap: Record<string, Array<{ name: string; duration: number; buffer: number; price: number }>> = {
    barber: [
      { name: "תספורת גברים קלאסית", duration: 30, buffer: 5, price: 80 },
      { name: "עיצוב ודיוק זקן", duration: 20, buffer: 5, price: 45 },
      { name: "חבילת VIP: תספורת + זקן", duration: 45, buffer: 10, price: 115 },
    ],
    nails: [
      { name: "לק ג'ל ומניקור", duration: 60, buffer: 10, price: 140 },
      { name: "מבנה אנטומי וחיזוק", duration: 75, buffer: 15, price: 180 },
      { name: "פדיקור ספא מפנק", duration: 50, buffer: 10, price: 150 },
    ],
    therapy: [
      { name: "עיסוי שוודי / רפואי (50 דק')", duration: 50, buffer: 15, price: 250 },
      { name: "טיפול ממוקד לכאבים", duration: 35, buffer: 10, price: 190 },
    ],
    general: [
      { name: "פגישת ייעוץ וטיפול אישי", duration: 45, buffer: 10, price: 150 },
      { name: "טיפול מורחב / מתקדם", duration: 60, buffer: 15, price: 220 },
    ],
  };

  const starterServices = defaultServicesMap[cat] || defaultServicesMap.general;
  for (const s of starterServices) {
    await createService({
      business_id: newBusiness.id,
      name: s.name,
      duration_minutes: s.duration,
      buffer_minutes: s.buffer,
      price: s.price,
    });
  }

  return newBusiness;
}

export async function deleteBusiness(id: string): Promise<boolean> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    // Delete associated appointments and services
    await client.from("appointments").delete().eq("business_id", id);
    await client.from("services").delete().eq("business_id", id);
    const { error } = await client.from("businesses").delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  db.appointments = db.appointments.filter((a) => a.business_id !== id);
  db.services = db.services.filter((s) => s.business_id !== id);
  db.businesses = db.businesses.filter((b) => b.id !== id);
  return true;
}

// ==============================================================================
// SERVICES
// ==============================================================================

export async function getServices(businessId: string): Promise<Service[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin!
      .from("services")
      .select("*")
      .eq("business_id", businessId)
      .order("price", { ascending: true });
    if (error) throw error;
    if (data) return data as Service[];
  }
  return db.services.filter((s) => s.business_id === businessId);
}

export async function createService(
  serviceData: Omit<Service, "id" | "created_at">
): Promise<Service> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("services")
      .insert(serviceData)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Service;
  }

  const newService: Service = {
    ...serviceData,
    id: "s-" + Math.random().toString(36).substring(2, 9),
    created_at: new Date().toISOString(),
  };
  db.services.push(newService);
  return newService;
}

export async function updateService(
  id: string,
  updates: Partial<Omit<Service, "id" | "business_id">>
): Promise<Service | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("services")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Service;
  }

  const idx = db.services.findIndex((s) => s.id === id);
  if (idx !== -1) {
    db.services[idx] = { ...db.services[idx], ...updates };
    return db.services[idx];
  }
  return null;
}

export async function getServiceById(id: string): Promise<Service | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("services")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as Service) || null;
  }
  return db.services.find((s) => s.id === id) || null;
}

export async function deleteService(id: string): Promise<boolean> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { error } = await client.from("services").delete().eq("id", id);
    if (!error) return true;
  }

  const idx = db.services.findIndex((s) => s.id === id);
  if (idx !== -1) {
    db.services.splice(idx, 1);
    return true;
  }
  return false;
}

// ==============================================================================
// CLIENTS
// ==============================================================================

/** Real customers only (not the placeholder that blocked time hangs on), every page of them. */
export async function getClients(businessId: string): Promise<Client[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const all: Client[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin!
        .from("clients")
        .select("*")
        .eq("business_id", businessId)
        .neq("phone", BLOCK_CLIENT_PHONE)
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      all.push(...((data || []) as Client[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return all;
  }
  return db.clients.filter((c) => c.business_id === businessId && c.phone !== BLOCK_CLIENT_PHONE);
}

export async function findClientByPhone(
  businessId: string,
  phone: string
): Promise<Client | null> {
  const normalized = phone.replace(/\D/g, "");
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin!
      .from("clients")
      .select("*")
      .eq("business_id", businessId)
      .eq("phone", normalized)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Client;
  }

  return (
    db.clients.find(
      (c) =>
        c.business_id === businessId &&
        c.phone.replace(/\D/g, "") === normalized
    ) || null
  );
}

export async function findOrCreateClient(
  businessId: string,
  clientData: {
    phone: string;
    first_name: string;
    last_name: string;
    email?: string;
    google_id?: string;
    auth_provider?: 'guest' | 'google';
  }
): Promise<Client> {
  const normalizedPhone = clientData.phone.replace(/\D/g, "");

  const existing = await findClientByPhone(businessId, normalizedPhone);
  if (existing) {
    // Never let an anonymous booking overwrite stored client details; only fill a missing email.
    // A verified Google identity may be linked to the existing record once.
    if (clientData.google_id && !existing.google_id) {
      if (isSupabaseConfigured && supabaseAdmin) {
        const { error } = await supabaseAdmin
          .from("clients")
          .update({ google_id: clientData.google_id, auth_provider: "google" })
          .eq("id", existing.id);
        if (error) throw error;
      }
      existing.google_id = clientData.google_id;
    }
    if (clientData.email && !existing.email) {
      if (isSupabaseConfigured && supabaseAdmin) {
        const { error } = await supabaseAdmin
          .from("clients")
          .update({ email: clientData.email })
          .eq("id", existing.id);
        if (error) throw error;
      }
      existing.email = clientData.email;
    }
    return existing;
  }

  // Create new client
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("clients")
      .insert({
        business_id: businessId,
        phone: normalizedPhone,
        first_name: clientData.first_name,
        last_name: clientData.last_name,
        email: clientData.email,
        google_id: clientData.google_id,
        auth_provider: clientData.auth_provider || 'guest',
      })
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Client;
  }

  const newClient: Client = {
    id: "c-" + Math.random().toString(36).substring(2, 9),
    business_id: businessId,
    phone: normalizedPhone,
    first_name: clientData.first_name,
    last_name: clientData.last_name,
    email: clientData.email,
    google_id: clientData.google_id,
    auth_provider: clientData.auth_provider || 'guest',
    created_at: new Date().toISOString(),
  };
  db.clients.push(newClient);
  return newClient;
}

// ==============================================================================
// APPOINTMENTS
// ==============================================================================

/**
 * Appointments of one business, oldest first, with their service and client.
 * Pass a range wherever possible: without one this reads the whole history.
 * (The business row is not embedded: its settings can hold large images.)
 */
export async function getAppointments(
  businessId: string,
  startDate?: string,
  endDate?: string
): Promise<Appointment[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const rows: Appointment[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabaseAdmin!
        .from("appointments")
        .select("*, service:services(*), client:clients(*)")
        .eq("business_id", businessId);
      if (startDate) query = query.gte("start_time", startDate);
      if (endDate) query = query.lte("end_time", endDate);
      const { data, error } = await query
        .order("start_time", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as Appointment[]));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  let apps = db.appointments.filter((a) => a.business_id === businessId);

  if (startDate) {
    apps = apps.filter((a) => a.start_time >= startDate);
  }
  if (endDate) {
    apps = apps.filter((a) => a.end_time <= endDate);
  }

  apps.sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  return apps.map((a) => {
    const { business, ...rest } = hydrateAppointment(a, db.businesses, db.services, db.clients);
    return rest;
  });
}

export async function getAppointmentById(
  id: string
): Promise<Appointment | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin!
      .from("appointments")
      .select("*, service:services(*), client:clients(*), business:businesses(id,slug,name,owner_phone,working_hours,created_at)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Appointment;
  }

  const app = db.appointments.find((a) => a.id === id);
  if (!app) return null;
  return hydrateAppointment(app, db.businesses, db.services, db.clients);
}

export async function createAppointment(appointmentData: {
  business_id: string;
  service_id: string;
  client_id: string;
  start_time: string;
  end_time: string;
  notes?: string | null;
}): Promise<Appointment> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("appointments")
      .insert({
        business_id: appointmentData.business_id,
        service_id: appointmentData.service_id,
        client_id: appointmentData.client_id,
        start_time: appointmentData.start_time,
        end_time: appointmentData.end_time,
        status: "confirmed",
        reminder_sent: false,
        notes: appointmentData.notes || null,
      })
      .select("*, service:services(*), client:clients(*), business:businesses(id,slug,name,owner_phone,working_hours,created_at)")
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Appointment;
  }

  const newApp: Appointment = {
    id: "app-" + Math.random().toString(36).substring(2, 9),
    business_id: appointmentData.business_id,
    service_id: appointmentData.service_id,
    client_id: appointmentData.client_id,
    start_time: appointmentData.start_time,
    end_time: appointmentData.end_time,
    status: "confirmed",
    reminder_sent: false,
    notes: appointmentData.notes || null,
    created_at: new Date().toISOString(),
  };

  db.appointments.push(newApp);
  return hydrateAppointment(newApp, db.businesses, db.services, db.clients);
}

export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus
): Promise<Appointment | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const client = supabaseAdmin!;
    const { data, error } = await client
      .from("appointments")
      .update({ status })
      .eq("id", id)
      .select("*, service:services(*), client:clients(*), business:businesses(id,slug,name,owner_phone,working_hours,created_at)")
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Appointment;
  }

  const idx = db.appointments.findIndex((a) => a.id === id);
  if (idx !== -1) {
    db.appointments[idx].status = status;
    return hydrateAppointment(
      db.appointments[idx],
      db.businesses,
      db.services,
      db.clients
    );
  }
  return null;
}

// Block time (creates a busy block appointment preventing public bookings)
export async function blockTimeSlot({
  business_id,
  start_time,
  end_time,
  reason,
}: {
  business_id: string;
  start_time: string;
  end_time: string;
  reason: string;
}): Promise<Appointment> {
  // Ensure a special "חסימת זמן" client exists for this business
  const blockClient = await findOrCreateClient(business_id, {
    phone: BLOCK_CLIENT_PHONE,
    first_name: "חסימה",
    last_name: `(${reason || "הפסקה"})`,
  });

  return createAppointment({
    business_id,
    service_id: null as unknown as string,
    client_id: blockClient.id,
    start_time,
    end_time,
    notes: `${BLOCK_NOTE_PREFIX} ${reason || "הפסקה/סידורים"}`,
  });
}

/** Removes a block of blocked time for good. Customer appointments are never deleted this way. */
export async function deleteBlockedTime(id: string): Promise<boolean> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .delete()
      .eq("id", id)
      .is("service_id", null)
      .like("notes", `${BLOCK_NOTE_PREFIX}%`)
      .select("id");
    if (error) throw error;
    return (data?.length || 0) > 0;
  }
  const idx = db.appointments.findIndex(
    (a) => a.id === id && !a.service_id && !!a.notes?.startsWith(BLOCK_NOTE_PREFIX)
  );
  if (idx === -1) return false;
  db.appointments.splice(idx, 1);
  return true;
}

// ==============================================================================
// BACKGROUND REMINDER WORKER SUPPORT
// ==============================================================================

export async function getPendingReminders(
  minHoursAhead = 24,
  maxHoursAhead = 25
): Promise<Appointment[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + minHoursAhead * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + maxHoursAhead * 60 * 60 * 1000).toISOString();

  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select("*, service:services(*), client:clients(*), business:businesses(id,slug,name,owner_phone,working_hours,created_at)")
      .eq("status", "confirmed")
      .eq("reminder_sent", false)
      .gte("start_time", windowStart)
      .lte("start_time", windowEnd);

    if (error) throw error;
    if (data) return data as Appointment[];
  }

  const pending = db.appointments.filter((a) => {
    return (
      a.status === "confirmed" &&
      !a.reminder_sent &&
      a.start_time >= windowStart &&
      a.start_time <= windowEnd
    );
  });

  return pending.map((a) =>
    hydrateAppointment(a, db.businesses, db.services, db.clients)
  );
}

export async function markReminderSent(appointmentId: string): Promise<boolean> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("appointments")
      .update({ reminder_sent: true })
      .eq("id", appointmentId);
    if (!error) return true;
  }

  const app = db.appointments.find((a) => a.id === appointmentId);
  if (app) {
    app.reminder_sent = true;
    return true;
  }
  return false;
}

// ==============================================================================
// CLIENT CONTACTS (owner address book) & CUSTOMER GOOGLE PROFILES
// ==============================================================================

export async function getClientById(id: string): Promise<Client | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from("clients").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as Client) || null;
  }
  return db.clients.find((c) => c.id === id) || null;
}

export async function updateClientNotes(id: string, notes: string): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("clients").update({ notes }).eq("id", id);
    if (error) throw error;
    return;
  }
  const c = db.clients.find((x) => x.id === id);
  if (c) c.notes = notes;
}

export interface ContactInput {
  first_name: string;
  last_name: string;
  phone: string; // already normalised to 10 digits
  email?: string;
  birthday?: string;
  notes?: string;
}

/** Adds contacts to a business's customers; phones that already exist are skipped. */
export async function addClientsBulk(
  businessId: string,
  contacts: ContactInput[]
): Promise<{ added: number; skipped: number }> {
  const existing = await getClients(businessId);
  const known = new Set(existing.map((c) => c.phone.replace(/[^0-9]/g, "")));
  const fresh: ContactInput[] = [];
  for (const c of contacts) {
    if (known.has(c.phone)) continue;
    known.add(c.phone);
    fresh.push(c);
  }

  if (isSupabaseConfigured && supabaseAdmin) {
    for (let i = 0; i < fresh.length; i += 200) {
      const rows = fresh.slice(i, i + 200).map((c) => ({
        business_id: businessId,
        phone: c.phone,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email || null,
        birthday: c.birthday || null,
        notes: c.notes || null,
        auth_provider: "guest",
      }));
      const { error } = await supabaseAdmin
        .from("clients")
        .upsert(rows, { onConflict: "business_id,phone", ignoreDuplicates: true });
      if (error) throw error;
    }
  } else {
    for (const c of fresh) {
      db.clients.push({
        id: "c-" + Math.random().toString(36).substring(2, 9),
        business_id: businessId,
        phone: c.phone,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        birthday: c.birthday,
        notes: c.notes,
        auth_provider: "guest",
        created_at: new Date().toISOString(),
      } as Client);
    }
  }
  return { added: fresh.length, skipped: contacts.length - fresh.length };
}

export interface CustomerProfile {
  google_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
}

const mockProfiles = inMemory(new Map<string, CustomerProfile>());

export async function getCustomerProfile(googleId: string): Promise<CustomerProfile | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("customer_profiles")
      .select("google_id,email,first_name,last_name,phone")
      .eq("google_id", googleId)
      .maybeSingle();
    if (error) throw error;
    return (data as CustomerProfile) || null;
  }
  return mockProfiles.get(googleId) || null;
}

export async function upsertCustomerProfile(p: CustomerProfile): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("customer_profiles")
      .upsert({ ...p, updated_at: new Date().toISOString() }, { onConflict: "google_id" });
    if (error) throw error;
    return;
  }
  mockProfiles.set(p.google_id, p);
}

// ==============================================================================
// STAFF (employees with optional system login)
// ==============================================================================

export interface StaffMember {
  id: string;
  business_id: string;
  name: string;
  phone: string;
  role: "manager" | "staff";
  password?: string | null; // bcrypt hash, server-side only
  is_visible_online: boolean;
  avatar_color?: string | null;
  active: boolean;
  created_at?: string;
}

const mockStaff = inMemory<StaffMember[]>([]);

export async function getStaffByBusiness(businessId: string): Promise<StaffMember[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("staff_members")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as StaffMember[]) || [];
  }
  return mockStaff.filter((s) => s.business_id === businessId);
}

export async function getStaffById(id: string): Promise<StaffMember | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from("staff_members").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as StaffMember) || null;
  }
  return mockStaff.find((s) => s.id === id) || null;
}

export async function getStaffByPhone(phone: string): Promise<StaffMember | null> {
  const digits = phone.replace(/[^0-9]/g, "");
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("staff_members")
      .select("*")
      .eq("phone", digits)
      .maybeSingle();
    if (error) throw error;
    return (data as StaffMember) || null;
  }
  return mockStaff.find((s) => s.phone === digits) || null;
}

export async function createStaff(input: {
  business_id: string;
  name: string;
  phone: string;
  role: "manager" | "staff";
  passwordHash?: string;
  is_visible_online?: boolean;
  avatar_color?: string;
}): Promise<StaffMember> {
  const row = {
    business_id: input.business_id,
    name: input.name,
    phone: input.phone,
    role: input.role,
    password: input.passwordHash || null,
    is_visible_online: input.is_visible_online ?? true,
    avatar_color: input.avatar_color || null,
  };
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from("staff_members").insert(row).select().single();
    if (error) throw error;
    return data as StaffMember;
  }
  const s: StaffMember = {
    ...row,
    id: "st-" + Math.random().toString(36).substring(2, 9),
    active: true,
    created_at: new Date().toISOString(),
  };
  mockStaff.push(s);
  return s;
}

export async function updateStaff(
  id: string,
  updates: Partial<Pick<StaffMember, "name" | "phone" | "role" | "is_visible_online" | "active">> & {
    passwordHash?: string | null;
  }
): Promise<StaffMember | null> {
  const { passwordHash, ...rest } = updates;
  const payload: Record<string, unknown> = { ...rest };
  if (passwordHash !== undefined) payload.password = passwordHash;
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("staff_members")
      .update(payload)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return (data as StaffMember) || null;
  }
  const s = mockStaff.find((x) => x.id === id);
  if (!s) return null;
  Object.assign(s, payload);
  return s;
}

export async function deleteStaff(id: string): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("staff_members").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const i = mockStaff.findIndex((x) => x.id === id);
  if (i !== -1) mockStaff.splice(i, 1);
}

export async function setAppointmentStaff(id: string, staffId: string | null): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("appointments").update({ staff_id: staffId }).eq("id", id);
    if (error) throw error;
    return;
  }
  const a = db.appointments.find((x) => x.id === id);
  if (a) (a as Appointment & { staff_id?: string | null }).staff_id = staffId;
}

/** Moves an appointment to a new time (used by customer/owner rescheduling). */
export async function rescheduleAppointment(
  id: string,
  startIso: string,
  endIso: string
): Promise<Appointment | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update({ start_time: startIso, end_time: endIso, reminder_sent: false })
      .eq("id", id)
      .select("*, service:services(*), client:clients(*), business:businesses(id,slug,name,owner_phone,working_hours,created_at)")
      .maybeSingle();
    if (error) throw error;
    return (data as Appointment) || null;
  }
  const idx = db.appointments.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  db.appointments[idx].start_time = startIso;
  db.appointments[idx].end_time = endIso;
  db.appointments[idx].reminder_sent = false;
  return hydrateAppointment(db.appointments[idx], db.businesses, db.services, db.clients);
}

// ==============================================================================
// WAITING LIST
// ==============================================================================

export interface WaitlistEntry {
  id: string;
  business_id: string;
  service_id: string | null;
  phone: string;
  first_name: string;
  last_name: string;
  desired_date: string; // YYYY-MM-DD (Israel)
  status: "waiting" | "slot_open" | "done" | "cancelled";
  opened_start: string | null;
  created_at: string;
  service?: { name: string } | null;
}

const mockWaitlist = inMemory<WaitlistEntry[]>([]);

export async function addWaitlistEntry(input: {
  business_id: string;
  service_id: string;
  phone: string;
  first_name: string;
  last_name: string;
  desired_date: string;
}): Promise<{ entry: WaitlistEntry; duplicate: boolean }> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const existing = await supabaseAdmin
      .from("waitlist")
      .select("*")
      .eq("business_id", input.business_id)
      .eq("phone", input.phone)
      .eq("desired_date", input.desired_date)
      .eq("service_id", input.service_id)
      .in("status", ["waiting", "slot_open"])
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { entry: existing.data as WaitlistEntry, duplicate: true };
    const { data, error } = await supabaseAdmin.from("waitlist").insert(input).select().single();
    if (error) throw error;
    return { entry: data as WaitlistEntry, duplicate: false };
  }
  const dup = mockWaitlist.find(
    (w) =>
      w.business_id === input.business_id &&
      w.phone === input.phone &&
      w.desired_date === input.desired_date &&
      w.service_id === input.service_id &&
      (w.status === "waiting" || w.status === "slot_open")
  );
  if (dup) return { entry: dup, duplicate: true };
  const entry: WaitlistEntry = {
    ...input,
    id: "wl-" + Math.random().toString(36).substring(2, 9),
    status: "waiting",
    opened_start: null,
    created_at: new Date().toISOString(),
  };
  mockWaitlist.push(entry);
  return { entry, duplicate: false };
}

export async function getWaitlist(businessId: string): Promise<WaitlistEntry[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("waitlist")
      .select("*, service:services(name)")
      .eq("business_id", businessId)
      .in("status", ["waiting", "slot_open"])
      .order("desired_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as unknown as WaitlistEntry[]) || [];
  }
  return mockWaitlist
    .filter((w) => w.business_id === businessId && (w.status === "waiting" || w.status === "slot_open"))
    .map((w) => ({ ...w, service: db.services.find((s) => s.id === w.service_id) || null }));
}

export async function setWaitlistStatus(
  id: string,
  businessId: string,
  status: "done" | "cancelled"
): Promise<boolean> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("waitlist")
      .update({ status })
      .eq("id", id)
      .eq("business_id", businessId)
      .select("id");
    if (error) throw error;
    return (data?.length || 0) > 0;
  }
  const w = mockWaitlist.find((x) => x.id === id && x.business_id === businessId);
  if (!w) return false;
  w.status = status;
  return true;
}

/** A booked slot was freed: everyone waiting for that Israel calendar day is flagged. */
export async function openWaitlistForSlot(
  businessId: string,
  israelDate: string,
  startIso: string
): Promise<number> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("waitlist")
      .update({ status: "slot_open", opened_start: startIso })
      .eq("business_id", businessId)
      .eq("desired_date", israelDate)
      .in("status", ["waiting", "slot_open"])
      .select("id");
    if (error) throw error;
    return data?.length || 0;
  }
  let n = 0;
  for (const w of mockWaitlist) {
    if (w.business_id === businessId && w.desired_date === israelDate && w.status !== "done" && w.status !== "cancelled") {
      w.status = "slot_open";
      w.opened_start = startIso;
      n += 1;
    }
  }
  return n;
}

// ==============================================================================
// WEB PUSH (subscriptions + server-held VAPID keys)
// ==============================================================================

export interface PushSub {
  endpoint: string;
  business_id: string;
  staff_id?: string | null;
  p256dh: string;
  auth: string;
}

const mockPush = inMemory(new Map<string, PushSub>());
const mockSecrets = inMemory(new Map<string, string>());

export async function savePushSubscription(sub: PushSub): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        { endpoint: sub.endpoint, business_id: sub.business_id, staff_id: sub.staff_id || null, p256dh: sub.p256dh, auth: sub.auth },
        { onConflict: "endpoint" }
      );
    if (error) throw error;
    return;
  }
  mockPush.set(sub.endpoint, sub);
}

export async function deletePushSubscription(endpoint: string, businessId: string): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("business_id", businessId);
    if (error) throw error;
    return;
  }
  const s = mockPush.get(endpoint);
  if (s && s.business_id === businessId) mockPush.delete(endpoint);
}

export async function getPushSubscriptions(businessId: string): Promise<PushSub[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint,business_id,staff_id,p256dh,auth")
      .eq("business_id", businessId);
    if (error) throw error;
    return (data as PushSub[]) || [];
  }
  return Array.from(mockPush.values()).filter((s) => s.business_id === businessId);
}

export async function getSecret(key: string): Promise<string | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from("app_secrets").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return (data?.value as string) || null;
  }
  return mockSecrets.get(key) || null;
}

/** Stores a secret only if it does not exist yet; returns the winning value (race-safe). */
export async function setSecretIfAbsent(key: string, value: string): Promise<string> {
  if (isSupabaseConfigured && supabaseAdmin) {
    await supabaseAdmin.from("app_secrets").upsert({ key, value }, { onConflict: "key", ignoreDuplicates: true });
    return (await getSecret(key)) || value;
  }
  if (!mockSecrets.has(key)) mockSecrets.set(key, value);
  return mockSecrets.get(key)!;
}

// ==============================================================================
// EXPORT (owner backup)
// ==============================================================================

export async function getAllAppointmentsForExport(businessId: string): Promise<Appointment[]> {
  return getAppointments(businessId);
}

export async function getBusinessesByEmail(email: string): Promise<Business[]> {
  const e = email.trim().toLowerCase();
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .ilike("owner_email", escapeLike(e));
    if (error) throw error;
    return (data || []).map(normalizeBusinessRecord);
  }
  return db.businesses.filter((b) => b.owner_email?.toLowerCase() === e).map(normalizeBusinessRecord);
}

// ==============================================================================
// GOOGLE CALENDAR SYNC (connection + per-appointment sync bookkeeping)
// ==============================================================================

export interface GoogleConnectionRow {
  business_id: string;
  google_email: string;
  refresh_token_encrypted: string;
  calendar_id: string;
  status: "active" | "needs_reconnect";
}

export interface GoogleSyncPatch {
  status: "pending" | "synced" | "failed" | "not_connected";
  /** undefined = leave as is, null = clear */
  googleEventId?: string | null;
  error?: string | null;
  retryCount?: number;
  nextAttemptAt?: string | null;
}

export interface GoogleSyncContextRow {
  appointment: Appointment;
  service: { name: string } | null;
  client: { first_name: string; last_name: string; phone: string; email?: string | null } | null;
  business: { id: string; name: string; settings?: Business["settings"] };
}

/** Retries are only attempted while the failure counter is at most this (initial try + 5 retries). */
const GOOGLE_SYNC_MAX_RETRIES = 5;

const mockGoogleConnections = new Map<string, GoogleConnectionRow>();

type SyncColumns = {
  sync_status: GoogleSyncPatch["status"];
  google_event_id?: string | null;
  sync_error?: string | null;
  sync_retry_count?: number;
  sync_next_attempt_at?: string | null;
};

function syncColumns(patch: GoogleSyncPatch): SyncColumns {
  const cols: SyncColumns = { sync_status: patch.status };
  if (patch.googleEventId !== undefined) cols.google_event_id = patch.googleEventId;
  if (patch.error !== undefined) cols.sync_error = patch.error;
  if (patch.retryCount !== undefined) cols.sync_retry_count = patch.retryCount;
  if (patch.nextAttemptAt !== undefined) cols.sync_next_attempt_at = patch.nextAttemptAt;
  return cols;
}

export async function getGoogleConnection(businessId: string): Promise<GoogleConnectionRow | null> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("google_calendar_connections")
      .select("business_id,google_email,refresh_token_encrypted,calendar_id,status")
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw error;
    return (data as GoogleConnectionRow | null) ?? null;
  }
  return mockGoogleConnections.get(businessId) ?? null;
}

export async function upsertGoogleConnection(row: GoogleConnectionRow): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("google_calendar_connections")
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "business_id" });
    if (error) throw error;
    return;
  }
  mockGoogleConnections.set(row.business_id, { ...row });
}

export async function setGoogleConnectionStatus(
  businessId: string,
  status: GoogleConnectionRow["status"]
): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("google_calendar_connections")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("business_id", businessId);
    if (error) throw error;
    return;
  }
  const row = mockGoogleConnections.get(businessId);
  if (row) row.status = status;
}

export async function deleteGoogleConnection(businessId: string): Promise<void> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("google_calendar_connections").delete().eq("business_id", businessId);
    if (error) throw error;
    return;
  }
  mockGoogleConnections.delete(businessId);
}

export async function getGoogleSyncContext(appointmentId: string): Promise<GoogleSyncContextRow | null> {
  let appointment: Appointment | null = null;
  let service: GoogleSyncContextRow["service"] = null;
  let client: GoogleSyncContextRow["client"] = null;

  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select("*, service:services(name), client:clients(first_name,last_name,phone,email)")
      .eq("id", appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { service: s, client: c, ...rest } = data as Appointment & {
      service: GoogleSyncContextRow["service"];
      client: GoogleSyncContextRow["client"];
    };
    appointment = rest as Appointment;
    service = s ?? null;
    client = c ?? null;
  } else {
    const found = db.appointments.find((a) => a.id === appointmentId);
    if (!found) return null;
    appointment = found;
    const svc = db.services.find((x) => x.id === found.service_id);
    const cli = db.clients.find((x) => x.id === found.client_id);
    service = svc ? { name: svc.name } : null;
    client = cli
      ? { first_name: cli.first_name, last_name: cli.last_name, phone: cli.phone, email: cli.email ?? null }
      : null;
  }

  const business = await getBusinessById(appointment.business_id);
  if (!business) return null;
  return {
    appointment,
    service,
    client,
    business: { id: business.id, name: business.name, settings: business.settings },
  };
}

export async function markAppointmentSync(appointmentId: string, patch: GoogleSyncPatch): Promise<void> {
  const cols = syncColumns(patch);
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("appointments").update(cols).eq("id", appointmentId);
    if (error) throw error;
    return;
  }
  const a = db.appointments.find((x) => x.id === appointmentId);
  if (a) Object.assign(a, cols);
}

export async function listAppointmentsDueForGoogleSync(nowIso: string, limit: number): Promise<string[]> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .select("id")
      .in("sync_status", ["pending", "failed"])
      .lte("sync_retry_count", GOOGLE_SYNC_MAX_RETRIES)
      .not("sync_next_attempt_at", "is", null)
      .lte("sync_next_attempt_at", nowIso)
      .order("sync_next_attempt_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: { id: string }) => r.id);
  }
  return db.appointments
    .filter(
      (a) =>
        (a.sync_status === "pending" || a.sync_status === "failed") &&
        (a.sync_retry_count ?? 0) <= GOOGLE_SYNC_MAX_RETRIES &&
        !!a.sync_next_attempt_at &&
        a.sync_next_attempt_at <= nowIso
    )
    .slice(0, limit)
    .map((a) => a.id);
}

/** Confirmed appointments from now on become "pending", due right away. Returns how many. */
export async function queueFutureAppointmentsForGoogleSync(businessId: string, nowIso: string): Promise<number> {
  const cols: SyncColumns = {
    sync_status: "pending",
    sync_retry_count: 0,
    sync_error: null,
    sync_next_attempt_at: nowIso,
  };
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update(cols)
      .eq("business_id", businessId)
      .eq("status", "confirmed")
      .not("service_id", "is", null)
      .gte("start_time", nowIso)
      .in("sync_status", ["not_connected", "failed"])
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  }
  const rows = db.appointments.filter(
    (a) =>
      a.business_id === businessId &&
      a.status === "confirmed" &&
      !!a.service_id &&
      a.start_time >= nowIso &&
      (a.sync_status === undefined || a.sync_status === "not_connected" || a.sync_status === "failed")
  );
  rows.forEach((a) => Object.assign(a, cols));
  return rows.length;
}

export async function requeueFailedGoogleSyncs(businessId: string, nowIso: string): Promise<number> {
  const cols: SyncColumns = {
    sync_status: "pending",
    sync_retry_count: 0,
    sync_error: null,
    sync_next_attempt_at: nowIso,
  };
  if (isSupabaseConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("appointments")
      .update(cols)
      .eq("business_id", businessId)
      .eq("sync_status", "failed")
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  }
  const rows = db.appointments.filter((a) => a.business_id === businessId && a.sync_status === "failed");
  rows.forEach((a) => Object.assign(a, cols));
  return rows.length;
}

/** After a disconnect: forget event ids and queue state for the business. */
export async function clearGoogleSyncState(businessId: string): Promise<void> {
  const cols: SyncColumns = {
    sync_status: "not_connected",
    google_event_id: null,
    sync_error: null,
    sync_retry_count: 0,
    sync_next_attempt_at: null,
  };
  if (isSupabaseConfigured && supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from("appointments")
      .update(cols)
      .eq("business_id", businessId)
      .neq("sync_status", "not_connected");
    if (error) throw error;
    return;
  }
  db.appointments
    .filter((a) => a.business_id === businessId && a.sync_status && a.sync_status !== "not_connected")
    .forEach((a) => Object.assign(a, cols));
}

export async function countGoogleSyncs(
  businessId: string
): Promise<{ failed: number; pending: number }> {
  if (isSupabaseConfigured && supabaseAdmin) {
    const count = async (status: "failed" | "pending"): Promise<number> => {
      const { count: n, error } = await supabaseAdmin!
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("sync_status", status);
      if (error) throw error;
      return n ?? 0;
    };
    return { failed: await count("failed"), pending: await count("pending") };
  }
  const mine = db.appointments.filter((a) => a.business_id === businessId);
  return {
    failed: mine.filter((a) => a.sync_status === "failed").length,
    pending: mine.filter((a) => a.sync_status === "pending").length,
  };
}
