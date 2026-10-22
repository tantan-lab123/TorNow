// ==============================================================================
// Domain Types for Appointment Scheduling SaaS (Hebrew / RTL)
// ==============================================================================

export type DayOfWeek =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export interface DayBreak {
  active: boolean;
  start: string; // "HH:mm" e.g., "13:00"
  end: string;   // "HH:mm" e.g., "14:00"
}

export interface DayHours {
  open: string; // "HH:mm" e.g., "09:00"
  close: string; // "HH:mm" e.g., "19:00"
  active: boolean;
  lunch_break?: DayBreak;
}

export type WorkingHours = Record<DayOfWeek, DayHours>;

export interface DateOverride {
  id: string;
  date: string; // "YYYY-MM-DD"
  is_closed: boolean;
  reason: string; // e.g. "חג", "חופשה שנתית", "אירוע אישי", "שיפוצים"
  custom_open?: string;
  custom_close?: string;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  owner_phone: string;
  owner_email?: string;
  password?: string; // Strong password (min 8 chars, uppercase, lowercase, digit, special char)
  google_id?: string; // Google OAuth ID
  pin?: string; // legacy, unused: never returned by the API
  calendar_token?: string; // server-issued, owner-only (calendar feed secret)
  calendar_version?: number; // server-only: raising it replaces every calendar feed link
  slot_interval_minutes?: number; // 15, 20, 30, 45, 60 (resolution)
  date_overrides?: DateOverride[]; // specific date closures/holidays
  working_hours: WorkingHours;
  settings?: BusinessSettings;
  created_at: string;
}

export interface BusinessSettings {
  address?: string;
  whatsapp_phone?: string;
  instagram_url?: string;
  tiktok_url?: string;
  logo_url?: string; // Business logo image (data URL or external URL)
  cover_image_url?: string; // Business cover header banner (data URL or external URL)
  og_image_url?: string; // Optional picture for shared links (WhatsApp...), 1200x630. Served at /api/og/<slug>, never in the public business JSON
  min_notice_hours?: number; // e.g. 0.25 (15 min), 1, 2, 24
  max_future_days?: number; // e.g. 30, 90, 180, 365
  cancellation_cutoff_hours?: number; // e.g. 6, 12, 24
  max_active_appointments_per_client?: number; // default: 3
  max_appointments_per_day?: number; // 0 = unlimited, 1 = 1 per day, etc.
  max_appointments_per_week?: number; // 0 = unlimited, 2 = 2 per week, etc.
  max_appointments_per_month?: number; // 0 = unlimited, 4 = 4 per month, etc.
  show_price_and_duration?: boolean; // default: true
  require_staff_selection?: boolean; // default: false
  waiting_list_enabled?: boolean; // default: true
  calendar_reminder_minutes?: number; // alert in the owner's calendar before each appointment; 0 = none, default 60
  post_booking_message?: string; // custom instructions on completion
  show_hebrew_dates?: boolean; // toggle Hebrew calendar dates & Jewish holidays in client & admin views
  bit_payment_url?: string; // Bit payment link
  paybox_payment_url?: string; // PayBox payment link
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  category?: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: number;
  color_tag?: string;
  created_at?: string;
}

export interface Employee {
  id: string;
  business_id: string;
  name: string;
  phone: string;
  role: 'owner' | 'manager' | 'staff';
  is_visible_online: boolean;
  avatar_color?: string;
  services?: string[];
  created_at?: string;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  category: string;
  sku?: string;
  cost_price: number;
  sale_price: number;
  stock_quantity: number;
  min_stock_alert: number;
  created_at?: string;
}

export interface MarketingMessage {
  id: string;
  business_id: string;
  recipient_count: number;
  channel: 'sms' | 'whatsapp';
  content: string;
  sent_at: string;
  status: 'delivered' | 'pending' | 'failed';
}

export interface AttendanceRecord {
  id: string;
  business_id: string;
  employee_name: string;
  date: string;
  check_in: string; // HH:mm
  check_out?: string; // HH:mm
  total_hours?: string;
}

export interface Client {
  id: string;
  business_id: string;
  phone: string;
  first_name: string;
  last_name: string;
  email?: string;
  address?: string;
  birthday?: string;
  gender?: string;
  notes?: string;
  google_id?: string;
  auth_provider?: 'guest' | 'google';
  created_at?: string;
}

export type AppointmentStatus = 'confirmed' | 'cancelled';

export interface Appointment {
  id: string;
  business_id: string;
  service_id: string;
  client_id: string;
  start_time: string; // ISO timestamptz e.g., "2026-09-10T10:00:00Z"
  end_time: string; // ISO timestamptz
  status: AppointmentStatus;
  reminder_sent: boolean;
  notes?: string | null;
  staff_id?: string | null;
  created_at?: string;

  // Joined fields for convenience
  service?: Service;
  client?: Client;
  business?: Business;
}

export interface TimeSlot {
  startTime: string; // ISO string
  endTime: string; // ISO string
  formattedTime: string; // "10:30"
  period: 'morning' | 'afternoon' | 'evening';
  available: boolean;
}

export interface CreateBookingInput {
  business_id: string;
  service_id: string;
  phone: string;
  first_name: string;
  last_name: string;
  email?: string;
  google_id?: string;
  auth_provider?: 'guest' | 'google';
  start_time: string;
  notes?: string;
}

export interface BlockSlotInput {
  business_id: string;
  start_time: string;
  end_time: string;
  reason: string;
}

export interface CreateBusinessInput {
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
}
