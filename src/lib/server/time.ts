import "server-only";

const DEFAULT_TIMEZONE = "America/Denver";

/** JEFFY_TIMEZONE if it is a valid IANA zone, else America/Denver. */
export function resolveTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const tz = env.JEFFY_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// Calendar date in `timeZone` for `now`, as a UTC-midnight Date.
function localDate(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(now);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(n("year"), n("month") - 1, n("day")));
}

/** e.g. "Friday, November 20, 2026" for the calendar date in `timeZone`. */
export function formatToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(localDate(now, timeZone));
}
