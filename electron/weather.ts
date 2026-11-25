// Fetches the weather for the valley from the National Weather Service, every 15 minutes while the wallpaper is on.
// No key, no account: each request names the app (User-Agent), as the service asks. Location: Milpitas unless set.
import { fromForecast, fromObservation, todayRange, type ValleyWeather } from "../src/valley/weather";

const UA = "Praxis/3.5 (https://github.com/Quasician/praxis)";
type Point = { stations: string; hourly: string; at: number };
let point: Point | null = null;
let station: { id: string; at: number } | null = null;

async function get(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`weather.gov answered ${r.status}`);
  return r.json() as Promise<Record<string, any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The current weather at (lat, lng): the nearest station's reading, or the hourly forecast when the station has nothing. */
export async function currentWeather(lat: number, lng: number, base = process.env.PRAXIS_NWS_BASE || "https://api.weather.gov"): Promise<ValleyWeather> {
  const day = 24 * 3600_000;
  if (!point || Date.now() - point.at > day) {
    const j = await get(`${base}/points/${lat.toFixed(4)},${lng.toFixed(4)}`);
    point = { stations: j.properties?.observationStations, hourly: j.properties?.forecastHourly, at: Date.now() };
  }
  // 3.9: the hourly forecast every time, for today's high and low (and as the fallback below).
  let hourly: Record<string, unknown>[] | undefined;
  try { hourly = (await get(point.hourly)).properties?.periods; } catch { /* the station may still answer */ }
  const range = todayRange(hourly);
  try {
    if (!station || Date.now() - station.at > day) {
      const s = await get(point.stations);
      const id = s.features?.[0]?.properties?.stationIdentifier;
      if (id) station = { id, at: Date.now() };
    }
    if (station) {
      const o = await get(`${base}/stations/${station.id}/observations/latest`);
      const ageMin = (Date.now() - Date.parse(o.properties?.timestamp || "")) / 60_000;
      const w = ageMin < 180 ? fromObservation(o.properties) : null;
      // Stations often report the sky but leave the temperature blank for a reading: take this hour's from the forecast then.
      if (w && w.tempC === null) w.tempC = fromForecast(hourly?.[0] as Record<string, unknown>)?.tempC ?? null;
      if (w) return { ...w, station: station.id, ...range };
    }
  } catch { /* the forecast below still works */ }
  const w = fromForecast((hourly || (await get(point.hourly)).properties?.periods)?.[0]);
  if (!w) throw new Error("weather.gov had no forecast for here");
  return { ...w, ...range };
}
