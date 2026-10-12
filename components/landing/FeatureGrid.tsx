"use client";

import { useState } from "react";
import {
  BellRing,
  CalendarCheck,
  CalendarDays,
  Download,
  Hourglass,
  MessageCircle,
  QrCode,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Everything here exists in the product today; keep it that way when editing.
const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: CalendarCheck,
    title: "רק שעות פנויות",
    text: "הלקוח רואה רק שעות שבאמת פנויות, לפי משך הטיפול ושעות הפעילות. אין שני תורים על אותה שעה.",
  },
  {
    icon: BellRing,
    title: "התראה על כל שינוי",
    text: "תור חדש, הזזה או ביטול? מקבלים התראה לטלפון ברגע שזה קורה.",
  },
  {
    icon: RefreshCw,
    title: "שינוי וביטול עצמי",
    text: "באישור התור יש קישור לשינוי או ביטול, עד כמה שעות לפני התור שאתם קובעים.",
  },
  {
    icon: Hourglass,
    title: "רשימת המתנה",
    text: "היום מלא? הלקוחות נרשמים לרשימת המתנה, ואתם רואים אותה ביומן.",
  },
  {
    icon: Users,
    title: "צוות והרשאות",
    text: "בעלים, מנהלים ועובדים. כל אחד נכנס עם הטלפון שלו ורואה רק את מה שמותר לו.",
  },
  {
    icon: MessageCircle,
    title: "וואטסאפ בלחיצה",
    text: "הודעת אישור או תזכורת מוכנה מראש עם כל הפרטים, ונשלחת מהוואטסאפ שלכם בלחיצה.",
  },
  {
    icon: QrCode,
    title: "קוד QR לדלפק",
    text: "מדפיסים את הקוד של העסק, והלקוחות סורקים וקובעים את התור הבא עוד לפני שיצאו.",
  },
  {
    icon: Wallet,
    title: "ביט ופייבוקס",
    text: "מוסיפים קישור תשלום, והלקוח יכול לשלם לכם מיד אחרי שקבע.",
  },
  {
    icon: CalendarDays,
    title: "תאריך עברי וחגים",
    text: "התאריך העברי והחגים מופיעים ביומן שלכם ובעמוד ההזמנה, וחג או חופשה נסגרים בלחיצה.",
  },
  {
    icon: SlidersHorizontal,
    title: "כללי הזמנה",
    text: "כמה זמן מראש מותר לקבוע, עד כמה ימים קדימה, וכמה תורים פתוחים מותר ללקוח אחד.",
  },
  {
    icon: Download,
    title: "ייצוא וגיבוי",
    text: "רשימת הלקוחות נפתחת באקסל, וגיבוי מלא של העסק יורד בלחיצה.",
  },
  {
    icon: Smartphone,
    title: "בלי אפליקציה ללקוח",
    text: "הכל עובד מהדפדפן בטלפון. מי שרוצה נכנס עם Google, והפרטים נשמרים לפעם הבאה.",
  },
];

const FIRST_ON_PHONE = 6;

/** A hairline table of features. Phones show the first six until asked for the rest. */
export function FeatureGrid() {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className="grid gap-px border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => {
          const Icon = f.icon;
          return (
            <li
              key={f.title}
              className={cn(
                "l-cell relative flex gap-4 bg-paper p-5 transition-colors duration-300 hover:bg-white sm:block sm:p-8",
                i >= FIRST_ON_PHONE && !all && "hidden"
              )}
            >
              <div className="flex flex-none items-start justify-between sm:mb-7">
                <Icon className="h-6 w-6 text-brand-600" strokeWidth={1.75} aria-hidden="true" />
                <span className="hidden text-xs font-bold tabular-nums text-ink-500 sm:inline">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <div>
                <h3 className="text-[18px] font-extrabold tracking-tight sm:text-[19px]">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-700 sm:mt-2">{f.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {!all && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="m-key2 mt-4 h-12 w-full rounded-lg border border-ink-200 bg-white text-[15px] font-bold text-ink-900 sm:hidden"
        >
          להציג את כל {FEATURES.length} היכולות
        </button>
      )}
    </>
  );
}
