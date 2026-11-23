import { useEffect, useState } from "react";
import { clockText, type Nudge as N, type NudgeKind } from "../domain/nudges";
import { api } from "../lib/api";
import { skyAt } from "./useAppearance";

// The floating reminder card. The desktop app opens it in its own small window that sits on top of
// everything (full-screen apps included) without taking keyboard focus.

const LABEL: Record<NudgeKind, string> = {
  start: "Starting now", "heads-up": "Coming up", "focus-end": "Focus timer", shutdown: "Evening",
  "wind-down": "Evening", "time-check": "Time check", test: "Praxis",
};

type Btn = { action: string; label: string; primary?: boolean };
const BUTTONS: Record<NudgeKind, Btn[]> = {
  start: [{ action: "start", label: "Start focus", primary: true }, { action: "done", label: "Already done" }, { action: "later", label: "In 10 min" }],
  "heads-up": [{ action: "dismiss", label: "Got it", primary: true }],
  "focus-end": [{ action: "done", label: "Done", primary: true }, { action: "more", label: "+5 min" }, { action: "stop", label: "Stop timer" }],
  shutdown: [{ action: "shutdown", label: "Shut down now", primary: true }, { action: "later", label: "In 15 min" }],
  "wind-down": [{ action: "dismiss", label: "Winding down", primary: true }, { action: "later", label: "In 15 min" }],
  "time-check": [{ action: "dismiss", label: "Thanks", primary: true }],
  test: [{ action: "dismiss", label: "Looks good", primary: true }],
};

const COLLAPSE_AFTER = 30_000; // a reminder you haven't answered shrinks to a small pill, but stays
const AUTO_HIDE = 15_000;      // heads-ups and time checks just fade away

function chime() {
  try {
    const ctx = new AudioContext();
    [[659.25, 0], [987.77, 0.18]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(0.07, ctx.currentTime + t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 1.4);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 1.5);
    });
  } catch { /* no audio: fine */ }
}

export function NudgeCard() {
  const q = new URLSearchParams(location.search);
  const n = JSON.parse(q.get("nudge") || "{}") as N;
  const [collapsed, setCollapsed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const send = (action: string) => api("/api/desktop/nudge", { method: "POST", body: { action, key: n.key } }).catch(() => window.close());
  const act = (action: string) => {
    if (action === "collapse" || action === "expand") { send(action); return; }
    setLeaving(true);
    setTimeout(() => send(action), 180);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = q.get("theme") === "light" ? "light" : "dark";
    if (q.get("evening")) document.documentElement.dataset.evening = "";
    document.documentElement.dataset.sky = skyAt(new Date(n.at || Date.now()));
    document.documentElement.classList.add("nudge-doc");
    if (q.get("sound")) chime();
    const id = setTimeout(() => {
      if (n.sticky) { setCollapsed(true); send("collapse"); } else act("dismiss");
    }, n.sticky ? COLLAPSE_AFTER : AUTO_HIDE);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line

  if (collapsed) {
    return (
      <button className="nudge-pill" id="nudge-pill" onClick={() => { setCollapsed(false); act("expand"); }} title="Show the reminder">
        <span className="nudge-dot" />
        <span className="nudge-pill-text">{n.kind === "start" ? `Now: ${n.title}` : n.title}</span>
        <span className="nudge-pill-x" role="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); act("dismiss"); }}>×</span>
      </button>
    );
  }

  const time = clockText(n.at || Date.now()).replace(/\s?[AP]M$/i, "");
  const ampm = (clockText(n.at || Date.now()).match(/[AP]M$/i) || [""])[0];
  return (
    <section className={`nudge ${leaving ? "leaving" : ""} kind-${n.kind}`} id="nudge" data-kind={n.kind} role="alert">
      <div className="nudge-sun" aria-hidden="true"><span className="nudge-time">{time}</span><span className="nudge-ampm">{ampm}</span></div>
      <div className="nudge-body">
        <span className="nudge-label">{LABEL[n.kind]}</span>
        <h1 className="nudge-title" id="nudge-title">{n.title}</h1>
        <p className="nudge-text">{n.body}</p>
        <div className="nudge-actions">
          {BUTTONS[n.kind].map((b) => <button key={b.action} id={`nudge-${b.action}`} className={b.primary ? "primary" : "ghost-btn"} onClick={() => act(b.action)}>{b.label}</button>)}
        </div>
      </div>
      <button className="nudge-close" id="nudge-dismiss" aria-label="Dismiss" onClick={() => act("dismiss")}>×</button>
      {!n.sticky && <span className="nudge-timer" style={{ animationDuration: `${AUTO_HIDE}ms` }} />}
    </section>
  );
}
