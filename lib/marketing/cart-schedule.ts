import type { CartConfig } from "./cart-config";

/** Find an actual future instant, including DST changes and fractional-hour zones. */
export function cartEmailNextAllowed(config: CartConfig, timezone?: string, at = new Date()): Date | null {
  let clock: Intl.DateTimeFormat;
  try {
    clock = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "America/Los_Angeles", hour: "numeric", hourCycle: "h23" });
  } catch {
    clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" });
  }
  const start = config.sendStartHour ?? 9, end = config.sendEndHour ?? 20;
  const allowed = (date: Date) => { const hour = Number(clock.format(date)); return hour >= start && hour < end; };
  if (allowed(at)) return null;
  for (let minute = Math.ceil((+at + 1) / 60000); minute < +at / 60000 + 26 * 60; minute++) {
    const next = new Date(minute * 60000);
    if (allowed(next)) return next;
  }
  throw new Error("Cart email sending window could not be calculated");
}
