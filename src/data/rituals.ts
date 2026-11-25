// 4.3 Which rituals are waiting, in order: what the marker in the top bar shows and the ritual panel offers next.
// No components here, so the panel (components/common.tsx) and the marker can both use it.
import { useMemo } from "react";
import { minOfDay, toMin, ymd } from "../lib/dates";
import { reviewDue } from "../domain/review";
import type { DialogName } from "../state/ui";
import { useData } from "./useData";
import { useNow } from "../components/useNow";

export interface Due { name: DialogName; label: string; short: string }
export const RITUAL_TITLES: Partial<Record<DialogName, string>> = {
  morning: "Morning commit", shutdown: "Shut down the day", review: "Weekly review", letter: "Sunday letter",
  triage: "Needs a decision", backlog: "Clean up the backlog", fresh: "Fresh start", heal: "Yesterday's leftovers",
};

export function useDueRituals(): Due[] {
  const { config, cfg, trayIds } = useData();
  const now = useNow();
  const minute = Math.floor(minOfDay(now) / 5);
  return useMemo(() => {
    if (!config) return [];
    const out: Due[] = [];
    const today = ymd(now);
    if (cfg.morningCommit && !config.history?.[today]?.committedAt && now.getHours() >= 5 && now.getHours() < 12 && minOfDay(now) < toMin(cfg.shutdownAt))
      out.push({ name: "morning", label: "Commit to today", short: "Morning" });
    if (minOfDay(now) >= toMin(cfg.shutdownAt) && cfg.lastShutdown !== today) out.push({ name: "shutdown", label: "Shut down the day", short: "Shutdown" });
    if (reviewDue(config.reviews, now)) out.push({ name: "review", label: "Weekly review", short: "Review" });
    const letters = Object.keys(config.letters || {}).sort(), last = letters.length ? config.letters![letters[letters.length - 1]] : null;
    if (last && !last.read && now.getTime() - Date.parse(last.at) < 2 * 864e5) out.push({ name: "letter", label: "Your Sunday letter", short: "Letter" });
    if (trayIds.size) out.push({ name: "triage", label: `${trayIds.size} need${trayIds.size === 1 ? "s" : ""} a decision`, short: `${trayIds.size} to decide` });
    return out;
  }, [config, cfg, trayIds, minute]); // eslint-disable-line react-hooks/exhaustive-deps
}
