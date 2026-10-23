import { describe, expect, it } from "vitest";
import {
  ADMIN_TABS,
  HIDDEN_TABS,
  isTabAllowed,
  resolveActiveTab,
  visibleNavItems,
  type AdminRole,
  type AdminTab,
} from "@/lib/admin-nav";

const ROLES: AdminRole[] = ["owner", "manager", "staff"];
const ids = (role: AdminRole) => visibleNavItems(role).map((t) => t.id);

describe("the new Messages tab", () => {
  it("owner and manager see it, staff does not", () => {
    expect(ids("owner")).toContain("messages");
    expect(ids("manager")).toContain("messages");
    expect(ids("staff")).not.toContain("messages");
  });

  it("sits right after Customers", () => {
    for (const role of ["owner", "manager"] as const) {
      const list = ids(role);
      expect(list[list.indexOf("customers") + 1]).toBe("messages");
    }
  });

  it("is shown without a 'coming soon' badge", () => {
    expect(visibleNavItems("owner").find((t) => t.id === "messages")?.badge).toBeUndefined();
  });

  it("there is exactly one item called 'הודעות', for every role", () => {
    for (const role of ROLES) {
      expect(visibleNavItems(role).filter((t) => t.label === "הודעות").length).toBeLessThanOrEqual(1);
    }
    expect(ADMIN_TABS.filter((t) => t.label === "הודעות")).toHaveLength(1);
    expect(new Set(ADMIN_TABS.map((t) => t.id)).size).toBe(ADMIN_TABS.length);
    expect(new Set(ADMIN_TABS.map((t) => t.label)).size).toBe(ADMIN_TABS.length);
  });

  it("the old placeholder id is gone", () => {
    expect(ADMIN_TABS.map((t) => t.id)).not.toContain("marketing" as AdminTab);
  });
});

describe("nothing else changed, for any role", () => {
  // The lists exactly as the navigation showed them before the Messages tab (hidden ones left out).
  const BEFORE: Record<AdminRole, AdminTab[]> = {
    owner: ["calendar", "stats", "customers", "services", "workschedule", "employees", "settings"],
    manager: ["calendar", "stats", "customers", "services", "workschedule", "settings"],
    staff: ["calendar", "customers"],
  };

  it.each(ROLES)("%s sees the same tabs in the same order, plus Messages where allowed", (role) => {
    expect(ids(role).filter((id) => id !== "messages")).toEqual(BEFORE[role]);
  });

  it("owner: everything except the hidden ones", () => {
    expect(ids("owner").sort()).toEqual(ADMIN_TABS.map((t) => t.id).filter((id) => !HIDDEN_TABS.includes(id)).sort());
  });

  it("manager: no Team; staff: only Calendar and Customers", () => {
    expect(ids("manager")).not.toContain("employees");
    expect(ids("staff")).toEqual(["calendar", "customers"]);
  });

  it("products and the cash register stay hidden for everybody", () => {
    expect(HIDDEN_TABS).toEqual(["products", "cashregister"]);
    for (const role of ROLES) {
      expect(ids(role)).not.toContain("products");
      expect(ids(role)).not.toContain("cashregister");
    }
  });

  it("the page guard allows exactly what the page allowed before (marketing is now messages)", () => {
    // the page's old rule, copied: staff and manager had lists, the owner had none, hidden tabs went to the calendar
    const legacyAllowed = (role: AdminRole, tab: string): boolean => {
      const t = tab === "messages" ? "marketing" : tab;
      const list: string[] | null =
        role === "staff"
          ? ["calendar", "customers"]
          : role === "manager"
            ? ["calendar", "stats", "customers", "services", "workschedule", "marketing", "cashregister", "settings"]
            : null;
      const hidden = ["products", "marketing", "cashregister"];
      // Messages is the former marketing tab, but it is visible now, so it is no longer hidden
      const hiddenNow = tab === "messages" ? false : hidden.includes(t);
      return !((list && !list.includes(t)) || hiddenNow);
    };
    for (const role of ROLES) {
      for (const tab of ADMIN_TABS.map((t) => t.id)) {
        expect(isTabAllowed(role, tab), `${role} / ${tab}`).toBe(legacyAllowed(role, tab));
      }
    }
  });
});

describe("resolveActiveTab", () => {
  it("keeps a tab the role may use", () => {
    expect(resolveActiveTab("owner", "messages")).toBe("messages");
    expect(resolveActiveTab("manager", "messages")).toBe("messages");
    expect(resolveActiveTab("staff", "customers")).toBe("customers");
  });

  it("sends a role back to the calendar from a tab it may not use", () => {
    expect(resolveActiveTab("staff", "messages")).toBe("calendar");
    expect(resolveActiveTab("staff", "settings")).toBe("calendar");
    expect(resolveActiveTab("manager", "employees")).toBe("calendar");
    expect(resolveActiveTab("owner", "products")).toBe("calendar");
    expect(resolveActiveTab("owner", "cashregister")).toBe("calendar");
  });
});
