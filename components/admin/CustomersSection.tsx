"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MessageCircle,
  Clock,
  X,
  Check,
  FileText,
  Download,
  Upload,
  Smartphone,
} from "lucide-react";
import { Client, Appointment, Service } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import {
  RawContact,
  isContactPickerSupported,
  parseContactsFile,
  pickContactsFromPhone,
} from "@/lib/contacts";
import { formatPhone, toInternationalPhone, formatTime, formatHebrewDate, formatShortDate, triggerHaptic, validatePhoneNumber } from "@/lib/utils";

interface CustomersSectionProps {
  clients: Client[];
  appointments: Appointment[];
  services: Service[];
  businessId: string;
  onAddClient?: (client: Partial<Client>) => void;
  onUpdateClientNotes?: (clientId: string, notes: string) => void;
  onImportContacts?: (
    contacts: RawContact[]
  ) => Promise<{ added: number; skipped: number; invalid: number }>;
}

export const CustomersSection: React.FC<CustomersSectionProps> = ({
  clients,
  appointments,
  services,
  businessId,
  onAddClient,
  onUpdateClientNotes,
  onImportContacts,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  // Contacts import (phone contact picker / vCard / CSV)
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importContacts, setImportContacts] = useState<RawContact[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [pickerSupported, setPickerSupported] = useState(false);
  useEffect(() => {
    setPickerSupported(isContactPickerSupported());
  }, []);

  const resetImport = () => {
    setImportContacts([]);
    setImportMessage("");
    setImportBusy(false);
  };

  const handlePickFromPhone = async () => {
    try {
      const picked = await pickContactsFromPhone();
      setImportContacts(picked);
      setImportMessage(picked.length ? "" : "לא נבחרו אנשי קשר");
    } catch {
      setImportMessage("לא ניתן לגשת לאנשי הקשר. אפשר להעלות קובץ במקום.");
    }
  };

  const handleContactsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5_000_000) {
      setImportMessage("הקובץ גדול מדי (עד 5MB)");
      return;
    }
    const parsed = await parseContactsFile(file);
    setImportContacts(parsed);
    setImportMessage(parsed.length ? "" : "לא נמצאו אנשי קשר עם מספר טלפון בקובץ");
  };

  const handleConfirmImport = async () => {
    if (!onImportContacts || importContacts.length === 0) return;
    setImportBusy(true);
    try {
      const r = await onImportContacts(importContacts.slice(0, 2000));
      setImportMessage(
        `נוספו ${r.added} לקוחות חדשים. ${r.skipped} כבר היו קיימים, ${r.invalid} דולגו (מספר לא תקין / לא נייד).`
      );
      setImportContacts([]);
    } catch {
      setImportMessage("שגיאה בייבוא. אנא נסה שוב.");
    } finally {
      setImportBusy(false);
    }
  };
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [clientNotesEdit, setClientNotesEdit] = useState("");
  const [notesSaveSuccess, setNotesSaveSuccess] = useState(false);

  // New Client Form State
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneError, setNewPhoneError] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBirthday, setNewBirthday] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Calculate stats for each client
  const clientStats = useMemo(() => {
    const statsMap: Record<
      string,
      {
        totalBookings: number;
        confirmedBookings: number;
        cancellations: number;
        totalRevenue: number;
        lastAppointmentDate: string | null;
        clientAppointments: Appointment[];
      }
    > = {};

    clients.forEach((c) => {
      const clientApps = appointments.filter((a) => a.client_id === c.id);
      const confirmed = clientApps.filter((a) => a.status === "confirmed");
      const cancelled = clientApps.filter((a) => a.status === "cancelled");

      let revenue = 0;
      confirmed.forEach((a) => {
        const s = services.find((srv) => srv.id === a.service_id) || a.service;
        if (s) revenue += s.price;
      });

      const sorted = [...clientApps].sort(
        (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      );

      statsMap[c.id] = {
        totalBookings: clientApps.length,
        confirmedBookings: confirmed.length,
        cancellations: cancelled.length,
        totalRevenue: revenue,
        lastAppointmentDate: sorted[0]?.start_time || null,
        clientAppointments: sorted,
      };
    });

    return statsMap;
  }, [clients, appointments, services]);

  const filteredClients = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) => {
      const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
      const phone = c.phone.toLowerCase();
      const email = (c.email || "").toLowerCase();
      return fullName.includes(term) || phone.includes(term) || email.includes(term);
    });
  }, [clients, searchTerm]);

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFirstName.trim() || !newPhone.trim()) return;

    const phoneCheck = validatePhoneNumber(newPhone);
    if (!phoneCheck.isValid) {
      setNewPhoneError(phoneCheck.error || "מספר טלפון חייב להכיל בדיוק 10 ספרות");
      triggerHaptic(40);
      return;
    }

    triggerHaptic(25);
    const newClient: Partial<Client> = {
      id: "cli-" + Math.random().toString(36).substring(2, 9),
      business_id: businessId,
      first_name: newFirstName.trim(),
      last_name: newLastName.trim(),
      phone: phoneCheck.cleaned,
      email: newEmail.trim() || undefined,
      birthday: newBirthday.trim() || undefined,
      notes: newNotes.trim() || undefined,
    };

    if (onAddClient) {
      onAddClient(newClient);
    }

    setIsAddModalOpen(false);
    setNewFirstName("");
    setNewLastName("");
    setNewPhone("");
    setNewPhoneError("");
    setNewEmail("");
    setNewBirthday("");
    setNewNotes("");
  };

  // Export clients list to Excel/CSV with UTF-8 BOM
  const handleExportCSV = () => {
    triggerHaptic(20);
    const headers = [
      "שם פרטי",
      "שם משפחה",
      "טלפון",
      "אימייל",
      "תאריך לידה",
      "סה\"כ תורים",
      "תורים מאושרים",
      "ביטולים",
      "סך הכנסות (₪)",
      "תאריך תור אחרון",
      "הערות פנימיות",
    ];

    const rows = clients.map((c) => {
      const stats = clientStats[c.id] || {
        totalBookings: 0,
        confirmedBookings: 0,
        cancellations: 0,
        totalRevenue: 0,
        lastAppointmentDate: null,
      };

      return [
        `"${(c.first_name || "").replace(/"/g, '""')}"`,
        `"${(c.last_name || "").replace(/"/g, '""')}"`,
        `"${formatPhone(c.phone)}"`,
        `"${(c.email || "").replace(/"/g, '""')}"`,
        `"${(c.birthday || "").replace(/"/g, '""')}"`,
        stats.totalBookings,
        stats.confirmedBookings,
        stats.cancellations,
        stats.totalRevenue,
        stats.lastAppointmentDate ? `"${formatShortDate(stats.lastAppointmentDate)}"` : '""',
        `"${(c.notes || "").replace(/"/g, '""')}"`,
      ].join(",");
    });

    // UTF-8 BOM for full Microsoft Excel Hebrew compatibility
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `לקוחות_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Top Controls: Search, Export & Add Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="חיפוש לקוח לפי שם, טלפון או אימייל..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-medium text-right"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl whitespace-nowrap">
            סה&quot;כ {clients.length} לקוחות
          </div>
          {onImportContacts && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                triggerHaptic(20);
                resetImport();
                setIsImportOpen(true);
              }}
              className="shadow-2xs whitespace-nowrap border-slate-200 hover:bg-slate-50 text-slate-700"
              title="ייבוא לקוחות מאנשי הקשר בטלפון"
            >
              <Upload className="w-4 h-4 ml-1 text-indigo-600" />
              <span>ייבוא אנשי קשר</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            className="shadow-2xs whitespace-nowrap border-slate-200 hover:bg-slate-50 text-slate-700"
            title="ייצא את כל רשימת הלקוחות לקובץ Excel / CSV"
          >
            <Download className="w-4 h-4 ml-1 text-indigo-600" />
            <span>ייצוא לאקסל (CSV)</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic(15);
              setIsAddModalOpen(true);
            }}
            className="shadow-xs whitespace-nowrap"
          >
            <Plus className="w-4 h-4 ml-1" />
            <span>הוסף לקוח חדש</span>
          </Button>
        </div>
      </div>

      {/* Clients Grid */}
      {filteredClients.length === 0 ? (
        <Card className="p-8 text-center text-slate-500 bg-white border border-slate-200">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <div className="font-bold text-slate-700 text-sm">לא נמצאו לקוחות מתאימים</div>
          <div className="text-xs text-slate-400 mt-1">
            נסה מונח חיפוש אחר או הוסף לקוח חדש למאגר
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredClients.map((client) => {
            const stats = clientStats[client.id] || {
              totalBookings: 0,
              confirmedBookings: 0,
              cancellations: 0,
              totalRevenue: 0,
              lastAppointmentDate: null,
            };

            return (
              <Card
                key={client.id}
                onClick={() => {
                  triggerHaptic(15);
                  setSelectedClient(client);
                  setClientNotesEdit(client.notes || "");
                  setNotesSaveSuccess(false);
                }}
                className="p-4 bg-white border border-slate-200/90 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer text-right flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 font-extrabold flex items-center justify-center text-sm border border-indigo-100 flex-shrink-0">
                      {client.first_name[0]}
                      {client.last_name ? client.last_name[0] : ""}
                    </div>
                    <div className="flex-1 text-right">
                      <div className="font-extrabold text-slate-900 text-sm">
                        {client.first_name} {client.last_name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono flex items-center justify-end gap-1 mt-0.5">
                        <span dir="ltr">{formatPhone(client.phone)}</span>
                        <Phone className="w-3 h-3 text-slate-400" />
                      </div>
                    </div>
                  </div>

                  {client.email && (
                    <div className="text-xs text-slate-400 truncate flex items-center justify-end gap-1 mb-2 font-mono">
                      <span>{client.email}</span>
                      <Mail className="w-3 h-3 flex-shrink-0" />
                    </div>
                  )}

                  {client.notes && (
                    <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-xl mb-3 border border-slate-100 line-clamp-2">
                      {client.notes}
                    </div>
                  )}
                </div>

                {/* Stats Row */}
                <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-1 text-center text-xs">
                  <div className="bg-slate-50 p-1.5 rounded-lg">
                    <div className="text-[10px] text-slate-400 font-medium">הושלמו</div>
                    <div className="font-extrabold text-emerald-700">{stats.confirmedBookings}</div>
                  </div>
                  <div className="bg-slate-50 p-1.5 rounded-lg">
                    <div className="text-[10px] text-slate-400 font-medium">ביטולים</div>
                    <div className="font-extrabold text-slate-600">{stats.cancellations}</div>
                  </div>
                  <div className="bg-slate-50 p-1.5 rounded-lg">
                    <div className="text-[10px] text-slate-400 font-medium">סך רכישות</div>
                    <div className="font-extrabold text-indigo-700">₪{stats.totalRevenue}</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Client Extended Card Modal */}
      {selectedClient && (
        <Modal
          isOpen={Boolean(selectedClient)}
          onClose={() => setSelectedClient(null)}
          title={`כרטיס לקוח: ${selectedClient.first_name} ${selectedClient.last_name}`}
        >
          <div className="space-y-4 text-right">
            {/* Quick Actions Header */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2">
                <a
                  href={`tel:${selectedClient.phone}`}
                  className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-indigo-600 transition-colors shadow-2xs"
                  title="התקשר"
                >
                  <Phone className="w-4 h-4" />
                </a>
                <a
                  href={`https://wa.me/${toInternationalPhone(selectedClient.phone)}?text=${encodeURIComponent(
                    `היי ${selectedClient.first_name}, מה שלומך? פונה אליך מבית העסק.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 transition-colors shadow-2xs text-xs font-bold"
                  title="שלח הודעת וואטסאפ ללקוח"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>וואטסאפ</span>
                </a>
              </div>

              <div className="text-right">
                <div className="text-xs text-slate-400">מספר טלפון</div>
                <div className="text-sm font-mono font-bold text-slate-900" dir="ltr">
                  {formatPhone(selectedClient.phone)}
                </div>
              </div>
            </div>

            {/* Metrics Breakdown */}
            {(() => {
              const s = clientStats[selectedClient.id];
              return (
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl text-center">
                    <div className="text-xs text-indigo-700 font-bold">סך הכנסות</div>
                    <div className="text-lg font-black text-indigo-900 mt-0.5">₪{s?.totalRevenue || 0}</div>
                  </div>
                  <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-center">
                    <div className="text-xs text-emerald-700 font-bold">תורים שבוצעו</div>
                    <div className="text-lg font-black text-emerald-900 mt-0.5">{s?.confirmedBookings || 0}</div>
                  </div>
                  <div className="p-3 bg-rose-50/70 border border-rose-100 rounded-2xl text-center">
                    <div className="text-xs text-rose-700 font-bold">ביטולים</div>
                    <div className="text-lg font-black text-rose-900 mt-0.5">{s?.cancellations || 0}</div>
                  </div>
                </div>
              );
            })()}

            {/* Client History List */}
            <div>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>היסטוריית תורים ({clientStats[selectedClient.id]?.clientAppointments.length || 0})</span>
              </h4>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {(clientStats[selectedClient.id]?.clientAppointments || []).map((app) => {
                  const s = services.find((srv) => srv.id === app.service_id) || app.service;
                  const date = new Date(app.start_time);
                  const isCancelled = app.status === "cancelled";
                  const isUpcoming = !isCancelled && date.getTime() > Date.now();

                  return (
                    <div
                      key={app.id}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-white text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant={isCancelled ? "destructive" : isUpcoming ? "default" : "success"}>
                          {isCancelled ? "בוטל" : isUpcoming ? "עתידי" : "התקיים"}
                        </Badge>
                        <span className="font-bold text-slate-700">₪{s?.price || 0}</span>
                        {isUpcoming && selectedClient.phone && (
                          <a
                            href={`https://wa.me/${toInternationalPhone(selectedClient.phone)}?text=${encodeURIComponent(
                              `היי ${selectedClient.first_name}, תזכורת לתור שלך ל${s?.name || "טיפול"} ב-${formatHebrewDate(date)} בשעה ${formatTime(date)}.\nלביטול או שינוי: ${window.location.origin}/cancel/${app.id}`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-11 w-11 inline-flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                            title="שלח תזכורת בוואטסאפ לתור זה"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-slate-800">{s?.name || "טיפול"}</div>
                        <div className="text-[11px] text-slate-400">
                          {formatHebrewDate(date)} • {formatTime(date)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Internal CRM Notes (Editable) */}
            <div className="p-3.5 bg-amber-50/80 border border-amber-200/90 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-amber-700" />
                  <span>הערות פנימיות של בעל העסק (גלוי רק לך)</span>
                </span>
                {notesSaveSuccess && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>ההערה נשמרה!</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-amber-800 leading-snug">
                רשום כאן דברים שחשוב לזכור על הלקוח (העדפות אישיות, רגישות לחומרים, סגנון תספורת מועדף).
              </p>
              <textarea
                rows={2}
                value={clientNotesEdit}
                onChange={(e) => setClientNotesEdit(e.target.value)}
                placeholder="למשל: רגיש לצבע שיער מסוים, מעדיף תורים מוקדם בבוקר..."
                className="w-full p-2.5 rounded-xl border border-amber-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-right font-medium"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(20);
                    if (onUpdateClientNotes) {
                      onUpdateClientNotes(selectedClient.id, clientNotesEdit.trim());
                    }
                    selectedClient.notes = clientNotesEdit.trim();
                    setNotesSaveSuccess(true);
                    setTimeout(() => setNotesSaveSuccess(false), 2500);
                  }}
                  className="min-h-[44px] px-4 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition-colors"
                >
                  שמור הערה לכרטיס לקוח
                </button>
              </div>
            </div>

            <div className="pt-2">
              <Button variant="outline" className="w-full" onClick={() => setSelectedClient(null)}>
                סגור כרטיס
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import contacts modal */}
      <Modal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        title="ייבוא לקוחות מאנשי הקשר"
      >
        <div className="space-y-4 text-right">
          <p className="text-sm text-slate-600 leading-relaxed">
            הוסף בבת אחת את אנשי הקשר מהטלפון שלך כלקוחות. נוספים רק מספרי נייד ישראליים, ומספרים שכבר קיימים אצלך מדולגים.
          </p>

          {pickerSupported && (
            <Button type="button" variant="primary" className="w-full" onClick={handlePickFromPhone}>
              <Smartphone className="w-4 h-4 ml-1" />
              <span>בחר אנשי קשר מהטלפון</span>
            </Button>
          )}

          <label className="block w-full cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 hover:border-indigo-400 p-4 text-center transition-colors">
            <Upload className="w-5 h-5 mx-auto text-indigo-600 mb-1" />
            <span className="block text-sm font-bold text-slate-800">העלאת קובץ אנשי קשר (.vcf או .csv)</span>
            <span className="block text-xs text-slate-500 mt-1">
              באייפון: אנשי קשר ← סמן הכול ← שתף ← שמור לקבצים. באנדרואיד / Google Contacts: ייצוא ← vCard או CSV.
            </span>
            <input type="file" accept=".vcf,.csv,text/vcard,text/csv" className="hidden" onChange={handleContactsFile} />
          </label>

          {importContacts.length > 0 && (
            <div className="rounded-2xl bg-indigo-50 border border-indigo-200/70 p-3 text-sm">
              <div className="font-bold text-indigo-950 mb-1">נמצאו {importContacts.length} מספרים לייבוא</div>
              <ul className="text-xs text-indigo-800 space-y-0.5 max-h-28 overflow-auto">
                {importContacts.slice(0, 5).map((c, i) => (
                  <li key={i}>
                    {c.first_name} {c.last_name} · {c.phone}
                  </li>
                ))}
                {importContacts.length > 5 && <li>ועוד {importContacts.length - 5}...</li>}
              </ul>
              <Button
                type="button"
                variant="primary"
                className="w-full mt-3"
                onClick={handleConfirmImport}
                disabled={importBusy}
              >
                {importBusy ? "מייבא..." : `ייבא ${importContacts.length} אנשי קשר`}
              </Button>
            </div>
          )}

          {importMessage && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">{importMessage}</div>
          )}
        </div>
      </Modal>

      {/* Add New Client Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="הוספת לקוח חדש למאגר">
        <form onSubmit={handleCreateClient} className="space-y-3 text-right">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="שם פרטי *"
              placeholder="ישראל"
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              required
            />
            <Input
              label="שם משפחה"
              placeholder="ישראלי"
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
            />
          </div>

          <Input
            label="מספר טלפון נייד (10 ספרות) *"
            type="tel"
            maxLength={12}
            placeholder="054-1234567"
            dir="ltr"
            className="text-right font-medium"
            value={newPhone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
              let formatted = digits;
              if (digits.length > 3) {
                formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
              }
              setNewPhone(formatted);
              if (newPhoneError) setNewPhoneError("");
            }}
            error={newPhoneError}
            helperText={
              newPhoneError
                ? undefined
                : newPhone.replace(/\D/g, "").length === 10
                ? "✓ מספר טלפון תקין (10 ספרות)"
                : newPhone.replace(/\D/g, "").length > 0
                ? `יש להזין בדיוק 10 ספרות (${newPhone.replace(/\D/g, "").length}/10)`
                : "הזן 10 ספרות"
            }
            required
          />

          <Input
            label="כתובת אימייל"
            type="email"
            placeholder="client@example.com"
            dir="ltr"
            className="text-right"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />

          <Input
            label="תאריך לידה (לברכות יום הולדת)"
            type="date"
            value={newBirthday}
            onChange={(e) => setNewBirthday(e.target.value)}
          />

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">הערות קבועות ללקוח</label>
            <textarea
              rows={2}
              placeholder="למשל: רגישות לחומרים מסוימים, העדפת קפה, וכו'"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddModalOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" className="flex-1">
              שמור לקוח
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
