// Real weather for the valley (3.5), from the US National Weather Service (api.weather.gov).
// Its data is open and free to use; each request names the app in a User-Agent header. Nothing to sign up for.
// This file only turns the service's answers into the valley's few kinds of weather; the desktop app does the fetching.
import type { Weather } from "./model";

export interface ValleyWeather { kind: Weather; wind: number; tempC: number | null; text: string; at: string; source: "station" | "forecast"; station?: string;
  /** 3.9: the forecast's highest and lowest for the rest of today (the desktop app adds what it has already seen since midnight). */
  hiC?: number | null; loC?: number | null }

/** 3.9: the highest and lowest temperature the hourly forecast still expects today (periods of forecastHourly). */
export function todayRange(periods: Record<string, unknown>[] | undefined, now = new Date()): { hiC: number | null; loC: number | null } {
  const day = now.toDateString();
  const temps = (periods || []).filter((p) => typeof p?.startTime === "string" && new Date(p.startTime as string).toDateString() === day && typeof p.temperature === "number")
    .map((p) => (p.temperatureUnit === "C" ? (p.temperature as number) : ((p.temperature as number) - 32) * 5 / 9));
  return temps.length ? { hiC: Math.max(...temps), loC: Math.min(...temps) } : { hiC: null, loC: null };
}

const KMH = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const RAIN = /rain|drizzle|shower|thunder|storm/i, SNOW = /snow|sleet|ice pellets|flurr|blizzard|freezing/i, MIST = /fog|mist|haze|smoke/i, CLOUD = /cloudy|overcast/i;
const wind01 = (kmh: number | null) => (kmh === null ? 0.2 : Math.max(0, Math.min(1, kmh / 40)));

/** In deep winter, cold rain in the valley falls as snow (the valley is higher than Milpitas). */
function winterize(kind: Weather, tempC: number | null, when: Date): Weather {
  const m = when.getMonth();
  if (kind === "rain" && (m === 11 || m <= 1) && tempC !== null && tempC < 7.2) return "snow";
  return kind;
}

/** From a station's latest observation (properties of /stations/{id}/observations/latest). */
export function fromObservation(p: Record<string, unknown>, when = new Date()): ValleyWeather | null {
  if (!p || typeof p !== "object") return null;
  const text = String(p.textDescription || "");
  const present = Array.isArray(p.presentWeather) ? (p.presentWeather as { weather?: string; rawString?: string }[]).map((w) => `${w.weather || ""} ${w.rawString || ""}`).join(" ") : "";
  const layers = Array.isArray(p.cloudLayers) ? (p.cloudLayers as { amount?: string }[]).map((l) => l.amount || "") : [];
  const vis = KMH((p.visibility as { value?: unknown })?.value);
  const tempC = KMH((p.temperature as { value?: unknown })?.value);
  const kmh = KMH((p.windSpeed as { value?: unknown })?.value);
  const all = `${text} ${present}`;
  if (!text && !present && !layers.length && vis === null) return null;      // an empty reading: use the forecast instead
  let kind: Weather = "clear";
  if (SNOW.test(all)) kind = "snow";
  else if (RAIN.test(all)) kind = "rain";
  else if (MIST.test(all) || (vis !== null && vis < 3000)) kind = "mist";
  else if (layers.some((a) => a === "BKN" || a === "OVC") || CLOUD.test(text)) kind = "cloudy";
  return { kind: winterize(kind, tempC, when), wind: wind01(kmh), tempC, text: text || present.trim() || "—", at: String(p.timestamp || when.toISOString()), source: "station" };
}

/** From the hourly forecast's current period (properties.periods[0] of the gridpoint's forecastHourly). */
export function fromForecast(period: Record<string, unknown>, when = new Date()): ValleyWeather | null {
  if (!period || typeof period !== "object") return null;
  const text = String(period.shortForecast || "");
  const tempF = typeof period.temperature === "number" ? period.temperature : null;
  const tempC = tempF === null ? null : (period.temperatureUnit === "C" ? tempF : (tempF - 32) * 5 / 9);
  const mph = Number(String(period.windSpeed || "").match(/(\d+)(?!.*\d)/)?.[1] ?? NaN);
  const pop = (period.probabilityOfPrecipitation as { value?: number } | undefined)?.value ?? 0;
  let kind: Weather = "clear";
  if (SNOW.test(text)) kind = "snow";
  else if (RAIN.test(text) && pop >= 40) kind = "rain";
  else if (MIST.test(text)) kind = "mist";
  else if (CLOUD.test(text) || /mostly cloudy|chance/i.test(text)) kind = "cloudy";
  return { kind: winterize(kind, tempC, when), wind: wind01(Number.isFinite(mph) ? mph * 1.609 : null), tempC, text: text || "—", at: when.toISOString(), source: "forecast" };
}
