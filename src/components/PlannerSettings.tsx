import { useState } from "react";
import { PLANNER_DEFAULTS } from "../domain/planner";
import type { PlannerSettings as Settings } from "../lib/types";
import { updateConfig } from "../data/actions";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";
import { SCALES, type ScaleName } from "../domain/rewards";
import { previewScale } from "../lib/chime";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PlannerSettingsDialog() {
  return <Dialog name="planner" id="planner-dialog"><Body /></Dialog>;
}

function Body() {
  const { cfg } = useData();
  const close = useUi((s) => s.closeDialog);
  const [s, setS] = useState<Settings>(cfg);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const num = (v: string, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

  const save = async () => {
    const next: Settings = {
      ...s,
      dayStart: s.dayStart || PLANNER_DEFAULTS.dayStart, dayEnd: s.dayEnd || PLANNER_DEFAULTS.dayEnd,
      workStart: s.workStart || PLANNER_DEFAULTS.workStart, workEnd: s.workEnd || PLANNER_DEFAULTS.workEnd,
      deepLabel: (s.deepLabel || "deep").replace(/^@/, "").trim(), lightLabel: (s.lightLabel || "light").replace(/^@/, "").trim(),
    };
    try { await updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), ...next } })); toast("Planner settings saved"); close("planner"); }
    catch (e) { toast(`Couldn't save: ${(e as Error).message}`); }
  };

  return (
    <form id="planner-form" className="planner-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2>Planner settings</h2>
      <p className="dialog-sub">“Plan my day” fills your free time with today's tasks, hardest first. Tag tasks in Todoist with <b>@deep</b> (needs willpower) or <b>@light</b> (easy). Everything else counts as medium; priority breaks ties.</p>

      <label className="switch-row"><input type="checkbox" name="auto" checked={s.auto} onChange={(e) => set("auto", e.target.checked)} /> <span>Propose a plan automatically the first time I open Praxis each day</span></label>
      <label className="switch-row"><input type="checkbox" name="morningCommit" checked={s.morningCommit} onChange={(e) => set("morningCommit", e.target.checked)} /> <span>Start each day with a one-minute commit (pick today's {s.commitCount})</span></label>
      <label className="switch-row"><input type="checkbox" name="adaptive" checked={s.adaptive} onChange={(e) => set("adaptive", e.target.checked)} /> <span>Make plans lighter or fuller based on how much I finished last week</span></label>
      <label className="switch-row"><input type="checkbox" name="learn" checked={s.learn} onChange={(e) => set("learn", e.target.checked)} /> <span>Learn from my history: Deep work in my best hours, durations from how long things really take</span></label>
      <label className="switch-row"><input type="checkbox" name="selfHeal" id="ps-selfheal" checked={!!s.selfHeal} onChange={(e) => set("selfHeal", e.target.checked)} /> <span>When I skip a shutdown, re-home the leftovers for me (with a morning note and an undo)</span></label>
      <label className="switch-row"><input type="checkbox" name="sundayLetter" id="ps-letter" checked={s.sundayLetter !== false} onChange={(e) => set("sundayLetter", e.target.checked)} /> <span>On Sundays, a short letter from Claude about my week, with one suggestion</span></label>
      <div className="switch-row chime-row">
        <label htmlFor="ps-chime">A soft note when I finish something</label>
        <select id="ps-chime" name="chime" value={s.chime || "off"} onChange={(e) => { const v = e.target.value as ScaleName; set("chime", v); previewScale(v); }}>
          <option value="off">Off</option>
          {Object.entries(SCALES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="muted small">Each one climbs the scale, so a good day plays a little tune.</span>
      </div>
      <label className="switch-row"><input type="checkbox" name="weeklyAuto" checked={s.weeklyAuto} onChange={(e) => set("weeklyAuto", e.target.checked)} /> <span>Draft next week's plan automatically on Friday after work</span></label>

      <div className="form-grid">
        <label>Day starts <input type="time" name="dayStart" step={900} value={s.dayStart} onChange={(e) => set("dayStart", e.target.value)} /></label>
        <label>Day ends <input type="time" name="dayEnd" step={900} value={s.dayEnd} onChange={(e) => set("dayEnd", e.target.value)} /></label>
        <label>Work starts <input type="time" name="workStart" step={900} value={s.workStart} onChange={(e) => set("workStart", e.target.value)} /></label>
        <label>Work ends <input type="time" name="workEnd" step={900} value={s.workEnd} onChange={(e) => set("workEnd", e.target.value)} /></label>
        <label>Shut-down reminder <input type="time" name="shutdownAt" step={900} value={s.shutdownAt} onChange={(e) => set("shutdownAt", e.target.value)} /></label>
      </div>
      <div className="form-row"><span className="form-label">Work days</span>
        <div id="work-days" className="day-picks">
          {DOW.map((d, i) => (
            <label key={d} className={`day-pick ${s.workDays.includes(i) ? "on" : ""}`}>
              <input type="checkbox" value={i} checked={s.workDays.includes(i)} onChange={(e) => set("workDays", e.target.checked ? [...s.workDays, i].sort() : s.workDays.filter((x) => x !== i))} />{d}
            </label>
          ))}
        </div>
      </div>

      <div className="form-grid">
        <label>Break after work <span className="unit"><input type="number" name="afterWork" min={0} max={180} step={5} value={s.afterWork} onChange={(e) => set("afterWork", num(e.target.value, 0, 180, 30))} /> min</span></label>
        <label>Gap between blocks <span className="unit"><input type="number" name="gap" min={0} max={60} step={5} value={s.gap} onChange={(e) => set("gap", num(e.target.value, 0, 60, 10))} /> min</span></label>
        <label>Keep free <span className="unit"><input type="number" name="keepFree" min={0} max={80} step={5} value={s.keepFree} onChange={(e) => set("keepFree", num(e.target.value, 0, 80, 20))} /> %</span></label>
        <label>Fill free time <span className="unit"><input type="number" name="fill" min={30} max={90} step={5} value={s.fill} onChange={(e) => set("fill", num(e.target.value, 30, 90, 60))} /> %</span></label>
        <label>Commit to <span className="unit"><input type="number" name="commitCount" min={1} max={6} value={s.commitCount} onChange={(e) => set("commitCount", num(e.target.value, 1, 6, 3))} /> tasks a day</span></label>
        <label>Milestone steps per day <input type="number" name="milestoneSteps" min={0} max={10} value={s.milestoneSteps} onChange={(e) => set("milestoneSteps", num(e.target.value, 0, 10, 2))} /></label>
        <label>High-willpower label <span className="unit">@<input type="text" name="deepLabel" value={s.deepLabel} onChange={(e) => set("deepLabel", e.target.value)} /></span></label>
        <label>Low-willpower label <span className="unit">@<input type="text" name="lightLabel" value={s.lightLabel} onChange={(e) => set("lightLabel", e.target.value)} /></span></label>
      </div>

      <div className="dialog-actions">
        <button type="button" value="cancel" className="ghost-btn" onClick={() => close("planner")}>Cancel</button>
        <button type="submit" value="save" className="primary">Save</button>
      </div>
    </form>
  );
}
