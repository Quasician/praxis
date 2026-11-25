// The city wallpaper (3.9): what to show at a given moment. Pure functions, no drawing.
// The city is 32 paintings (4 seasons x 8 moments of the day) in your city kit folder. At any minute the picture is two of
// them blended, timed from the real sunrise and sunset here; the sun, moon, stars, window lights and weather go on top.
import { sunTimes, DEFAULT_LAT, DEFAULT_LNG } from "../domain/sun";
import { moonPhase, type RGB, type Weather } from "../valley/model";

export const CITY_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export const CITY_MOMENTS = ["dawn", "sunrise", "noon", "golden", "sunset", "dusk", "night", "overcast"] as const;
export type CitySeason = (typeof CITY_SEASONS)[number];
export type CityMoment = (typeof CITY_MOMENTS)[number];
/** Every painting the city needs, by file name (without .png): spring-dawn … winter-overcast, and one mask per season. */
export const CITY_FILES = [...CITY_SEASONS.flatMap((s) => CITY_MOMENTS.map((m) => `${s}-${m}`)), ...CITY_SEASONS.map((s) => `${s}-mask`)];

/** Where the bay meets the sky in the paintings, as a fraction of the height from the top. */
export const CITY_HORIZON = 0.63;

const sm = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const wrap = (m: number) => ((m % 1440) + 1440) % 1440;

/** The season on the calendar: spring from 20 March, summer from 21 June, autumn from 22 September, winter from 21 December. */
export function citySeason(d: Date): CitySeason {
  const m = d.getMonth() + 1, day = d.getDate(), k = m * 100 + day;
  if (k >= 320 && k < 621) return "spring";
  if (k >= 621 && k < 922) return "summer";
  if (k >= 922 && k < 1221) return "autumn";
  return "winter";
}

/** Which two paintings are on screen at this minute of the day, and how far between them (0 = all a, 1 = all b). */
export function cityBlend(minute: number, rise: number, set: number): [CityMoment, CityMoment, number] {
  const keys: [number, CityMoment][] = [[rise - 85, "night"], [rise - 30, "dawn"], [rise + 5, "sunrise"], [rise + 130, "noon"], [set - 170, "noon"],
    [set - 65, "golden"], [set - 5, "sunset"], [set + 35, "dusk"], [set + 100, "night"]];
  if (minute <= keys[0][0] || minute >= keys[keys.length - 1][0]) return ["night", "night", 0];
  for (let i = 1; i < keys.length; i++) if (minute <= keys[i][0]) {
    const [m0, a] = keys[i - 1], [m1, b] = keys[i];
    return [a, b, a === b ? 0 : sm((minute - m0) / (m1 - m0))];
  }
  return ["night", "night", 0];
}

export interface CityBody { x: number; y: number; r: number; strength: number; color: RGB }
/** The sun rises and sets at the centre of the horizon (where the paintings put it) and arcs up over the viewpoint, out of the top
 *  of the frame, in between. Design units: 5120 x 2160, y down. */
export function citySun(minute: number, rise: number, set: number): CityBody {
  const p = (minute - rise) / (set - rise);
  const el = Math.sin(Math.PI * Math.max(-.12, Math.min(1.12, p)));     // just below the horizon either side of the day
  const x = (.5 + .05 * Math.sin(2 * Math.PI * Math.max(0, Math.min(1, p)))) * 5120;
  const y = (CITY_HORIZON - Math.sign(el) * Math.pow(Math.abs(el), 1.7) * 1.3) * 2160;   // low for a while, then quickly up and over
  const low = 1 - Math.min(1, Math.max(0, el) * 2.2);                   // 1 at the horizon, 0 well up
  const strength = p > -.1 && p < 1.1 ? sm((el + .12) / .2) : 0;
  return { x, y, r: (.026 + .010 * low) * 2160, strength: strength * (.75 + .25 * low), color: [255, (.93 - .28 * low) * 255, (.78 - .52 * low) * 255] };
}

/** The moon crosses from left to right through the night, in its real phase. */
export function cityMoon(minute: number, rise: number, set: number): CityBody & { phase: number } {
  const start = set + 50, len = 1440 - (set + 50) + (rise - 50);
  const p = wrap(minute - start) / len;
  if (p < 0 || p > 1) return { x: 0, y: -1000, r: 56, strength: 0, color: [236, 240, 252], phase: 0 };
  return { x: (.14 + .72 * p) * 5120, y: (CITY_HORIZON - .02 - Math.sin(Math.PI * p) * .46) * 2160, r: .026 * 2160,
    strength: sm(p / .08) * sm((1 - p) / .08), color: [236, 240, 252], phase: 0 };
}

/** How dark it is (0 by day, 1 at night): drives the stars and how much the weather greys the night. */
export function cityNight(minute: number, rise: number, set: number) {
  const m = wrap(minute);
  if (m < rise) return sm((rise - 40 - m) / 50);
  return sm((m - (set + 45)) / 55);
}

/** How many windows are lit (0..1) and how strongly the one-by-one switching applies. Evening runs on into the next morning. */
export function cityLights(minute: number, rise: number, set: number) {
  const m = minute < 720 ? minute + 1440 : minute, R = rise + 1440;
  let on = sm((m - (set - 40)) / 150);                 // windows come on through dusk
  on *= 1 - .45 * sm((m - 1410) / 200);                // some go out after half past eleven
  on = Math.max(on, .25 * sm((m - (R - 110)) / 50));   // early risers
  on *= 1 - sm((m - (R - 30)) / 60);                   // the rest go out around sunrise
  const gate = sm((m - (set - 100)) / 60) * (1 - sm((m - (R + 20)) / 40));
  return { on, gate };
}

/** How much the grey-day painting's light is laid over the picture, and whether it rains. */
export function cityWeather(weather: Weather | undefined, night: number) {
  switch (weather) {
    case "rain": return { over: 1 - .2 * night, rain: 1, mist: 0 };
    case "snow": return { over: .85 - .2 * night, rain: 0, mist: 0 };
    case "cloudy": return { over: .6 * (1 - .55 * night), rain: 0, mist: 0 };
    case "mist": return { over: .35 * (1 - .55 * night), rain: 0, mist: 1 };
    default: return { over: 0, rain: 0, mist: 0 };
  }
}

export interface CityPlan {
  season: CitySeason; a: CityMoment; b: CityMoment; k: number; minute: number; rise: number; set: number;
  sun: CityBody; moon: CityBody & { phase: number }; night: number; lights: { on: number; gate: number };
  over: number; rain: number; mist: number;
  /** The paintings to have loaded for this moment (the two on screen and the grey day), plus the season's mask. */
  files: string[];
}
export function cityPlan(when: Date, weather?: Weather, lat = DEFAULT_LAT, lng = DEFAULT_LNG): CityPlan {
  const { rise, set } = sunTimes(when, lat, lng);
  const minute = when.getHours() * 60 + when.getMinutes() + when.getSeconds() / 60;
  const season = citySeason(when);
  const [a, b, k] = cityBlend(minute, rise, set);
  const night = cityNight(minute, rise, set);
  const moon = { ...cityMoon(minute, rise, set), phase: moonPhase(when) };
  moon.strength *= night;
  const wx = cityWeather(weather, night);
  const files = [...new Set([`${season}-${a}`, `${season}-${b}`, `${season}-overcast`, `${season}-mask`])];
  return { season, a, b, k, minute, rise, set, sun: citySun(minute, rise, set), moon, night, lights: cityLights(minute, rise, set), ...wx, files };
}
