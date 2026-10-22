import { Employee, Product, MarketingMessage, AttendanceRecord } from "./types";

export const DEFAULT_EMPLOYEES: Record<string, Employee[]> = {
  default: [
    {
      id: "emp-1",
      business_id: "biz-1",
      name: "דניאל (בעל העסק)",
      phone: "054-1234567",
      role: "owner",
      is_visible_online: true,
      avatar_color: "bg-indigo-600",
    },
    {
      id: "emp-2",
      business_id: "biz-1",
      name: "יוסי כהן",
      phone: "050-9988776",
      role: "staff",
      is_visible_online: true,
      avatar_color: "bg-emerald-600",
    },
    {
      id: "emp-3",
      business_id: "biz-1",
      name: "מיכאל אברהם",
      phone: "052-3344556",
      role: "staff",
      is_visible_online: false,
      avatar_color: "bg-amber-600",
    },
  ],
};

export const DEFAULT_PRODUCTS: Record<string, Product[]> = {
  default: [
    {
      id: "prod-1",
      business_id: "biz-1",
      name: "ווקס מט לעיצוב שיער 100 מ\"ל",
      category: "עיצוב שיער",
      sku: "WX-100-M",
      cost_price: 35,
      sale_price: 75,
      stock_quantity: 18,
      min_stock_alert: 5,
    },
    {
      id: "prod-2",
      business_id: "biz-1",
      name: "שמן טיפוח לזקן בניחוח עץ ארז",
      category: "טיפוח זקן",
      sku: "OIL-50-CD",
      cost_price: 28,
      sale_price: 65,
      stock_quantity: 12,
      min_stock_alert: 4,
    },
    {
      id: "prod-3",
      business_id: "biz-1",
      name: "שמפו טיפולי ללא מלחים 500 מ\"ל",
      category: "שמפו ומרכך",
      sku: "SHP-500-SL",
      cost_price: 42,
      sale_price: 90,
      stock_quantity: 3,
      min_stock_alert: 5,
    },
    {
      id: "prod-4",
      business_id: "biz-1",
      name: "קרם פנים לחות מרענן לאחר גילוח",
      category: "טיפוח פנים",
      sku: "CRM-75-AF",
      cost_price: 30,
      sale_price: 70,
      stock_quantity: 24,
      min_stock_alert: 6,
    },
  ],
};

export const DEFAULT_MARKETING_MESSAGES: MarketingMessage[] = [
  {
    id: "msg-1",
    business_id: "biz-1",
    recipient_count: 142,
    channel: "sms",
    content: "שנה טובה וחג שמח מכל צוות המספרה! 🍎🍯 מזמינים אתכם להבטיח תור לתספורת לחג בלינק: tornow.app/barber-dan",
    sent_at: "2026-09-08 11:30",
    status: "delivered",
  },
  {
    id: "msg-2",
    business_id: "biz-1",
    recipient_count: 88,
    channel: "whatsapp",
    content: "היי חברים, שריינו תור מראש לסופ\"ש הקרוב דרך היומן החכם שלנו וקבלו 10% הנחה על מוצרי הטיפוח!",
    sent_at: "2026-09-01 16:45",
    status: "delivered",
  },
];

export const DEFAULT_ATTENDANCE: AttendanceRecord[] = [
  {
    id: "att-1",
    business_id: "biz-1",
    employee_name: "דניאל",
    date: "2026-09-10",
    check_in: "08:55",
    check_out: "",
    total_hours: "פעיל כעת",
  },
  {
    id: "att-2",
    business_id: "biz-1",
    employee_name: "יוסי כהן",
    date: "2026-09-10",
    check_in: "09:02",
    check_out: "",
    total_hours: "פעיל כעת",
  },
  {
    id: "att-3",
    business_id: "biz-1",
    employee_name: "דניאל",
    date: "2026-09-09",
    check_in: "08:50",
    check_out: "19:15",
    total_hours: "10 שעות ו-25 דק'",
  },
  {
    id: "att-4",
    business_id: "biz-1",
    employee_name: "יוסי כהן",
    date: "2026-09-09",
    check_in: "09:00",
    check_out: "18:30",
    total_hours: "9 שעות ו-30 דק'",
  },
];
