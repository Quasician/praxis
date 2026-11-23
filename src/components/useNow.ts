import { useEffect, useState } from "react";

/** The current time, updated every minute (keeps the "now" line and "past" blocks fresh). */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Re-renders when a CSS media query starts or stops matching. */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on); on();
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Taller hours on tall screens, so the whole day (6 AM – midnight) uses the height you have. Sets --hour. */
export function useHourHeight(): number {
  const calc = () => Math.max(64, Math.min(120, Math.floor((window.innerHeight - 230) / 18)));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const on = () => setH(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  useEffect(() => { document.documentElement.style.setProperty("--hour", `${h}px`); }, [h]);
  document.documentElement.style.setProperty("--hour", `${h}px`); // before this render's positions are computed
  return h;
}
