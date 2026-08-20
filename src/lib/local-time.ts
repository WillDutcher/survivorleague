/**
 * Local wall-clock time in a named timezone.
 *
 * Vercel cron speaks only UTC, so "1 PM Eastern" is 17:00 UTC for most of the
 * season and 18:00 UTC after the November clock change. Jobs that must happen
 * at a local time are scheduled at BOTH offsets and then check the local hour
 * themselves. This is that check.
 *
 * Kept free of database and framework imports so it can be unit tested, since
 * an off-by-one here sends a "picks are locked" email while picks are still
 * open — which is exactly the class of bug that already bit the default-pick
 * job once.
 *
 * Uses Intl so the DST rules come from the platform tz database rather than
 * hardcoded dates that go stale.
 */
export interface LocalTime {
  hour: number;
  minute: number;
  weekday: string;
}

export function localTimeIn(timezone: string, now: Date): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";

  return {
    // hour12:false renders midnight as "24" in some environments.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** True once the local wall clock has reached hour:minute. */
export function isAtOrAfterLocal(
  timezone: string,
  now: Date,
  hour: number,
  minute = 0,
): boolean {
  const t = localTimeIn(timezone, now);
  return t.hour > hour || (t.hour === hour && t.minute >= minute);
}
