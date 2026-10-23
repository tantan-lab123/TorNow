/**
 * The sections of the admin screen and who may see them.
 * One place for the navigation bar (what is shown) and the page (which tab it will actually render),
 * so the two can never disagree. The server enforces permissions as well; this only hides what a
 * person cannot use.
 */

export type AdminTab =
  | "calendar"
  | "stats"
  | "customers"
  | "messages"
  | "services"
  | "workschedule"
  | "employees"
  | "products"
  | "cashregister"
  | "settings";

export type AdminRole = "owner" | "manager" | "staff";

/** In the order they appear in the navigation. */
export const ADMIN_TABS: { id: AdminTab; label: string; badge?: string }[] = [
  { id: "calendar", label: "יומן" },
  { id: "stats", label: "סטטיסטיקות" },
  { id: "customers", label: "לקוחות" },
  { id: "messages", label: "הודעות" },
  { id: "services", label: "שירותים" },
  { id: "workschedule", label: "שעות פעילות" },
  { id: "employees", label: "צוות" },
  { id: "products", label: "מוצרים" },
  { id: "cashregister", label: "קופה", badge: "בקרוב" },
  { id: "settings", label: "הגדרות" },
];

// Sections that still show sample data only; hidden until they work for real.
export const HIDDEN_TABS: AdminTab[] = ["products", "cashregister"];

/** Tabs a role may not use (besides the hidden ones, which nobody sees). */
const STAFF_TABS: AdminTab[] = ["calendar", "customers"];
const MANAGER_DENIED: AdminTab[] = ["employees"];

/** The tabs this role sees, in navigation order. */
export function visibleNavItems(role: AdminRole): typeof ADMIN_TABS {
  return ADMIN_TABS.filter((tab) => {
    if (HIDDEN_TABS.includes(tab.id)) return false;
    if (role === "staff") return STAFF_TABS.includes(tab.id);
    if (role === "manager") return !MANAGER_DENIED.includes(tab.id);
    return true; // owner
  });
}

export function isTabAllowed(role: AdminRole, tab: AdminTab): boolean {
  return visibleNavItems(role).some((t) => t.id === tab);
}

/** The tab to show: the requested one, or the calendar when this role may not be there. */
export function resolveActiveTab(role: AdminRole, requested: AdminTab): AdminTab {
  return isTabAllowed(role, requested) ? requested : "calendar";
}
