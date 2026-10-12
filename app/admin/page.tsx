"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Clock,
  Phone,
  MessageCircle,
  Plus,
  Ban,
  XCircle,
  ChevronRight,
  ChevronLeft,
  CalendarDays,
  Trash2,
  Send,
  RefreshCw,
  Sparkles,
  AlertCircle,
  CalendarX,
  Palmtree,
  KeyRound,
  Check,
  History,
  Dices,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  X,
} from "lucide-react";
import {
  Business,
  Service,
  Appointment,
  DayOfWeek,
  DateOverride,
  Employee,
  Product,
  MarketingMessage,
  Client,
  WorkingHours,
  DayHours,
} from "@/lib/types";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  formatHebrewDate,
  countAppointments,
  formatTime,
  formatPhone,
  toInternationalPhone,
  triggerHaptic,
  cn,
  validatePassword,
  validatePhoneNumber,
  formatJewishDate,
  getJewishHolidayOrShabbat,
  generateRandomSlug,
  isBlockedTime,
} from "@/lib/utils";
import { supabase } from "@/lib/db/supabase";
import {
  addDays,
  subDays,
  eachDayOfInterval,
  startOfWeek,
  format,
  isSameDay,
  isBefore,
  startOfToday,
  parseISO,
} from "date-fns";
import { he } from "date-fns/locale";
import { AdminTopBar, AdminTab, HIDDEN_TABS } from "@/components/admin/AdminTopBar";
import { NextUpTicket } from "@/components/admin/NextUpTicket";
import { Logo } from "@/components/brand/Logo";
import { AdminFAB } from "@/components/admin/AdminFAB";
import { CustomersSection } from "@/components/admin/CustomersSection";
import { StatsSection } from "@/components/admin/StatsSection";
import { EmployeesSection, TeamMember } from "@/components/admin/EmployeesSection";
import { WaitlistPanel } from "@/components/admin/WaitlistPanel";
import { MonthTable } from "@/components/admin/MonthTable";
import { ProductsSection } from "@/components/admin/ProductsSection";
import { MarketingSection } from "@/components/admin/MarketingSection";
import { CashRegisterSection } from "@/components/admin/CashRegisterSection";
import { WorkScheduleSection } from "@/components/admin/WorkScheduleSection";
import { ServicesSection } from "@/components/admin/ServicesSection";
import { alertDialog, confirmDialog } from "@/lib/dialogs";
import { SettingsSection } from "@/components/admin/SettingsSection";
import {
  DEFAULT_EMPLOYEES,
  DEFAULT_PRODUCTS,
  DEFAULT_MARKETING_MESSAGES,
} from "@/lib/mock-saas";

const ADMIN_SESSION_KEY = "schedule_active_business_slug_v2";

/**
 * Pleasant Web Audio API double-tone notification chime for new bookings
 */
function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Harmonic Tone 1 (D5 ~587Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Harmonic Tone 2 (A5 ~880Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.22, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);
  } catch (e) {
    console.log("Audio chime error:", e);
  }
}

export default function AdminDashboardPage() {
  // Businesses & active business
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Sound & Live New Booking Notification
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("torli_admin_sound") !== "false";
  });
  const [newBookingBanner, setNewBookingBanner] = useState<{
    id: string;
    clientName: string;
    serviceName: string;
    time: string;
  } | null>(null);

  const knownAppointmentIdsRef = React.useRef<Set<string>>(new Set());
  const isInitialLoadRef = React.useRef(true);

  // Active TopBar Tab (11 core areas)
  const [activeTab, setActiveTab] = useState<AdminTab>("calendar");
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");

  // SaaS domain collections - start empty for new businesses!
  const [employees, setEmployees] = useState<TeamMember[]>([]);
  const [role, setRole] = useState<"owner" | "manager" | "staff">("owner");
  const [staffName, setStaffName] = useState<string | undefined>();

  // forgot-password (email link) UI
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [products, setProducts] = useState<Product[]>(DEFAULT_PRODUCTS.default);
  const [marketingMessages, setMarketingMessages] = useState<MarketingMessage[]>(DEFAULT_MARKETING_MESSAGES);
  const [customClients, setCustomClients] = useState<Client[]>([]);
  const [savedClients, setSavedClients] = useState<Client[]>([]);

  // Onboarding / Setup Wizard state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Unique CRM Clients computed from appointments + custom created clients
  const clients = useMemo(() => {
    const map = new Map<string, Client>();
    savedClients.forEach((c) => map.set(c.id, c));
    appointments.forEach((app) => {
      // blocked time hangs on a placeholder client, not a customer
      if (isBlockedTime(app)) return;
      if (app.client) {
        map.set(app.client.id, app.client);
      } else if (app.client_id) {
        if (!map.has(app.client_id)) {
          map.set(app.client_id, {
            id: app.client_id,
            business_id: selectedBusiness?.id || "",
            first_name: "לקוח",
            last_name: `#${app.client_id.slice(-4)}`,
            phone: "050-0000000",
          });
        }
      }
    });
    customClients.forEach((c) => map.set(c.id, c));
    return Array.from(map.values());
  }, [appointments, customClients, savedClients, selectedBusiness]);

  const loadSavedClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) setSavedClients(await res.json());
    } catch (err) {
      console.error("Failed to load customers:", err);
    }
  }, []);

  useEffect(() => {
    if (selectedBusiness) loadSavedClients();
    else setSavedClients([]);
  }, [selectedBusiness?.id, loadSavedClients]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());

  // Schedule sub-mode: 'day' = detailed day timeline, 'month' = full month calendar & batch closure
  const [scheduleMode, setScheduleMode] = useState<"day" | "month">("day");
  const [ownerMonth, setOwnerMonth] = useState<Date>(startOfToday());

  // Range Closure Modal (Closing week/holiday/vacation at once)
  const [isRangeModalOpen, setIsRangeModalOpen] = useState(false);
  const [rangeStartDate, setRangeStartDate] = useState(format(startOfToday(), "yyyy-MM-dd"));
  const [rangeEndDate, setRangeEndDate] = useState(format(addDays(startOfToday(), 6), "yyyy-MM-dd"));
  const [rangeReason, setRangeReason] = useState("חופשה / שבוע סגור");
  const [isSubmittingRange, setIsSubmittingRange] = useState(false);

  // Day Action Modal (Clicking on a specific day in owner's month view)
  const [dayActionModalDate, setDayActionModalDate] = useState<Date | null>(null);

  // Private SaaS Login & Registration State
  // The landing page's sign-up buttons link to /admin?new=1, which opens on registration.
  // The page shows a loader until the session check ends, so the tab never hydrates.
  const [authTab, setAuthTab] = useState<"login" | "register">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1"
      ? "register"
      : "login"
  );
  // In-app navigation (a <Link> click) renders this page before the address bar updates, so the
  // initializer above can still see the old URL. Re-check once the page is mounted.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setAuthTab("register");
  }, []);
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [googleUser, setGoogleUser] = useState<{
    email: string;
    id: string;
    name?: string;
    accessToken?: string;
  } | null>(null);

  // New Business Registration Form
  const [regName, setRegName] = useState("");
  const [regSlug, setRegSlug] = useState(() => generateRandomSlug(6));
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regInterval, setRegInterval] = useState("15");
  const [regCategory, setRegCategory] = useState<"barber" | "nails" | "therapy" | "general">("barber");
  const [isRegistering, setIsRegistering] = useState(false);
  const [regError, setRegError] = useState("");
  const [isOnboardingHours, setIsOnboardingHours] = useState(false);
  const [isSavingOnboardingHours, setIsSavingOnboardingHours] = useState(false);

  // Real-time password validation for registration
  const passwordValidation = useMemo(() => {
    return validatePassword(regPassword);
  }, [regPassword]);

  // Modals state
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isBlockTimeOpen, setIsBlockTimeOpen] = useState(false);
  const [isReminderRunning, setIsReminderRunning] = useState(false);
  const [reminderResult, setReminderResult] = useState<Record<string, unknown> | null>(null);

  // Quick Add / Walk-in form
  const [walkinServiceId, setWalkinServiceId] = useState("");
  const [walkinFirstName, setWalkinFirstName] = useState("");
  const [walkinLastName, setWalkinLastName] = useState("");
  const [walkinPhone, setWalkinPhone] = useState("");
  const [walkinTime, setWalkinTime] = useState("10:00");
  const [isSubmittingWalkin, setIsSubmittingWalkin] = useState(false);

  // Block Time form
  const [blockReason, setBlockReason] = useState("הפסקת צהריים");
  const [blockStartTime, setBlockStartTime] = useState("13:00");
  const [blockEndTime, setBlockEndTime] = useState("14:00");
  const [isSubmittingBlock, setIsSubmittingBlock] = useState(false);

  // Working hours, Interval, and Overrides editing state
  const [editingWorkingHours, setEditingWorkingHours] = useState<Business["working_hours"] | null>(null);
  const [editingInterval, setEditingInterval] = useState<number>(15);
  const [editingOverrides, setEditingOverrides] = useState<DateOverride[]>([]);

  // Restore saved session on mount
  useEffect(() => {
    const restoreSession = async () => {
      // If user explicitly logged out in this browser session, do not auto-restore!
      if (sessionStorage.getItem("torli_user_logged_out") === "true") {
        setIsLoading(false);
        return;
      }

      
      try {
        const res = await fetch("/api/auth/session?probe=1");
        const sess = res.ok ? await res.json() : null;
        if (sess?.signedIn) {
          const biz = sess.business;
          setRole(sess.role || "owner");
          setStaffName(sess.staff?.name);
          setSelectedBusiness(biz);
          setEditingWorkingHours(biz.working_hours);
          setEditingInterval(biz.slot_interval_minutes || 15);
          setEditingOverrides(biz.date_overrides || []);
        } else {
          localStorage.removeItem(ADMIN_SESSION_KEY);
        }
      } catch (err) {
        console.error("Failed to restore admin session:", err);
      } finally {
        setIsLoading(false);
      }
    };
    restoreSession();
  }, []);

  // Listen for Supabase OAuth return (e.g. Google Sign-In)
  useEffect(() => {
    if (!supabase) return;

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // If user explicitly logged out, do NOT auto-login from cached session!
        if (sessionStorage.getItem("torli_user_logged_out") === "true") {
          return;
        }

        if (
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          session?.user?.email &&
          session.user.app_metadata?.provider === "google" &&
          !selectedBusiness
        ) {
          try {
            setIsLoggingIn(true);
            const res = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: "google",
                access_token: session.access_token,
              }),
            });

            const data = await res.json();
            if (res.ok && data.business) {
              setRole(data.role || "owner");
              setSelectedBusiness(data.business);
              setEditingWorkingHours(data.business.working_hours);
              setEditingInterval(data.business.slot_interval_minutes || 15);
              setEditingOverrides(data.business.date_overrides || []);
              localStorage.setItem(ADMIN_SESSION_KEY, data.business.slug);
              triggerHaptic(45);
            } else {
              // User signed in with Google, but hasn't created their business yet!
              const gUser = {
                email: session.user.email,
                id: session.user.id,
                accessToken: session.access_token,
                name:
                  (session.user.user_metadata?.full_name as string) ||
                  (session.user.user_metadata?.name as string) ||
                  "",
              };
              setGoogleUser(gUser);
              setAuthTab("register");
              setRegEmail(session.user.email);
              if (gUser.name) {
                setRegName((prev) => prev || `עסק ${gUser.name}`);
              }
              setRegSlug((prev) => prev || generateRandomSlug(6));
              setLoginError("");
            }
          } catch (e) {
            console.error("Google login check error:", e);
          } finally {
            setIsLoggingIn(false);
          }
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [selectedBusiness]);

  // Handle Private Owner Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    sessionStorage.removeItem("torli_user_logged_out");
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    triggerHaptic(20);

    if (!loginPhone.trim() || !loginPassword.trim()) {
      setLoginError("יש להזין מספר טלפון וסיסמה");
      setIsLoggingIn(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: loginPhone.trim(),
          password: loginPassword.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || "מספר טלפון או סיסמה שגויים");
        setIsLoggingIn(false);
        return;
      }

      // Success
      const biz: Business = data.business;
      setRole((data.role as "owner" | "manager" | "staff") || "owner");
      setStaffName(data.staff?.name);
      setSelectedBusiness(biz);
      setEditingWorkingHours(biz.working_hours);
      setEditingInterval(biz.slot_interval_minutes || 15);
      setEditingOverrides(biz.date_overrides || []);
      localStorage.setItem(ADMIN_SESSION_KEY, biz.slug);
      triggerHaptic(40);
    } catch (err) {
      console.error(err);
      setLoginError("שגיאת תקשורת");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Google Sign-in for Business Owner
  const handleGoogleOwnerLogin = async () => {
    sessionStorage.removeItem("torli_user_logged_out");
    setLoginError("");
    setIsLoggingIn(true);
    triggerHaptic(20);

    try {
      if (!supabase) {
        setLoginError("חיבור Supabase אינו מוגדר בסביבה זו.");
        setIsLoggingIn(false);
        return;
      }

      const redirectUrl = typeof window !== "undefined" ? `${window.location.origin}/admin` : undefined;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        if (
          error.message?.toLowerCase().includes("not enabled") ||
          error.message?.toLowerCase().includes("unsupported") ||
          error.message?.toLowerCase().includes("disabled")
        ) {
          setLoginError(
            "ספק Google טרם הופעל בלוח הבקרה של Supabase. יש להפעיל את Google ב-Authentication -> Providers (הסבר מלא זמין במדריך)."
          );
        } else {
          setLoginError(error.message || "שגיאה בהתחברות עם Google");
        }
        setIsLoggingIn(false);
      }
    } catch (err) {
      console.error(err);
      setLoginError("שגיאת תקשורת בהתחברות Google");
      setIsLoggingIn(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    sessionStorage.setItem("torli_user_logged_out", "true");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(ADMIN_SESSION_KEY);
    setLoginPassword("");
    setGoogleUser(null);
    setSelectedBusiness(null);
    triggerHaptic(25);
  };

  // Permanent Delete Business
  const handleDeleteBusiness = async () => {
    if (!selectedBusiness) return;
    try {
      setIsLoading(true);
      const res = await fetch(`/api/business?id=${selectedBusiness.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        triggerHaptic(50);
        await handleLogout();
        await alertDialog("העסק וכל נתוניו נמחקו לצמיתות מהמערכת.");
      } else {
        const d = await res.json();
        await alertDialog(d.error || "שגיאה במחיקת העסק");
      }
    } catch (err) {
      console.error("Error deleting business:", err);
      await alertDialog("שגיאת תקשורת במחיקת העסק");
    } finally {
      setIsLoading(false);
    }
  };

  // Business name change in registration form
  const handleRegNameChange = (name: string) => {
    setRegName(name);
    if (!regSlug) {
      setRegSlug(generateRandomSlug(6));
    }
  };

  // Handle New Business Registration
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError("");

    if (!regName.trim() || !regSlug.trim() || !regPhone.trim()) {
      setRegError("יש למלא את כל שדות החובה המסומנים בכוכבית (*)");
      return;
    }

    const phoneCheck = validatePhoneNumber(regPhone);
    if (!phoneCheck.isValid) {
      setRegError(phoneCheck.error || "מספר טלפון בעל העסק חייב להכיל בדיוק 10 ספרות");
      return;
    }

    if (!googleUser) {
      if (!regPassword.trim()) {
        setRegError("יש להגדיר סיסמה מאובטחת לבעל העסק");
        return;
      }

      if (!passwordValidation.isValid) {
        setRegError("הסיסמה אינה עומדת בכל 5 כללי האבטחה הנדרשים");
        return;
      }
    }

    setIsRegistering(true);
    try {
      const res = await fetch("/api/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: regName.trim(),
          slug: regSlug.trim(),
          owner_phone: regPhone.trim(),
          owner_email: (googleUser ? googleUser.email : regEmail.trim()) || undefined,
          password: googleUser ? undefined : regPassword.trim(),
          access_token: googleUser ? googleUser.accessToken : undefined,
          slot_interval_minutes: Number(regInterval),
          category: regCategory,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRegError(data.error || "שגיאה ביצירת העסק");
        setIsRegistering(false);
        return;
      }

      const biz: Business = data.business;
      setSelectedBusiness(biz);
      setEditingWorkingHours(biz.working_hours);
      setEditingInterval(biz.slot_interval_minutes || 15);
      setEditingOverrides(biz.date_overrides || []);
      localStorage.setItem(ADMIN_SESSION_KEY, biz.slug);
      setIsOnboardingHours(true);
      triggerHaptic(50);
    } catch (err) {
      console.error(err);
      setRegError("שגיאת תקשורת");
    } finally {
      setIsRegistering(false);
    }
  };

  // Load services & appointments for selected business with polling detection.
  // The full book loads once; a poll re-reads only from yesterday on (new bookings,
  // moves and cancellations all land there) and merges it in.
  const fetchAppointments = useCallback(
    async (isPolling = false) => {
      if (!selectedBusiness) return;
      try {
        const since = isPolling ? Date.now() - 24 * 3600 * 1000 : null;
        const aRes = await fetch(
          `/api/appointments?business_id=${selectedBusiness.id}` +
            (since ? `&start_date=${encodeURIComponent(new Date(since).toISOString())}` : "")
        );
        if (aRes.ok) {
          const aList: Appointment[] = await aRes.json();

          // Detect new appointments during polling
          if (!isInitialLoadRef.current && isPolling) {
            const newAppointments = aList.filter(
              (a) => !knownAppointmentIdsRef.current.has(a.id) && a.status === "confirmed"
            );
            if (newAppointments.length > 0) {
              const latest = newAppointments[newAppointments.length - 1];
              if (soundEnabled) {
                playNotificationChime();
              }
              triggerHaptic(50);
              const clientName =
                `${latest.client?.first_name || ""} ${latest.client?.last_name || ""}`.trim() ||
                "לקוח חדש";
              const serviceName = latest.service?.name || "טיפול";
              setNewBookingBanner({
                id: latest.id,
                clientName,
                serviceName,
                time: formatTime(latest.start_time),
              });
              confetti({ particleCount: 50, spread: 60, origin: { y: 0.2 } });
            }
          }

          // Update known IDs Set
          aList.forEach((a) => knownAppointmentIdsRef.current.add(a.id));
          isInitialLoadRef.current = false;
          setAppointments((prev) =>
            since === null
              ? aList
              : [...prev.filter((a) => new Date(a.start_time).getTime() < since), ...aList]
          );
        } else if (aRes.status === 401) {
          // signed out elsewhere (password changed, account disabled): back to the login screen
          const data: { error?: string } = await aRes.json();
          localStorage.removeItem(ADMIN_SESSION_KEY);
          setLoginError(data.error || "נדרשת התחברות מחדש");
          setSelectedBusiness(null);
          return;
        }
        if (isPolling) return;

        const sRes = await fetch(`/api/services?business_id=${selectedBusiness.id}`);
        if (sRes.ok) {
          const sList = await sRes.json();
          setServices(sList);
          if (sList.length > 0) {
            setWalkinServiceId((prev) => prev || sList[0].id);
          }
        }
      } catch (err) {
        console.error("Error loading appointments:", err);
      }
    },
    [selectedBusiness, soundEnabled]
  );

  useEffect(() => {
    if (selectedBusiness) {
      fetchAppointments(false);
    }
  }, [selectedBusiness, fetchAppointments]);

  // Background polling every 15 seconds to catch new client bookings, only while the
  // screen is in front of the owner; coming back to it refreshes at once.
  useEffect(() => {
    if (!selectedBusiness) return;
    const poll = () => {
      if (document.visibilityState === "visible") fetchAppointments(true);
    };
    const intervalId = setInterval(poll, 15000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [selectedBusiness, fetchAppointments]);

  // Team members come from the server (per business, with roles)
  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/staff");
      if (res.ok) setEmployees(await res.json());
    } catch (err) {
      console.error("Failed to load staff:", err);
    }
  }, []);

  useEffect(() => {
    if (selectedBusiness) loadEmployees();
    else setEmployees([]);
  }, [selectedBusiness?.id, loadEmployees]); // eslint-disable-line react-hooks/exhaustive-deps

  // A role may not sit on a tab it cannot use (e.g. after switching accounts)
  useEffect(() => {
    const allowed =
      role === "staff"
        ? ["calendar", "customers"]
        : role === "manager"
        ? ["calendar", "stats", "customers", "services", "workschedule", "marketing", "cashregister", "settings"]
        : null;
    if ((allowed && !allowed.includes(activeTab)) || HIDDEN_TABS.includes(activeTab)) setActiveTab("calendar");
  }, [role, activeTab]);

  // Appointments for the selected day
  const dailyAppointments = useMemo(() => {
    return appointments.filter((app) => {
      const appDate = parseISO(app.start_time);
      if (!isSameDay(appDate, selectedDate)) return false;
      if (selectedStaffId === "all") return true;
      const isBlock = isBlockedTime(app);
      return isBlock || app.staff_id === selectedStaffId;
    });
  }, [appointments, selectedDate, selectedStaffId]);

  // Daily Stats KPI
  const dailyStats = useMemo(() => {
    // blocked time is the business's own, not a booking: it never counts as one
    const bookings = dailyAppointments.filter((a) => !isBlockedTime(a));
    const confirmed = bookings.filter((a) => a.status === "confirmed");
    const totalIncome = confirmed.reduce(
      (sum, a) => sum + (Number(a.service?.price) || 0),
      0
    );
    return {
      total: bookings.length,
      confirmed: confirmed.length,
      cancelled: bookings.filter((a) => a.status === "cancelled").length,
      revenue: totalIncome,
    };
  }, [dailyAppointments]);

  // Appointments count by date
  const appointmentsCountByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const app of appointments) {
      if (app.status === "confirmed") {
        const d = app.start_time.split("T")[0];
        map[d] = (map[d] || 0) + 1;
      }
    }
    return map;
  }, [appointments]);

  // Check if business works on a given day of the week
  const isBusinessOpenOnDay = useCallback(
    (date: Date) => {
      if (!selectedBusiness) return true;
      const dayIndex = date.getDay();
      const dayNames: DayOfWeek[] = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      const dayName = dayNames[dayIndex];
      const cfg = editingWorkingHours?.[dayName] || selectedBusiness.working_hours[dayName];
      return cfg?.active ?? true;
    },
    [selectedBusiness, editingWorkingHours]
  );

  // Get override for date
  const getOverrideForDate = useCallback(
    (date: Date) => {
      const dStr = format(date, "yyyy-MM-dd");
      return editingOverrides.find((o) => o.date === dStr);
    },
    [editingOverrides]
  );

  // Range Closure Presets
  const applyPresetThisWeek = () => {
    const today = new Date();
    const sunday = startOfWeek(today, { weekStartsOn: 0 });
    const thursday = addDays(sunday, 4);
    setRangeStartDate(format(sunday, "yyyy-MM-dd"));
    setRangeEndDate(format(thursday, "yyyy-MM-dd"));
    setRangeReason("חופשה השבוע");
  };

  const applyPresetNextWeek = () => {
    const today = new Date();
    const nextSunday = addDays(startOfWeek(today, { weekStartsOn: 0 }), 7);
    const nextThursday = addDays(nextSunday, 4);
    setRangeStartDate(format(nextSunday, "yyyy-MM-dd"));
    setRangeEndDate(format(nextThursday, "yyyy-MM-dd"));
    setRangeReason("חופשה שבוע הבא");
  };

  const applyPresetWeekend = () => {
    const today = new Date();
    const sunday = startOfWeek(today, { weekStartsOn: 0 });
    const thursday = addDays(sunday, 4);
    const friday = addDays(sunday, 5);
    setRangeStartDate(format(thursday, "yyyy-MM-dd"));
    setRangeEndDate(format(friday, "yyyy-MM-dd"));
    setRangeReason("חופשת סוף שבוע");
  };

  const applyPresetTwoWeeks = () => {
    const today = new Date();
    setRangeStartDate(format(today, "yyyy-MM-dd"));
    setRangeEndDate(format(addDays(today, 13), "yyyy-MM-dd"));
    setRangeReason("חופשה מרוכזת (שבועיים)");
  };

  // Closing a day does not cancel what is already booked on it, so say so first.
  const confirmCloseDays = async (dayStrs: string[]): Promise<boolean> => {
    const days = new Set(dayStrs);
    const booked = appointments.filter(
      (a) =>
        a.status === "confirmed" &&
        !isBlockedTime(a) &&
        days.has(format(new Date(a.start_time), "yyyy-MM-dd"))
    ).length;
    if (booked === 0) return true;
    return confirmDialog(
      booked === 1
        ? "יש תור אחד בימים שנבחרו. הסגירה לא מבטלת אותו ולא מודיעה ללקוח, כדאי לדבר איתו. לסגור בכל זאת?"
        : `יש ${booked} תורים בימים שנבחרו. הסגירה לא מבטלת אותם ולא מודיעה ללקוחות, כדאי לדבר איתם. לסגור בכל זאת?`,
      { confirmLabel: "לסגור בכל זאת", danger: true }
    );
  };

  // Handle closing or opening a range of dates
  const handleRangeAction = async (action: "close" | "open") => {
    if (!selectedBusiness || !rangeStartDate || !rangeEndDate) return;
    try {
      setIsSubmittingRange(true);
      const start = parseISO(rangeStartDate);
      const end = parseISO(rangeEndDate);
      if (start > end) {
        await alertDialog("תאריך התחלה חייב להיות לפני תאריך סיום");
        return;
      }

      const days = eachDayOfInterval({ start, end });
      let updatedOverrides = [...editingOverrides];
      if (action === "close" && !(await confirmCloseDays(days.map((d) => format(d, "yyyy-MM-dd"))))) return;

      if (action === "close") {
        for (const d of days) {
          const dStr = format(d, "yyyy-MM-dd");
          updatedOverrides = updatedOverrides.filter((o) => o.date !== dStr);
          updatedOverrides.push({
            id: "ov-" + Math.random().toString(36).substring(2, 7),
            date: dStr,
            is_closed: true,
            reason: rangeReason.trim() || "חופשה / שבוע סגור",
          });
        }
      } else {
        const dateStrings = new Set(days.map((d) => format(d, "yyyy-MM-dd")));
        updatedOverrides = updatedOverrides.filter((o) => !dateStrings.has(o.date));
      }

      // Persist to backend
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedBusiness.id,
          date_overrides: updatedOverrides,
        }),
      });

      if (res.ok) {
        const savedBiz: Business = await res.json();
        setSelectedBusiness(savedBiz);
        setEditingOverrides(savedBiz.date_overrides || []);
        setIsRangeModalOpen(false);
        setDayActionModalDate(null);
        triggerHaptic(25);
      }
    } catch (err) {
      console.error("Error updating range overrides:", err);
    } finally {
      setIsSubmittingRange(false);
    }
  };

  // Quick single day or 7-day closure from Day Action Modal
  const handleToggleSingleDay = async (date: Date, daysCount = 1) => {
    if (!selectedBusiness) return;
    const existing = getOverrideForDate(date);
    let updatedOverrides = [...editingOverrides];

    if (existing) {
      // Reopen
      const dStr = format(date, "yyyy-MM-dd");
      updatedOverrides = updatedOverrides.filter((o) => o.date !== dStr);
    } else {
      // Close
      const dayStrs = Array.from({ length: daysCount }, (_, i) => format(addDays(date, i), "yyyy-MM-dd"));
      if (!(await confirmCloseDays(dayStrs))) return;
      for (let i = 0; i < daysCount; i++) {
        const targetD = addDays(date, i);
        const dStr = format(targetD, "yyyy-MM-dd");
        updatedOverrides = updatedOverrides.filter((o) => o.date !== dStr);
        updatedOverrides.push({
          id: "ov-" + Math.random().toString(36).substring(2, 7),
          date: dStr,
          is_closed: true,
          reason: daysCount > 1 ? "שבוע סגור / חופשה" : "חופש / סידורים אישיים",
        });
      }
    }

    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedBusiness.id,
          date_overrides: updatedOverrides,
        }),
      });
      if (res.ok) {
        const savedBiz: Business = await res.json();
        setSelectedBusiness(savedBiz);
        setEditingOverrides(savedBiz.date_overrides || []);
        setDayActionModalDate(null);
        triggerHaptic(20);
      }
    } catch (err) {
      console.error("Error toggling day override:", err);
    }
  };

  // Cancel appointment handler
  const handleCancelAppointment = async (id: string) => {
    const ok = await confirmDialog("האם לבטל את התור? המועד ישתחרר מיד ללקוחות אחרים.", {
      confirmLabel: "כן, לבטל את התור",
      cancelLabel: "לא, להשאיר",
      danger: true,
    });
    if (!ok) return;
    triggerHaptic(25);

    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (res.ok) {
        fetchAppointments();
      }
    } catch (err) {
      console.error("Cancel error:", err);
    }
  };

  // Remove a block of blocked time (customers waiting for that day are flagged by the server)
  const handleRemoveBlock = async (id: string) => {
    triggerHaptic(20);
    try {
      const res = await fetch(`/api/appointments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await alertDialog(data.error || "לא הצלחנו להסיר את החסימה");
        return;
      }
      fetchAppointments();
    } catch (err) {
      console.error("Remove block error:", err);
      await alertDialog("שגיאה ברשת");
    }
  };

  // Quick Add Walk-in submit
  const handleWalkinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBusiness || !walkinServiceId) return;

    setIsSubmittingWalkin(true);
    triggerHaptic(20);

    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const startIso = new Date(`${dateStr}T${walkinTime}:00`).toISOString();

    let finalPhone = "0500000000";
    if (walkinPhone.trim()) {
      const phoneCheck = validatePhoneNumber(walkinPhone);
      if (!phoneCheck.isValid) {
        await alertDialog(phoneCheck.error || "מספר טלפון לקוח לא תקין (חייב להכיל 10 ספרות בדיוק)");
        setIsSubmittingWalkin(false);
        return;
      }
      finalPhone = phoneCheck.cleaned;
    }

    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: selectedBusiness.id,
          service_id: walkinServiceId,
          phone: finalPhone,
          first_name: walkinFirstName.trim() || "לקוח",
          last_name: walkinLastName.trim() || "מזדמן",
          start_time: startIso,
          notes: "נוסף ידנית ע״י בית העסק",
        }),
      });

      if (res.ok) {
        setIsQuickAddOpen(false);
        setWalkinFirstName("");
        setWalkinLastName("");
        setWalkinPhone("");
        fetchAppointments();
      } else {
        const data = await res.json();
        await alertDialog(data.error || "שגיאה בהוספת התור");
      }
    } catch (err) {
      console.error(err);
      await alertDialog("שגיאה ברשת");
    } finally {
      setIsSubmittingWalkin(false);
    }
  };

  // Block Time submit (one-off)
  const handleBlockTimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBusiness) return;

    setIsSubmittingBlock(true);
    triggerHaptic(25);

    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const startIso = new Date(`${dateStr}T${blockStartTime}:00`).toISOString();
    const endIso = new Date(`${dateStr}T${blockEndTime}:00`).toISOString();

    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_block: true,
          business_id: selectedBusiness.id,
          start_time: startIso,
          end_time: endIso,
          reason: blockReason,
        }),
      });

      if (res.ok) {
        setIsBlockTimeOpen(false);
        fetchAppointments();
      } else {
        const data = await res.json();
        await alertDialog(data.error || "שגיאה בחסימת זמן");
      }
    } catch (err) {
      console.error(err);
      await alertDialog("שגיאה ברשת");
    } finally {
      setIsSubmittingBlock(false);
    }
  };

  // Test WhatsApp Reminder Cron Trigger
  const handleTriggerReminderCron = async () => {
    setIsReminderRunning(true);
    setReminderResult(null);
    triggerHaptic(30);

    try {
      const res = await fetch("/api/cron/reminders", { method: "POST" });
      const data = await res.json();
      setReminderResult(data);
      fetchAppointments();
    } catch (err) {
      console.error(err);
      await alertDialog("שגיאה בהפעלת מנגנון התזכורות");
    } finally {
      setIsReminderRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-500">טוען לוח ניהול מאובטח...</p>
      </div>
    );
  }

  // =========================================================================
  // PRIVATE AUTHENTICATION GATEWAY: NO PUBLIC DIRECTORY SHOWN
  // =========================================================================
  if (!selectedBusiness) {
    return (
      <div className="min-h-screen bg-paper flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full space-y-6">
          {/* Brand header */}
          <div className="text-center space-y-3">
            <Logo size={40} className="justify-center" />
            <h1 className="text-2xl font-extrabold text-ink-900">
              {authTab === "register" ? "פתיחת יומן לעסק" : "כניסה לבעלי עסקים"}
            </h1>
            <p className="text-sm text-ink-600 max-w-xs mx-auto">
              {authTab === "register"
                ? "כמה פרטים על העסק, והיומן שלך מוכן לקבל תורים"
                : "היומן, הלקוחות וההגדרות של העסק שלך, במקום אחד"}
            </p>
          </div>

          {/* Tab Switcher: Login / Register */}
          <div role="tablist" className="flex bg-ink-100 border border-ink-200 p-1 rounded-lg">
            <button
              onClick={() => {
                setAuthTab("login");
                setLoginError("");
              }}
              role="tab"
              aria-selected={authTab === "login"}
              className={cn(
                "m-press flex-1 h-11 rounded-md text-sm font-bold",
                authTab === "login"
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-ink-600 hover:text-ink-900"
              )}
            >
              כניסה
            </button>
            <button
              onClick={() => {
                setAuthTab("register");
                setRegError("");
              }}
              role="tab"
              aria-selected={authTab === "register"}
              className={cn(
                "m-press flex-1 h-11 rounded-md text-sm font-bold",
                authTab === "register"
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-ink-600 hover:text-ink-900"
              )}
            >
              עסק חדש
            </button>
          </div>

          {/* TAB 1: PRIVATE LOGIN */}
          {authTab === "login" && (
            <Card className="p-6 space-y-4">
              <div className="text-right">
                <h3 className="font-bold text-sm text-slate-900">
                  הזן פרטי זיהוי לכניסה:
                </h3>
                <p className="text-xs text-slate-500">
                  התחברות באמצעות חשבון Google או מספר טלפון וסיסמה
                </p>
              </div>

              {loginError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 flex items-center gap-2 text-right">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              {/* 1-Tap Google Sign-In for Owner */}
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handleGoogleOwnerLogin}
                isLoading={isLoggingIn}
                className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 border-slate-300 text-slate-700 font-bold shadow-xs py-3"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span>התחבר באמצעות Google</span>
              </Button>

              <div className="relative flex py-1 items-center justify-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-3 text-slate-400 text-xs font-medium">או התחבר עם טלפון וסיסמה</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4 text-right">
                <Input
                  label="מספר טלפון נייד *"
                  type="tel"
                  placeholder="054-1234567"
                  dir="ltr"
                  className="text-right font-medium text-base"
                  value={loginPhone}
                  onChange={(e) => setLoginPhone(e.target.value)}
                  required
                />

                <Input
                  label="סיסמה אישית *"
                  type="password"
                  placeholder="הזן סיסמה מאובטחת"
                  dir="ltr"
                  className="text-right font-medium text-base"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  helperText="הזן את הסיסמה האישית שהוגדרה בעת הרישום"
                  required
                />

                <Button
                  type="submit"
                  size="lg"
                  isLoading={isLoggingIn}
                  className="w-full mt-2 shadow-md shadow-indigo-600/20"
                >
                  <KeyRound className="w-4 h-4 ml-2" />
                  <span>התחבר ליומן שלי</span>
                </Button>
              </form>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgot((v) => !v);
                    setForgotMsg("");
                  }}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline"
                >
                  שכחתי סיסמה
                </button>
              </div>

              {showForgot && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setForgotBusy(true);
                    setForgotMsg("");
                    try {
                      const res = await fetch("/api/auth/forgot", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: forgotEmail }),
                      });
                      const data = await res.json().catch(() => ({}));
                      setForgotMsg(
                        res.ok
                          ? data.message || "אם קיים חשבון עם האימייל הזה, נשלח אליו קישור לאיפוס."
                          : data.error || "שגיאה בשליחה"
                      );
                    } catch {
                      setForgotMsg("שגיאת תקשורת");
                    } finally {
                      setForgotBusy(false);
                    }
                  }}
                  className="space-y-2 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-right"
                >
                  <p className="text-xs text-slate-600">
                    הזן את כתובת האימייל שהגדרת לחשבון העסק. נשלח אליה קישור לאיפוס הסיסמה.
                  </p>
                  <Input
                    label="אימייל החשבון"
                    type="email"
                    dir="ltr"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                  <Button type="submit" className="w-full" disabled={forgotBusy}>
                    {forgotBusy ? "שולח..." : "שלח קישור לאיפוס"}
                  </Button>
                  {forgotMsg && <p className="text-xs font-semibold text-emerald-700">{forgotMsg}</p>}
                </form>
              )}

              {/* Demo credentials: development only, never shown in production */}
              {process.env.NODE_ENV !== "production" && (
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs text-slate-500 space-y-1 text-right">
                <span className="font-bold text-slate-700 block">עסקי הדגמה מוכנים מראש:</span>
                <div>• מספרת דניאל: טלפון <span className="font-mono font-bold text-slate-800">0541234567</span> | סיסמה: <span className="font-mono font-bold text-slate-800">BarberDan2026!</span></div>
                <div>• סטודיו מיה: טלפון <span className="font-mono font-bold text-slate-800">0529876543</span> | סיסמה: <span className="font-mono font-bold text-slate-800">MayaNails2026!</span></div>
                <div>• קליניקת רפאל: טלפון <span className="font-mono font-bold text-slate-800">0505556677</span> | סיסמה: <span className="font-mono font-bold text-slate-800">RafaelClinic2026!</span></div>
              </div>
              )}
            </Card>
          )}

          {/* TAB 2: REGISTER NEW BUSINESS */}
          {authTab === "register" && (
            <Card className="p-6 space-y-4">
              <div className="text-right">
                <h3 className="font-bold text-sm text-slate-900">
                  פתיחת חשבון עסק חדש
                </h3>
                <p className="text-xs text-slate-500">
                  קבל יומן תורים מותאם אישית תוך 30 שניות
                </p>
              </div>

              {regError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 flex items-center gap-2 text-right">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{regError}</span>
                </div>
              )}

              {/* 1-Tap Google Registration / Connected Status */}
              {googleUser ? (
                <div className="p-4 rounded-xl bg-success-50 border border-success-200 text-right space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                        <Check className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-emerald-950 block">מחובר באמצעות Google</span>
                        <span className="text-xs text-emerald-700 font-mono">{googleUser.email}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (supabase) await supabase.auth.signOut();
                        setGoogleUser(null);
                        setLoginError("");
                      }}
                      className="text-xs text-emerald-800 hover:text-emerald-950 font-bold underline px-2 py-1 rounded hover:bg-emerald-100/60 transition-colors"
                    >
                      החלף חשבון
                    </button>
                  </div>
                  <p className="text-xs text-emerald-800 font-medium leading-relaxed">
                    חשבון Google אומת בהצלחה! נשאר רק לתת שם לעסק ומספר טלפון כדי לפתוח את היומן שלך מיד (ללא צורך בסיסמה).
                  </p>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={handleGoogleOwnerLogin}
                    isLoading={isLoggingIn}
                    className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 border-slate-300 text-slate-700 font-bold shadow-xs py-3"
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                      <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"/>
                      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                    </svg>
                    <span>הרשמה מהירה באמצעות Google</span>
                  </Button>

                  <div className="relative flex py-1 items-center justify-center">
                    <div className="flex-grow border-t border-slate-200"></div>
                    <span className="flex-shrink mx-3 text-slate-400 text-xs font-medium">או מלא את פרטי העסק והסיסמה</span>
                    <div className="flex-grow border-t border-slate-200"></div>
                  </div>
                </>
              )}

              <form onSubmit={handleRegisterSubmit} className="space-y-3.5 text-right">
                <Input
                  label="שם בית העסק *"
                  placeholder="לדוגמה: מספרת אלירן, סטודיו זוהר"
                  value={regName}
                  onChange={(e) => handleRegNameChange(e.target.value)}
                  required
                />

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-semibold text-slate-700">
                      סיומת קישור אישית (6 אותיות רנדומליות) *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        setRegSlug(generateRandomSlug(6));
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 transition-colors"
                    >
                      <Dices className="w-3.5 h-3.5" />
                      <span>הגרל סלאג חדש</span>
                    </button>
                  </div>
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-white px-3 h-12 ltr focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-500/15 transition-all">
                    <span className="text-xs text-slate-400 font-mono">torli.app/</span>
                    <input
                      type="text"
                      value={regSlug}
                      onChange={(e) =>
                        setRegSlug(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9]/g, "")
                            .slice(0, 12)
                        )
                      }
                      placeholder="kx9m2p"
                      className="w-full bg-transparent border-none text-sm font-bold text-indigo-600 focus:outline-none pl-1"
                      required
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 text-right">
                    כתובת מקוצרת וקלה לשיתוף (למשל torli-eight.vercel.app/{regSlug || "kx9m2p"})
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="טלפון נייד בעל העסק (10 ספרות) *"
                    type="tel"
                    maxLength={12}
                    placeholder="054-0001122"
                    dir="ltr"
                    className="text-right font-medium"
                    value={regPhone}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                      let formatted = digits;
                      if (digits.length > 3) {
                        formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
                      }
                      setRegPhone(formatted);
                    }}
                    helperText={
                      regPhone.replace(/\D/g, "").length === 10
                        ? "✓ 10 ספרות תקינות"
                        : regPhone.replace(/\D/g, "").length > 0
                        ? `חסרות ספרות (${regPhone.replace(/\D/g, "").length}/10)`
                        : undefined
                    }
                    required
                  />
                  <Input
                    label="כתובת אימייל"
                    type="email"
                    placeholder="owner@example.com"
                    dir="ltr"
                    value={googleUser ? googleUser.email : regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    disabled={!!googleUser}
                  />
                </div>

                {/* Password field or Google Security Confirmation */}
                {!googleUser ? (
                  <div className="space-y-1.5">
                    <Input
                      label="סיסמה מאובטחת לבעל העסק *"
                      type="password"
                      placeholder="לדוגמה: Barber2026!"
                      dir="ltr"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      required
                    />

                    {/* Real-Time Visual Security Checklist */}
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs space-y-1.5 text-right">
                      <span className="font-bold text-slate-700 block text-[11px]">
                        כללי אבטחה לסיסמה:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                        <div className={cn("flex items-center gap-1.5 transition-colors", passwordValidation.hasMinLength ? "text-emerald-700 font-bold" : "text-slate-500")}>
                          <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px]", passwordValidation.hasMinLength ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-400")}>
                            {passwordValidation.hasMinLength ? <Check className="w-3 h-3" /> : "•"}
                          </div>
                          <span>לפחות 8 תווים</span>
                        </div>

                        <div className={cn("flex items-center gap-1.5 transition-colors", passwordValidation.hasUpper ? "text-emerald-700 font-bold" : "text-slate-500")}>
                          <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px]", passwordValidation.hasUpper ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-400")}>
                            {passwordValidation.hasUpper ? <Check className="w-3 h-3" /> : "•"}
                          </div>
                          <span>אות גדולה באנגלית (A-Z)</span>
                        </div>

                        <div className={cn("flex items-center gap-1.5 transition-colors", passwordValidation.hasLower ? "text-emerald-700 font-bold" : "text-slate-500")}>
                          <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px]", passwordValidation.hasLower ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-400")}>
                            {passwordValidation.hasLower ? <Check className="w-3 h-3" /> : "•"}
                          </div>
                          <span>אות קטנה באנגלית (a-z)</span>
                        </div>

                        <div className={cn("flex items-center gap-1.5 transition-colors", passwordValidation.hasNumber ? "text-emerald-700 font-bold" : "text-slate-500")}>
                          <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px]", passwordValidation.hasNumber ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-400")}>
                            {passwordValidation.hasNumber ? <Check className="w-3 h-3" /> : "•"}
                          </div>
                          <span>ספרה (0-9)</span>
                        </div>

                        <div className={cn("flex items-center gap-1.5 transition-colors sm:col-span-2", passwordValidation.hasSpecial ? "text-emerald-700 font-bold" : "text-slate-500")}>
                          <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px]", passwordValidation.hasSpecial ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-400")}>
                            {passwordValidation.hasSpecial ? <Check className="w-3 h-3" /> : "•"}
                          </div>
                          <span>{"תו מיוחד (!@#$%^&*()_+-=[]{};':\"|,.<>/?) "}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2.5 text-right">
                    <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 text-[10px]">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <span>חשבונך מאובטח אוטומטית באמצעות Google — אין צורך ביצירת סיסמה נוספת.</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    תחום פעילות העסק
                  </label>
                  <select
                    value={regCategory}
                    onChange={(e) => setRegCategory(e.target.value as any)}
                    className="w-full h-12 rounded-2xl border border-slate-200 px-3 text-sm bg-white font-medium"
                  >
                    <option value="barber">מספרה / עיצוב שיער לגברים ונשים</option>
                    <option value="nails">סטודיו ציפורניים / מניקור / יופי</option>
                    <option value="therapy">קליניקה / עיסויים / פיזיותרפיה</option>
                    <option value="general">כללי / שירותים אחרים</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    רזולוציית תורים רצויה (מרווח זימון בין תורים)
                  </label>
                  <select
                    value={regInterval}
                    onChange={(e) => setRegInterval(e.target.value)}
                    className="w-full h-12 rounded-2xl border border-slate-200 px-3 text-sm bg-white font-medium"
                  >
                    <option value="15">כל 15 דקות (09:00, 09:15, 09:30...)</option>
                    <option value="20">כל 20 דקות (09:00, 09:20, 09:40, 10:00...)</option>
                    <option value="30">כל 30 דקות (09:00, 09:30, 10:00...)</option>
                    <option value="45">כל 45 דקות (09:00, 09:45, 10:30...)</option>
                    <option value="60">כל 60 דקות (תורים עגולים בכל שעה עגולה)</option>
                  </select>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  isLoading={isRegistering}
                  disabled={!googleUser && regPassword.length > 0 && !passwordValidation.isValid}
                  className="w-full mt-2 shadow-md shadow-indigo-600/20"
                >
                  <Sparkles className="w-4 h-4 ml-2" />
                  <span>
                    {googleUser
                      ? "המשך להגדרת שעות פעילות"
                      : "המשך להגדרת שעות פעילות"}
                  </span>
                </Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // ONBOARDING STEP 2: SET OPERATING HOURS
  // =========================================================================
  if (isOnboardingHours && selectedBusiness) {
    const dayLabels: Record<DayOfWeek, string> = {
      sunday: "יום ראשון",
      monday: "יום שני",
      tuesday: "יום שלישי",
      wednesday: "יום רביעי",
      thursday: "יום חמישי",
      friday: "יום שישי",
      saturday: "יום שבת",
    };

    return (
      <div className="min-h-screen bg-paper py-10 px-4">
        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 bg-lime text-lime-ink px-3 py-1 rounded text-xs font-bold">
              <span>שלב 2 מתוך 2</span>
              <span>•</span>
              <span>הגדרת שעות פתיחה לעסק</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
              ברוך הבא ל-Torli, {selectedBusiness.name}
            </h1>
            <p className="text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
              העסק נוצר בהצלחה! כעת בחר באילו ימים ושעות העסק שלך יהיה פתוח לקבלת תורים מלקוחות.
            </p>
          </div>

          {/* Weekly Schedule Card */}
          <Card className="p-6 space-y-5 text-right">
            {/* Preset shortcuts */}
            <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-500">תבניות מהירות:</span>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(15);
                  setEditingWorkingHours({
                    sunday: { active: true, open: "09:00", close: "19:00", lunch_break: { active: true, start: "13:00", end: "14:00" } },
                    monday: { active: true, open: "09:00", close: "19:00", lunch_break: { active: true, start: "13:00", end: "14:00" } },
                    tuesday: { active: true, open: "09:00", close: "19:00", lunch_break: { active: true, start: "13:00", end: "14:00" } },
                    wednesday: { active: true, open: "09:00", close: "19:00", lunch_break: { active: true, start: "13:00", end: "14:00" } },
                    thursday: { active: true, open: "09:00", close: "20:00", lunch_break: { active: true, start: "13:00", end: "14:00" } },
                    friday: { active: true, open: "08:30", close: "14:00", lunch_break: { active: false, start: "12:00", end: "12:30" } },
                    saturday: { active: false, open: "00:00", close: "00:00" },
                  });
                }}
                className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 transition-colors"
              >
                שבוע סטנדרטי (א׳-ה׳ 09:00-19:00, ו׳ עד 14:00)
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(15);
                  setEditingWorkingHours({
                    sunday: { active: true, open: "10:00", close: "20:00" },
                    monday: { active: true, open: "10:00", close: "20:00" },
                    tuesday: { active: true, open: "10:00", close: "20:00" },
                    wednesday: { active: true, open: "10:00", close: "20:00" },
                    thursday: { active: true, open: "10:00", close: "20:00" },
                    friday: { active: false, open: "00:00", close: "00:00" },
                    saturday: { active: false, open: "00:00", close: "00:00" },
                  });
                }}
                className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 transition-colors"
              >
                ימי חול בלבד (א׳-ה׳ 10:00-20:00)
              </button>
            </div>

            {/* Days list */}
            <div className="space-y-3">
              {(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as DayOfWeek[]).map((day) => {
                const cfg = editingWorkingHours?.[day] || { active: true, open: "09:00", close: "19:00" };

                return (
                  <div
                    key={day}
                    className={cn(
                      "p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3",
                      cfg.active ? "bg-white border-slate-200 shadow-2xs" : "bg-slate-50/80 border-slate-200/60 opacity-60"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={cfg.active}
                        onChange={(e) => {
                          setEditingWorkingHours((prev) => {
                            const base = prev || (selectedBusiness?.working_hours as WorkingHours);
                            return {
                              ...base,
                              [day]: { ...cfg, active: e.target.checked },
                            };
                          });
                        }}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm font-bold text-slate-800 w-24">
                        {dayLabels[day]}
                      </span>
                      {!cfg.active && (
                        <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                          סגור ביום זה
                        </span>
                      )}
                    </div>

                    {cfg.active && (
                      <div className="flex flex-wrap items-center gap-2.5 text-xs">
                        <span className="text-slate-400 font-medium">פתיחה:</span>
                        <input
                          type="time"
                          value={cfg.open}
                          onChange={(e) => {
                            setEditingWorkingHours((prev) => {
                              const base = prev || (selectedBusiness?.working_hours as WorkingHours);
                              return {
                                ...base,
                                [day]: { ...cfg, open: e.target.value },
                              };
                            });
                          }}
                          className="border border-slate-200 rounded-xl px-2.5 py-1 text-slate-800 font-bold bg-white"
                        />
                        <span className="text-slate-400 font-medium">סגירה:</span>
                        <input
                          type="time"
                          value={cfg.close}
                          onChange={(e) => {
                            setEditingWorkingHours((prev) => {
                              const base = prev || (selectedBusiness?.working_hours as WorkingHours);
                              return {
                                ...base,
                                [day]: { ...cfg, close: e.target.value },
                              };
                            });
                          }}
                          className="border border-slate-200 rounded-xl px-2.5 py-1 text-slate-800 font-bold bg-white"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom Actions */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                השעות יישמרו ותוכל לעדכן אותן תמיד דרך אזור &quot;שעות פעילות&quot;.
              </span>
              <Button
                type="button"
                size="lg"
                isLoading={isSavingOnboardingHours}
                onClick={async () => {
                  triggerHaptic(40);
                  setIsSavingOnboardingHours(true);
                  try {
                    const res = await fetch("/api/business", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        id: selectedBusiness.id,
                        working_hours: editingWorkingHours,
                      }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      setSelectedBusiness(updated);
                    }
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setIsSavingOnboardingHours(false);
                    setIsOnboardingHours(false);
                    confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
                  }
                }}
                className="w-full sm:w-auto shadow-lg shadow-indigo-600/25 px-8"
              >
                <Sparkles className="w-4 h-4 ml-2" />
                <span>שמירה וכניסה ליומן</span>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // =========================================================================
  // AUTHENTICATED: SCOPED PRIVATE DASHBOARD
  // =========================================================================
  return (
    <div className="min-h-screen bg-paper text-ink-900 pb-28 md:pb-24">
      {/* SaaS 11-Destination Top Navigation Bar */}
      <AdminTopBar
        business={selectedBusiness}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
        role={role}
        staffName={staffName}
      />

      {/* Real-time New Booking Toast Banner */}
      {newBookingBanner && (
        <div role="status" aria-live="polite" className="m-toast bg-ink-900 text-white px-4 py-2.5 shadow-lg flex items-center justify-between z-50 sticky top-14 md:top-[106px]">
          <div className="flex items-center gap-3 max-w-7xl mx-auto w-full">
            <div className="w-8 h-8 rounded-lg bg-lime text-lime-ink flex items-center justify-center flex-shrink-0">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div className="flex-1 text-right">
              <span className="font-extrabold text-sm block">תור חדש נקבע</span>
              <span className="text-xs text-ink-300">
                {newBookingBanner.clientName} הזמין/ה תור ל-{newBookingBanner.serviceName} בשעה {newBookingBanner.time}
              </span>
            </div>
            <button
              onClick={() => setNewBookingBanner(null)}
              className="m-press w-11 h-11 -ml-2 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/80 hover:text-white flex-shrink-0"
              title="סגירת ההתראה"
              aria-label="סגירת ההתראה"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 space-y-4">
        {/* ========================================================================= */}
        {/* TAB 1: CALENDAR VIEW */}
        {/* ========================================================================= */}
        {activeTab === "calendar" && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Staff Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <div
                role="group"
                aria-label="סינון לפי איש צוות"
                className={cn("flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5", employees.length === 0 && "hidden")}
              >
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setSelectedStaffId("all");
                  }}
                  aria-pressed={selectedStaffId === "all"}
                  className={cn(
                    "m-chip m-press h-10 px-3.5 rounded-md text-sm font-bold whitespace-nowrap border",
                    selectedStaffId === "all"
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white text-ink-700 border-ink-200"
                  )}
                >
                  כל הצוות
                </button>
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setSelectedStaffId(emp.id);
                    }}
                    aria-pressed={selectedStaffId === emp.id}
                    className={cn(
                      "m-chip m-press h-10 px-3.5 rounded-md text-sm font-bold flex items-center gap-1 whitespace-nowrap border",
                      selectedStaffId === emp.id
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-white text-ink-700 border-ink-200"
                    )}
                  >
                    <span>{emp.name.split(" ")[0]}</span>
                  </button>
                ))}
              </div>

              <div className="hidden sm:block text-xs font-semibold text-ink-600 text-right whitespace-nowrap">
                <span>{countAppointments(dailyStats.total)} ביום הזה</span>
              </div>
            </div>
            {/* Schedule View Segment Control */}
            <div role="radiogroup" aria-label="תצוגת יומן" className="flex bg-ink-100 border border-ink-200 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setScheduleMode("day");
                }}
                role="radio"
                aria-checked={scheduleMode === "day"}
                className={cn(
                  "m-press flex-1 h-10 rounded-md text-[13px] font-bold flex items-center justify-center gap-1.5",
                  scheduleMode === "day"
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-ink-600 hover:text-ink-900"
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>יום</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setScheduleMode("month");
                }}
                role="radio"
                aria-checked={scheduleMode === "month"}
                className={cn(
                  "m-press flex-1 h-10 rounded-md text-[13px] font-bold flex items-center justify-center gap-1.5",
                  scheduleMode === "month"
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-ink-600 hover:text-ink-900"
                )}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span>חודש וסגירת ימים</span>
              </button>
            </div>

            {/* SUB-VIEW 1: DETAILED DAILY SCHEDULE */}
            {scheduleMode === "day" && (
              <div className="space-y-4">
                {isSameDay(selectedDate, startOfToday()) && <NextUpTicket appointments={dailyAppointments} />}

                {/* Date Navigator Bar */}
                <Card className="p-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSelectedDate((d) => addDays(d, 1))}
                  className="m-key2 w-11 h-11 rounded-lg border border-ink-200 bg-white flex items-center justify-center text-ink-800"
                  title="יום הבא"
                  aria-label="יום הבא"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                <div className="text-center">
                  <div className="text-base font-bold text-slate-900">
                    {formatHebrewDate(selectedDate)}
                  </div>
                  {selectedBusiness?.settings?.show_hebrew_dates && (
                    <div className="text-xs text-indigo-600 font-bold mt-0.5 flex items-center justify-center gap-1.5">
                      <span>{formatJewishDate(selectedDate, true)}</span>
                      {getJewishHolidayOrShabbat(selectedDate) && (
                        <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md border border-indigo-200/60 text-[10px]">
                          {getJewishHolidayOrShabbat(selectedDate)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-2 text-xs text-slate-500 mt-0.5">
                    {isSameDay(selectedDate, startOfToday()) ? (
                      <span className="bg-lime text-lime-ink font-bold px-1.5 rounded">היום</span>
                    ) : (
                      <button
                        onClick={() => setSelectedDate(startOfToday())}
                        className="text-brand-600 font-bold underline"
                      >
                        חזרה להיום
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedDate((d) => subDays(d, 1))}
                  className="m-key2 w-11 h-11 rounded-lg border border-ink-200 bg-white flex items-center justify-center text-ink-800"
                  title="יום קודם"
                  aria-label="יום קודם"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>
            </Card>

            {/* Daily KPI Stats Bar */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-white rounded-xl p-3 border border-ink-200 text-right">
                <span className="text-xs text-ink-600 block font-medium">
                  מאושרים
                </span>
                <span className="text-2xl font-extrabold text-ink-900">
                  {dailyStats.confirmed}
                </span>
              </div>
              <div className="bg-white rounded-xl p-3 border border-ink-200 text-right">
                <span className="text-xs text-ink-600 block font-medium">בוטלו</span>
                <span className="text-2xl font-extrabold text-ink-900">
                  {dailyStats.cancelled}
                </span>
              </div>
              <div className="bg-white rounded-xl p-3 border border-ink-200 text-right">
                <span className="text-xs text-ink-600 block font-medium">
                  הכנסה צפויה
                </span>
                <span className="text-2xl font-extrabold text-ink-900">
                  ₪{dailyStats.revenue}
                </span>
              </div>
            </div>

            {/* Quick Action Buttons for One-Thumb Reach */}
            <div className="hidden md:grid grid-cols-2 gap-2.5">
              <Button
                variant="primary"
                onClick={() => setIsQuickAddOpen(true)}
                className="h-12 text-sm"
              >
                <Plus className="w-4 h-4 text-lime" />
                <span>תור חדש</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsBlockTimeOpen(true)}
                className="h-12 text-sm"
              >
                <Ban className="w-4 h-4 text-pending-600" />
                <span>חסימת זמן</span>
              </Button>
            </div>

            {/* Vertical Daily Timeline List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>לוח זמנים ({countAppointments(dailyStats.total)})</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      const next = !soundEnabled;
                      setSoundEnabled(next);
                      localStorage.setItem("torli_admin_sound", String(next));
                      if (next) playNotificationChime();
                    }}
                    aria-pressed={soundEnabled}
                    className={cn(
                      "m-press flex items-center gap-1.5 h-9 px-2.5 rounded-md text-xs font-bold border",
                      soundEnabled
                        ? "bg-success-100 text-success-700 border-success-200"
                        : "bg-white text-ink-500 border-ink-200"
                    )}
                    title={soundEnabled ? "התראות קוליות מופעלות - לחץ להשתקה" : "התראות קוליות מושתקות - לחץ להפעלה"}
                  >
                    {soundEnabled ? (
                      <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span>{soundEnabled ? "צליל פעיל" : "מושתק"}</span>
                  </button>

                  <button
                    onClick={() => fetchAppointments(false)}
                    className="m-press flex items-center gap-1 h-9 px-2.5 rounded-md bg-white border border-ink-200 text-ink-700 font-bold"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                    <span>רענן</span>
                  </button>
                </div>
              </div>

              <WaitlistPanel businessName={selectedBusiness.name} />

              {dailyAppointments.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-ink-300 p-8 text-center">
                  <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <h4 className="font-bold text-slate-800 mb-1">אין תורים ביום זה</h4>
                  <p className="text-xs text-slate-500">
                    יומן פנוי לקבלת לקוחות או לחסימת שעות
                  </p>
                </div>
              ) : (
                dailyAppointments.map((app) => {
                  const isCancelled = app.status === "cancelled";
                  const isBlockedSlot = isBlockedTime(app);
                  const clientPhone = app.client?.phone || "";
                  const clientName = `${app.client?.first_name || ""} ${
                    app.client?.last_name || ""
                  }`.trim();

                  const appDate = parseISO(app.start_time);
                  let dateDesc = `ביום ${formatHebrewDate(appDate)}`;
                  if (isSameDay(appDate, new Date())) {
                    dateDesc = "היום";
                  } else if (isSameDay(appDate, addDays(new Date(), 1))) {
                    dateDesc = "מחר";
                  }

                  const bizAddress = selectedBusiness.settings?.address?.trim();
                  const waGreeting = encodeURIComponent(
                    `היי ${app.client?.first_name || "חבר"}, תזכורת לתור שלך ל${
                      app.service?.name || "טיפול"
                    } ${dateDesc} בשעה ${formatTime(app.start_time)} ב${
                      selectedBusiness.name
                    }! נשמח לראותך 🙂` +
                      (bizAddress ? `\nכתובת: ${bizAddress}` : "") +
                      `\nלביטול או שינוי: ${window.location.origin}/cancel/${app.id}`
                  );

                  return (
                    <div
                      key={app.id}
                      className={cn(
                        "rounded-xl border p-4 bg-white transition-all",
                        isCancelled
                          ? "opacity-60 bg-paper border-ink-200"
                          : isBlockedSlot
                          ? "border-pending-200 bg-pending-50"
                          : "border-ink-200"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {/* Right: Client & Service Details */}
                        <div className="text-right flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-base text-slate-900">
                              {clientName || "לקוח ללא שם"}
                            </span>
                            {isCancelled ? (
                              <Badge variant="destructive">בוטל</Badge>
                            ) : isBlockedSlot ? (
                              <Badge variant="warning">זמן חסום</Badge>
                            ) : (
                              <Badge variant="success">מאושר</Badge>
                            )}
                          </div>

                          {!isBlockedSlot && (
                            <div className="text-sm font-medium text-ink-600 mt-0.5">
                              {app.service?.name || "שירות כללי"}
                              {app.service?.price ? ` • ₪${app.service.price}` : ""}
                            </div>
                          )}

                          {app.notes && !isBlockedSlot && (
                            <p className="text-xs text-ink-700 mt-1.5 bg-paper px-2 py-1.5 rounded-md border border-ink-200">
                              {app.notes}
                            </p>
                          )}

                          {employees.length > 0 && !isBlockedSlot && !isCancelled && (
                            <select
                              value={app.staff_id || ""}
                              onChange={async (e) => {
                                triggerHaptic(10);
                                await fetch(`/api/appointments/${app.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ staff_id: e.target.value || null }),
                                });
                                fetchAppointments(true);
                              }}
                              className="mt-2 h-9 rounded-md border border-ink-200 bg-white px-2 text-xs font-semibold text-ink-700"
                              title="שייך את התור לעובד"
                            >
                              <option value="">ללא עובד מוגדר</option>
                              {employees
                                .filter((emp) => emp.active)
                                .map((emp) => (
                                  <option key={emp.id} value={emp.id}>
                                    {emp.name}
                                  </option>
                                ))}
                            </select>
                          )}
                        </div>

                        {/* Left: Time badge */}
                        <div className="text-left flex-shrink-0">
                          <div className="text-left">
                            <span className="text-xl font-extrabold text-ink-900 block leading-none tracking-tight">
                              {formatTime(app.start_time)}
                            </span>
                            <span className="text-xs text-ink-500 leading-tight">
                              עד {formatTime(app.end_time)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Direct Action Buttons: "חייג" & "וואטסאפ" */}
                      {!isBlockedSlot && !isCancelled && clientPhone && (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-ink-100">
                          <a
                            href={`tel:${clientPhone}`}
                            className="m-key2 flex-1 flex items-center justify-center gap-1.5 h-11 rounded-lg border border-ink-200 bg-white text-ink-900 font-bold text-xs"
                          >
                            <Phone className="w-4 h-4 text-ink-600" />
                            <span dir="ltr">{formatPhone(clientPhone)}</span>
                          </a>

                          <a
                            href={`https://wa.me/${toInternationalPhone(
                              clientPhone
                            )}?text=${waGreeting}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="m-key flex-1 flex items-center justify-center gap-1.5 h-11 rounded-lg bg-brand-600 text-white font-bold text-xs"
                          >
                            <MessageCircle className="w-4 h-4 text-lime" />
                            <span>וואטסאפ</span>
                          </a>

                          <button
                            onClick={() => handleCancelAppointment(app.id)}
                            className="m-key2 h-11 w-11 flex-none flex items-center justify-center rounded-lg border border-danger-200 bg-white text-danger-600"
                            title="ביטול התור"
                            aria-label="ביטול התור"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {isBlockedSlot && (
                        <div className="flex justify-end mt-2 pt-2 border-t border-ink-100">
                          <button
                            onClick={() => handleRemoveBlock(app.id)}
                            className="m-press min-h-[40px] px-2 text-xs font-semibold text-ink-500 hover:text-danger-600 flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>הסר חסימה</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            </div>
            )}

            {/* SUB-VIEW 2: FULL MONTH CALENDAR & FAST CLOSURES */}
            {scheduleMode === "month" && (
              <div className="animate-in fade-in duration-200">
                <MonthTable
                  month={ownerMonth}
                  onMonthChange={setOwnerMonth}
                  selectedDate={selectedDate}
                  countByDate={appointmentsCountByDate}
                  isOpenOnDay={isBusinessOpenOnDay}
                  getOverride={getOverrideForDate}
                  showHebrewDates={!!selectedBusiness?.settings?.show_hebrew_dates}
                  onPickDay={setDayActionModalDate}
                  onCloseRange={() => {
                    applyPresetNextWeek();
                    setIsRangeModalOpen(true);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: STATS */}
        {/* ========================================================================= */}
        {activeTab === "stats" && (
          <div className="animate-in fade-in duration-200">
            <StatsSection
              appointments={appointments}
              services={services}
              clients={clients}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: CUSTOMERS & CRM */}
        {/* ========================================================================= */}
        {activeTab === "customers" && (
          <div className="animate-in fade-in duration-200">
            <CustomersSection
              clients={clients}
              appointments={appointments}
              services={services}
              businessId={selectedBusiness.id}
              onAddClient={async (newClient) => {
                // persisted server-side so the customer survives a refresh
                try {
                  const res = await fetch("/api/clients", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contacts: [newClient] }),
                  });
                  const result = res.ok ? await res.json().catch(() => null) : null;
                  await loadSavedClients();
                  return result ? { added: result.added ?? 0, skipped: result.skipped ?? 0 } : undefined;
                } catch {
                  setCustomClients((prev) => [newClient as Client, ...prev]);
                }
              }}
              onImportContacts={async (contacts) => {
                const res = await fetch("/api/clients", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ contacts }),
                });
                if (!res.ok) throw new Error("import failed");
                const result = await res.json();
                await loadSavedClients();
                return result;
              }}
              onUpdateClientNotes={(clientId, notes) => {
                fetch("/api/clients", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: clientId, notes }),
                }).catch(() => {});
                setCustomClients((prev) => {
                  const exists = prev.find((c) => c.id === clientId);
                  if (exists) {
                    return prev.map((c) => (c.id === clientId ? { ...c, notes } : c));
                  }
                  const clientObj = clients.find((c) => c.id === clientId);
                  if (clientObj) {
                    return [...prev, { ...clientObj, notes }];
                  }
                  return prev;
                });
                setAppointments((prev) =>
                  prev.map((a) =>
                    a.client_id === clientId && a.client
                      ? { ...a, client: { ...a.client, notes } }
                      : a
                  )
                );
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: SERVICES & PRICING */}
        {/* ========================================================================= */}
        {activeTab === "services" && (
          <div className="animate-in fade-in duration-200">
            <ServicesSection
              services={services}
              businessId={selectedBusiness.id}
              onAddService={async (service) => {
                try {
                  const res = await fetch("/api/services", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(service),
                  });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    return data.error || "לא הצלחנו לשמור את השירות. נסו שוב.";
                  }
                } catch {
                  return "שגיאת תקשורת. נסו שוב.";
                }
                fetchAppointments();
              }}
              onEditService={async (service) => {
                try {
                  const res = await fetch("/api/services", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(service),
                  });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    return data.error || "לא הצלחנו לשמור את השינויים. נסו שוב.";
                  }
                } catch {
                  return "שגיאת תקשורת. נסו שוב.";
                }
                fetchAppointments();
              }}
              onDeleteService={async (serviceId) => {
                const name = services.find((s) => s.id === serviceId)?.name || "השירות";
                if (!(await confirmDialog(`למחוק את ״${name}״? אי אפשר לשחזר.`, { confirmLabel: "למחוק", danger: true }))) return;
                try {
                  const res = await fetch(`/api/services?id=${serviceId}`, { method: "DELETE" });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    await alertDialog(data.error || "שגיאה במחיקת השירות");
                    return;
                  }
                  fetchAppointments();
                } catch (err) {
                  console.error(err);
                }
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: WORK SCHEDULE & ATTENDANCE */}
        {/* ========================================================================= */}
        {activeTab === "workschedule" && (
          <div className="animate-in fade-in duration-200">
            <WorkScheduleSection
              business={selectedBusiness}
              workingHours={editingWorkingHours || selectedBusiness.working_hours}
              onUpdateWorkingHours={async (hours) => {
                setEditingWorkingHours(hours);
                await fetch("/api/business", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: selectedBusiness.id,
                    working_hours: hours,
                  }),
                });
              }}
              dateOverrides={editingOverrides}
              onAddOverride={async (ovr) => {
                const updated = [...editingOverrides, ovr];
                setEditingOverrides(updated);
                await fetch("/api/business", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: selectedBusiness.id,
                    date_overrides: updated,
                  }),
                });
              }}
              onDeleteOverride={async (ovrId) => {
                const updated = editingOverrides.filter((o) => o.id !== ovrId);
                setEditingOverrides(updated);
                await fetch("/api/business", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: selectedBusiness.id,
                    date_overrides: updated,
                  }),
                });
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: EMPLOYEES */}
        {/* ========================================================================= */}
        {activeTab === "employees" && (
          <div className="animate-in fade-in duration-200">
            <EmployeesSection
              employees={employees}
              services={services}
              businessId={selectedBusiness.id}
              onAddEmployee={async (input) => {
                const res = await fetch("/api/staff", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(input),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return data.error || "שגיאה בהוספת העובד";
                await loadEmployees();
                return null;
              }}
              onUpdateEmployee={async (id, patch) => {
                const res = await fetch("/api/staff", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id, ...patch }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return data.error || "שגיאה בעדכון העובד";
                await loadEmployees();
                return null;
              }}
              onDeleteEmployee={async (id) => {
                const res = await fetch(`/api/staff?id=${id}`, { method: "DELETE" });
                if (!res.ok) return "שגיאה במחיקת העובד";
                await loadEmployees();
                return null;
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 7: MARKETING & MESSAGES */}
        {/* ========================================================================= */}
        {activeTab === "marketing" && (
          <div className="animate-in fade-in duration-200 space-y-4">
            <MarketingSection
              messages={marketingMessages}
              clients={clients}
              businessName={selectedBusiness.name}
              businessSlug={selectedBusiness.slug}
              onSendMessage={(newMsg) => {
                setMarketingMessages((prev) => [newMsg, ...prev]);
              }}
            />

            {/* Cron Reminders Tester Card */}
            <Card className="p-5 space-y-3 text-right">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
                  <Send className="w-5 h-5" />
                </div>
                <div className="text-right flex-1">
                  <h4 className="font-bold text-sm text-slate-900">
                    בדיקת מנגנון תזכורות אוטומטיות (Cron Worker)
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    מדמה הרצת ה-Worker של ה-Cron (סורק תורים בטווח 24-25 שעות, שולח הודעות ומעדכן reminder_sent).
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleTriggerReminderCron}
                isLoading={isReminderRunning}
                className="w-full text-xs font-bold border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50"
              >
                <span>הפעל בדיקת תזכורות עכשיו (/api/cron/reminders)</span>
              </Button>

              {reminderResult && (
                <div className="p-3 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto text-left ltr">
                  <pre>{JSON.stringify(reminderResult, null, 2)}</pre>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 9: CASH REGISTER (COMING SOON) */}
        {/* ========================================================================= */}
        {activeTab === "cashregister" && (
          <div className="animate-in fade-in duration-200">
            <CashRegisterSection
              todayRevenue={dailyStats.revenue}
              confirmedAppointmentsCount={dailyStats.confirmed}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 10: SETTINGS */}
        {/* ========================================================================= */}
        {activeTab === "settings" && (
          <div className="animate-in fade-in duration-200">
            <SettingsSection
              business={selectedBusiness}
              slotInterval={editingInterval}
              onUpdateSettings={async (updates) => {
                if (!selectedBusiness) return;
                if (updates.slot_interval_minutes) {
                  setEditingInterval(updates.slot_interval_minutes);
                }
                const res = await fetch("/api/business", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: selectedBusiness.id,
                    ...updates,
                  }),
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  throw new Error(data.error || "לא הצלחנו לשמור את ההגדרות. נסו שוב.");
                }
                const updated = await res.json();
                setSelectedBusiness(updated);
              }}
              onDeleteBusiness={role === "owner" ? handleDeleteBusiness : undefined}
              role={role}
            />
          </div>
        )}
      </main>



      {/* ========================================================================= */}
      {/* MODAL 1: QUICK ADD / WALKIN */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        title="הוספת תור ידני / לקוח מזדמן"
        description="קבע תור מהיר ישירות ביומן העסק"
      >
        <form onSubmit={handleWalkinSubmit} className="space-y-4 text-right">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              בחר שירות *
            </label>
            <select
              value={walkinServiceId}
              onChange={(e) => setWalkinServiceId(e.target.value)}
              className="w-full h-12 rounded-2xl border border-slate-200 px-3 text-sm bg-white font-medium"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration_minutes} דק׳ + {s.buffer_minutes} מנוחה - ₪{s.price})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="שם פרטי *"
              placeholder="ישראל"
              value={walkinFirstName}
              onChange={(e) => setWalkinFirstName(e.target.value)}
              required
            />
            <Input
              label="שם משפחה"
              placeholder="ישראלי"
              value={walkinLastName}
              onChange={(e) => setWalkinLastName(e.target.value)}
            />
          </div>

          <Input
            label="טלפון נייד (10 ספרות)"
            type="tel"
            maxLength={12}
            placeholder="050-1234567"
            dir="ltr"
            className="text-right font-medium"
            value={walkinPhone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
              let formatted = digits;
              if (digits.length > 3) {
                formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
              }
              setWalkinPhone(formatted);
            }}
            helperText={
              walkinPhone.replace(/\D/g, "").length === 10
                ? "✓ 10 ספרות תקינות"
                : walkinPhone.replace(/\D/g, "").length > 0
                ? `יש להזין 10 ספרות (${walkinPhone.replace(/\D/g, "").length}/10)`
                : "אופציונלי למזדמנים"
            }
          />

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              שעת התחלה *
            </label>
            <input
              type="time"
              value={walkinTime}
              onChange={(e) => setWalkinTime(e.target.value)}
              className="w-full h-12 rounded-2xl border border-slate-200 px-4 text-base font-bold bg-white"
              required
            />
          </div>

          <Button
            type="submit"
            size="lg"
            isLoading={isSubmittingWalkin}
            className="w-full mt-2"
          >
            <span>הוסף תור ליומן</span>
          </Button>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: BLOCK TIME (ONE-OFF) */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isBlockTimeOpen}
        onClose={() => setIsBlockTimeOpen(false)}
        title="חסימת זמן חד-פעמית ביומן"
        description="המועד ייחסם ולא יאפשר ללקוחות להזמין תורים בשעות אלו"
      >
        <form onSubmit={handleBlockTimeSubmit} className="space-y-4 text-right">
          <Input
            label="סיבת החסימה"
            placeholder="הפסקת צהריים, סידורים אישיים..."
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                משעה *
              </label>
              <input
                type="time"
                value={blockStartTime}
                onChange={(e) => setBlockStartTime(e.target.value)}
                className="w-full h-12 rounded-2xl border border-slate-200 px-4 text-base font-bold bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                עד שעה *
              </label>
              <input
                type="time"
                value={blockEndTime}
                onChange={(e) => setBlockEndTime(e.target.value)}
                className="w-full h-12 rounded-2xl border border-slate-200 px-4 text-base font-bold bg-white"
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            variant="destructive"
            isLoading={isSubmittingBlock}
            className="w-full mt-2"
          >
            <span>חסום זמן זה כעת</span>
          </Button>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5: DAY ACTION QUICK SHEET */}
      {/* ========================================================================= */}
      <Modal
        isOpen={!!dayActionModalDate}
        onClose={() => setDayActionModalDate(null)}
        title={
          dayActionModalDate
            ? isBefore(dayActionModalDate, startOfToday())
              ? `היסטוריית יום ${formatHebrewDate(dayActionModalDate)}`
              : formatHebrewDate(dayActionModalDate)
            : "ניהול יום ביומן"
        }
        description={
          dayActionModalDate && isBefore(dayActionModalDate, startOfToday())
            ? "צפייה בתורים שהיו ביום זה והיסטוריית הלקוחות"
            : "פעולות מהירות ליום זה: צפייה בלוח הזמנים, סגירה נקודתית או סגירת שבוע"
        }
      >
        {dayActionModalDate && (() => {
          const override = getOverrideForDate(dayActionModalDate);
          const isOverrideClosed = override?.is_closed ?? false;
          const isWeeklyOpen = isBusinessOpenOnDay(dayActionModalDate);
          const dStr = format(dayActionModalDate, "yyyy-MM-dd");
          const appCount = appointmentsCountByDate[dStr] || 0;
          const isPastDate = isBefore(dayActionModalDate, startOfToday());

          return (
            <div className="space-y-4 text-right">
              {/* Day Status Summary Banner */}
              <div
                className={cn(
                  "p-3.5 rounded-2xl border text-sm space-y-1",
                  isPastDate
                    ? "bg-slate-100/90 border-slate-300 text-slate-800"
                    : isOverrideClosed
                    ? "bg-rose-50 border-rose-200 text-rose-900"
                    : !isWeeklyOpen
                    ? "bg-slate-50 border-slate-200 text-slate-700"
                    : "bg-emerald-50 border-emerald-200 text-emerald-900"
                )}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>סטטוס יום זה:</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-extrabold border bg-white">
                    {isPastDate
                      ? "תאריך מהעבר"
                      : isOverrideClosed
                      ? `סגור (${override?.reason || "חופשה"})`
                      : !isWeeklyOpen
                      ? "סגור קבוע בשבוע"
                      : "פתוח לקבלת קהל"}
                  </span>
                </div>
                <div className="text-xs text-slate-600">
                  {isPastDate
                    ? appCount > 0
                      ? `ביום זה התקיימו ${appCount} תורים במערכת`
                      : "לא נרשמו תורים ביום זה"
                    : appCount > 0
                    ? `קיימים ${appCount} תורים מוזמנים ליום זה`
                    : "אין עדיין תורים מוזמנים ליום זה"}
                </div>
              </div>

              {/* Action 1: View Daily Schedule / Historical View */}
              <Button
                size="lg"
                variant="primary"
                onClick={() => {
                  setSelectedDate(dayActionModalDate);
                  setScheduleMode("day");
                  setDayActionModalDate(null);
                  triggerHaptic(15);
                }}
                className="w-full flex items-center justify-center gap-2 font-bold shadow-md shadow-indigo-600/20"
              >
                {isPastDate ? (
                  <>
                    <History className="w-4 h-4 ml-1" />
                    <span>צפה בהיסטוריית התורים של יום זה ({appCount})</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-4 h-4 ml-1" />
                    <span>מעבר ליומן התורים של יום זה</span>
                  </>
                )}
              </Button>

              {/* Action 2 & 3: Close or Reopen (Only applicable for today or future dates) */}
              {!isPastDate && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-400 block mb-1">
                    פעולות סגירה ופתיחה מהירות:
                  </span>

                  {isOverrideClosed ? (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() => handleToggleSingleDay(dayActionModalDate)}
                      className="w-full font-bold border-emerald-300 text-emerald-800 bg-emerald-50/50 hover:bg-emerald-100/50"
                    >
                      <span>פתח מחדש יום זה לקבלת קהל</span>
                    </Button>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button
                        size="md"
                        variant="destructive"
                        onClick={() => handleToggleSingleDay(dayActionModalDate, 1)}
                        className="font-bold text-xs"
                      >
                        <CalendarX className="w-4 h-4 ml-1" />
                        <span>סגור רק את היום הזה</span>
                      </Button>
                      <Button
                        size="md"
                        variant="outline"
                        onClick={() => handleToggleSingleDay(dayActionModalDate, 7)}
                        className="font-bold text-xs border-rose-300 text-rose-800 bg-rose-50 hover:bg-rose-100"
                      >
                        <Palmtree className="w-4 h-4 ml-1 text-rose-600" />
                        <span>סגור שבוע שלם מיום זה</span>
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 6: BATCH RANGE / VACATION CLOSURE */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isRangeModalOpen}
        onClose={() => setIsRangeModalOpen(false)}
        title="סגירת שבוע שלם / חופשה מרוכזת"
        description="חסום שבוע או טווח ימים מלא לקבלת קהל בלחיצה אחת, בלי לעבור יום-יום"
      >
        <div className="space-y-4 text-right">
          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-2">
              בחירה מהירה לפי תקופות:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  applyPresetThisWeek();
                }}
                className="p-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 text-right transition-all"
              >
                <div>השבוע (א׳ - ה׳)</div>
                <div className="text-[10px] text-slate-400 font-normal">סגור את השבוע הנוכחי</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  applyPresetNextWeek();
                }}
                className="p-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 text-right transition-all"
              >
                <div>שבוע הבא (א׳ - ה׳)</div>
                <div className="text-[10px] text-slate-400 font-normal">חופשה שבוע שלם</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  applyPresetWeekend();
                }}
                className="p-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 text-right transition-all"
              >
                <div>סוף שבוע (ה׳ + ו׳)</div>
                <div className="text-[10px] text-slate-400 font-normal">סגירת סופ״ש</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  applyPresetTwoWeeks();
                }}
                className="p-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 text-right transition-all"
              >
                <div>שבועיים חופשה</div>
                <div className="text-[10px] text-slate-400 font-normal">14 ימים ברצף</div>
              </button>
            </div>
          </div>

          {/* Date Pickers */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                מתאריך: *
              </label>
              <input
                type="date"
                value={rangeStartDate}
                onChange={(e) => setRangeStartDate(e.target.value)}
                className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                עד תאריך: *
              </label>
              <input
                type="date"
                value={rangeEndDate}
                onChange={(e) => setRangeEndDate(e.target.value)}
                className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold bg-white"
                required
              />
            </div>
          </div>

          <Input
            label="סיבת הסגירה (תוצג ללקוחות) *"
            placeholder="חופשה שנתית, חול המועד, שיפוצים..."
            value={rangeReason}
            onChange={(e) => setRangeReason(e.target.value)}
            required
          />

          <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200 text-xs text-amber-900 leading-snug">
            כל הימים בטווח הנבחר ייחסמו מיד ביומן הלקוחות. ניתן לפתוח אותם מחדש בכל עת.
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            <Button
              size="lg"
              variant="destructive"
              onClick={() => handleRangeAction("close")}
              isLoading={isSubmittingRange}
              className="w-full font-bold"
            >
              <CalendarX className="w-4 h-4 ml-1.5" />
              <span>סגור את כל הימים בטווח זה</span>
            </Button>
            <Button
              size="md"
              variant="outline"
              onClick={() => handleRangeAction("open")}
              isLoading={isSubmittingRange}
              className="w-full font-semibold border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <span>בטל סגירה ופתח ימים אלו לקבלת קהל</span>
            </Button>
          </div>
        </div>
      </Modal>

      {/* Floating Action Button (FAB) for quick operations */}
      <AdminFAB
        businessSlug={selectedBusiness.slug}
        businessName={selectedBusiness.name}
        onNewAppointment={() => {
          setWalkinServiceId(services[0]?.id || "");
          setIsQuickAddOpen(true);
        }}
        onBlockTime={() => setIsBlockTimeOpen(true)}
      />
    </div>
  );
}
