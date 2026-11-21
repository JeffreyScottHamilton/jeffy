import { describe, expect, it } from "vitest";
import { formatToday, resolveTimeZone } from "./time";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("resolveTimeZone", () => {
  it("defaults to America/Denver", () => {
    expect(resolveTimeZone(env({}))).toBe("America/Denver");
    expect(resolveTimeZone(env({ JEFFY_TIMEZONE: "  " }))).toBe("America/Denver");
  });
  it("accepts a valid IANA zone and rejects an invalid one", () => {
    expect(resolveTimeZone(env({ JEFFY_TIMEZONE: "Europe/Paris" }))).toBe("Europe/Paris");
    expect(resolveTimeZone(env({ JEFFY_TIMEZONE: "Mars/Olympus" }))).toBe("America/Denver");
  });
});

describe("formatToday", () => {
  it("formats the local calendar date", () => {
    expect(formatToday(new Date("2026-11-20T18:00:00Z"), "America/Denver")).toBe("Friday, November 20, 2026");
  });
  it("uses the timezone, not UTC", () => {
    const late = new Date("2026-11-20T03:00:00Z"); // Nov 19 evening in Denver
    expect(formatToday(late, "America/Denver")).toBe("Thursday, November 19, 2026");
    expect(formatToday(late, "Asia/Tokyo")).toBe("Friday, November 20, 2026");
  });
});
