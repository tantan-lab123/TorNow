import { describe, expect, it } from "vitest";
import {
  formFieldsFromClient,
  formatLocalPhone,
  isPlaceholderClient,
  lastVisitByClient,
  normalizePhoneDigits,
  samePhone,
  searchClients,
} from "@/lib/client-search";
import type { Client } from "@/lib/types";

const c = (id: string, first: string, last: string, phone: string): Client => ({
  id,
  business_id: "b",
  first_name: first,
  last_name: last,
  phone,
});

const dana = c("1", "דנה", "כהן", "0501234567");
const yossi = c("2", "יוסי", "לוי", "052-7654321");
const noa = c("3", "נועה", "כהנא", "0541112222");
const all = [dana, yossi, noa];

const ids = (list: Client[]) => list.map((x) => x.id);

describe("normalizePhoneDigits", () => {
  it.each([
    ["050-123 4567", "0501234567"],
    ["+972501234567", "0501234567"],
    ["972501234567", "0501234567"],
    ["00972501234567", "0501234567"],
    ["+972-50", "050"],
    ["0501234567", "0501234567"],
  ])("%s -> %s", (raw, out) => expect(normalizePhoneDigits(raw)).toBe(out));
});

describe("searchClients by phone", () => {
  it("ignores dashes, spaces and +972 / 972", () => {
    expect(ids(searchClients(all, "050-123"))).toEqual(["1"]);
    expect(ids(searchClients(all, "+972 52 765"))).toEqual(["2"]);
    expect(ids(searchClients(all, "972541112222"))).toEqual(["3"]);
    expect(ids(searchClients(all, "0527654321"))).toEqual(["2"]);
  });
  it("matches a number typed without the leading zero", () => {
    expect(ids(searchClients(all, "541112"))).toEqual(["3"]);
  });
  it("needs at least two digits", () => {
    expect(searchClients(all, "0")).toEqual([]);
  });
});

describe("searchClients by name", () => {
  it("matches first name, last name and both in any order", () => {
    expect(ids(searchClients(all, "דנה"))).toEqual(["1"]);
    expect(ids(searchClients(all, "לוי"))).toEqual(["2"]);
    expect(ids(searchClients(all, "דנה כהן"))).toEqual(["1"]);
    expect(ids(searchClients(all, "כהן דנה"))).toEqual(["1"]);
  });
  it("matches part of a name", () => {
    expect(ids(searchClients(all, "כהנ"))).toEqual(["3"]);
    expect(new Set(ids(searchClients(all, "כה")))).toEqual(new Set(["1", "3"]));
  });
  it("is not case sensitive and ignores quote marks", () => {
    const list = [c("9", "John", "O'Neil", "0501111111"), c("10", "גיא", "בן-דוד", "0502222222")];
    expect(ids(searchClients(list, "JOHN oneil"))).toEqual(["9"]);
    expect(ids(searchClients(list, "בן-דוד"))).toEqual(["10"]);
  });
  it("ignores niqqud in the saved name", () => {
    const withNiqqud = c("n", "ד" + String.fromCharCode(0x05b8) + "נ" + String.fromCharCode(0x05b8) + "ה", "לוי", "0503333333");
    expect(ids(searchClients([withNiqqud], "דנה"))).toEqual(["n"]);
  });
  it("returns nothing for an unknown name", () => {
    expect(searchClients(all, "אברהם")).toEqual([]);
  });
});

describe("placeholders are never offered", () => {
  const walkin = c("w", "לקוח", "מזדמן", "0500000000");
  const noPhone = c("p", "לקוח", "#ab12", "050-0000000");
  const block = c("b", "זמן", "חסום", "0000000000");
  const real = c("r", "רונית", "אבן", "0509998888");

  it("detects them", () => {
    expect(isPlaceholderClient(walkin)).toBe(true);
    expect(isPlaceholderClient(noPhone)).toBe(true);
    expect(isPlaceholderClient(block)).toBe(true);
    expect(isPlaceholderClient(c("x", "לקוח", "#ff00", "0501234567"))).toBe(true);
    expect(isPlaceholderClient(real)).toBe(false);
    expect(isPlaceholderClient(dana)).toBe(false);
  });
  it("filters them from every search, including the empty one", () => {
    const list = [walkin, noPhone, block, real];
    expect(ids(searchClients(list, ""))).toEqual(["r"]);
    expect(searchClients(list, "מזדמן")).toEqual([]);
    expect(searchClients(list, "0500000000")).toEqual([]);
    expect(searchClients(list, "לקוח")).toEqual([]);
  });
});

describe("ordering", () => {
  it("latest appointment first, then by name; never-booked last", () => {
    const visits = new Map([
      ["2", "2026-10-20T10:00:00Z"],
      ["3", "2026-11-02T10:00:00Z"],
    ]);
    expect(ids(searchClients(all, "", visits))).toEqual(["3", "2", "1"]);
    expect(ids(searchClients([noa, dana, yossi], "", new Map()))).toEqual(["1", "2", "3"]);
  });

  it("lastVisitByClient ignores cancelled appointments and blocked time", () => {
    const m = lastVisitByClient([
      { client_id: "1", start_time: "2026-10-01T10:00:00Z", service_id: "s" },
      { client_id: "1", start_time: "2026-10-09T10:00:00Z", service_id: "s" },
      { client_id: "1", start_time: "2026-12-01T10:00:00Z", service_id: "s", status: "cancelled" },
      { client_id: "2", start_time: "2026-10-05T10:00:00Z", service_id: null },
    ]);
    expect(m.get("1")).toBe("2026-10-09T10:00:00Z");
    expect(m.has("2")).toBe(false);
  });
});

describe("filling the booking form from the picked customer", () => {
  const picked = (phone: string) => c("9", "דנה", "כהן", phone);

  it.each([
    ["050-1234567", "050-1234567"],
    ["0501234567", "050-1234567"],
    ["+972501234567", "050-1234567"],
    ["972501234567", "050-1234567"],
    ["+972-50-123-4567", "050-1234567"],
    ["00972501234567", "050-1234567"],
    ["052 765 4321", "052-7654321"],
  ])("a phone saved as %s fills the form as %s", (saved, shown) => {
    expect(formFieldsFromClient(picked(saved))).toEqual({ firstName: "דנה", lastName: "כהן", phone: shown });
  });

  it("the filled phone is a valid 10-digit number for the booking", () => {
    for (const saved of ["050-1234567", "+972501234567"]) {
      const digits = formFieldsFromClient(picked(saved)).phone.replace(/\D/g, "");
      expect(digits).toBe("0501234567");
    }
  });

  it("formatLocalPhone never keeps dashes or a country code", () => {
    expect(formatLocalPhone("+972501234567")).toBe("050-1234567");
    expect(formatLocalPhone("050-12")).toBe("050-12");
    expect(formatLocalPhone("05")).toBe("05");
    expect(formatLocalPhone("")).toBe("");
  });

  it("samePhone recognises one number in every format, and different numbers", () => {
    expect(samePhone("0501234567", "050-1234567")).toBe(true);
    expect(samePhone("0501234567", "+972501234567")).toBe(true);
    expect(samePhone("050-1234567", "972501234567")).toBe(true);
    expect(samePhone("0501234567", "0501234568")).toBe(false);
    expect(samePhone("050123", "0501234567")).toBe(false); // half-typed: another customer
  });
});
