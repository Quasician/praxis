// 3.7: rewards. The aurora after a week of kept commitments, legends for finished projects, and the Sunday letter.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { ymd } from "../lib/dates";
import { plain } from "../lib/text";
import type { Config, Task } from "../lib/types";
import { dayStats } from "../domain/progress";
import { auroraEarned, keptStreak, letterWeek, plainLetter, type Letter, type WeekSummary } from "../domain/rewards";
import { quickAdd, updateConfig } from "../data/actions";
import { useCompleted } from "../data/queries";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";

const DAY = 864e5;

/** Watches for the rewards that come from your history rather than a single click. */
export function useRewards() {
  const { config, connected, today } = useData();
  const completedQ = useCompleted(connected);
  const completed = completedQ.data;
  const ready = !!config && completedQ.isSuccess;
  const todayKey = ymd(new Date());

  // The aurora: the evening a run of kept commitments reaches a week.
  useEffect(() => {
    if (!ready) return;
    const streak = keptStreak(dayStats(config, completed!, 28), todayKey);
    const earned = auroraEarned(streak, config!.rewards, todayKey);
    if (!earned) return;
    updateConfig((c) => ({ ...c, rewards: { ...(c.rewards || {}), aurora: earned } })).catch(() => undefined);
    useUi.getState().celebrate(`${streak} days of kept commitments. The aurora's out tonight.`, "aurora");
  }, [ready, completed, config?.history, today]); // eslint-disable-line react-hooks/exhaustive-deps

  useLegends(config);
  useSundayLetter(config, completed, ready);
}

// ---------- legends ----------
const tried = new Set<string>();
/** When a project finishes, Claude writes it a one-line legend (once; quietly skipped without Claude). */
function useLegends(config: Config | undefined) {
  const busy = useRef(false);
  useEffect(() => {
    const cons = config?.sky?.cons;
    if (!cons || busy.current) return;
    const fresh = Object.entries(cons).filter(([id, c]) => c.finished && !c.legend && !tried.has(id) && Date.now() - Date.parse(c.finished) < 14 * DAY);
    if (!fresh.length) return;
    const [id, c] = fresh[0];
    tried.add(id); busy.current = true;
    const days = Math.max(1, Math.round((Date.parse(c.finished!) - Date.parse(c.since)) / DAY));
    api<{ legend: string }>("/api/claude/legend", { method: "POST", body: { name: c.name, steps: c.steps.map((s) => s.title).slice(0, 40), days } })
      .then(({ legend }) => updateConfig((cfg) => {
        const was = cfg.sky?.cons?.[id];
        if (!was || !legend) return cfg;
        return { ...cfg, sky: { ...cfg.sky!, cons: { ...cfg.sky!.cons, [id]: { ...was, legend } } } };
      }))
      .catch(() => undefined)
      .finally(() => { busy.current = false; });
  }, [config?.sky]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- the Sunday letter ----------
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** What the week held, for the letter: the 7 days ending on the letter's Sunday. */
export function weekSummary(config: Config | undefined, completed: Task[], week: string): WeekSummary {
  const end = new Date(`${week}T23:59:59`).getTime(), start = end - 7 * DAY;
  const inWeek = completed.filter((t) => t.completed_at && Date.parse(t.completed_at) > start && Date.parse(t.completed_at) <= end);
  const perDay = new Array(7).fill(0);
  for (const t of inWeek) perDay[new Date(t.completed_at!).getDay()]++;
  const top = perDay.indexOf(Math.max(...perDay));
  const stats = dayStats(config, completed, 28).filter((d) => d.day > ymd(new Date(start)) && d.day <= week && d.committed);
  const projects = Object.values(config?.sky?.cons || {})
    .map((c) => ({ name: c.name, lit: c.steps.filter((s) => s.done && Date.parse(s.done) > start && Date.parse(s.done) <= end).length, finished: !!c.finished && Date.parse(c.finished) > start && Date.parse(c.finished) <= end }))
    .filter((p) => p.lit || p.finished).slice(0, 12);
  return {
    done: inWeek.map((t) => plain(t.content).slice(0, 140)).slice(0, 60),
    total: inWeek.length,
    kept: stats.filter((d) => d.committedDone >= d.committed).length,
    committedDays: stats.length,
    projects,
    busiest: inWeek.length >= 3 && perDay[top] > 1 ? WEEKDAYS[top] : undefined,
  };
}

let writing = false;
function useSundayLetter(config: Config | undefined, completed: Task[] | undefined, ready: boolean) {
  useEffect(() => {
    if (!ready || writing || config?.planner?.sundayLetter === false) return;
    const now = new Date();
    if (now.getDay() > 1) return;                 // written on Sunday, or on Monday if you didn't open Praxis on Sunday
    const week = letterWeek(now.getDay() === 1 ? new Date(now.getTime() - DAY) : now);
    if (config?.letters?.[week]) return;
    if (now.getDay() === 0 && now.getHours() < 9) return; // let Sunday happen first
    writing = true;
    const s = weekSummary(config, completed!, week);
    const save = (l: Letter) => updateConfig((c) => {
      const letters = { ...(c.letters || {}), [week]: l };
      for (const k of Object.keys(letters).sort().slice(0, -8)) delete letters[k];   // keep the last 8
      return { ...c, letters };
    });
    api<{ paragraphs: string[]; suggestion: string }>("/api/claude/letter", { method: "POST", body: { week, ...s } })
      .then((r) => save({ week, at: new Date().toISOString(), paragraphs: r.paragraphs, suggestion: r.suggestion || undefined, byClaude: true }))
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return save({ week, at: new Date().toISOString(), ...plainLetter(s), byClaude: false }); })
      .catch(() => undefined)
      .finally(() => { writing = false; });
  }, [ready, config?.letters, completed]); // eslint-disable-line react-hooks/exhaustive-deps
}

const latestLetter = (config: Config | undefined) => {
  const ks = Object.keys(config?.letters || {}).sort();
  return ks.length ? config!.letters![ks[ks.length - 1]] : null;
};

/** A small card at the top of the list on Sunday (and Monday) when the letter's waiting. */
export function LetterCard() {
  const { config } = useData();
  const open = useUi((s) => s.openDialog);
  const l = latestLetter(config);
  if (!l || l.read || Date.now() - Date.parse(l.at) > 2 * DAY) return null;
  return (
    <div className="letter-card" id="letter-card" role="status">
      <span className="letter-seal" aria-hidden="true">✉</span>
      <strong>Your Sunday letter is here.</strong>
      <span className="spacer" />
      <button type="button" id="letter-open" className="ghost-btn" onClick={() => open("letter")}>Read it</button>
    </div>
  );
}

export function LetterDialog() {
  return <Dialog name="letter" id="letter-dialog" className="letter-dialog"><LetterBody /></Dialog>;
}
function LetterBody() {
  const { config } = useData();
  const close = useUi((s) => s.closeDialog);
  const l = latestLetter(config);
  const [added, setAdded] = useState(false);
  const when = useMemo(() => (l ? new Date(`${l.week}T12:00:00`).toLocaleDateString([], { month: "long", day: "numeric" }) : ""), [l]);
  useEffect(() => {
    if (l && !l.read) updateConfig((c) => ({ ...c, letters: { ...(c.letters || {}), [l.week]: { ...c.letters![l.week], read: true } } })).catch(() => undefined);
  }, [l?.week]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return <div className="letter"><p className="dialog-sub">Your first letter comes on Sunday.</p></div>;
  return (
    <article className="letter">
      <p className="letter-date">Sunday, {when}</p>
      {l.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      {l.suggestion && (
        <div className="letter-suggestion">
          <p><span className="muted">For next week:</span> {l.suggestion}</p>
          <button type="button" id="letter-add" className="ghost-btn" disabled={added} onClick={async () => { setAdded(true); try { await quickAdd(l.suggestion!, false); } catch { setAdded(false); toast("Couldn't add that. Try again."); } }}>{added ? "Added to your Inbox" : "Add it to my Inbox"}</button>
        </div>
      )}
      <p className="letter-sign">{l.byClaude ? "— Claude" : "— Praxis"}</p>
      <div className="fresh-actions"><button type="button" id="letter-close" className="primary" onClick={() => close("letter")}>Close</button></div>
    </article>
  );
}
