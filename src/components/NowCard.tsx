import { useEffect, useRef, useState } from "react";
import { SAMPLES_KEEP } from "../domain/progress";
import { minOfDay, parseDue, sameDay, startOfToday, ymd } from "../lib/dates";
import { blockMinutes, sortTasks, willpower } from "../lib/tasks";
import { plain } from "../lib/text";
import type { Task } from "../lib/types";
import { completeTask, scheduleTask, updateConfigFresh as updateConfig } from "../data/actions";
import { doTiny, energyToday, tinyFor, needsTiny } from "../data/habits";
import { queryClient, qk } from "../data/queries";
import { useCommitted, useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { useAppearance } from "./useAppearance";
import { useNow } from "./useNow";
import { askNextMove } from "../data/constellation";
import { addStep } from "../data/actions";
import { ApiError } from "../lib/api";

export const FOCUS_MIN = 25;
export const GUESSES = [10, 15, 25, 45, 60, 90];
const RING = 2 * Math.PI * 23;
const isDesktop = () => /Electron/i.test(navigator.userAgent);

/** What to work on now: the running focus task, else the block happening now, else your next commitment, else the top of today's list. */
function useQueue(skipped: Set<string>) {
  const { today, trayIds } = useData();
  const committed = useCommitted();
  const now = new Date();
  const open = today.filter((t) => { const d = parseDue(t.due); return d && d.d <= new Date(+startOfToday() + 864e5) && !trayIds.has(t.id) && !skipped.has(t.id); });
  // -1 = its block is happening now; a start time = still ahead today; Infinity = untimed, or its block is over.
  const timedNow = (t: Task) => {
    const d = parseDue(t.due)!;
    if (!d.hasTime || !sameDay(d.d, now)) return Infinity;
    const s = minOfDay(d.d), m = minOfDay(now);
    if (m >= s - 10 && m < s + blockMinutes(t)) return -1;
    return s > m ? s : Infinity;
  };
  const score = (t: Task) => {
    const at = timedNow(t);
    if (at === -1) return -2e4;                                   // its block is happening now
    if (committed.has(t.id)) return -1e4 + (committed.get(t.id)!.star ? -500 : 0) + (at === Infinity ? 9000 : at);
    return at === Infinity ? 0 : at - 5000;                       // upcoming blocks before the rest
  };
  const ranked = sortTasks(open, "today").map((t, i) => ({ t, k: score(t) + i / 1000 })).sort((a, b) => a.k - b.k).map((x) => x.t);
  return { ranked, committed };
}

export function NowCard({ mini = false }: { mini?: boolean }) {
  const { config, cfg, today } = useData();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const { ranked, committed } = useQueue(skipped);
  const focus = config?.focus || null;
  const focusTask = focus ? today.find((t) => t.id === focus.taskId) || ({ id: focus.taskId, content: focus.content, project_id: "", priority: 1, due: null } as Task) : null;
  const task = focusTask || ranked[0];
  const next = ranked.find((t) => t.id !== task?.id);
  const setNowTask = useUi((s) => s.setNowTask);
  useEffect(() => { if (!mini) setNowTask(task?.id || null); }, [task?.id, mini]); // eslint-disable-line
  const lowDay = energyToday(config || undefined) !== "full";
  const plannedTiny = config?.history?.[ymd(new Date())]?.planned.find((p) => p.id === task?.id)?.tiny;
  const tiny = task && (plannedTiny || (lowDay && needsTiny(task) ? tinyFor(task, config || undefined) : ""));
  const [tick, setTick] = useState(Date.now());
  const minuteNow = useNow();
  const warned = useRef("");
  // "I'm stuck": one tiny next move for this task.
  const [move, setMove] = useState<{ text: string; why?: string; fallback?: boolean } | null>(null);
  const [tried, setTried] = useState<string[]>([]);
  const [stuckBusy, setStuckBusy] = useState(false);
  useEffect(() => { setMove(null); setTried([]); }, [task?.id]);

  useEffect(() => {
    if (!focus) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [focus?.taskId, focus?.startedAt]);

  const elapsed = focus ? Math.max(0, (tick - Date.parse(focus.startedAt)) / 1000) : 0;
  const left = focus ? focus.minutes * 60 - elapsed : 0;
  useEffect(() => {
    if (!focus || left > 0 || warned.current === focus.startedAt) return;
    warned.current = focus.startedAt;
    toast(`Time's up on “${plain(focus.content).slice(0, 50)}”. Done, or 5 more minutes?`);
    // The desktop app shows its own reminder on top of everything; in a browser, a notification.
    try { if (!isDesktop() && "Notification" in window && Notification.permission === "granted") new Notification("Praxis: time's up", { body: plain(focus.content) }); } catch { /* ignore */ }
  }, [left <= 0, focus?.startedAt]); // eslint-disable-line

  if (!task) {
    if (mini) return <div className="now-card mini empty"><span className="now-label">Now</span><span className="now-title">Nothing left for today.</span></div>;
    return null;
  }

  const start = () => {
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch { /* ignore */ }
    updateConfig((c) => ({ ...c, focus: { taskId: task.id, content: task.content, startedAt: new Date().toISOString(), minutes: FOCUS_MIN } }));
  };
  const stop = () => updateConfig((c) => ({ ...c, focus: null }));
  const more = () => updateConfig((c) => (c.focus ? { ...c, focus: { ...c.focus, minutes: Math.ceil(elapsed / 60) + 5 } } : c));
  const done = () => finishNow(task, cfg, focus, elapsed);
  const stuck = async () => {
    setStuckBusy(true);
    try {
      const r = await askNextMove(task, { tried, minutesIn: running ? Math.round(elapsed / 60) : 0 });
      setMove({ text: r.move, why: r.why }); setTried((t) => [...t, r.move]);
    } catch (e) {
      const noClaude = e instanceof ApiError && e.status === 401;
      setMove({ text: `Open what you need for “${plain(task.content).slice(0, 60)}” and do just the first 2 minutes.`, fallback: true });
      toast(noClaude ? "Connect Claude (⋯ → Claude…) for a move that fits this task." : `Couldn't reach Claude: ${(e as Error).message}`);
    } finally { setStuckBusy(false); }
  };
  const keepMove = async () => { if (!move) return; try { await addStep(task.id, move.text); toast("Added as a step"); setMove(null); } catch (e) { toast(`Couldn't add it: ${(e as Error).message}`); } };
  const guess = (m: number) => updateConfig((c) => (c.focus ? { ...c, focus: { ...c.focus, guess: m } } : c));
  const snooze = () => { const dd = parseDue(task.due); if (dd?.hasTime) scheduleTask(task, minOfDay(dd.d) + 10, blockMinutes(task)); };
  const skip = () => setSkipped((s) => new Set([...s, task.id]));
  const running = !!focus && focus.taskId === task.id;
  const clock = (sec: number) => { const a = Math.abs(Math.round(sec)); return `${sec < 0 ? "+" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`; };
  const c = committed.get(task.id);
  const d = parseDue(task.due);
  // Time blindness helper: how long until the next planned block starts.
  const nowM = minOfDay(focus ? new Date(tick) : minuteNow);
  const upcoming = today.map((t) => parseDue(t.due)).filter((x) => x?.hasTime && sameDay(x.d, new Date()) && minOfDay(x.d) > nowM).map((x) => minOfDay(x!.d) - nowM).sort((a, b) => a - b);
  const nextIn = upcoming.length && upcoming[0] <= 180 ? upcoming[0] : null;

  return (
    <div className={`now-card ${mini ? "mini" : ""} ${running ? "running" : ""} ${running && left <= 0 ? "over" : ""}`} id={mini ? "now-mini" : "now-card"} data-id={task.id}>
      {!mini && <span className="now-sun" aria-hidden="true" />}
      <div className="now-main">
        <span className="now-label">{running ? "Focusing" : "Now"}{c && <span className={`commit-star ${c.star ? "the-one" : ""}`}> ★</span>}</span>
        <span className="now-title" title={plain(task.content)}>{plain(task.content)}</span>
        {!running && nextIn !== null && <span className="now-next-in" id="now-next-in">Next block in {nextIn < 60 ? `${nextIn} min` : `${Math.floor(nextIn / 60)}h ${nextIn % 60}m`}</span>}
        {tiny && <span className="now-tiny" id="now-tiny-text" title="On a low day, this counts">Tiny: {tiny}</span>}
        {move && (
          <div className="now-move" id="now-move" role="status">
            <span className="now-move-label">Try this</span>
            <span className="now-move-text" id="now-move-text">{move.text}</span>
            <span className="now-move-actions">
              {!move.fallback && <button id="now-move-another" className="now-btn" disabled={stuckBusy} onClick={stuck}>{stuckBusy ? "…" : "Another"}</button>}
              {!mini && <button id="now-move-step" className="now-btn" onClick={keepMove}>Add as a step</button>}
              <button className="now-btn" aria-label="Dismiss" onClick={() => setMove(null)}>×</button>
            </span>
          </div>
        )}
        {running && !focus?.guess && elapsed < 180 && (
          <div className="now-guess" id="now-guess"><span>How long will it take?</span>
            {GUESSES.map((m) => <button key={m} id={`now-guess-${m}`} className="now-chip" onClick={() => guess(m)}>{m < 60 ? `${m}m` : `${m / 60 === 1 ? "1h" : `${m / 60}h`}`}</button>)}
          </div>
        )}
        {!mini && <span className="now-meta">{running && focus?.guess ? `you guessed ${focus.guess}m · ` : ""}{d?.hasTime ? `${d.d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ` : ""}{blockMinutes(task)}m{next ? <> · next: <span className="now-next">{plain(next.content).slice(0, 48)}</span></> : null}</span>}
      </div>
      <div className="now-actions">
        {running ? <>
          <span className="now-ring" title={left >= 0 ? "Time left" : "Over time"}>
            <svg viewBox="0 0 54 54" aria-hidden="true"><circle className="track" cx="27" cy="27" r="23" /><circle className="fill" cx="27" cy="27" r="23" strokeDasharray={RING} strokeDashoffset={RING * Math.min(1, Math.max(0, elapsed / ((focus?.minutes || FOCUS_MIN) * 60)))} /></svg>
            <span className="now-clock" id="now-clock">{clock(left)}</span>
          </span>
          <button id="now-done" className="now-btn done" title="Done" onClick={done}>✓</button>
          <button id="now-more" className="now-btn" title="5 more minutes" onClick={more}>+5</button>
          <button id="now-stop" className="now-btn" title="Stop the timer" onClick={stop}>■</button>
          <button id="now-stuck" className="now-btn stuck" title="Get one tiny next move" disabled={stuckBusy} onClick={stuck}>{stuckBusy ? "Thinking…" : "I'm stuck"}</button>
        </> : <>
          <button id="now-start" className="now-btn start" title={`Start a ${FOCUS_MIN}-minute focus session`} onClick={start}>▶ Start</button>
          <button id="now-done" className="now-btn done" title="Already done" onClick={done}>✓</button>
          {tiny && <button id="now-tiny" className="now-btn tiny" title={`I did the tiny version: ${tiny}`} onClick={() => doTiny(task)}>✓ Tiny</button>}
          {d?.hasTime && sameDay(d.d, new Date()) && minOfDay(new Date()) >= minOfDay(d.d) - 10 && minOfDay(new Date()) < minOfDay(d.d) + blockMinutes(task) && <button id="now-snooze" className="now-btn" title="Push this block 10 minutes later" onClick={snooze}>+10m</button>}
          {!focus && <button id="now-skip" className="now-btn" title="Not now: show the next one" onClick={skip}>↷</button>}
          <button id="now-stuck" className="now-btn stuck" title="Get one tiny next move" disabled={stuckBusy} onClick={stuck}>{stuckBusy ? "Thinking…" : "I'm stuck"}</button>
        </>}
        {!mini && isDesktop() && <button id="now-popout" className="now-btn" title="Keep this on top of other windows" onClick={() => window.open(`${location.origin}/?mini=1`, "praxis-now")}>⧉</button>}
        {mini && <button className="now-btn close" title="Close" onClick={() => window.close()}>×</button>}
      </div>
    </div>
  );
}

/** The always-on-top pop-out (desktop app): just the Now card, kept in sync with the main window. */
export function NowMini() {
  const { connected } = useData();
  useAppearance();
  useEffect(() => {
    document.body.classList.add("mini-body");
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: qk.config });
      queryClient.invalidateQueries({ queryKey: qk.today });
    }, 4000);
    return () => clearInterval(id);
  }, []);
  useUi(); // keep the store alive for toasts
  if (!connected) return <div className="now-card mini empty"><span className="now-title">Open Praxis to connect first.</span></div>;
  return <NowCard mini />;
}

/** Finish the Now task: record how long a timed session took, clear the timer, complete it. */
export async function finishNow(task: Task, cfg: ReturnType<typeof useData>["cfg"], focus: { taskId: string; guess?: number } | null, elapsedSec: number) {
  const actual = focus && focus.taskId === task.id ? Math.round(elapsedSec / 60) : 0;
  const g = (focus && focus.taskId === task.id && (focus as { guess?: number }).guess) || undefined;
  updateConfig((c) => ({
    ...c, focus: null,
    // A timed session teaches Praxis how long this kind of task really takes (ignore accidental 1-minute runs).
    samples: actual >= 3 ? [...(c.samples || []), { wp: willpower(task, cfg), est: blockMinutes(task), actual: Math.min(actual, 600), at: new Date().toISOString(), ...(g ? { guess: g } : {}) }].slice(-SAMPLES_KEEP) : c.samples,
  }));
  await completeTask(task);
  // After the "Completed" message (and its Undo) has had its moment.
  if (g && actual >= 3) setTimeout(() => toast(guessVerdict(g, actual)), 2600);
}

/** One line after a guessed session: how close you were. */
export function guessVerdict(guess: number, actual: number) {
  const off = Math.abs(actual - guess) / Math.max(guess, 1);
  if (off <= 0.15) return `Spot on: you guessed ${guess} min and it took ${actual}.`;
  return actual > guess ? `You guessed ${guess} min; it took ${actual}. Things tend to take longer than they feel.` : `You guessed ${guess} min; it only took ${actual}.`;
}
