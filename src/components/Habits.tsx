import { useEffect, useMemo, useRef, useState } from "react";
import { habitStreak } from "../domain/progress";
import { parseDue, sameDay, minOfDay, ymd } from "../lib/dates";
import { plain } from "../lib/text";
import type { Task } from "../lib/types";
import { AWAY_DAYS, PILE, daysAway, freshStart, overdueNow } from "../data/habits";
import { proposePlan } from "../data/planActions";
import { useCompleted } from "../data/queries";
import { useData } from "../data/useData";
import { useUi } from "../state/ui";
import { Dialog } from "./common";
import { finishNow } from "./NowCard";

// ---------- never-miss-twice streak ----------
export function StreakChip() {
  const { config, connected } = useData();
  const completedQ = useCompleted(connected);
  const s = habitStreak(config, completedQ.data || []);
  if (!config || (!s.days && !s.todayDone)) return null;
  const title = s.atRisk
    ? `You missed yesterday. One small thing today (a tiny version counts) keeps your ${s.days}-day streak. Two misses in a row ends it.`
    : s.todayDone ? `Today counts. ${s.days} day${s.days === 1 ? "" : "s"} in a row (one missed day is allowed, never two).`
    : `${s.days} day${s.days === 1 ? "" : "s"}. Do one committed thing or close the day to keep it going.`;
  return (
    <span id="streak-chip" className={`streak-chip ${s.atRisk ? "risk" : s.todayDone ? "done" : ""}`} title={title}>
      <b>{s.days}</b>-day streak{s.atRisk ? " · keep it alive today" : s.todayDone ? " ✓" : ""}
    </span>
  );
}

// ---------- fresh start ----------
export function FreshStartDialog() {
  return <Dialog name="fresh" id="fresh-dialog" className="fresh-dialog"><FreshBody /></Dialog>;
}

function FreshBody() {
  const { config, today, cfg } = useData();
  const close = useUi((s) => s.closeDialog);
  const pile = useMemo(() => overdueNow(today), [today]);
  const away = useUi((s) => s.awayDays) || daysAway(config);
  const repeats = pile.filter((t) => t.due?.is_recurring).length;
  const [busy, setBusy] = useState(false);
  const go = async (mode: "spread" | "someday") => {
    setBusy(true);
    try { await freshStart(pile, mode); } finally { setBusy(false); }
    close("fresh");
    if (cfg.morningCommit) setTimeout(() => { proposePlan().then(() => useUi.getState().openDialog("morning")); }, 1200);
  };
  return (
    <div className="fresh-form">
      <h2>Welcome back.</h2>
      <p className="dialog-sub">
        {away > 1 ? `It's been ${away} days. ` : ""}{pile.length} task{pile.length === 1 ? "" : "s"} piled up while you were away. That's normal, and you don't have to dig through it.
        Start fresh: nothing gets deleted, it just stops shouting at you.
      </p>
      <ul className="fresh-list">{pile.slice(0, 6).map((t) => <li key={t.id}>{plain(t.content)}</li>)}{pile.length > 6 && <li className="more">and {pile.length - 6} more</li>}</ul>
      <div className="fresh-actions">
        <button type="button" id="fresh-spread" className="primary" disabled={busy} onClick={() => go("spread")}>Spread them over the next week</button>
        <button type="button" id="fresh-someday" className="ghost-btn" disabled={busy} onClick={() => go("someday")}>Park them all in Someday</button>
        <button type="button" id="fresh-look" className="ghost-btn" disabled={busy} onClick={() => { close("fresh"); useUi.getState().openDialog("triage"); }}>Let me look through them</button>
      </div>
      {repeats > 0 && <p className="fresh-note">Missed repeating tasks ({repeats}) just start again today either way.</p>}
    </div>
  );
}

/** Opens the fresh start when you come back after 2+ days away to a pile of overdue tasks. Returns true if it did. */
export function shouldFreshStart(config: { lastOpen?: string } | undefined, today: Task[]) {
  return daysAway(config as never) >= AWAY_DAYS && overdueNow(today).length >= PILE;
}

// ---------- notifications when a block starts ----------
const isDesktop = () => /Electron/i.test(navigator.userAgent);

/** When a planned block starts and you're elsewhere, a notification; clicking it opens the Now pop-out (desktop) or Praxis. */
export function useBlockNotifications() {
  const { today } = useData();
  const sent = useRef(new Set<string>());
  useEffect(() => {
    const tick = () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const now = new Date(), m = minOfDay(now);
      for (const t of today) {
        const d = parseDue(t.due);
        if (!d?.hasTime || !sameDay(d.d, now)) continue;
        const start = minOfDay(d.d), key = `${t.id}@${ymd(now)}@${start}`;
        if (m < start || m > start + 2 || sent.current.has(key)) continue;
        sent.current.add(key);
        if (document.hasFocus()) continue; // you're looking at Praxis already
        const n = new Notification(`Now: ${plain(t.content)}`, { body: isDesktop() ? "Click to start, or open it on top of your other windows." : "Click to open Praxis.", tag: key });
        n.onclick = () => { if (isDesktop()) window.open(`${location.origin}/?mini=1`, "praxis-now"); else window.focus(); n.close(); };
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [today]);
}

/** Ctrl+Alt+D from anywhere (desktop app): mark the Now task done. */
export function useDoneHotkey() {
  const { cfg } = useData();
  useEffect(() => {
    const onDone = () => {
      const ui = useUi.getState();
      if (ui.view !== "day") ui.setView("day");
      setTimeout(() => {
        const id = useUi.getState().nowTaskId;
        const task = id && (window.__praxisToday?.() || []).find((t) => t.id === id);
        if (!task) { ui.showToast("Nothing in Now to mark done."); return; }
        finishNow(task, cfg, null, 0);
        try { if (!document.hasFocus() && Notification.permission === "granted") new Notification("Done ✓", { body: plain(task.content) }); } catch { /* ignore */ }
      }, 300);
    };
    window.addEventListener("praxis:now-done", onDone);
    return () => window.removeEventListener("praxis:now-done", onDone);
  }, [cfg]);
}

// ---------- celebration ----------
export function Celebration() {
  const cheer = useUi((s) => s.cheer);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!cheer.n) return;
    setMsg(cheer.msg);
    const hide = setTimeout(() => setMsg(""), 4200);
    const c = canvas.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!c || reduced) return () => clearTimeout(hide);
    const ctx = c.getContext("2d")!;
    c.width = innerWidth; c.height = innerHeight;
    const colors = ["#c8553d", "#d4a017", "#2f8f5b", "#3b78d8", "#a855f7"];
    const bits = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0; const t0 = performance.now();
    const frame = (t: number) => {
      ctx.clearRect(0, 0, c.width, c.height);
      const life = (t - t0) / 1800;
      for (const b of bits) {
        b.vy += 0.35; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vx *= 0.99;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - life); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (life < 1) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(hide); };
  }, [cheer.n]); // eslint-disable-line
  return <>
    <canvas ref={canvas} className="confetti" aria-hidden="true" />
    {msg && <div className="cheer" id="cheer" role="status">{msg}</div>}
  </>;
}

declare global { interface Window { __praxisToday?: () => Task[] } }
