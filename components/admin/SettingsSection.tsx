"use client";

import React, { useState, useEffect } from "react";
import {
  Store,
  QrCode,
  Sliders,
  Check,
  Printer,
  Copy,
  Calendar,
  ExternalLink,
  Upload,
  Image as ImageIcon,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Business, BusinessSettings } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { BackupAndAlerts } from "@/components/admin/BackupAndAlerts";
import { triggerHaptic } from "@/lib/utils";

/**
 * Client-side canvas image compression - 100% free, zero external API keys needed
 */
function compressImage(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

interface SettingsSectionProps {
  business: Business;
  slotInterval: number;
  onUpdateSettings: (settings: Partial<Business>) => Promise<void>;
  onDeleteBusiness?: () => Promise<void>;
  role?: "owner" | "manager" | "staff";
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  business,
  slotInterval,
  onUpdateSettings,
  onDeleteBusiness,
  role = "owner",
}) => {
  const [subTab, setSubTab] = useState<"general" | "controls" | "qrcode" | "sync">("general");
  const [copiedSyncUrl, setCopiedSyncUrl] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // General profile state
  const [name, setName] = useState(business.name);
  const [phone, setPhone] = useState(business.owner_phone);
  const [ownerEmail, setOwnerEmail] = useState(business.owner_email || "");
  const [address, setAddress] = useState(business.settings?.address || "רוטשילד 15, תל אביב");
  const [whatsapp, setWhatsapp] = useState(business.settings?.whatsapp_phone || business.owner_phone);
  const [instagram, setInstagram] = useState(business.settings?.instagram_url || "");
  const [tiktok, setTiktok] = useState(business.settings?.tiktok_url || "");
  const [bitUrl, setBitUrl] = useState(business.settings?.bit_payment_url || "");
  const [payboxUrl, setPayboxUrl] = useState(business.settings?.paybox_payment_url || "");
  const [logoUrl, setLogoUrl] = useState(business.settings?.logo_url || "");
  const [coverUrl, setCoverUrl] = useState(business.settings?.cover_image_url || "");

  // Smart controls state
  const [interval, setInterval] = useState(String(slotInterval || 15));
  const [minNotice, setMinNotice] = useState(String(business.settings?.min_notice_hours ?? 1));
  const [maxFuture, setMaxFuture] = useState(String(business.settings?.max_future_days ?? 60));
  const [cancellationCutoff, setCancellationCutoff] = useState(
    String(business.settings?.cancellation_cutoff_hours ?? 6)
  );
  const [maxPerDay, setMaxPerDay] = useState(String(business.settings?.max_appointments_per_day ?? 0));
  const [maxPerWeek, setMaxPerWeek] = useState(String(business.settings?.max_appointments_per_week ?? 0));
  const [maxPerMonth, setMaxPerMonth] = useState(String(business.settings?.max_appointments_per_month ?? 0));
  const [showPrice, setShowPrice] = useState(business.settings?.show_price_and_duration ?? true);
  const [requireStaff, setRequireStaff] = useState(business.settings?.require_staff_selection ?? false);
  const [waitingList, setWaitingList] = useState(business.settings?.waiting_list_enabled ?? true);
  const [showHebrewDates, setShowHebrewDates] = useState(business.settings?.show_hebrew_dates ?? false);
  const [postBookingMsg, setPostBookingMsg] = useState(
    business.settings?.post_booking_message || "נא להגיע 5 דקות לפני המועד שנקבע. חניה נוחה בכחול לבן ברחוב."
  );

  // Synchronize state whenever business prop updates
  useEffect(() => {
    setName(business.name);
    setPhone(business.owner_phone);
    setOwnerEmail(business.owner_email || "");
    setAddress(business.settings?.address || "רוטשילד 15, תל אביב");
    setWhatsapp(business.settings?.whatsapp_phone || business.owner_phone);
    setInstagram(business.settings?.instagram_url || "");
    setTiktok(business.settings?.tiktok_url || "");
    setBitUrl(business.settings?.bit_payment_url || "");
    setPayboxUrl(business.settings?.paybox_payment_url || "");
    setLogoUrl(business.settings?.logo_url || "");
    setCoverUrl(business.settings?.cover_image_url || "");
    setInterval(String(slotInterval || 15));
    setMinNotice(String(business.settings?.min_notice_hours ?? 1));
    setMaxFuture(String(business.settings?.max_future_days ?? 60));
    setCancellationCutoff(String(business.settings?.cancellation_cutoff_hours ?? 6));
    setMaxPerDay(String(business.settings?.max_appointments_per_day ?? 0));
    setMaxPerWeek(String(business.settings?.max_appointments_per_week ?? 0));
    setMaxPerMonth(String(business.settings?.max_appointments_per_month ?? 0));
    setShowPrice(business.settings?.show_price_and_duration ?? true);
    setRequireStaff(business.settings?.require_staff_selection ?? false);
    setWaitingList(business.settings?.waiting_list_enabled ?? true);
    setShowHebrewDates(business.settings?.show_hebrew_dates ?? false);
    setPostBookingMsg(
      business.settings?.post_booking_message ||
        "נא להגיע 5 דקות לפני המועד שנקבע. חניה נוחה בכחול לבן ברחוב."
    );
  }, [business, slotInterval]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const bookingUrl = typeof window !== "undefined"
    ? `${window.location.origin}/${business.slug}`
    : `https://torli-eight.vercel.app/${business.slug}`;

  // QR Code URL using high-quality Google Charts API or quick SVG
  const qrCodeImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
    bookingUrl
  )}&bgcolor=ffffff&color=2a2758&qzone=2`;

  const handleImageUpload = async (file: File, type: "logo" | "cover") => {
    try {
      const maxWidth = type === "logo" ? 320 : 1000;
      const maxHeight = type === "logo" ? 320 : 500;
      const compressed = await compressImage(file, maxWidth, maxHeight, 0.85);
      if (type === "logo") {
        setLogoUrl(compressed);
      } else {
        setCoverUrl(compressed);
      }
      triggerHaptic(20);
    } catch (err) {
      console.error("Image upload error:", err);
      alert("שגיאה בטעינת התמונה");
    }
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    triggerHaptic(20);

    try {
      const updatedSettings: BusinessSettings = {
        address: address.trim(),
        whatsapp_phone: whatsapp.trim(),
        instagram_url: instagram.trim(),
        tiktok_url: tiktok.trim(),
        bit_payment_url: bitUrl.trim(),
        paybox_payment_url: payboxUrl.trim(),
        logo_url: logoUrl.trim(),
        cover_image_url: coverUrl.trim(),
        min_notice_hours: Number(minNotice),
        max_future_days: Number(maxFuture),
        cancellation_cutoff_hours: Number(cancellationCutoff),
        max_appointments_per_day: Number(maxPerDay),
        max_appointments_per_week: Number(maxPerWeek),
        max_appointments_per_month: Number(maxPerMonth),
        show_price_and_duration: showPrice,
        require_staff_selection: requireStaff,
        waiting_list_enabled: waitingList,
        show_hebrew_dates: showHebrewDates,
        post_booking_message: postBookingMsg.trim(),
      };

      await onUpdateSettings({
        name: name.trim(),
        owner_phone: phone.trim(),
        ...(role === "owner" && ownerEmail.trim() ? { owner_email: ownerEmail.trim() } : {}),
        slot_interval_minutes: Number(interval),
        settings: updatedSettings,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = async () => {
    triggerHaptic(15);
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // fallback
    }
  };

  const handlePrintQR = () => {
    triggerHaptic(20);
    const esc = (t: string) =>
      t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <title>קוד QR - ${esc(business.name)}</title>
          <style>
            body { font-family: system-ui, sans-serif; text-align: center; padding: 40px; background: #F4F1E8; color: #17201A; }
            .card { max-width: 400px; margin: 0 auto; background: #FFFDF9; border: 2px dashed #1E4D36; border-radius: 12px; padding: 30px; }
            h1 { color: #17201A; margin-bottom: 8px; }
            p { color: #4D564F; font-size: 16px; margin-top: 0; }
            img { width: 260px; height: 260px; margin: 20px 0; }
            .badge { display: inline-block; background: #CFEA6E; color: #1A2E12; padding: 6px 14px; border-radius: 4px; font-weight: bold; font-size: 14px; }
            @media print { body { background: #fff; } }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">סרוק לקביעת תור מיידי</div>
            <h1>${esc(business.name)}</h1>
            <p>שמחים שבאת! קובעים תור ישירות מהנייד תוך 30 שניות</p>
            <img src="${qrCodeImgUrl}" alt="QR Code" />
            <p style="font-size: 14px; color: #4D564F;" dir="ltr">${esc(bookingUrl)}</p>
          </div>
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex bg-slate-200/80 p-1 rounded-2xl max-w-xl mx-auto overflow-x-auto no-scrollbar">
        <button
          onClick={() => setSubTab("general")}
          className={`flex-1 min-w-[110px] py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
            subTab === "general" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Store className="w-4 h-4" />
          <span>פרטי עסק וסושיאל</span>
        </button>

        <button
          onClick={() => setSubTab("controls")}
          className={`flex-1 min-w-[110px] py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
            subTab === "controls" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>בקרות תורים חכמות</span>
        </button>

        <button
          onClick={() => setSubTab("qrcode")}
          className={`flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
            subTab === "qrcode" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>קוד QR לדלפק</span>
        </button>

        <button
          onClick={() => setSubTab("sync")}
          className={`flex-1 min-w-[120px] py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
            subTab === "sync" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>סנכרון ליומן Google</span>
        </button>
      </div>

      <form onSubmit={handleSaveAll} className="space-y-4 text-right">
        {/* TAB 1: GENERAL BUSINESS INFO & SOCIAL */}
        {subTab === "general" && (
          <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">פרטי בית העסק וקישורים</h3>
                <p className="text-xs text-slate-400 mt-0.5">מידע המוצג ללקוח בדף הזימון ובהודעות התזכורת</p>
              </div>
              <Button type="submit" size="sm" isLoading={isSaving} className="shadow-xs">
                {saveSuccess ? <Check className="w-4 h-4 ml-1" /> : null}
                <span>{saveSuccess ? "נשמר בהצלחה!" : "שמור הגדרות"}</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Input
                label="שם בית העסק *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <Input
                label="כתובת העסק (וויז ומיקום)"
                placeholder="רוטשילד 15, תל אביב"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />

              <Input
                label="טלפון ראשי ללקוחות *"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />

              {role === "owner" && (
                <Input
                  label="אימייל לשחזור סיסמה"
                  type="email"
                  dir="ltr"
                  placeholder="owner@example.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  helperText="אם תשכח סיסמה, נשלח לכאן קישור לאיפוס. מומלץ להגדיר."
                />
              )}

              <Input
                label="מספר וואטסאפ ייעודי להודעות"
                type="tel"
                placeholder="054-1234567"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />

              <Input
                label="קישור לעמוד Instagram"
                placeholder="https://instagram.com/mybusiness"
                dir="ltr"
                className="text-right"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
              />

              <Input
                label="קישור לעמוד TikTok"
                placeholder="https://tiktok.com/@mybusiness"
                dir="ltr"
                className="text-right"
                value={tiktok}
                onChange={(e) => setTiktok(e.target.value)}
              />

              <div className="sm:col-span-2 pt-3 border-t border-slate-100">
                <div className="mb-2">
                  <span className="text-xs font-bold text-slate-800 block">קישורי תשלום מהיר ללקוחות (Bit ו-PayBox)</span>
                  <span className="text-[11px] text-slate-400">הקישורים יופיעו ללקוח במסך סיום קביעת התור לתשלום מיידי בלחיצה אחת</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Input
                    label="קישור לתשלום ב-Bit (ביט)"
                    placeholder="https://bitpay.co.il/..."
                    dir="ltr"
                    className="text-right"
                    value={bitUrl}
                    onChange={(e) => setBitUrl(e.target.value)}
                  />
                  <Input
                    label="קישור לתשלום ב-PayBox (פייבוקס)"
                    placeholder="https://payboxapp.page.link/..."
                    dir="ltr"
                    className="text-right"
                    value={payboxUrl}
                    onChange={(e) => setPayboxUrl(e.target.value)}
                  />
                </div>
              </div>

              {/* Branding, Logo & Cover Image for client booking page */}
              <div className="sm:col-span-2 pt-4 border-t border-slate-100 space-y-3">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">מיתוג ותמונות לעמוד הלקוח</span>
                  <span className="text-[11px] text-slate-400">הלוגו ותמונת הקאבר יוצגו בראש דף קביעת התורים של העסק (נשמר ישירות ללא צורך בשירות חיצוני)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Logo Upload Card */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <span className="text-xs font-bold text-slate-700 block">לוגו בית העסק</span>
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-indigo-200 bg-white flex items-center justify-center overflow-hidden shadow-2xs flex-shrink-0">
                        {logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logoUrl} alt="לוגו" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="w-6 h-6 text-slate-300" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer transition-colors border border-indigo-200">
                          <Upload className="w-3.5 h-3.5" />
                          <span>העלה קובץ לוגו</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleImageUpload(f, "logo");
                            }}
                          />
                        </label>
                        {logoUrl && (
                          <button
                            type="button"
                            onClick={() => setLogoUrl("")}
                            className="flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 font-semibold"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>הסר לוגו</span>
                          </button>
                        )}
                        <p className="text-[10px] text-slate-400 leading-tight">
                          קובץ תמונה (PNG/JPG/WebP). נדחס ונשמר ישירות ללא עלות נוספת.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Cover Header Image Card */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                    <span className="text-xs font-bold text-slate-700 block">תמונת קאבר / באנר עליון</span>
                    <div className="space-y-2">
                      <div className="w-full h-20 rounded-xl border-2 border-dashed border-indigo-200 bg-white flex items-center justify-center overflow-hidden shadow-2xs relative">
                        {coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={coverUrl} alt="תמונת רקע" className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center text-slate-300 flex items-center gap-1 text-xs">
                            <ImageIcon className="w-5 h-5" />
                            <span>באנר עליון לדף התורים</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer transition-colors border border-indigo-200">
                          <Upload className="w-3.5 h-3.5" />
                          <span>העלה תמונת קאבר</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleImageUpload(f, "cover");
                            }}
                          />
                        </label>
                        {coverUrl && (
                          <button
                            type="button"
                            onClick={() => setCoverUrl("")}
                            className="flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 font-semibold"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>הסר תמונה</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Custom Post-Booking Instructions / Notes for Clients */}
              <div className="sm:col-span-2 pt-4 border-t border-slate-100 space-y-2">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">הנחיות, דרכי הגעה ודגשים ללקוח לאחר קביעת תור</span>
                  <span className="text-[11px] text-slate-400">טקסט זה יוצג בהבלטה ללקוח במסך אישור התור הסופי</span>
                </div>
                <textarea
                  rows={3}
                  value={postBookingMsg}
                  onChange={(e) => setPostBookingMsg(e.target.value)}
                  placeholder="לדוגמה: נא להגיע 5 דקות לפני המועד שנקבע. חניה נוחה בכחול לבן ברחוב. שימו לב שיש לעלות לקומה 2 (יש מעלית)."
                  className="w-full p-3 rounded-2xl border border-slate-200 text-xs text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-medium leading-relaxed"
                />
              </div>
            </div>
          </Card>
        )}

        {/* TAB 2: SMART APPOINTMENT CONTROLS */}
        {subTab === "controls" && (
          <div className="space-y-4">
            <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-4">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">בקרות ומדיניות תורים חכמה</h3>
                  <p className="text-xs text-slate-400 mt-0.5">שליטה מלאה על מועדי הזימון, הביטול והתצוגה</p>
                </div>
                <Button type="submit" size="sm" isLoading={isSaving} className="shadow-xs">
                  {saveSuccess ? <Check className="w-4 h-4 ml-1" /> : null}
                  <span>{saveSuccess ? "נשמר בהצלחה!" : "שמור הגדרות"}</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Slot Interval */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    רזולוציית סלוטים (כל כמה דקות נפתח תור)
                  </label>
                  <select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    className="w-full h-11 rounded-2xl border border-slate-200 px-3 text-xs bg-white font-medium"
                  >
                    <option value="15">כל 15 דקות (תורים קצרים / מספרות)</option>
                    <option value="20">כל 20 דקות</option>
                    <option value="30">כל 30 דקות</option>
                    <option value="60">כל שעה עגולה (טיפולים ארוכים / קליניקות)</option>
                  </select>
                </div>

                {/* Min notice time */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    זמן התראה מראש (מניעת קביעה ברגע האחרון)
                  </label>
                  <select
                    value={minNotice}
                    onChange={(e) => setMinNotice(e.target.value)}
                    className="w-full h-11 rounded-2xl border border-slate-200 px-3 text-xs bg-white font-medium"
                  >
                    <option value="0.25">לפחות 15 דקות מראש</option>
                    <option value="1">לפחות שעה אחת מראש</option>
                    <option value="2">לפחות שעתיים מראש</option>
                    <option value="24">לפחות 24 שעות מראש</option>
                  </select>
                </div>

                {/* Max future booking */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    טווח מקסימלי להזמנה קדימה
                  </label>
                  <select
                    value={maxFuture}
                    onChange={(e) => setMaxFuture(e.target.value)}
                    className="w-full h-11 rounded-2xl border border-slate-200 px-3 text-xs bg-white font-medium"
                  >
                    <option value="30">עד חודש אחד קדימה (30 יום)</option>
                    <option value="60">עד חודשיים קדימה (60 יום)</option>
                    <option value="90">עד 3 חודשים קדימה (90 יום)</option>
                    <option value="365">עד שנה קדימה (365 יום)</option>
                  </select>
                </div>

                {/* Cancellation policy cutoff */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    מדיניות ביטולים עצמאית (עד מתי מותר לבטל בלינק)
                  </label>
                  <select
                    value={cancellationCutoff}
                    onChange={(e) => setCancellationCutoff(e.target.value)}
                    className="w-full h-11 rounded-2xl border border-slate-200 px-3 text-xs bg-white font-medium"
                  >
                    <option value="2">עד שעתיים לפני התור</option>
                    <option value="6">עד 6 שעות לפני התור</option>
                    <option value="12">עד 12 שעות לפני התור</option>
                    <option value="24">עד 24 שעות לפני התור</option>
                  </select>
                </div>
              </div>

              {/* Toggles */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between p-3 rounded-2xl bg-indigo-50/60 border border-indigo-200/80">
                  <div>
                    <div className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                      <span>הצגת תאריכים עבריים, שבתות וחגים</span>
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 font-extrabold px-1.5 py-0.5 rounded-full">חדש</span>
                    </div>
                    <div className="text-[11px] text-indigo-700/80 mt-0.5">
                      מציג תאריכים עבריים (כגון ט״ו באב, י״ד באלול), ערבי שבת, שבתות קודש ומועדי ישראל בלוח הזמנת התור ובפאנל הניהול
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={showHebrewDates}
                    onChange={(e) => setShowHebrewDates(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div>
                    <div className="text-xs font-bold text-slate-800">הצגת מחיר ומשך שירות בדף הזימון</div>
                    <div className="text-[11px] text-slate-400">הצג ללקוחות כמה זמן נמשך הטיפול ומה עלותו</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div>
                    <div className="text-xs font-bold text-slate-800">בחירת איש צוות על ידי הלקוח</div>
                    <div className="text-[11px] text-slate-400">חייב את הלקוח לבחור עובד מסוים, או שובץ אוטומטית</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={requireStaff}
                    onChange={(e) => setRequireStaff(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div>
                    <div className="text-xs font-bold text-slate-800">רשימת המתנה חכמה (Waiting List)</div>
                    <div className="text-[11px] text-slate-400">הצע ללקוחות להירשם לתור שיתפנה במקרה של ביטול</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={waitingList}
                    onChange={(e) => setWaitingList(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div>
                    <div className="text-xs font-bold text-slate-800">מגבלות תורים ללקוח בודד (מניעת תפיסת מקומות כפולים)</div>
                    <div className="text-[11px] text-slate-400">שליטה בכמה תורים לקוח יחיד מורשה להזמין ביום, בשבוע ובחודש</div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        מגבלה ליום בודד
                      </label>
                      <select
                        value={maxPerDay}
                        onChange={(e) => setMaxPerDay(e.target.value)}
                        className="w-full h-9 rounded-xl border border-slate-200 px-2 text-xs bg-white font-medium"
                      >
                        <option value="0">ללא הגבלה יומית</option>
                        <option value="1">תור 1 ביום בלבד</option>
                        <option value="2">עד 2 תורים ביום</option>
                        <option value="3">עד 3 תורים ביום</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        מגבלה לשבוע
                      </label>
                      <select
                        value={maxPerWeek}
                        onChange={(e) => setMaxPerWeek(e.target.value)}
                        className="w-full h-9 rounded-xl border border-slate-200 px-2 text-xs bg-white font-medium"
                      >
                        <option value="0">ללא הגבלה שבועית</option>
                        <option value="1">תור 1 בשבוע</option>
                        <option value="2">עד 2 תורים בשבוע</option>
                        <option value="3">עד 3 תורים בשבוע</option>
                        <option value="5">עד 5 תורים בשבוע</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        מגבלה לחודש
                      </label>
                      <select
                        value={maxPerMonth}
                        onChange={(e) => setMaxPerMonth(e.target.value)}
                        className="w-full h-9 rounded-xl border border-slate-200 px-2 text-xs bg-white font-medium"
                      >
                        <option value="0">ללא הגבלה חודשית</option>
                        <option value="2">עד 2 תורים בחודש</option>
                        <option value="4">עד 4 תורים בחודש</option>
                        <option value="6">עד 6 תורים בחודש</option>
                        <option value="10">עד 10 תורים בחודש</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Post Booking Instructions */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  הודעה מותאמת ללקוח לאחר סיום הזמנת התור
                </label>
                <textarea
                  rows={2}
                  value={postBookingMsg}
                  onChange={(e) => setPostBookingMsg(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-200 text-xs text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/20 leading-relaxed font-medium"
                  placeholder="הוראות הגעה, הנחיות חניה, מדיניות תשלום..."
                />
              </div>
            </Card>
          </div>
        )}

        {/* TAB 3: COUNTERTOP QR CODE */}
        {subTab === "qrcode" && (
          <Card className="p-6 bg-white border border-slate-200 shadow-xs text-center space-y-4">
            <div className="max-w-md mx-auto space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                <QrCode className="w-6 h-6" />
              </div>
              <h3 className="text-base font-black text-slate-900">קוד QR ייעודי להדפסה על הדלפק</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                הדפס שלט יוקרתי לדלפק הקבלה או לחלון הראווה. לקוחות יכולים לסרוק את הקוד עם המצלמה ולקבוע תור מיד!
              </p>
            </div>

            {/* QR Card Preview */}
            <div className="inline-block p-6 bg-white rounded-3xl border-2 border-dashed border-indigo-200 shadow-lg mx-auto">
              <div className="text-xs font-extrabold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full inline-block mb-3">
                {business.name}
              </div>
              <div className="bg-white p-2 rounded-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrCodeImgUrl}
                  alt="QR Code"
                  className="w-48 h-48 mx-auto rounded-xl shadow-xs"
                />
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-3 truncate max-w-xs mx-auto" dir="ltr">
                {bookingUrl}
              </div>
            </div>

            {/* Print & Share Actions */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button type="button" onClick={handlePrintQR} className="shadow-xs">
                <Printer className="w-4 h-4 ml-1.5" />
                <span>הדפס שלט מוכן לדלפק</span>
              </Button>

              <Button type="button" variant="outline" onClick={handleCopyLink}>
                {copiedLink ? <Check className="w-4 h-4 ml-1.5 text-emerald-600" /> : <Copy className="w-4 h-4 ml-1.5" />}
                <span>{copiedLink ? "הועתק!" : "העתק קישור ישיר"}</span>
              </Button>
            </div>
          </Card>
        )}
        {/* TAB 4: GOOGLE CALENDAR & APPLE CALENDAR LIVE SYNC */}
        {subTab === "sync" && (() => {
          const origin = typeof window !== "undefined" ? window.location.origin : "https://torli-eight.vercel.app";
          const syncFeedUrl = `${origin}/api/calendar/${business.slug}?t=${business.calendar_token ?? ""}`;

          const handleCopySync = async () => {
            triggerHaptic(20);
            try {
              await navigator.clipboard.writeText(syncFeedUrl);
              setCopiedSyncUrl(true);
              setTimeout(() => setCopiedSyncUrl(false), 2500);
            } catch {
              // fallback
            }
          };

          return (
            <Card className="p-6 bg-white border border-slate-200 shadow-xs text-right space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                      <Calendar className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900">
                      סנכרון אוטומטי ל-Google Calendar / Apple Calendar
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    כל תור חדש או ביטול שמתבצע במערכת יסונכרן אוטומטית ליומן Google שלך בטלפון ובמחשב.
                  </p>
                </div>

                <a
                  href={`https://calendar.google.com/calendar/r/settings/addbyurl?cid=${encodeURIComponent(
                    syncFeedUrl.replace(/^https?:\/\//, "webcal://")
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-xs whitespace-nowrap"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>הוסף ישירות ל-Google Calendar</span>
                </a>
              </div>

              {/* Feed URL Box */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  קישור סנכרון חי (iCalendar / Webcal Feed URL)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={syncFeedUrl}
                    className="flex-1 h-11 rounded-xl border border-slate-200 px-3 text-xs bg-slate-50 font-mono text-slate-700 text-left select-all"
                    dir="ltr"
                  />
                  <Button type="button" onClick={handleCopySync} className="h-11 shadow-xs">
                    {copiedSyncUrl ? (
                      <>
                        <Check className="w-4 h-4 ml-1 text-emerald-300" />
                        <span>הועתק!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 ml-1" />
                        <span>העתק קישור</span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-400">
                  פורמט סטנדרטי בינלאומי התומך ב-Google Calendar, Apple iCal, Microsoft Outlook.
                </p>
              </div>

              {/* 3 Steps Guide */}
              <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 space-y-3">
                <h4 className="text-xs font-black text-indigo-950">
                  איך מחברים את היומן תוך 30 שניות?
                </h4>
                <ol className="text-xs text-indigo-900 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>
                    לחץ על <strong>&quot;העתק קישור&quot;</strong> למעלה.
                  </li>
                  <li>
                    פתח את <strong>Google Calendar</strong> בדפדפן (או באפליקציה).
                  </li>
                  <li>
                    בסרגל הצד, ליד <strong>&quot;יומנים אחרים&quot; (Other calendars)</strong> לחץ על ה-<strong>+</strong> ובחר <strong>&quot;מכתובת אתר&quot; (From URL)</strong>.
                  </li>
                  <li>
                    הדבק את הקישור ולחץ על <strong>&quot;הוסף יומן&quot;</strong>.
                  </li>
                  <li>
                    <strong>זהו!</strong> כל תור שנקבע אצלך יופיע מיד ביומן האישי שלך עם שם הלקוח, השירות והטלפון.
                  </li>
                </ol>
              </div>
            </Card>
          );
        })()}
      </form>

      <BackupAndAlerts />

      {/* Danger Zone: Permanent Business Deletion */}
      {onDeleteBusiness && (
        <Card className="p-6 border border-red-200/90 bg-red-50/40 rounded-3xl space-y-4 text-right mt-6">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <h3 className="font-extrabold text-sm text-red-950">
              אזור סכנה: מחיקת בית העסק לצמיתות
            </h3>
          </div>
          <p className="text-xs text-red-700 leading-relaxed">
            מחיקת העסק הינה פעולה <strong>סופית ובלתי הפיכה</strong>. כל התורים שהוזמנו, רשימת השירותים, הגדרות העסק ודף הנחיתה של הלקוחות יימחקו לצמיתות ממסד הנתונים.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              triggerHaptic(20);
              setDeleteConfirmText("");
              setIsDeleteModalOpen(true);
            }}
            className="border-red-300 text-red-700 hover:bg-red-600 hover:text-white font-bold text-xs"
          >
            <Trash2 className="w-4 h-4 ml-1.5" />
            <span>מחק את בית העסק לצמיתות מהמערכת</span>
          </Button>
        </Card>
      )}

      {/* Confirmation Modal */}
      {onDeleteBusiness && (
        <Modal
          isOpen={isDeleteModalOpen}
          onClose={() => !isDeleting && setIsDeleteModalOpen(false)}
          title="אישור מחיקת עסק לצמיתות"
        >
          <div className="space-y-4 text-right">
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 space-y-1.5">
              <span className="font-extrabold text-red-950 block">אזהרה קריטית:</span>
              <p>
                אתה עומד למחוק את העסק <strong>&quot;{business.name}&quot;</strong>.
              </p>
              <p>
                פעולה זו תמחק לחלוטין את כל התורים, השירותים ופרטי הגישה. לא ניתן יהיה לשחזר את המידע לאחר המחיקה.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                אנא הקלד <span className="font-mono text-red-600 font-extrabold">{business.name}</span> לאישור סופי:
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={business.name}
                className="text-right"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="flex-1"
              >
                ביטול
              </Button>
              <Button
                type="button"
                onClick={async () => {
                  if (deleteConfirmText.trim() !== business.name.trim()) return;
                  triggerHaptic(50);
                  setIsDeleting(true);
                  try {
                    await onDeleteBusiness();
                    setIsDeleteModalOpen(false);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={deleteConfirmText.trim() !== business.name.trim() || isDeleting}
                isLoading={isDeleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
              >
                <Trash2 className="w-4 h-4 ml-1.5" />
                <span>אישור מחיקה סופית</span>
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
