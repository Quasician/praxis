// 5.0: keeps the day's trace (where each block sat, what moved) in the record as blocks appear, move and go.
import { useEffect, useMemo } from "react";
import { minOfDay, parseDue, sameDay, ymd } from "../lib/dates";
import { blockMinutes } from "../lib/tasks";
import type { Config, DayRecord, Task } from "../lib/types";
import { noteSeen, traceOf, type OpenBlock } from "../domain/trace";
import { updateConfigFresh } from "./actions";
import { useCompleted } from "./queries";
import { useData } from "./useData";

/** Today's open blocks with a time. */
export function openBlocks(today: Task[], now = new Date()): OpenBlock[] {
  const out: OpenBlock[] = [];
  for (const t of today) {
    const d = parseDue(t.due);
    if (d?.hasTime && sameDay(d.d, now)) out.push({ id: t.id, content: t.content, start: minOfDay(d.d), dur: blockMinutes(t), project: t.project_id });
  }
  return out;
}

/** Ids finished today: ticked off (here or anywhere) or answered "done" at a check-in. */
export function doneToday(completed: Task[] | undefined, rec: DayRecord | undefined, now = new Date()): Set<string> {
  const s = new Set<string>();
  for (const t of completed || []) if (t.completed_at && sameDay(new Date(t.completed_at), now)) s.add(t.id);
  for (const [id, a] of Object.entries(rec?.actual || {})) if (a.o === "done") s.add(id);
  return s;
}

/** Writes the trace when today's blocks change (in the main window only). Every minute too, so a block that left gets settled. */
export function useDayTrace(enabled: boolean) {
  const { today, config, connected, loading } = useData();
  const completed = useCompleted(connected && enabled).data;
  const key = useMemo(() => openBlocks(today).map((b) => `${b.id}@${b.start}+${b.dur}`).sort().join("|"), [today]);
  useEffect(() => {
    if (!enabled || loading || !config) return;
    const run = () => {
      const now = new Date(), day = ymd(now);
      const rec = config.history?.[day] as DayRecord | undefined;
      const next = noteSeen(rec, openBlocks(today, now), minOfDay(now), doneToday(completed, rec, now));
      if (next) updateConfigFresh((c: Config) => {
        const r = (c.history?.[day] as DayRecord | undefined) || { planned: [] };
        // Recompute against the freshest record so two windows never undo each other.
        const fresh = noteSeen(r, openBlocks(today, now), minOfDay(now), doneToday(completed, r, now));
        return fresh ? { ...c, history: { ...(c.history || {}), [day]: { ...r, ...fresh } } } : c;
      }).catch(() => undefined);
    };
    run();
    const id = setInterval(run, 60_000);
    return () => clearInterval(id);
  }, [enabled, loading, key, completed, config?.history]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** What the day draws besides its open blocks (see domain/trace). */
export function useTrace() {
  const { today, config, connected } = useData();
  const completed = useCompleted(connected).data;
  const now = new Date(), rec = config?.history?.[ymd(now)] as DayRecord | undefined;
  const open = new Set(openBlocks(today, now).map((b) => b.id));
  return traceOf(rec, open, doneToday(completed, rec, now));
}
