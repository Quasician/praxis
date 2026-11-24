import { useEffect, useMemo, useRef, useState } from "react";
import { habitStreak } from "../domain/progress";
import { parseDue, sameDay, minOfDay, ymd } from "../lib/dates";
import { plain } from "../lib/text";
import type { Project, Task } from "../lib/types";
import type { Slot } from "../domain/nudges";
import { blockMinutes } from "../lib/tasks";
import { completeTask, reconcileSoon, updateConfigFresh } from "../data/actions";
import { sync, uuid } from "../lib/api";
import { pendingCount } from "../data/pending";
import { AWAY_DAYS, PILE, daysAway, freshStart, overdueNow } from "../data/habits";
import { proposePlan } from "../data/planActions";
import { inboxOf, qk, queryClient, useCompleted } from "../data/queries";
import { useData } from "../data/useData";
import { useUi } from "../state/ui";
import type { CheerKind } from "../state/ui";
import { Dialog } from "./common";
import { FOCUS_MIN, finishNow } from "./NowCard";

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
    if (isDesktop()) return; // the desktop app shows its own reminders, on top of full-screen apps too
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
  const [kind, setKind] = useState<CheerKind>("confetti");
  useEffect(() => {
    if (!cheer.n) return;
    const k = cheer.kind || "confetti";
    setMsg(cheer.msg); setKind(k);
    const hide = setTimeout(() => setMsg(""), k === "aurora" ? 6500 : 4200);
    const c = canvas.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!c || reduced) return () => clearTimeout(hide);
    const ctx = c.getContext("2d")!;
    c.width = innerWidth; c.height = innerHeight;
    let raf = 0; const t0 = performance.now();
    let frame: (t: number) => void;
    if (k === "meteor") {
      // One bright streak from the upper right, down and to the left, with a soft tail and a few sparks.
      const W = c.width, H = c.height, x0 = W * 0.86, y0 = H * 0.06, x1 = W * 0.2, y1 = H * 0.42, dur = 1300;
      // White on a night page; warm gold on a light one, so it shows either way.
      const dark = document.documentElement.dataset.theme === "dark";
      const [cr, cg, cb] = dark ? [255, 246, 226] : [222, 150, 40];
      const sparks: { x: number; y: number; vx: number; vy: number; t: number }[] = [];
      frame = (t) => {
        const u = (t - t0) / dur;
        ctx.clearRect(0, 0, W, H);
        const head = Math.min(1, u), fade = u > 1 ? Math.max(0, 1 - (u - 1) / 0.5) : 1;
        const hx = x0 + (x1 - x0) * head, hy = y0 + (y1 - y0) * head;
        const tail = 0.32, tx = x0 + (x1 - x0) * Math.max(0, head - tail), ty = y0 + (y1 - y0) * Math.max(0, head - tail);
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, `rgba(${cr},${cg},${cb},0)`); g.addColorStop(1, `rgba(${cr},${cg},${cb},${0.95 * fade})`);
        ctx.strokeStyle = g; ctx.lineWidth = dark ? 3 : 4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 26);
        glow.addColorStop(0, `rgba(${cr},${cg},${cb},${0.9 * fade})`); glow.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, hy, 26, 0, Math.PI * 2); ctx.fill();
        if (u < 1 && Math.random() < 0.6) sparks.push({ x: hx, y: hy, vx: (Math.random() - 0.3) * 1.5, vy: Math.random() * 1.2, t });
        for (const p of sparks) {
          const a = 1 - (t - p.t) / 700; if (a <= 0) continue;
          p.x += p.vx; p.y += p.vy; ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * 0.8 * fade})`; ctx.fillRect(p.x, p.y, 2, 2);
        }
        if (u < 1.5) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
      };
    } else if (k === "aurora") {
      // Curtains of green and violet light along the top of the window, breathing for a few seconds.
      const W = c.width, H = c.height, dur = 6000;
      const bands = Array.from({ length: 5 }, (_, i) => ({ y: H * (0.08 + i * 0.035), amp: 18 + i * 6, f: 0.004 + i * 0.0013, ph: Math.random() * 6, hue: i % 2 ? [150, 110, 240] : [90, 235, 165] }));
      frame = (t) => {
        const u = (t - t0) / dur, env = Math.sin(Math.PI * Math.min(1, u)) ** 0.8;
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";
        for (const b of bands) {
          for (let x = 0; x < W; x += 6) {
            const y = b.y + Math.sin(x * b.f + b.ph + u * 3) * b.amp + Math.sin(x * b.f * 2.7 - u * 2) * b.amp * 0.4;
            const flick = 0.55 + 0.45 * Math.sin(x * 0.05 + u * 9 + b.ph);
            const g = ctx.createLinearGradient(x, y - 90, x, y + 14);
            g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(${b.hue[0]},${b.hue[1]},${b.hue[2]},${0.11 * env * flick})`);
            ctx.fillStyle = g; ctx.fillRect(x, y - 90, 6, 104);
          }
        }
        ctx.globalCompositeOperation = "source-over";
        if (u < 1) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
      };
    } else {
      const colors = ["#c8553d", "#d4a017", "#2f8f5b", "#3b78d8", "#a855f7"];
      const bits = Array.from({ length: 140 }, () => ({
        x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)],
      }));
      frame = (t) => {
        ctx.clearRect(0, 0, c.width, c.height);
        const life = (t - t0) / 1800;
        for (const b of bits) {
          b.vy += 0.35; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vx *= 0.99;
          ctx.save(); ctx.globalAlpha = Math.max(0, 1 - life); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
        }
        if (life < 1) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
      };
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(hide); };
  }, [cheer.n]); // eslint-disable-line
  return <>
    <canvas ref={canvas} className="confetti" aria-hidden="true" data-kind={kind} />
    {msg && <div className={`cheer cheer-${kind}`} id="cheer" role="status" data-kind={kind}>{msg}</div>}
  </>;
}

declare global { interface Window { __praxisToday?: () => Task[]; __praxisSchedule?: () => Slot[]; __praxisCapture?: (text: string) => Promise<{ ok: boolean; queued?: boolean; title?: string; error?: string }> } }

// ---------- the desktop app's reminders ----------
/** Lets the desktop app read today's timed blocks and act on its reminder buttons (Done, Start, +5 min). */
export function useDesktopBridge() {
  useEffect(() => {
    if (!isDesktop()) return;
    const todayTasks = () => window.__praxisToday?.() || [];
    window.__praxisSchedule = () => {
      const now = new Date();
      return todayTasks().flatMap((t) => {
        const d = parseDue(t.due);
        if (!d?.hasTime || !sameDay(d.d, now)) return [];
        const start = d.d.getTime();
        return [{ id: t.id, title: plain(t.content), start, end: start + blockMinutes(t) * 60_000 }];
      });
    };
    // 3.6: the capture hotkey sends the clipboard here; it becomes a task in your Inbox (kept for later if Todoist is down).
    window.__praxisCapture = async (text: string) => {
      const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return { ok: false, error: "Nothing to capture: copy some text first." };
      let title = lines[0], desc = lines.slice(1).join("\n");
      if (title.length > 300) { desc = `…${title.slice(290)}${desc ? `\n${desc}` : ""}`; title = `${title.slice(0, 290)}…`; }
      const inbox = inboxOf(queryClient.getQueryData<Project[]>(qk.projects));
      if (!inbox) return { ok: false, error: "Couldn't find your Inbox in Todoist." };
      const before = pendingCount();
      try {
        const failed = await sync([{ type: "item_add", uuid: uuid(), args: { content: title, description: desc.slice(0, 15000), project_id: inbox.id } }]);
        if (failed.length) return { ok: false, error: "Todoist didn't accept it." };
        reconcileSoon(1500);
        return { ok: true, queued: pendingCount() > before, title };
      } catch (e) { return { ok: false, error: (e as Error).message }; }
    };
    const find = (e: Event) => todayTasks().find((t) => t.id === (e as CustomEvent<string>).detail);
    const onDone = (e: Event) => { const t = find(e); if (t) completeTask(t); };
    const onStart = (e: Event) => {
      const t = find(e);
      if (!t) return;
      useUi.getState().setNowTask(t.id);
      updateConfigFresh((c) => ({ ...c, focus: { taskId: t.id, content: t.content, startedAt: new Date().toISOString(), minutes: FOCUS_MIN } }));
    };
    const onMore = () => updateConfigFresh((c) => (c.focus ? { ...c, focus: { ...c.focus, minutes: Math.ceil((Date.now() - Date.parse(c.focus.startedAt)) / 60_000) + 5 } } : c));
    const onStop = () => updateConfigFresh((c) => ({ ...c, focus: null }));
    window.addEventListener("praxis:complete", onDone);
    window.addEventListener("praxis:start-focus", onStart);
    window.addEventListener("praxis:focus-more", onMore);
    window.addEventListener("praxis:focus-stop", onStop);
    return () => {
      window.removeEventListener("praxis:complete", onDone);
      window.removeEventListener("praxis:start-focus", onStart);
      window.removeEventListener("praxis:focus-more", onMore);
      window.removeEventListener("praxis:focus-stop", onStop);
    };
  }, []);
}
