// 3.3 Stay in view: the edge horizon (a thin strip across the top of the screen) and the tray sundial.
// Both are for the moments Praxis is out of sight: a full-screen app, a game, deep work in another window.
import { useEffect, useMemo, useState } from "react";
import { blocksAt, layoutBlocks, nextBlocks, TL_END, TL_START, visibleEvents, type Block } from "../domain/layout";
import { skyStops, sunTimes } from "../domain/sun";
import { fmtMin, minOfDay, ymd } from "../lib/dates";
import { colorOf, plain } from "../lib/text";
import { queryClient, qk } from "../data/queries";
import { api } from "../lib/api";
import { useCommitted, useData } from "../data/useData";
import { useUi } from "../state/ui";
import { useAppearance } from "./useAppearance";
import { useNow } from "./useNow";

const isDesktop = () => /Electron/i.test(navigator.userAgent);
const inMin = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${Math.round(m % 60)}m` : ""}`);

/** What the strip and the tray read: today's blocks, the sun, and the commitments still open. */
export function useGlance() {
  const { today, events, projects, trayIds, config } = useData();
  const committed = useCommitted();
  const now = useNow();
  const todayList = useMemo(() => today.filter((t) => !trayIds.has(t.id)), [today, trayIds]);
  const blocks = useMemo(() => layoutBlocks(todayList, visibleEvents(events, todayList)), [todayList, events, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rise, set } = useMemo(() => sunTimes(now), [ymd(now)]); // eslint-disable-line react-hooks/exhaustive-deps
  const openIds = new Set(today.map((t) => t.id));
  const left = [...committed.keys()].filter((id) => openIds.has(id)).length;
  const color = (b: Block) => b.event ? (b.event.color || "#8a8178") : (colorOf(projects.get(b.task!.project_id)?.color) || "var(--accent)");
  return { now, nowMin: minOfDay(now), blocks, rise, set, left, committedCount: committed.size, color, config };
}

const title = (b: Block) => (b.task ? plain(b.task.content) : b.event?.title || "");

// ---------- the edge horizon ----------

/** The strip window's page (?strip=1). The desktop app sizes it: a few pixels tall, or taller while you hover the top edge.
 *  4.5: overlapping blocks share the line in lanes (each a slice of its height) instead of painting over each other,
 *  and the hover card names every block that's on now, next, or under the pointer. */
export function EdgeStrip() {
  useAppearance();
  useUi();
  const { nowMin, blocks, rise, set, color } = useGlance();
  const [peek, setPeek] = useState<{ open: boolean; x: number }>({ open: false, x: 0 });
  useEffect(() => {
    document.documentElement.classList.add("strip-doc");
    const id = setInterval(() => {
      for (const k of [qk.config, qk.today]) queryClient.invalidateQueries({ queryKey: k });
    }, 30_000);
    const on = (e: Event) => setPeek((e as CustomEvent<{ open: boolean; x: number }>).detail);
    window.addEventListener("praxis:strip", on);
    return () => { clearInterval(id); window.removeEventListener("praxis:strip", on); };
  }, []);

  const span = (TL_END - TL_START) * 60;
  const pct = (m: number) => Math.max(0, Math.min(100, ((m - TL_START * 60) / span) * 100));
  const stops = skyStops(rise, set, TL_START * 60, TL_END * 60).map(([v, p]) => `var(${v}) ${p.toFixed(1)}%`).join(", ");
  const w = typeof window === "undefined" ? 1 : window.innerWidth || 1;
  const atX = TL_START * 60 + (peek.x / w) * span;
  const current = blocksAt(blocks, nowMin);
  const next = nextBlocks(blocks, nowMin);
  const under = blocksAt(blocks, atX).filter((b) => !current.includes(b) && !next.includes(b));
  const cardX = Math.max(12, Math.min(w - 432, peek.x - 210));
  const many = (g: Block[], label: string) => (g.length > 1 ? `${label} · ${g.length} at once` : label);

  return (
    <div className={`edge-strip ${peek.open ? "open" : ""}`} id="edge-strip">
      <div className="es-line" style={{ background: `linear-gradient(to right, ${stops})` }}>
        <div className="es-past" style={{ width: `${pct(nowMin)}%` }} />
        {blocks.map((b, i) => (
          <span key={i} className={`es-block ${b.event ? "event" : ""} ${b.end <= nowMin ? "past" : ""}`} data-lane={`${b.col + 1}/${b.cols}`}
                style={{ left: `${pct(b.start)}%`, width: `max(3px, ${pct(b.end) - pct(b.start)}%)`, ["--c" as string]: color(b), ["--lane" as string]: b.col, ["--lanes" as string]: b.cols }} />
        ))}
        <span className="es-now" style={{ left: `${pct(nowMin)}%` }} />
      </div>
      {peek.open && (
        <div className="es-card" id="es-card" style={{ left: cardX }}>
          {under.length > 0 && <Row label={many(under, `${fmtMin(Math.min(...under.map((b) => b.start)))} – ${fmtMin(Math.max(...under.map((b) => b.end)))}`)} blocks={under} color={color} />}
          {current.length > 0 && <Row label={many(current, `Now · until ${fmtMin(Math.min(...current.map((b) => b.end)))}`)} blocks={current} color={color} />}
          {next.length ? <Row label={many(next, `Next · ${fmtMin(next[0].start)} · in ${inMin(next[0].start - nowMin)}`)} blocks={next} color={color} />
            : <div className="es-row"><span className="es-label">Nothing else planned today</span></div>}
        </div>
      )}
    </div>
  );
}
/** One line of the hover card: a label, and the blocks' titles side by side (each with its colour), shortened to fit. */
function Row({ label, blocks, color }: { label: string; blocks: Block[]; color: (b: Block) => string }) {
  return (
    <div className="es-row" style={{ ["--c" as string]: color(blocks[0]) }}>
      <span className="es-dot" /><span className="es-label">{label}</span>
      <span className="es-text" title={blocks.map(title).join(" · ")}>
        {blocks.slice(0, 2).map((b, i) => <span key={i} className="es-one" style={{ ["--c" as string]: color(b) }}>{i > 0 && <i className="es-sep" aria-hidden="true" />}{title(b)}</span>)}
        {blocks.length > 2 && <span className="es-more">+{blocks.length - 2} more</span>}
      </span>
    </div>
  );
}

// ---------- the tray sundial ----------
/** Draws the sun's place on its arc and the commitments still open; returns PNG data URLs for 16 and 32 px. */
export function drawDial(size: number, o: { frac: number; up: boolean; left: number; dark: boolean; accent: string }) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const s = size / 16;
  const ink = o.dark ? "rgba(255,255,255,.9)" : "rgba(20,20,30,.85)";
  const faint = o.dark ? "rgba(255,255,255,.38)" : "rgba(20,20,30,.32)";
  const cx = 8 * s, cy = 12.5 * s, r = 6.4 * s;
  // horizon
  g.strokeStyle = ink; g.lineWidth = Math.max(1, s); g.lineCap = "round";
  g.beginPath(); g.moveTo(1 * s, cy); g.lineTo(15 * s, cy); g.stroke();
  // the day's path
  g.strokeStyle = faint; g.lineWidth = Math.max(1, 0.9 * s);
  g.beginPath(); g.arc(cx, cy, r, Math.PI, 2 * Math.PI); g.stroke();
  // the sun (by day) or the moon (by night) on the arc
  const a = Math.PI + Math.max(0, Math.min(1, o.frac)) * Math.PI;
  const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
  if (o.up) {
    g.fillStyle = "#f6b73c"; g.strokeStyle = o.dark ? "#1b1b22" : "#fff7e6"; g.lineWidth = Math.max(1, 0.8 * s);
    g.beginPath(); g.arc(x, y, 2.7 * s, 0, 2 * Math.PI); g.fill(); g.stroke();
  } else {
    g.fillStyle = o.dark ? "#e6e8f4" : "#545b7a";
    g.beginPath(); g.arc(x, y, 2.5 * s, 0, 2 * Math.PI); g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(x + 1.3 * s, y - 0.8 * s, 2.2 * s, 0, 2 * Math.PI); g.fill();
    g.globalCompositeOperation = "source-over";
  }
  // commitments still open, as a badge
  if (o.left > 0) {
    const bx = 12 * s, by = 4.4 * s, br = 4.1 * s;
    g.fillStyle = o.accent; g.beginPath(); g.arc(bx, by, br, 0, 2 * Math.PI); g.fill();
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `800 ${Math.round(6.6 * s)}px "Segoe UI", system-ui, sans-serif`;
    g.fillText(o.left > 9 ? "9+" : String(o.left), bx, by + 0.4 * s);
  }
  return c.toDataURL("image/png");
}

declare global { interface Window { __praxisDrawDial?: typeof drawDial } }
if (typeof window !== "undefined") window.__praxisDrawDial = drawDial; // the desktop app's tests look at the icon

/** In the main window of the desktop app: keeps the tray icon showing the sun and the commitments left. */
export function useTrayDial() {
  const { nowMin, rise, set, left, committedCount, blocks } = useGlance();
  const minute = Math.floor(nowMin / 5); // the sun moves a pixel every few minutes at most
  useEffect(() => {
    if (!isDesktop()) return;
    let stop = false;
    const send = async (dark: boolean) => {
      const up = nowMin > rise && nowMin < set;
      const frac = up ? (nowMin - rise) / (set - rise) : ((nowMin - set + 1440) % 1440) / (1440 - (set - rise));
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5b5bd6";
      const o = { frac, up, left, dark, accent };
      const nextAll = nextBlocks(blocks, nowMin), next = nextAll[0];
      const tip = [
        "Praxis",
        committedCount ? (left ? `${left} of ${committedCount} commitment${committedCount > 1 ? "s" : ""} left` : "All commitments done ✓") : "No commitments yet today",
        next ? `next: ${title(next).slice(0, 40)}${nextAll.length > 1 ? ` (+${nextAll.length - 1})` : ""} at ${fmtMin(next.start)}` : "",
        up ? `sunset ${fmtMin(set)}` : `sunrise ${fmtMin(rise)}`,
      ].filter(Boolean).join(" · ");
      await api("/api/desktop/tray", { method: "POST", body: { img16: drawDial(16, o), img32: drawDial(32, o), tip } }).catch(() => undefined);
    };
    // The desktop app says whether the taskbar is dark (it can differ from the app's own theme).
    api<{ dark: boolean }>("/api/desktop/taskbar").then((j) => { if (!stop) send(!!j.dark); }).catch(() => send(true));
    return () => { stop = true; };
  }, [minute, left, committedCount, rise, set, blocks.length]); // eslint-disable-line react-hooks/exhaustive-deps
}
