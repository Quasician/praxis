// A small, dependency-free iCalendar (.ics) reader.
// Enough of RFC 5545 for Google Calendar's "secret address in iCal format":
//   • time zones (TZID, UTC "Z", floating, all-day dates), DST-correct
//   • repeating events: DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL,
//     COUNT, UNTIL, BYDAY (incl. "2TU", "-1FR"), BYMONTHDAY, BYMONTH
//   • EXDATE (skipped occurrences) and RECURRENCE-ID (moved/edited/cancelled ones)

const DAY = 86400000;
const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type Params = Record<string, string>;
interface Prop { value: string; params: Params }
interface RawEvent {
  uid?: string; summary?: string; location?: string; status?: string; transp?: string;
  dtstart?: Prop; dtend?: Prop; duration?: string; rrule?: string; recurrenceId?: Prop; exdates: Prop[];
}
interface Wall { y: number; m: number; d: number; h: number; mi: number; s: number }
interface Stamp extends Wall { dateOnly: boolean; utc: boolean }
interface Resolved { allDay: boolean; wall: Wall; tz: string; utc: number }

export interface CalEvent {
  uid?: string; title: string; location: string; start: string; end: string;
  allDay: boolean; date?: string; endDate?: string; transparent: boolean;
}

// ---------- parsing ----------
const unfold = (text: string) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");

function parseLine(line: string): { name: string; params: Params; value: string } {
  let i = 0, inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) break;
  }
  const parts = line.slice(0, i).split(";");
  const name = (parts.shift() || "").toUpperCase();
  const params: Params = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value: line.slice(i + 1) };
}

const unescapeText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

export function parseICS(text: string) {
  const cal: { name: string | null; tz: string | null; events: RawEvent[] } = { name: null, tz: null, events: [] };
  let cur: RawEvent | null = null;
  const depth: string[] = [];
  for (const raw of unfold(text)) {
    if (!raw.trim()) continue;
    const { name, params, value } = parseLine(raw);
    if (name === "BEGIN") { depth.push(value.toUpperCase()); if (value.toUpperCase() === "VEVENT") cur = { exdates: [] }; continue; }
    if (name === "END") { const v = depth.pop(); if (v === "VEVENT" && cur) { cal.events.push(cur); cur = null; } continue; }
    const where = depth[depth.length - 1];
    if (where === "VCALENDAR") {
      if (name === "X-WR-CALNAME") cal.name = unescapeText(value);
      if (name === "X-WR-TIMEZONE") cal.tz = value;
      continue;
    }
    if (where !== "VEVENT" || !cur) continue;
    switch (name) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.summary = unescapeText(value); break;
      case "LOCATION": cur.location = unescapeText(value); break;
      case "STATUS": cur.status = value.toUpperCase(); break;
      case "TRANSP": cur.transp = value.toUpperCase(); break;
      case "DTSTART": cur.dtstart = { value, params }; break;
      case "DTEND": cur.dtend = { value, params }; break;
      case "DURATION": cur.duration = value; break;
      case "RRULE": cur.rrule = value; break;
      case "RECURRENCE-ID": cur.recurrenceId = { value, params }; break;
      case "EXDATE": for (const v of value.split(",")) cur.exdates.push({ value: v, params }); break;
    }
  }
  return cal;
}

// ---------- time zones ----------
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function tzOffsetMs(utcMs: number, tz: string): number {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dtfCache.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(new Date(utcMs))) p[type] = value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
function validTz(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
/** Wall-clock components in `tz` → UTC milliseconds (DST-aware). */
export function wallToUtc(w: Wall, tz: string): number {
  const guess = Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s);
  if (tz === "UTC") return guess;
  const utc = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(utc, tz);
}

function parseStamp(value: string): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2] - 1, d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), dateOnly: !m[4], utc: !!m[7] };
}

function resolve(prop: Prop | undefined, defaultTz: string): Resolved | null {
  if (!prop) return null;
  const st = parseStamp(prop.value);
  if (!st) return null;
  if (st.dateOnly || prop.params.VALUE === "DATE") return { allDay: true, wall: st, tz: "UTC", utc: Date.UTC(st.y, st.m, st.d) };
  if (st.utc) return { allDay: false, wall: st, tz: "UTC", utc: Date.UTC(st.y, st.m, st.d, st.h, st.mi, st.s) };
  const tz = validTz(prop.params.TZID) ? prop.params.TZID : defaultTz;
  return { allDay: false, wall: st, tz, utc: wallToUtc(st, tz) };
}

export function parseDuration(s: string | undefined): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec((s || "").trim());
  if (!m) return null;
  const ms = +(m[2] || 0) * 7 * DAY + +(m[3] || 0) * DAY + +(m[4] || 0) * 3600000 + +(m[5] || 0) * 60000 + +(m[6] || 0) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// ---------- repeating events ----------
interface ByDay { n: number | null; wd: number }
interface Rule { freq: string; interval: number; count: number | null; until: string | null; byday: ByDay[] | null; bymonthday: number[] | null; bymonth: number[] | null; supported: boolean }

export function parseRRule(s: string): Rule {
  const r: Record<string, string> = {};
  for (const part of s.split(";")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) r[k.toUpperCase()] = v;
  }
  return {
    freq: r.FREQ,
    interval: Math.max(1, +(r.INTERVAL || 1)),
    count: r.COUNT ? +r.COUNT : null,
    until: r.UNTIL || null,
    byday: r.BYDAY ? r.BYDAY.split(",").map((x) => { const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim()); return m ? { n: m[1] ? +m[1] : null, wd: WEEKDAYS[m[2]] } : null; }).filter((x): x is ByDay => !!x) : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null,
    bymonth: r.BYMONTH ? r.BYMONTH.split(",").map((x) => +x - 1) : null,
    supported: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(r.FREQ),
  };
}

interface Civil { y: number; m: number; d: number; wd: number }
const civil = (y: number, m: number, d: number) => Date.UTC(y, m, d);
const fromCivil = (ms: number): Civil => { const t = new Date(ms); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay() }; };
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const mondayOf = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;

function matchesNthWeekday(c: Civil, n: number | null, wd: number) {
  if (c.wd !== wd) return false;
  if (n === null) return true;
  const idx = Math.floor((c.d - 1) / 7) + 1;
  const fromEnd = Math.floor((daysInMonth(c.y, c.m) - c.d) / 7) + 1;
  return n > 0 ? idx === n : fromEnd === -n;
}
const monthDayMatches = (c: Civil, n: number) => (n > 0 ? c.d === n : c.d === daysInMonth(c.y, c.m) + n + 1);

function dayMatches(rule: Rule, start: Wall, c: Civil): boolean {
  const s = fromCivil(civil(start.y, start.m, start.d));
  const cMs = civil(c.y, c.m, c.d), sMs = civil(s.y, s.m, s.d);
  switch (rule.freq) {
    case "DAILY":
      if (Math.round((cMs - sMs) / DAY) % rule.interval) return false;
      if (rule.bymonth && !rule.bymonth.includes(c.m)) return false;
      if (rule.byday && !rule.byday.some((b) => b.wd === c.wd)) return false;
      return true;
    case "WEEKLY": {
      if (Math.round((mondayOf(cMs) - mondayOf(sMs)) / (7 * DAY)) % rule.interval) return false;
      return (rule.byday ? rule.byday.map((b) => b.wd) : [s.wd]).includes(c.wd);
    }
    case "MONTHLY": {
      if (((c.y - s.y) * 12 + (c.m - s.m)) % rule.interval) return false;
      if (rule.bymonthday) return rule.bymonthday.some((n) => monthDayMatches(c, n));
      if (rule.byday) return rule.byday.some((b) => matchesNthWeekday(c, b.n, b.wd));
      return c.d === s.d;
    }
    case "YEARLY": {
      if ((c.y - s.y) % rule.interval) return false;
      if (!(rule.bymonth || [s.m]).includes(c.m)) return false;
      if (rule.bymonthday) return rule.bymonthday.some((n) => monthDayMatches(c, n));
      if (rule.byday) return rule.byday.some((b) => matchesNthWeekday(c, b.n, b.wd));
      return c.d === s.d;
    }
  }
  return false;
}

function occurrences(ev: RawEvent, start: Resolved, windowEnd: number): number[] {
  const rule = parseRRule(ev.rrule || "");
  if (!rule.supported) return [start.utc];
  let untilMs = Infinity;
  if (rule.until) {
    const u = resolve({ value: rule.until, params: {} }, start.tz);
    if (u) untilMs = u.allDay ? u.utc + DAY - 1 : u.utc;
  }
  const out: number[] = [];
  const last = Math.min(windowEnd, untilMs);
  let dayMs = civil(start.wall.y, start.wall.m, start.wall.d);
  let n = 0;
  for (let guard = 0; guard < 40000; guard++, dayMs += DAY) {
    const c = fromCivil(dayMs);
    if (!dayMatches(rule, start.wall, c)) continue;
    const w = { y: c.y, m: c.m, d: c.d, h: start.wall.h, mi: start.wall.mi, s: start.wall.s };
    const utc = start.allDay ? Date.UTC(c.y, c.m, c.d) : wallToUtc(w, start.tz);
    if (utc < start.utc) continue;
    if (utc > last) break;
    out.push(utc);
    if (rule.count && ++n >= rule.count) break;
  }
  return out;
}

// ---------- public ----------
/** Events overlapping [fromMs, toMs). */
export function eventsBetween(text: string, fromMs: number, toMs: number, fallbackTz?: string): { name: string | null; events: CalEvent[] } {
  const cal = parseICS(text);
  const defaultTz = validTz(cal.tz) ? cal.tz : validTz(fallbackTz) ? fallbackTz : "UTC";
  const masters: RawEvent[] = [];
  const overrides = new Map<string, RawEvent>();
  for (const ev of cal.events) {
    if (!ev.dtstart) continue;
    if (ev.recurrenceId) {
      const rid = resolve(ev.recurrenceId, defaultTz);
      if (rid) overrides.set(`${ev.uid}|${rid.utc}`, ev);
    } else masters.push(ev);
  }

  const out: CalEvent[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();
  const push = (ev: RawEvent, startUtc: number, allDay: boolean, lengthMs: number) => {
    if (ev.status === "CANCELLED") return;
    const endUtc = startUtc + lengthMs;
    if (endUtc <= fromMs || startUtc >= toMs) return;
    out.push({
      uid: ev.uid, title: ev.summary || "(No title)", location: ev.location || "",
      start: iso(startUtc), end: iso(endUtc), allDay,
      ...(allDay ? { date: iso(startUtc).slice(0, 10), endDate: iso(endUtc).slice(0, 10) } : {}),
      transparent: ev.transp === "TRANSPARENT",
    });
  };
  const lengthOf = (ev: RawEvent, start: Resolved) => {
    const end = resolve(ev.dtend, defaultTz);
    if (end) return Math.max(0, end.utc - start.utc);
    const d = parseDuration(ev.duration);
    if (d !== null) return d;
    return start.allDay ? DAY : 0;
  };

  for (const ev of masters) {
    const start = resolve(ev.dtstart, defaultTz);
    if (!start) continue;
    const len = lengthOf(ev, start);
    if (!ev.rrule) { push(ev, start.utc, start.allDay, len); continue; }
    const ex = new Set(ev.exdates.map((x) => { const r = resolve(x, start.tz); return r && r.utc; }));
    for (const occ of occurrences(ev, start, toMs)) {
      if (ex.has(occ)) continue;
      const key = `${ev.uid}|${occ}`;
      const ov = overrides.get(key);
      if (ov) {
        overrides.delete(key);
        const os = resolve(ov.dtstart, defaultTz);
        if (os) push(ov, os.utc, os.allDay, lengthOf(ov, os));
        continue;
      }
      push(ev, occ, start.allDay, len);
    }
  }
  for (const ov of overrides.values()) {
    const os = resolve(ov.dtstart, defaultTz);
    if (os) push(ov, os.utc, os.allDay, lengthOf(ov, os));
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return { name: cal.name, events: out };
}
