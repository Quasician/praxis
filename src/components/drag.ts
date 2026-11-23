// Drag to schedule, with the pointer (mouse or pen):
//   • drag a task from the list onto the timeline → schedule it
//   • drag a block → move it; drag its bottom edge → change its length
//   • drag a block back onto the list → take its time off (stays due today)
//   • proposed (auto-planner) blocks move locally until you accept the plan
import type { PointerEvent as ReactPointerEvent } from "react";
import { TL_END, TL_START } from "../domain/layout";
import { scheduleTask, unscheduleTask } from "../data/actions";
import { adjustProposal } from "../data/planActions";
import { useUi, type DragState } from "../state/ui";

const SNAP = 15;
/** The Horizon runs the day left to right; the classic timeline runs top to bottom. */
export const horizontal = () => document.documentElement.dataset.layout === "horizon";
export const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(horizontal() ? "--hour-x" : "--hour")) || 64;
export const minToY = (min: number) => (min / 60 - TL_START) * hourPx();
export const minToX = minToY;
const gridEl = () => document.querySelector(".tl-grid") as HTMLElement | null;
const inside = (el: Element | null, e: { clientX: number; clientY: number }) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};
export function pointerMin(e: { clientX: number; clientY: number }) {
  const g = gridEl();
  if (!g) return TL_START * 60;
  const r = g.getBoundingClientRect();
  return TL_START * 60 + (((horizontal() ? e.clientX - r.left : e.clientY - r.top)) / hourPx()) * 60;
}
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clampStart = (start: number, dur: number) => Math.max(TL_START * 60, Math.min(start, TL_END * 60 - dur));

type Info = Pick<DragState, "kind" | "task" | "start" | "dur" | "grab" | "proposalIdx">;
let pending: { info: Info; x0: number; y0: number; last: PointerEvent | null } | null = null;

export function startDrag(e: ReactPointerEvent, info: Info) {
  pending = { info, x0: e.clientX, y0: e.clientY, last: null };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onEnd);
  document.addEventListener("pointercancel", cancelDrag);
}

function onMove(e: PointerEvent) {
  if (!pending) return;
  pending.last = e;
  const ui = useUi.getState();
  if (!ui.drag) {
    if (Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0) < 5) return;
    document.body.classList.add("dragging", pending.info.kind === "resize" ? "resizing" : "moving");
    ui.setDrag({ ...pending.info, started: true, x: e.clientX, y: e.clientY, overTimeline: false, target: null, unschedule: false });
    requestAnimationFrame(autoScroll);
  }
  update(e);
}

function update(e: PointerEvent) {
  const drag = useUi.getState().drag;
  if (!drag) return;
  const overTimeline = inside(document.querySelector("#timeline"), e);
  const overList = !overTimeline && inside(document.querySelector(".tasks-pane"), e);
  let target: DragState["target"] = null;
  if (drag.kind === "resize") {
    const end = Math.min(TL_END * 60, Math.max(drag.start + SNAP, snap(pointerMin(e))));
    target = { start: drag.start, dur: end - drag.start };
  } else if (overTimeline) {
    const raw = drag.kind === "move" ? pointerMin(e) - drag.grab : pointerMin(e) - SNAP / 2;
    target = { start: clampStart(snap(raw), drag.dur), dur: drag.dur };
  }
  useUi.getState().setDrag({ ...drag, x: e.clientX, y: e.clientY, overTimeline, target, unschedule: drag.kind === "move" && overList });
}

// Scroll the timeline while dragging near its top or bottom edge.
function autoScroll() {
  const drag = useUi.getState().drag;
  if (!drag || !pending) return;
  const e = pending.last;
  const tl = document.querySelector("#timeline") as HTMLElement | null;
  if (e && tl && (inside(tl, e) || drag.kind === "resize")) {
    const r = tl.getBoundingClientRect(), edge = 48;
    const [p, lo, hi] = horizontal() ? [e.clientX, r.left, r.right] : [e.clientY, r.top, r.bottom];
    let d = 0;
    if (p < lo + edge) d = -Math.ceil((lo + edge - p) / 4);
    else if (p > hi - edge) d = Math.ceil((p - (hi - edge)) / 4);
    if (d) { if (horizontal()) tl.scrollLeft += d; else tl.scrollTop += d; update(e); }
  }
  requestAnimationFrame(autoScroll);
}

function cleanup() {
  document.removeEventListener("pointermove", onMove);
  document.removeEventListener("pointerup", onEnd);
  document.removeEventListener("pointercancel", cancelDrag);
  document.body.classList.remove("dragging", "resizing", "moving");
  pending = null;
  useUi.getState().setDrag(null);
}

export function cancelDrag() { cleanup(); }
export const isDragging = () => !!pending;

function onEnd() {
  const d = useUi.getState().drag;
  cleanup();
  if (!d) return;
  if (d.proposalIdx !== undefined) return adjustProposal(d.proposalIdx, d.target, d.unschedule && !d.target);
  if (d.target && !(d.kind !== "new" && d.target.start === d.start && d.target.dur === d.dur)) {
    scheduleTask(d.task, d.target.start, d.target.dur);
  } else if (d.unschedule) {
    unscheduleTask(d.task);
  }
}
