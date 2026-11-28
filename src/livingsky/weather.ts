// Real weather for the wallpaper (3.5; the living sky since 5.1), from the US National Weather Service (api.weather.gov).
// Its data is open and free to use; each request names the app in a User-Agent header. Nothing to sign up for.
// This file only turns the service's answers into a few kinds of weather and symbols; the desktop app does the fetching.

/** The broad kind of weather, from the observation or forecast text. */
export type Weather = "clear" | "cloudy" | "mist" | "rain" | "snow";

export interface WeatherReading { kind: Weather; wind: number; tempC: number | null; text: string; at: string; source: "station" | "forecast"; station?: string;
  /** 3.9: the forecast's highest and lowest for the rest of today (the desktop app adds what it has already seen since midnight). */
  hiC?: number | null; loC?: number | null;
  /** 3.9: the symbol for the conditions now, and how many of today's remaining forecast hours look like each symbol. */
  icon?: SkyIcon; icons?: Partial<Record<SkyIcon, number>> }

/** 3.9: the weather symbols the wallpaper can show next to the temperature. */
export type SkyIcon = "sun" | "partly" | "cloud" | "fog" | "rain" | "storm" | "snow";
/** The symbol for a weather.gov description ("Mostly Sunny", "Chance Light Rain", "Patchy Fog"…). */
export function iconOf(text: string): SkyIcon {
  const t = text.toLowerCase();
  if (/thunder|t-storm|tstorm/.test(t)) return "storm";
  if (SNOW.test(t)) return "snow";
  if (RAIN.test(t)) return "rain";
  if (MIST.test(t)) return "fog";
  if (/partly|mostly sunny|mostly clear|few clouds|scattered/.test(t)) return "partly";
  if (CLOUD.test(t) || /mostly cloudy|cloud/.test(t)) return "cloud";
  return "sun";
}
/** The symbol most of the day has: the hours already seen and the forecast for the rest, added up. Rain or snow wins ties. */
export function dayIcon(...counts: (Partial<Record<SkyIcon, number>> | null | undefined)[]): SkyIcon | null {
  const sum: Partial<Record<SkyIcon, number>> = {};
  for (const c of counts) for (const [k, v] of Object.entries(c || {})) sum[k as SkyIcon] = (sum[k as SkyIcon] || 0) + (v || 0);
  const order: SkyIcon[] = ["storm", "snow", "rain", "fog", "cloud", "partly", "sun"];
  let best: SkyIcon | null = null;
  for (const k of order) if ((sum[k] || 0) > 0 && (best === null || (sum[k] || 0) > (sum[best] || 0))) best = k;
  return best;
}

/** 3.9: the highest and lowest temperature the hourly forecast still expects today (periods of forecastHourly). */
export function todayRange(periods: Record<string, unknown>[] | undefined, now = new Date()): { hiC: number | null; loC: number | null; icons: Partial<Record<SkyIcon, number>> } {
  const day = now.toDateString();
  const today = (periods || []).filter((p) => typeof p?.startTime === "string" && new Date(p.startTime as string).toDateString() === day);
  const temps = today.filter((p) => typeof p.temperature === "number")
    .map((p) => (p.temperatureUnit === "C" ? (p.temperature as number) : ((p.temperature as number) - 32) * 5 / 9));
  const icons: Partial<Record<SkyIcon, number>> = {};
  for (const p of today) { const k = iconOf(String(p.shortForecast || "")); icons[k] = (icons[k] || 0) + 1; }
  return temps.length ? { hiC: Math.max(...temps), loC: Math.min(...temps), icons } : { hiC: null, loC: null, icons };
}

const KMH = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const RAIN = /rain|drizzle|shower|thunder|storm/i, SNOW = /snow|sleet|ice pellets|flurr|blizzard|freezing/i, MIST = /fog|mist|haze|smoke/i, CLOUD = /cloudy|overcast/i;
const wind01 = (kmh: number | null) => (kmh === null ? 0.2 : Math.max(0, Math.min(1, kmh / 40)));

/** From a station's latest observation (properties of /stations/{id}/observations/latest). */
export function fromObservation(p: Record<string, unknown>, when = new Date()): WeatherReading | null {
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
  return { kind: kind, wind: wind01(kmh), tempC, text: text || present.trim() || "—", at: String(p.timestamp || when.toISOString()), source: "station", icon: iconOf(`${text} ${present}`) };
}

/** From the hourly forecast's current period (properties.periods[0] of the gridpoint's forecastHourly). */
export function fromForecast(period: Record<string, unknown>, when = new Date()): WeatherReading | null {
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
  return { kind: kind, wind: wind01(Number.isFinite(mph) ? mph * 1.609 : null), tempC, text: text || "—", at: when.toISOString(), source: "forecast", icon: iconOf(text) };
}
