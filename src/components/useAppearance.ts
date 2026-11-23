import { sunTimes } from "../domain/sun";
import { useEffect } from "react";
import { useData } from "../data/useData";
import { useMedia, useNow } from "./useNow";

export const EVENING_FROM = 20; // 8 PM

/** Applies theme (auto follows Windows), the evening warm-up and focus mode to the page. */
export function useAppearance() {
  const { config } = useData();
  const ui = config?.ui || {};
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  const now = useNow();
  const theme = ui.theme === "dark" || ui.theme === "light" ? ui.theme : systemDark ? "dark" : "light";
  const evening = ui.warmEvenings !== false && (now.getHours() >= EVENING_FROM || now.getHours() < 5);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    if (evening) el.dataset.evening = ""; else delete el.dataset.evening;
    if (ui.focus) el.dataset.focus = ""; else delete el.dataset.focus;
    el.dataset.sky = skyAt(now);
  }, [theme, evening, ui.focus, Math.floor((now.getHours() * 60 + now.getMinutes()) / 5)]); // eslint-disable-line
  return { theme, evening, focus: !!ui.focus };
}

/** Which part of the sky we're in, from today's real sunrise and sunset: tints the app, the Now card and reminders. */
export function skyAt(d: Date) {
  const { rise, set } = sunTimes(d);
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= rise - 60 && m < rise + 75) return "dawn";
  if (m >= rise + 75 && m < set - 80) return "day";
  if (m >= set - 80 && m < set + 10) return "gold";
  if (m >= set + 10 && m < set + 75) return "dusk";
  return "night";
}
