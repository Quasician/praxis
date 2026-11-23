// Sunrise and sunset for the Horizon's sky (NOAA's simple solar formula; a few minutes' accuracy is plenty here).
// Defaults to the San Francisco Bay Area; the sky only needs to feel right, not navigate a ship.

const rad = Math.PI / 180;
export const DEFAULT_LAT = 37.4, DEFAULT_LNG = -121.9;

/** Minutes after local midnight of sunrise and sunset on that date. */
export function sunTimes(date: Date, lat = DEFAULT_LAT, lng = DEFAULT_LNG): { rise: number; set: number } {
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start.getTime()) / 864e5);
  const g = (2 * Math.PI / 365) * (doy - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const ha = Math.acos(Math.max(-1, Math.min(1, cosHa))) / rad;
  const tz = -date.getTimezoneOffset();                       // minutes east of UTC, DST included
  const noon = 720 - 4 * lng - eqTime + tz;
  return { rise: Math.round(noon - 4 * ha), set: Math.round(noon + 4 * ha) };
}

/** Sky colour stops across the timeline (as % of its span), from the real sunrise and sunset. */
export function skyStops(rise: number, set: number, from: number, to: number) {
  const pct = (m: number) => Math.max(0, Math.min(100, ((m - from) / (to - from)) * 100));
  return [
    ["--sky-night", pct(rise - 70)], ["--sky-dawn", pct(rise)], ["--sky-day", pct(rise + 90)],
    ["--sky-day", pct(set - 100)], ["--sky-gold", pct(set - 35)], ["--sky-dusk", pct(set + 15)], ["--sky-night", pct(set + 70)],
  ] as const;
}
