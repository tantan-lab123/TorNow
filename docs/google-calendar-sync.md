# סנכרון יומן Google (חד-כיווני)

כל תור שנקבע, משתנה או מבוטל ב-TorNow מופיע ביומן Google של בעל העסק תוך שניות.
נוצר יומן ייעודי בשם "TorNow – תורים" בחשבון של בעל העסק, ורק אליו נכתב. היומן האישי לא נוגע.

## איך זה עובד

- **חיבור (בעל העסק בלבד):** הגדרות ← סנכרון ליומן ← "חבר יומן Google". זו הסכמה נפרדת מהכניסה הרגילה
  (`calendar.app.created`, גישה מתמשכת). הטוקן נשלח לשרת פעם אחת, מוצפן (AES-256-GCM) ונשמר ב-`google_calendar_connections`.
  הדפדפן לא מחזיק אותו, והשרת לא מחזיר אותו לעולם.
- **סנכרון:** אחרי כל כתיבה של תור (`POST /api/appointments`, שינוי סטטוס, שינוי מועד) רץ `syncAppointment` בתוך `after()`.
  הוא לא חוסם ולא מכשיל הזמנה. מזהה האירוע ב-Google נגזר מה-UUID של התור, ולכן ניסיון חוזר לא יוצר כפילות.
- **ניסיונות חוזרים:** כשל זמני נרשם עם backoff של 1, 5, 15, 60, 240 דקות (ניסיון ראשון + 5 חוזרים). `cron-job.org`
  קורא כל 5 דקות ל-`/api/cron/google-calendar-sync`. בדשבורד יש באנר וכפתור "נסה שוב".
- **הרשאה שנפסלה (`invalid_grant`) או יומן שנמחק:** החיבור הופך ל"נדרש חיבור מחדש", ואין ניסיונות אוטומטיים עד שבעל העסק מחבר שוב.
- **ניתוק:** מבטל את הטוקן אצל Google, אפשר למחוק גם את היומן "TorNow – תורים", ומוחק את החיבור.
- **מעבר ליומן הראשי בעתיד:** `calendar_id` נשמר בחיבור (`'primary'` או מזהה היומן הייעודי), וכל הקוד עובד מולו.
  מעבר = חיבור מחדש עם הרשאת `calendar.events` ופעולת "העבר תורים" אחת.

## משתני סביבה ב-Vercel

| שם | מה זה | הערה |
|---|---|---|
| `GOOGLE_CLIENT_ID` | מזהה הלקוח של ה-OAuth | אותו ערך שמוגדר ב-Supabase: Authentication ← Sign In / Providers ← Google |
| `GOOGLE_CLIENT_SECRET` | הסוד של אותו לקוח | אותו מקור. **Sensitive** |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | מפתח ההצפנה של הטוקנים, 32 בתים ב-base64 | ליצור: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. לשמור בגיבוי: אם הוא אובד, כל החיברים יצטרכו חיבור מחדש. **Sensitive** |
| `CRON_SECRET` | כבר קיים ב-Vercel | משמש גם את `/api/cron/reminders` |

Environments: Production (ו-Preview אם רוצים לבדוק בענף). אחרי הוספה, צריך Redeploy.
בלי שלושת הראשונים, כפתור החיבור כבוי עם הסבר, ושום דבר אחר לא נפגע.

## הגדרות ב-cron-job.org

- **Title:** TorNow Google Calendar retry
- **URL:** `https://tornow-eight.vercel.app/api/cron/google-calendar-sync`
- **Schedule:** כל 5 דקות (Every 5 minutes)
- **Request method:** POST (גם GET עובד)
- **Advanced ← Headers:** `Authorization` = `Bearer <ערך CRON_SECRET>`
- **Request timeout:** 30 שניות. **Notify me on failure:** מופעל.
- תשובה תקינה: `200` עם `{"success":true,"processed":N,"synced":N,"failed":N}`. בלי כותרת: `401`.

## הגדרות ב-Google Cloud (בפרויקט של ההתחברות עם Google)

1. APIs & Services ← Library ← להפעיל את **Google Calendar API**.
2. OAuth consent screen / Data access ← להוסיף את ההרשאה `https://www.googleapis.com/auth/calendar.app.created`
   (לא רגישה, ולא דורשת אימות לפי מרכז האימות).
3. Authorized redirect URI: כתובת ה-callback של Supabase (`https://<project>.supabase.co/auth/v1/callback`) כבר קיימת בגלל ההתחברות הרגילה.
4. ב-Supabase, Authentication ← URL Configuration: `https://tornow-eight.vercel.app/**` כבר ברשימה, והיא מכסה את `/admin?gcal=connect`.

## בדיקה מקצה לקצה (עם Google אמיתי)

1. להחיל את המיגרציה (`supabase/migrations/20261022000001_google_calendar_sync.sql`) ולהגדיר את משתני הסביבה.
2. כניסה כבעל עסק ← הגדרות ← סנכרון ליומן ← "חבר יומן Google" ← לאשר ב-Google ← "כן, לסנכרן" את התורים העתידיים.
3. ב-Google Calendar: יומן חדש "TorNow – תורים" עם התורים העתידיים. באפליקציה בטלפון הוא מופיע בלי סימון ידני.
4. לקבוע תור כלקוח: האירוע מופיע תוך שניות, עם כותרת "שירות - לקוח", טלפון בתיאור, והתראה לפי ההגדרה.
5. לשנות מועד דרך קישור הלקוח: האירוע זז. לבטל: האירוע נעלם.
6. כשל: ב-Google Calendar למחוק ידנית את היומן "TorNow – תורים", לקבוע תור, ולראות באנר "החיבור פג". אז "חבר מחדש".
7. ניתוק: "נתק" ← בחירה אם למחוק גם את היומן ← ב-Google מוודאים שהגישה נעלמה (myaccount.google.com/permissions).

## בדיקות אוטומטיות

`npm test` (45 בדיקות): הצפנה, כל מקרי היצירה/עדכון/מחיקה (כולל 404 ו-410), `invalid_grant`, backoff, מטמון טוקן,
חיבור וניתוק, ובדיקת אינטגרציה של כל המסלול מול שרת Google מדומה על שכבת הנתונים בזיכרון.
שכבת הנתונים מול Supabase עצמו (השאילתות) נבדקת רק אחרי החלת המיגרציה.

## חומרי אישור והסבר לגוגל (אם יידרש, ולמיתוג)

**Scope justification (for the Google verification form):**

> TorNow is an appointment-booking tool for small businesses. When a business owner chooses to connect their Google
> Calendar, TorNow creates one dedicated calendar named "TorNow – תורים" in the owner's account and writes the
> appointments booked through TorNow into it, so the owner sees their schedule in the Google Calendar app. We use the
> `calendar.app.created` scope because it is the narrowest scope that allows this: it lets TorNow create that single
> secondary calendar and manage events only on calendars it created. TorNow cannot read, change or delete the owner's
> existing calendars or events. The connection is optional, started by the owner from Settings, and can be removed at any
> time (TorNow then revokes the token and can delete the calendar). Refresh tokens are stored encrypted on the server and
> are never exposed to the browser.

**Demo video outline (about 90 seconds):**

1. The TorNow home page and the owner dashboard (who we are, what the app does).
2. Settings, Calendar sync: show the "Connect Google Calendar" button next to the existing link option.
3. Click it: the Google consent screen appears, showing the requested access and the app name. Approve.
4. Back in TorNow: status "Connected as <email>".
5. Open Google Calendar: the new "TorNow – תורים" calendar exists and the owner's other calendars are untouched.
6. As a customer, book an appointment on the business page: the event appears in the calendar within seconds.
7. Reschedule it (event moves) and cancel it (event disappears).
8. Back in Settings, click Disconnect, choose to delete the calendar, and show that access is gone in Google Account permissions.

## סיכונים והמשך

- **דומיין:** מיתוג (brand verification) נעשה בהמשך עם דומיין משלך. עד אז המשתמשים עשויים לראות מסך הסכמה כללי.
- **סנכרון דו-כיווני** (אירוע שנמחק או שונה ידנית ב-Google משפיע חזרה): לא כלול. אפשרי בהמשך עם `events.watch`.
- **שינוי שם שירות או לקוח אחרי יצירת האירוע** לא מתעדכן אוטומטית (רק שינוי מועד, ביטול ושחזור מפעילים סנכרון).
- **חסימות זמן** של בעל העסק אינן מסונכרנות (אינן תורים של לקוחות).
- **פיילוט של משתמש אחד:** כדאי לבדוק עם בעל עסק אחד אמיתי לפני שמציעים לכולם.
