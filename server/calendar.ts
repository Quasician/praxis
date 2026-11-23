// Reads Google Calendar (read-only) through each calendar's "secret address in iCal format".
import { eventsBetween } from "./ics";
import type { CalendarConfig } from "./store";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; text: string }>();
export const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function normalizeCalUrl(u: unknown): string | null {
  const s = String(u || "").trim().replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol === "https:") return url.toString();
  // Test-only: allow a local http calendar when PRAXIS_TEST_HTTP_CAL=1.
  if (process.env.PRAXIS_TEST_HTTP_CAL === "1" && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) return url.toString();
  return null;
}

export async function fetchCalendarText(url: string, force = false): Promise<string> {
  const hit = cache.get(url);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Praxis/1.0" } });
    if (!r.ok) throw new Error(r.status === 404 ? "Calendar not found. Check the link (it may have been reset)." : `Calendar server said ${r.status}`);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("That link didn't return a calendar (.ics). Use the “Secret address in iCal format”.");
    cache.set(url, { at: Date.now(), text });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const errMessage = (e: unknown) => (e instanceof Error ? (e.name === "AbortError" ? "Timed out" : e.message) : String(e));

export async function eventsForRange(cals: CalendarConfig[], from: number, to: number, force: boolean) {
  const events: Record<string, unknown>[] = [];
  const errors: { id: string; name: string; error: string }[] = [];
  await Promise.all(cals.filter((c) => c.enabled !== false && c.url).map(async (c) => {
    const u = normalizeCalUrl(c.url);
    if (!u) { errors.push({ id: c.id, name: c.name, error: "Invalid link" }); return; }
    try {
      const text = await fetchCalendarText(u, force);
      for (const e of eventsBetween(text, from, to, localTz).events) events.push({ ...e, calendarId: c.id, calendar: c.name, color: c.color });
    } catch (e) {
      errors.push({ id: c.id, name: c.name, error: errMessage(e) });
    }
  }));
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { events, errors };
}

export async function testCalendar(rawUrl: unknown) {
  const u = normalizeCalUrl(rawUrl);
  if (!u) throw new Error("Paste the full https:// link (the “Secret address in iCal format”).");
  try {
    const text = await fetchCalendarText(u, true);
    const now = Date.now();
    const { name, events } = eventsBetween(text, now, now + 7 * 86400000, localTz);
    return { ok: true, name, upcoming: events.length, next: events.slice(0, 3).map((e) => ({ title: e.title, start: e.start, allDay: e.allDay })) };
  } catch (e) {
    throw new Error(errMessage(e) === "Timed out" ? "Timed out reaching the calendar." : errMessage(e));
  }
}
