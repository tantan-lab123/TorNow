"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  Phone,
  ChevronRight,
  ChevronLeft,
  CalendarPlus,
  AlertCircle,
  ExternalLink,
  MessageCircle,
} from "lucide-react";
import confetti from "canvas-confetti";
import { Business, Service, TimeSlot, Appointment } from "@/lib/types";
import { supabase } from "@/lib/db/supabase";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import {
  formatHebrewDate,
  formatShortDate,
  generateGoogleCalendarUrl,
  generateIcsDataUrl,
  triggerHaptic,
  cn,
  formatJewishDate,
  getJewishHolidayOrShabbat,
  getHebrewDayLetter,
  validatePhoneNumber,
  toInternationalPhone,
} from "@/lib/utils";
import {
  addMonths,
  subMonths,
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfToday,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isBefore,
  isToday,
} from "date-fns";
import { he } from "date-fns/locale";

const STORAGE_KEY = "schedule_saved_client_v1";
// Booking progress is parked here while the customer is away signing in with Google.
const PENDING_KEY = "torli_pending_booking_v1";

// The time page opens on these three tabs, so a long day is not one wall of times.
const DAY_PARTS: { id: TimeSlot["period"]; label: string; hours: string }[] = [
  { id: "morning", label: "בוקר", hours: "עד 12:00" },
  { id: "afternoon", label: "צהריים", hours: "12:00-17:00" },
  { id: "evening", label: "ערב", hours: "מ-17:00" },
];

// Back / next keys live at the bottom of every step, where the thumb is.
function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] bg-white/95 backdrop-blur-md border-t border-ink-200 z-20">
      <div className="max-w-md mx-auto flex items-center gap-3">{children}</div>
    </div>
  );
}

export default function BookingPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  // State
  const [business, setBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [isLoadingBusiness, setIsLoadingBusiness] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Flow State: 1 = Service, 2 = Date & Time, 3 = Details, 4 = Success
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Selections
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotMessage, setSlotMessage] = useState<string | undefined>();
  const [slotPeriod, setSlotPeriod] = useState<TimeSlot["period"] | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Client Details Form
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [isGoogleClient, setIsGoogleClient] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Waiting list for a fully booked day
  const [waitOpen, setWaitOpen] = useState(false);
  const [waitBusy, setWaitBusy] = useState(false);
  const [waitMsg, setWaitMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [isClientLookupLoading, setIsClientLookupLoading] = useState(false);
  const [isReturningClient, setIsReturningClient] = useState(false);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Success State
  const [confirmedAppointment, setConfirmedAppointment] = useState<Appointment | null>(null);

  // Monthly Calendar & Availability State
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfToday());
  const [monthAvailability, setMonthAvailability] = useState<
    Record<string, { hasSlots: boolean; count: number; isOpen: boolean; message?: string }>
  >({});
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);

  // Month days & weekday alignment
  const monthDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const startDayOfWeek = useMemo(() => {
    return getDay(startOfMonth(currentMonth)); // 0 = Sunday
  }, [currentMonth]);

  const canGoPrevMonth = useMemo(() => {
    return !isSameMonth(currentMonth, startOfToday());
  }, [currentMonth]);

  // Fetch Business and Services
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoadingBusiness(true);
        const res = await fetch(`/api/business?slug=${slug}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const bData = await res.json();
        setBusiness(bData);

        const sRes = await fetch(`/api/services?business_id=${bData.id}`);
        if (sRes.ok) {
          const sData = await sRes.json();
          setServices(sData);
          if (sData.length > 0) {
            setSelectedService(sData[0]);
          }
          // Returning from Google sign-in: put the customer back on the details step
          try {
            const raw = sessionStorage.getItem(PENDING_KEY);
            if (raw) {
              const pending = JSON.parse(raw);
              const svc = sData.find((x: Service) => x.id === pending.serviceId);
              if (pending.slug === slug && svc && pending.slot && pending.dateStr) {
                const d = new Date(pending.dateStr + "T00:00:00");
                setSelectedService(svc);
                setSelectedDate(d);
                setCurrentMonth(d);
                setSelectedSlot(pending.slot);
                setStep(4);
              }
              sessionStorage.removeItem(PENDING_KEY);
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error("Error loading business:", err);
        setNotFound(true);
      } finally {
        setIsLoadingBusiness(false);
      }
    };
    loadData();
  }, [slug]);

  // Load saved client info from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.phone) setPhone(parsed.phone);
        if (parsed.firstName) setFirstName(parsed.firstName);
        if (parsed.lastName) setLastName(parsed.lastName);
        if (parsed.email) setClientEmail(parsed.email);
      }
    } catch {
      // ignore
    }
  }, []);

  // Each step is its own page: always start it from the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  // Real Google sign-in (Supabase Auth): prefill from the saved profile, or from the Google account
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const applySession = async (session: {
      access_token: string;
      user: { email?: string; user_metadata?: Record<string, any> };
    }) => {
      if (cancelled) return;
      setIsGoogleClient(true);
      setIsGoogleLoading(true);
      const meta = session.user.user_metadata || {};
      const fullName = String(meta.full_name || meta.name || "").trim();
      const googleFirst = String(meta.given_name || fullName.split(" ")[0] || "");
      const googleLast = String(meta.family_name || fullName.split(" ").slice(1).join(" ") || "");
      setClientEmail(session.user.email || "");
      try {
        const res = await fetch("/api/customer/profile", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (data?.profile) {
          setFirstName(data.profile.first_name);
          setLastName(data.profile.last_name);
          setPhone(
            data.profile.phone.length === 10
              ? `${data.profile.phone.slice(0, 3)}-${data.profile.phone.slice(3)}`
              : data.profile.phone
          );
          setIsReturningClient(true);
        } else {
          setFirstName((prev) => prev || googleFirst);
          setLastName((prev) => prev || googleLast);
        }
      } catch {
        setFirstName((prev) => prev || googleFirst);
        setLastName((prev) => prev || googleLast);
      } finally {
        if (!cancelled) setIsGoogleLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.app_metadata?.provider === "google") {
        applySession(data.session as any);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setIsGoogleClient(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business || !selectedService) return;
    const phoneCheck = validatePhoneNumber(phone);
    if (!phoneCheck.isValid) {
      setWaitMsg({ ok: false, text: phoneCheck.error || "מספר טלפון לא תקין" });
      return;
    }
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      setWaitMsg({ ok: false, text: "יש להזין שם פרטי ושם משפחה" });
      return;
    }
    setWaitBusy(true);
    setWaitMsg(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: business.id,
          service_id: selectedService.id,
          phone: phoneCheck.cleaned,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          desired_date: format(selectedDate, "yyyy-MM-dd"),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWaitMsg({ ok: false, text: data.error || "לא הצלחנו להוסיף אותך לרשימה" });
      } else {
        setWaitMsg({
          ok: true,
          text: data.duplicate
            ? "אתה כבר ברשימת ההמתנה ליום הזה. נעדכן אותך אם יתפנה תור."
            : "נוספת לרשימת ההמתנה! אם יתפנה תור ביום הזה, בית העסק ייצור איתך קשר.",
        });
        triggerHaptic(40);
      }
    } catch {
      setWaitMsg({ ok: false, text: "שגיאת תקשורת. אנא נסה שוב." });
    } finally {
      setWaitBusy(false);
    }
  };

  // Start Google sign-in; the booking progress survives the redirect via sessionStorage
  const handleGoogleSignIn = async () => {
    if (!supabase || !selectedService || !selectedSlot) return;
    triggerHaptic(20);
    setIsGoogleLoading(true);
    try {
      sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify({
          slug,
          serviceId: selectedService.id,
          dateStr: format(selectedDate, "yyyy-MM-dd"),
          slot: selectedSlot,
        })
      );
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/${slug}` },
      });
      if (error) throw error;
    } catch (err) {
      console.error("Google sign-in error:", err);
      sessionStorage.removeItem(PENDING_KEY);
      setIsGoogleLoading(false);
      alert("ההתחברות עם Google אינה זמינה כרגע. ניתן להמשיך כאורח.");
    }
  };

  const handleGuestContinue = async () => {
    triggerHaptic(15);
    try {
      await supabase?.auth.signOut();
    } catch {
      // ignore
    }
    setIsGoogleClient(false);
    setIsReturningClient(false);
    setClientEmail("");
  };

  // Fetch month availability map whenever currentMonth, business or selectedService changes
  useEffect(() => {
    if (!business || !selectedService) return;

    const loadMonthData = async () => {
      try {
        setIsLoadingMonth(true);
        const monthStr = format(currentMonth, "yyyy-MM");
        const dateStr = format(selectedDate, "yyyy-MM-dd");
        const res = await fetch(
          `/api/slots?business_id=${business.id}&service_id=${selectedService.id}&month=${monthStr}&date=${dateStr}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.monthDays) {
            setMonthAvailability(data.monthDays);
          }
          if (data.slots) {
            setSlots(data.slots || []);
            setSlotMessage(data.message);
          }
        }
      } catch (err) {
        console.error("Error loading month data:", err);
      } finally {
        setIsLoadingMonth(false);
      }
    };

    loadMonthData();
  }, [business, selectedService, currentMonth, selectedDate]);

  // Handle user selecting a date on the calendar
  const handleSelectDate = async (date: Date, goToTimePage = true) => {
    triggerHaptic(15);
    setSelectedDate(date);
    if (goToTimePage) setStep(3);
    setSelectedSlot(null);
    setWaitOpen(false);
    setWaitMsg(null);

    // If day is from another month, navigate to it
    if (!isSameMonth(date, currentMonth)) {
      setCurrentMonth(date);
    }

    try {
      setIsLoadingSlots(true);
      const dateStr = format(date, "yyyy-MM-dd");
      const res = await fetch(
        `/api/slots?business_id=${business?.id}&service_id=${selectedService?.id}&date=${dateStr}`
      );
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots || []);
        setSlotMessage(data.message);
      }
    } catch (err) {
      console.error("Error loading slots:", err);
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const findNeighborDay = (dir: 1 | -1): Date | null => {
    const today = startOfToday();
    const last = addDays(today, business?.settings?.max_future_days ?? 60);
    for (let i = 1; i <= 62; i++) {
      const d = addDays(selectedDate, dir * i);
      if (isBefore(d, today) || isBefore(last, d)) return null;
      const info = monthAvailability[format(d, "yyyy-MM-dd")];
      // unknown month data: step one day and let it load; known closed days are skipped
      if (info === undefined || info.isOpen) return d;
    }
    return null;
  };

  const handlePrevMonth = () => {
    if (!canGoPrevMonth) return;
    triggerHaptic(10);
    setCurrentMonth((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    triggerHaptic(10);
    setCurrentMonth((prev) => addMonths(prev, 1));
  };

  // Phone lookup when phone is 10 digits
  useEffect(() => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10 && business) {
      const lookup = async () => {
        try {
          setIsClientLookupLoading(true);
          const res = await fetch(
            `/api/clients/lookup?business_id=${business?.id}&phone=${cleaned}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.exists && data.client) {
              setFirstName(data.client.first_name);
              setLastName(data.client.last_name);
              setIsReturningClient(true);
            } else {
              setIsReturningClient(false);
            }
          }
        } catch (err) {
          console.error("Client lookup error:", err);
        } finally {
          setIsClientLookupLoading(false);
        }
      };
      lookup();
    } else {
      setIsReturningClient(false);
    }
  }, [phone, business]);

  // Handle Phone input change with automatic 10-digit cap and formatting
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, "");
    // Cap at exactly 10 digits max
    const trimmed = digits.slice(0, 10);
    let formatted = trimmed;
    if (trimmed.length > 3) {
      formatted = `${trimmed.slice(0, 3)}-${trimmed.slice(3)}`;
    }
    setPhone(formatted);
    if (formErrors.phone) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.phone;
        return next;
      });
    }
  };

  // Handle Form Submission
  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business || !selectedService || !selectedSlot) return;

    const errors: { [key: string]: string } = {};
    const phoneCheck = validatePhoneNumber(phone);

    if (!phoneCheck.isValid) {
      errors.phone = phoneCheck.error || "מספר הטלפון חייב להכיל בדיוק 10 ספרות";
    }
    const cleanedPhone = phoneCheck.cleaned;
    if (!firstName.trim()) {
      errors.firstName = "שם פרטי הוא שדה חובה";
    }
    if (!lastName.trim()) {
      errors.lastName = "שם משפחה הוא שדה חובה";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      triggerHaptic(40);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      const accessToken = isGoogleClient
        ? (await supabase?.auth.getSession())?.data.session?.access_token
        : undefined;
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: business.id,
          service_id: selectedService.id,
          phone: cleanedPhone,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: accessToken ? undefined : clientEmail.trim() || undefined,
          access_token: accessToken,
          start_time: selectedSlot.startTime,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "אירעה שגיאה בקביעת התור. אנא בחר מועד אחר.");
        setIsSubmitting(false);
        return;
      }

      // Persist in localStorage if checked
      if (rememberMe) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            phone: cleanedPhone,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: clientEmail.trim() || undefined,
          })
        );
      }

      setConfirmedAppointment(data.appointment);
      setStep(5);
      triggerHaptic(50);

      // Launch celebratory confetti (no web worker: the CSP blocks blob: workers)
      confetti.create(undefined, { resize: true, useWorker: false })({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.55 },
        colors: ["#1E4D36", "#CFEA6E", "#2F6B4B", "#F4F1E8"],
        disableForReducedMotion: true,
      });
    } catch (err) {
      console.error("Booking error:", err);
      alert("שגיאת תקשורת. אנא נסה שוב.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading Screen
  if (isLoadingBusiness) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="m-spin m-spin-dark mb-4" style={{ width: 36, height: 36, borderWidth: 3 }} />
        <p className="text-ink-600 font-medium">טוען את היומן...</p>
      </div>
    );
  }

  // Not Found Screen
  if (notFound || !business) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 bg-danger-50 text-danger-600 rounded-xl flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">עסק לא נמצא</h1>
        <p className="text-slate-500 mb-6">
          העמוד שחיפשת אינו קיים במערכת. אנא בדוק את הקישור או פנה לבעל העסק.
        </p>
        <Button onClick={() => router.push("/")} variant="outline">
          חזרה לדף הראשי
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink-900 pb-24 md:pb-12">
      {/* Mobile App Bar / Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-ink-200 px-4 py-2.5">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {business.settings?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.settings.logo_url}
                alt={business.name}
                className="w-10 h-10 rounded-lg object-cover border border-ink-200 flex-shrink-0"
              />
            ) : (
              <div
                aria-hidden="true"
                className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-lime text-lg font-extrabold flex-shrink-0"
              >
                {business.name.trim().charAt(0)}
              </div>
            )}
            <div className="text-right">
              <h1 className="font-bold text-base text-slate-900 leading-tight">
                {business.name}
              </h1>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="inline-block w-2 h-2 rounded-full bg-success-500" />
                <span>פתוח להזמנת תורים</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`https://wa.me/${toInternationalPhone(
                business.settings?.whatsapp_phone || business.owner_phone
              )}?text=${encodeURIComponent(`שלום ${business.name}, אשמח לקבל מידע / לקבוע תור`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="m-key2 w-11 h-11 rounded-lg border border-ink-200 bg-white flex items-center justify-center text-success-700"
              title="שלח וואטסאפ לעסק"
              aria-label="שלח וואטסאפ לעסק"
            >
              <MessageCircle className="w-5 h-5" />
            </a>
            <a
              href={`tel:${business.owner_phone}`}
              className="m-key2 w-11 h-11 rounded-lg border border-ink-200 bg-white flex items-center justify-center text-ink-700"
              title="חייג לעסק"
              aria-label="חייג לעסק"
            >
              <Phone className="w-5 h-5" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Container - Mobile First Max Width */}
      <main className="max-w-md mx-auto px-4 pt-5 pb-36">
        {/* Progress Tracker (Steps 1, 2, 3) */}
        {step < 5 && (
          <div className="mb-6">
            <ol className="grid grid-cols-4 gap-1.5 text-xs font-semibold text-ink-500" aria-label={`שלב ${step} מתוך 4`}>
              {["שירות", "תאריך", "שעה", "פרטים"].map((label, i) => (
                <li key={label} className="flex flex-col gap-1.5" aria-current={step === i + 1 ? "step" : undefined}>
                  <span
                    className={cn(
                      "h-1 rounded-full transition-colors duration-300",
                      step > i ? "bg-brand-600" : "bg-ink-200"
                    )}
                  />
                  <span className={cn(step === i + 1 && "text-brand-600 font-bold", step > i + 1 && "text-ink-700")}>
                    {i + 1}. {label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 1: SELECT SERVICE */}
        {/* ========================================================================= */}
        {step === 1 && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Business Cover Photo - perfectly sized to match service card width */}
            {business.settings?.cover_image_url && (
              <div className="relative w-full h-44 sm:h-48 rounded-2xl overflow-hidden shadow-sm border border-slate-200/90 bg-slate-100 group mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={business.settings.cover_image_url}
                  alt={business.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent pointer-events-none" />
              </div>
            )}

            <div className="text-right mb-2">
              <h2 className="text-xl font-extrabold text-slate-900">בחר שירות</h2>
              <p className="text-sm text-slate-500">בחר את סוג הטיפול או השירות המבוקש</p>
            </div>

            <div className="space-y-3">
              {services.map((service) => {
                const isSelected = selectedService?.id === service.id;
                return (
                  <button
                    type="button"
                    key={service.id}
                    aria-pressed={isSelected}
                    onClick={() => {
                      triggerHaptic(20);
                      setSelectedService(service);
                    }}
                    className={cn(
                      "m-press w-full p-4 rounded-xl border text-right flex items-center justify-between",
                      isSelected
                        ? "border-brand-600 bg-brand-50/60 ring-1 ring-brand-600"
                        : "border-ink-200 bg-white hover:border-ink-300"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "w-5 h-5 rounded-full border flex items-center justify-center transition-colors flex-none",
                          isSelected ? "m-chip border-brand-600 bg-brand-600" : "border-ink-300 bg-white"
                        )}
                        data-on={isSelected}
                      >
                        {isSelected && <span className="w-2 h-2 rounded-full bg-lime" />}
                      </span>

                      <div className="text-right">
                        <h3 className="font-bold text-base text-slate-900 leading-snug">
                          {service.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {service.duration_minutes} דקות
                          </span>
                          {service.buffer_minutes > 0 && (
                            <span className="text-slate-400">
                              (+{service.buffer_minutes} מנוחה)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-left">
                      <span className="text-lg font-extrabold text-ink-900">
                        ₪{service.price}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <StickyFooter>
              <div className="flex-1 text-right min-w-0">
                <span className="text-xs text-ink-500">שירות נבחר</span>
                <p className="text-sm font-bold text-ink-900 truncate">
                  {selectedService?.name || "בחר שירות"}
                </p>
              </div>
              <Button
                size="lg"
                onClick={() => {
                  if (selectedService) setStep(2);
                }}
                disabled={!selectedService}
                className="px-5 whitespace-nowrap flex-none"
              >
                <span>המשך לבחירת יום</span>
                <ChevronLeft className="w-4 h-4 mr-1" />
              </Button>
            </StickyFooter>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 2: SELECT DATE & TIME SLOT */}
        {/* ========================================================================= */}
        {step === 2 && (
          <div className="space-y-5 pb-36 animate-in fade-in duration-200">
            <div className="flex">
              <Badge variant="default">{selectedService?.name}</Badge>
            </div>

            <div className="text-right">
              <h2 className="text-xl font-extrabold text-slate-900">באיזה יום תרצה להגיע?</h2>
              <p className="text-sm text-slate-500">
                לחץ על היום הרצוי בלוח. בשלב הבא תבחר שעה.
              </p>
            </div>

            {/* Full Month Interactive Calendar Card */}
            <Card className="p-4 sm:p-5 space-y-4">
              {/* Month Navigation Header */}
              <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                {/* Previous Month (in RTL, Right arrow goes backward) */}
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  disabled={!canGoPrevMonth}
                  className={cn(
                    "w-11 h-11 rounded-lg flex items-center justify-center border",
                    canGoPrevMonth
                      ? "m-key2 border-ink-200 bg-white text-ink-800"
                      : "border-ink-100 text-ink-300 opacity-40 cursor-not-allowed"
                  )}
                  title="חודש קודם"
                  aria-label="חודש קודם"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                {/* Current Month Title */}
                <div className="flex flex-col items-center justify-center">
                  <div className="flex items-center justify-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-indigo-600" />
                    <span className="text-base sm:text-lg font-extrabold text-slate-900 capitalize">
                      {format(currentMonth, "MMMM yyyy", { locale: he })}
                    </span>
                    {isLoadingMonth && (
                      <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mr-1" />
                    )}
                  </div>
                  {business?.settings?.show_hebrew_dates && (
                    <span className="text-xs font-bold text-indigo-600/90 mt-0.5">
                      {formatJewishDate(currentMonth, true)}
                    </span>
                  )}
                </div>

                {/* Next Month (in RTL, Left arrow goes forward) */}
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="m-key2 w-11 h-11 rounded-lg border border-ink-200 bg-white text-ink-800 flex items-center justify-center"
                  title="חודש הבא"
                  aria-label="חודש הבא"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>

              {/* Weekday Column Headers (RTL: Sunday=א׳ on right, Saturday=ש׳ on left) */}
              <div className="grid grid-cols-7 gap-1 text-center select-none">
                {["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map((dayName, idx) => (
                  <div
                    key={idx}
                    className="text-xs font-bold text-slate-400 py-1"
                  >
                    {dayName}
                  </div>
                ))}
              </div>

              {/* Calendar Days Grid */}
              <div className="grid grid-cols-7 gap-y-2 gap-x-1 sm:gap-x-1.5 text-center items-center">
                {/* Empty cells before day 1 */}
                {Array.from({ length: startDayOfWeek }).map((_, i) => (
                  <div key={`empty-pad-${i}`} className="h-12" />
                ))}

                {/* Days in Month */}
                {monthDays.map((day, idx) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const dayNum = format(day, "d");
                  const isSelected = isSameDay(day, selectedDate);
                  const isPastDate = isBefore(day, startOfToday());
                  const dayAvail = monthAvailability[dateStr];
                  const holiday = business?.settings?.show_hebrew_dates ? getJewishHolidayOrShabbat(day) : null;
                  
                  // Has available slots check
                  const hasSlots = dayAvail ? dayAvail.hasSlots : false;
                  const isFullDay = !!dayAvail && dayAvail.isOpen && !dayAvail.hasSlots;
                  const canSelect =
                    !isPastDate &&
                    (hasSlots || (isFullDay && business?.settings?.waiting_list_enabled !== false));

                  if (canSelect) {
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectDate(day)}
                        aria-pressed={isSelected}
                        className={cn(
                          "m-chip m-press relative w-10 h-12 sm:w-11 mx-auto rounded-md flex flex-col items-center justify-center group",
                          isSelected
                            ? "bg-brand-600 text-white font-extrabold"
                            : "bg-white text-ink-900 font-bold border border-ink-200 hover:border-brand-400",
                          !isSelected && isToday(day) && "ring-2 ring-lime-edge ring-offset-1 ring-offset-white"
                        )}
                        title={`תאריך ${formatHebrewDate(day)}${business?.settings?.show_hebrew_dates ? ` (${formatJewishDate(day)}${holiday ? ` - ${holiday}` : ""})` : ""} - לחץ לבחירת שעה`}
                      >
                        <span className="text-xs sm:text-sm leading-none font-bold">
                          {dayNum}
                        </span>
                        {business?.settings?.show_hebrew_dates && (
                          <span
                            className={cn(
                              "text-[9px] sm:text-[10px] leading-tight font-bold truncate max-w-[38px] mt-0.5",
                              isSelected ? "text-brand-100" : holiday ? "text-pending-700" : "text-ink-500"
                            )}
                          >
                            {getHebrewDayLetter(day)}
                          </span>
                        )}
                        {/* Indicator: holiday dot or slot dot */}
                        {isFullDay ? (
                          <span className="text-[9px] font-extrabold text-amber-600 leading-none mt-0.5">מלא</span>
                        ) : holiday ? (
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full mt-0.5",
                              isSelected ? "bg-amber-300" : "bg-amber-500"
                            )}
                            title={holiday}
                          />
                        ) : (
                          <span
                            className={cn(
                              "w-1 h-1 rounded-full mt-0.5 transition-colors",
                              isSelected ? "bg-lime" : "bg-success-500"
                            )}
                          />
                        )}
                      </button>
                    );
                  }

                  // Non-selectable day (Past, Closed on working hours, Holiday override, or 0 free slots)
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled
                      aria-disabled="true"
                      className="w-10 h-12 sm:w-11 mx-auto rounded-md flex flex-col items-center justify-center text-xs sm:text-sm text-ink-400 bg-transparent cursor-not-allowed opacity-50 select-none pointer-events-none"
                      title={holiday ? `${formatHebrewDate(day)} - ${holiday}` : "אין תורים זמינים בתאריך זה"}
                    >
                      <span className="leading-none">{dayNum}</span>
                      {business?.settings?.show_hebrew_dates && (
                        <span className="text-[9px] sm:text-[10px] leading-tight text-slate-400 font-medium truncate max-w-[38px] mt-0.5">
                          {getHebrewDayLetter(day)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center gap-3 sm:gap-4 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500">
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded bg-white border border-ink-300 flex items-center justify-center">
                    <span className="w-1 h-1 rounded-full bg-success-500" />
                  </span>
                  <span>תורים זמינים</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded bg-brand-600" />
                  <span className="font-semibold text-slate-700">יום נבחר</span>
                </div>
                {business?.settings?.show_hebrew_dates && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    </span>
                    <span className="text-amber-900 font-medium">שבת / חג</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded text-ink-400 text-[10px] flex items-center justify-center font-bold">
                    -
                  </span>
                  <span>סגור</span>
                </div>
              </div>
            </Card>

            <StickyFooter>
              <Button variant="outline" size="lg" className="w-full" onClick={() => setStep(1)}>
                <ChevronRight className="w-4 h-4" />
                <span>חזרה לבחירת שירות</span>
              </Button>
            </StickyFooter>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 3: PICK A TIME (own page, with previous / next day arrows) */}
        {/* ========================================================================= */}
        {step === 3 && (
          <div className="space-y-5 pb-32 animate-in fade-in duration-200">
            <div className="flex">
              <Badge variant="default">{selectedService?.name}</Badge>
            </div>

            <div className="text-right">
              <h2 className="text-xl font-extrabold text-slate-900">באיזו שעה?</h2>
              <p className="text-sm text-slate-500">אפשר לעבור ליום אחר בעזרת החצים</p>
            </div>

            {/* Day navigator: big, labelled buttons */}
            {(() => {
              const prevDay = findNeighborDay(-1);
              const nextDay = findNeighborDay(1);
              return (
                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                  <button
                    type="button"
                    disabled={!prevDay}
                    onClick={() => prevDay && handleSelectDate(prevDay, false)}
                    className={cn(
                      "rounded-xl border px-2 py-3 flex flex-col items-center justify-center gap-0.5 text-sm font-bold",
                      prevDay
                        ? "m-key2 border-ink-200 bg-white text-ink-800"
                        : "border-ink-100 bg-paper text-ink-300 cursor-not-allowed"
                    )}
                    aria-label="היום הקודם"
                  >
                    <ChevronRight className="w-6 h-6" />
                    <span className="text-xs">היום הקודם</span>
                  </button>

                  <div key={format(selectedDate, "yyyy-MM-dd")} className="m-chip rounded-xl bg-brand-600 text-white px-4 py-3 text-center min-w-[120px] flex flex-col justify-center" data-on="true">
                    <span className="text-xs font-semibold text-brand-100">
                      {format(selectedDate, "EEEE", { locale: he })}
                    </span>
                    <span className="text-lg font-extrabold leading-tight">
                      {format(selectedDate, "d בMMMM", { locale: he })}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={!nextDay}
                    onClick={() => nextDay && handleSelectDate(nextDay, false)}
                    className={cn(
                      "rounded-xl border px-2 py-3 flex flex-col items-center justify-center gap-0.5 text-sm font-bold",
                      nextDay
                        ? "m-key2 border-ink-200 bg-white text-ink-800"
                        : "border-ink-100 bg-paper text-ink-300 cursor-not-allowed"
                    )}
                    aria-label="היום הבא"
                  >
                    <ChevronLeft className="w-6 h-6" />
                    <span className="text-xs">היום הבא</span>
                  </button>
                </div>
              );
            })()}

            {/* Selected Date Header */}
            <div className="bg-white border border-ink-200 rounded-xl px-4 py-3 text-center text-sm font-semibold text-ink-800 flex flex-col items-center justify-center gap-1.5">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                <span>שעות פנויות ל{formatHebrewDate(selectedDate)}:</span>
              </div>
              {business?.settings?.show_hebrew_dates && (
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-bold mt-0.5">
                  <span className="text-indigo-800">
                    תאריך עברי: {formatJewishDate(selectedDate, true)}
                  </span>
                  {getJewishHolidayOrShabbat(selectedDate) && (
                    <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full text-xs font-extrabold shadow-2xs flex items-center gap-1">
                      <span>{getJewishHolidayOrShabbat(selectedDate)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Slots Section */}
            {isLoadingSlots ? (
              <div className="py-12 text-center">
                <div className="m-spin m-spin-dark mx-auto mb-3" style={{ width: 28, height: 28 }} />
                <p className="text-xs text-slate-500">בודק זמינות תורים...</p>
              </div>
            ) : slots.length === 0 ? (
              <div className="py-10 px-4 rounded-xl border border-dashed border-ink-300 text-center bg-white">
                <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <h4 className="font-bold text-slate-800 mb-1">
                  {slotMessage || "אין שעות פנויות ביום זה"}
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  השתמש בחצים שלמעלה כדי לעבור ליום אחר
                </p>

                {business.settings?.waiting_list_enabled !== false &&
                  (monthAvailability[format(selectedDate, "yyyy-MM-dd")]?.isOpen ?? false) && (
                    <div className="mt-4 text-right">
                      {!waitOpen ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setWaitMsg(null);
                            setWaitOpen(true);
                          }}
                        >
                          הצטרף לרשימת המתנה ליום זה
                        </Button>
                      ) : (
                        <form onSubmit={handleJoinWaitlist} className="space-y-3 bg-slate-50 rounded-2xl border border-slate-200 p-3">
                          <p className="text-xs text-slate-600">
                            נעדכן את בית העסק, ואם יתפנה תור ביום הזה הוא ייצור איתך קשר.
                          </p>
                          <Input
                            label="מספר טלפון נייד *"
                            type="tel"
                            dir="ltr"
                            className="text-right"
                            value={phone}
                            onChange={handlePhoneChange}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input label="שם פרטי *" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                            <Input label="שם משפחה *" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                          </div>
                          {waitMsg && (
                            <p className={`text-xs font-bold ${waitMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
                              {waitMsg.text}
                            </p>
                          )}
                          <Button type="submit" className="w-full" disabled={waitBusy || waitMsg?.ok === true}>
                            {waitBusy ? "מוסיף..." : "הוסף אותי לרשימה"}
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
              </div>
            ) : (
              (() => {
                const counts = Object.fromEntries(
                  DAY_PARTS.map((p) => [p.id, slots.filter((sl) => sl.period === p.id).length])
                ) as Record<TimeSlot["period"], number>;
                const open = DAY_PARTS.filter((p) => counts[p.id] > 0);
                // Keep the customer's tab while they move between days; open the only one when there is just one.
                const active =
                  slotPeriod && counts[slotPeriod] > 0
                    ? slotPeriod
                    : open.length === 1
                      ? open[0].id
                      : null;

                return (
                  <div className="space-y-4">
                    <div role="tablist" aria-label="חלק ביום" className="grid grid-cols-3 gap-2">
                      {DAY_PARTS.map((part) => {
                        const count = counts[part.id];
                        const on = active === part.id;
                        return (
                          <button
                            key={part.id}
                            type="button"
                            role="tab"
                            id={`part-${part.id}`}
                            aria-selected={on}
                            aria-controls="day-part-times"
                            disabled={count === 0}
                            data-on={on || undefined}
                            onClick={() => {
                              triggerHaptic(10);
                              setSlotPeriod(part.id);
                            }}
                            className={cn(
                              "m-chip rounded-xl border px-2 py-3 flex flex-col items-center justify-center gap-0.5",
                              on
                                ? "bg-brand-600 border-brand-600 text-white"
                                : count === 0
                                  ? "bg-paper border-ink-100 text-ink-300 cursor-not-allowed"
                                  : "m-key2 bg-white border-ink-200 text-ink-900"
                            )}
                          >
                            <span className="text-base font-extrabold leading-tight">{part.label}</span>
                            <span className={cn("text-xs font-semibold", on ? "text-brand-100" : "text-ink-500")}>
                              {part.hours}
                            </span>
                            <span className={cn("text-xs font-bold", on ? "text-lime" : count === 0 ? "text-ink-300" : "text-brand-600")}>
                              {count === 0 ? "אין פנויות" : count === 1 ? "אחת פנויה" : `${count} פנויות`}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {active ? (
                      <div
                        key={`${format(selectedDate, "yyyy-MM-dd")}-${active}`}
                        id="day-part-times"
                        role="tabpanel"
                        aria-labelledby={`part-${active}`}
                        className="grid grid-cols-4 gap-2 animate-in fade-in"
                      >
                        {slots
                          .filter((sl) => sl.period === active)
                          .map((slot) => {
                            const picked = selectedSlot?.startTime === slot.startTime;
                            return (
                              <button
                                key={slot.startTime}
                                type="button"
                                aria-pressed={picked}
                                onClick={() => {
                                  triggerHaptic(15);
                                  setSelectedSlot(slot);
                                  // A short beat so the chosen time visibly pops, then straight to the details page
                                  if (advanceTimer.current) clearTimeout(advanceTimer.current);
                                  advanceTimer.current = setTimeout(() => setStep(4), 220);
                                }}
                                className={cn(
                                  "m-chip m-press h-12 rounded-md text-[15px] font-bold border flex items-center justify-center",
                                  picked
                                    ? "bg-brand-600 text-white border-brand-600"
                                    : "bg-white text-ink-900 border-ink-200 hover:border-brand-400"
                                )}
                              >
                                {slot.formattedTime}
                              </button>
                            );
                          })}
                      </div>
                    ) : (
                      <p className="py-6 text-center text-sm font-semibold text-ink-500">
                        בחרו בוקר, צהריים או ערב כדי לראות את השעות הפנויות
                      </p>
                    )}
                  </div>
                );
              })()
            )}

            <StickyFooter>
              <Button variant="outline" size="lg" className="w-full" onClick={() => setStep(2)}>
                <ChevronRight className="w-4 h-4" />
                <span>חזרה ללוח השנה</span>
              </Button>
            </StickyFooter>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 3: FRICTIONLESS CLIENT DETAILS */}
        {/* ========================================================================= */}
        {step === 4 && (
          <div className="space-y-5 pb-32 animate-in fade-in duration-200">
            <div className="flex">
              <Badge variant="success">
                {selectedSlot?.formattedTime} | {formatShortDate(selectedDate)}
              </Badge>
            </div>

            <div className="text-right">
              <h2 className="text-xl font-extrabold text-slate-900">פרטים אישיים ואישור</h2>
              <p className="text-sm text-slate-500">
                הזמן בקלות כאורח או התחבר עם חשבון Google (ללא סיסמה)
              </p>
            </div>

            {/* Client Fast Auth Choice: Google vs Guest (Strictly NO Passwords for Clients) */}
            <div className="p-3.5 rounded-xl bg-white border border-ink-200 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700">בחר אופן הזמנה:</span>
                <span className="text-[11px] font-bold text-success-700 bg-success-100 px-2 py-0.5 rounded">
                  ללא סיסמה • מהיר ומאובטח
                </span>
              </div>

              {!isGoogleClient ? (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={handleGoogleSignIn}
                  disabled={isGoogleLoading}
                  className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 border-slate-300 text-slate-800 font-bold shadow-xs py-2.5"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  <span>{isGoogleLoading ? "מתחבר..." : "התחבר עם Google (שמירת פרטים להזמנות הבאות)"}</span>
                </Button>
              ) : (
                <div className="p-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200 flex items-center justify-between text-right">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-emerald-950 block">מחובר באמצעות Google</span>
                      <span className="text-[11px] text-emerald-700 font-mono dir-ltr block">{clientEmail}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleGuestContinue}
                    className="text-xs text-slate-500 hover:text-slate-800 underline font-medium"
                  >
                    המשך כאורח
                  </button>
                </div>
              )}
            </div>

            {/* Returning Client Banner */}
            {isReturningClient && (
              <div className="m-toast p-3.5 rounded-xl bg-lime-soft border border-lime-edge flex items-center gap-3 text-right">
                <div className="w-8 h-8 rounded-lg bg-brand-600 text-lime flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-ink-900">
                    שמחים לראות אותך שוב, {firstName}
                  </h4>
                  <p className="text-xs text-ink-700">
                    זיהינו אותך במערכת והפרטים שלך מולאו אוטומטית.
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleBookingSubmit} className="space-y-4">
              {/* Phone Input with Auto-completion indicator & Live 10-digit verification */}
              <div className="relative">
                <Input
                  label="מספר טלפון נייד (10 ספרות) *"
                  type="tel"
                  maxLength={12}
                  placeholder="050-1234567"
                  dir="ltr"
                  className="text-right font-semibold text-lg"
                  value={phone}
                  onChange={handlePhoneChange}
                  error={formErrors.phone}
                  helperText={
                    formErrors.phone
                      ? undefined
                      : phone.replace(/\D/g, "").length === 10
                      ? "✓ מספר טלפון תקין (10 ספרות)"
                      : phone.replace(/\D/g, "").length > 0
                      ? `יש להזין בדיוק 10 ספרות (${phone.replace(/\D/g, "").length}/10)`
                      : "הזן 10 ספרות לקבלת אישור ותזכורת בוואטסאפ"
                  }
                />
                {isClientLookupLoading && (
                  <div className="absolute left-3 top-10">
                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {!isClientLookupLoading && phone.replace(/\D/g, "").length === 10 && (
                  <div className="absolute left-3 top-10 text-emerald-600 animate-in fade-in zoom-in-75 duration-200">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                )}
              </div>

              {/* First & Last Name */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="שם פרטי *"
                  placeholder="ישראל"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  error={formErrors.firstName}
                />
                <Input
                  label="שם משפחה *"
                  placeholder="ישראלי"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  error={formErrors.lastName}
                />
              </div>

              {/* Optional Email */}
              <Input
                label="כתובת אימייל (אופציונלי)"
                type="email"
                placeholder="client@example.com"
                dir="ltr"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                helperText="לשליחת אישור זימון תור וזימון יומן למייל"
              />

              {/* Optional Notes */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1 text-right">
                  הערות לטיפול (אופציונלי)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="בקשות מיוחדות, דגשים..."
                  className="w-full rounded-lg border border-ink-200 bg-white p-3 text-base focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 outline-none transition-colors"
                />
              </div>

              {/* LocalStorage "Remember Me" Checkbox */}
              <label className="flex items-center gap-2.5 cursor-pointer select-none text-right py-1">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-5 h-5 rounded accent-brand-600 border-ink-300"
                />
                <span className="text-xs font-medium text-slate-600">
                  שמור את הפרטים שלי לפעם הבאה
                </span>
              </label>

              {/* Booking Summary Box */}
              <Card className="m-ticket bg-white p-4 space-y-2 text-right [--notch:#F4F1E8]">
                <span className="text-xs font-bold text-slate-400 block">
                  סיכום ההזמנה:
                </span>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">שירות:</span>
                  <span className="font-bold text-slate-900">{selectedService?.name}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">מועד:</span>
                  <div className="text-left">
                    <span className="font-bold text-slate-900 block">
                      {formatHebrewDate(selectedDate)}
                    </span>
                    {business?.settings?.show_hebrew_dates && (
                      <span className="text-xs text-indigo-600 font-bold block mt-0.5">
                        {formatJewishDate(selectedDate, true)}
                        {getJewishHolidayOrShabbat(selectedDate) ? ` • ${getJewishHolidayOrShabbat(selectedDate)}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">שעה:</span>
                  <span className="font-bold text-indigo-600 text-base">
                    {selectedSlot?.formattedTime}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm border-t border-slate-200/80 pt-2 mt-2">
                  <span className="text-slate-700 font-medium">לתשלום במקום:</span>
                  <span className="text-lg font-extrabold text-slate-900">
                    ₪{selectedService?.price}
                  </span>
                </div>
              </Card>

              <StickyFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => setStep(3)}
                  disabled={isSubmitting}
                  aria-label="חזרה לבחירת שעה"
                  className="flex-none px-4"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>חזרה</span>
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  isLoading={isSubmitting}
                  className="flex-1 min-w-0"
                >
                  {!isSubmitting && <CheckCircle2 className="w-5 h-5" />}
                  <span>{isSubmitting ? "שומרים לך את התור" : "אישור וקביעת התור"}</span>
                </Button>
              </StickyFooter>
            </form>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 4: SUCCESS STATE */}
        {/* ========================================================================= */}
        {step === 5 && confirmedAppointment && (
          <div className="space-y-6 text-center animate-in zoom-in-95 duration-300 py-4">
            {/* Success Icon Badge */}
            <div className="w-16 h-16 rounded-xl bg-lime text-lime-ink mx-auto flex items-center justify-center m-chip" data-on="true">
              <svg className="m-draw w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>

            <div>
              <h2 className="text-2xl font-extrabold text-ink-900">התור נקבע</h2>
              <p className="text-sm text-slate-500 mt-1">
                נשלח אליך אישור ותזכורת לפני מועד התור
              </p>
            </div>

            {/* Appointment Ticket Card */}
            <Card className="m-print m-ticket text-right p-5 space-y-3.5 [--notch:#F4F1E8]">
              <div className="border-b border-dashed border-ink-300 pb-3">
                <span className="text-xs text-ink-600 font-semibold block">
                  {business.name}
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {confirmedAppointment.service?.name || selectedService?.name}
                </h3>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">תאריך:</span>
                  <span className="font-bold text-slate-900">
                    {formatHebrewDate(confirmedAppointment.start_time)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">שעה:</span>
                  <span className="font-extrabold text-ink-900 text-lg bg-lime px-2 rounded">
                    {format(new Date(confirmedAppointment.start_time), "HH:mm")}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">עבור:</span>
                  <span className="font-bold text-slate-900">
                    {confirmedAppointment.client?.first_name || firstName}{" "}
                    {confirmedAppointment.client?.last_name || lastName}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">מחיר לתשלום במקום:</span>
                  <span className="font-bold text-slate-900">
                    ₪{confirmedAppointment.service?.price || selectedService?.price}
                  </span>
                </div>
              </div>
            </Card>

            {/* Custom Post-Booking Instructions / Arrival Guidelines from Owner */}
            {business?.settings?.post_booking_message && (
              <Card className="p-4 bg-pending-50 border-pending-200 text-right space-y-1.5">
                <div className="flex items-center gap-2 text-pending-800 font-bold text-sm">
                  <AlertCircle className="w-4 h-4 text-pending-600 flex-shrink-0" />
                  <span>כדאי לדעת לפני שמגיעים</span>
                </div>
                <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-line pr-1">
                  {business.settings.post_booking_message}
                </p>
              </Card>
            )}

            {/* Instant Digital Payment Options (Bit & PayBox) */}
            {(business?.settings?.bit_payment_url || business?.settings?.paybox_payment_url) && (
              <Card className="p-4 text-right space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-extrabold text-ink-900">
                      תשלום מהיר בנייד (Bit / PayBox)
                    </span>
                  </div>
                  <span className="text-xs font-bold text-ink-900 bg-ink-100 px-2 py-0.5 rounded">
                    ₪{confirmedAppointment.service?.price || selectedService?.price}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  באפשרותך להעביר תשלום ישירות לחשבון בית העסק כעת בלחיצה אחת:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {business?.settings?.bit_payment_url && (
                    <a
                      href={business.settings.bit_payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="m-key flex items-center justify-center gap-2 h-12 rounded-lg bg-[#002d72] text-white font-bold text-sm"
                    >
                      <span>תשלום ב-Bit</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                    </a>
                  )}
                  {business?.settings?.paybox_payment_url && (
                    <a
                      href={business.settings.paybox_payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="m-key flex items-center justify-center gap-2 h-12 rounded-lg bg-[#008de4] text-white font-bold text-sm"
                    >
                      <span>תשלום ב-PayBox</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                    </a>
                  )}
                </div>
              </Card>
            )}

            {/* Action Buttons: Add to Google Calendar & Apple/ICS & WhatsApp */}
            <div className="space-y-2.5">
              <a
                href={generateGoogleCalendarUrl({
                  title: `תור ל${confirmedAppointment.service?.name || selectedService?.name} ב${business.name}`,
                  description: `נקבע תור דרך המערכת עבור ${firstName} ${lastName}`,
                  startTime: confirmedAppointment.start_time,
                  endTime: confirmedAppointment.end_time,
                  location: business.name,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="m-key w-full flex items-center justify-center gap-2 h-[52px] rounded-lg bg-brand-600 text-white font-bold"
              >
                <CalendarPlus className="w-5 h-5 text-lime" />
                <span>הוסף ליומן Google</span>
              </a>

              <a
                href={generateIcsDataUrl({
                  title: `תור ל${confirmedAppointment.service?.name || selectedService?.name} ב${business.name}`,
                  description: `נקבע תור דרך המערכת עבור ${firstName} ${lastName}`,
                  startTime: confirmedAppointment.start_time,
                  endTime: confirmedAppointment.end_time,
                  location: business.name,
                })}
                download="appointment.ics"
                className="m-key2 w-full flex items-center justify-center gap-2 h-12 rounded-lg border border-ink-200 bg-white text-ink-900 font-semibold text-sm"
              >
                <CalendarIcon className="w-4 h-4 text-ink-600" />
                <span>הוספה ליומן של אייפון או Outlook</span>
              </a>

              {/* Direct WhatsApp Chat with Business Owner */}
              {(business?.settings?.whatsapp_phone || business?.owner_phone) && (
                <a
                  href={`https://wa.me/${toInternationalPhone(
                    business.settings?.whatsapp_phone || business.owner_phone
                  )}?text=${encodeURIComponent(
                    `היי, קבעתי תור ל${
                      confirmedAppointment.service?.name || selectedService?.name
                    } ב-${formatHebrewDate(confirmedAppointment.start_time)} בשעה ${format(
                      new Date(confirmedAppointment.start_time),
                      "HH:mm"
                    )} עבור ${firstName} ${lastName}. יש לי שאלה לגבי התור:`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="m-key2 w-full flex items-center justify-center gap-2 h-12 rounded-lg border border-ink-200 bg-white text-success-700 font-semibold text-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>שאלה על התור? וואטסאפ לעסק</span>
                </a>
              )}
            </div>

            {/* Unique Cancellation Link as Required */}
            <div className="pt-4 border-t border-slate-200 text-right">
              <span className="text-xs text-slate-500 block mb-1">
                רוצה לבטל או לשנות את מועד התור?
              </span>
              <a
                href={`/cancel/${confirmedAppointment.id}`}
                className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-bold text-danger-600 underline"
              >
                <span>קישור ישיר לביטול התור</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Book Another Appointment */}
            <div className="pt-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setStep(1);
                  setSelectedSlot(null);
                  setConfirmedAppointment(null);
                }}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                קבע תור נוסף
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
