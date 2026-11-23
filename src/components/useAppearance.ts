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
    el.dataset.sky = skyAt(now.getHours());
  }, [theme, evening, ui.focus, now.getHours()]); // eslint-disable-line
  return { theme, evening, focus: !!ui.focus };
}

/** Which part of the sky we're in: tints the Now card. */
export function skyAt(h: number) {
  if (h >= 5 && h < 9) return "dawn";
  if (h >= 9 && h < 17) return "day";
  if (h >= 17 && h < 19) return "gold";
  if (h >= 19 && h < 21) return "dusk";
  return "night";
}
