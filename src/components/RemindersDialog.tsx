import { useState } from "react";
import { reminderCfg, type Reminders } from "../domain/nudges";
import { PLANNER_DEFAULTS } from "../domain/planner";
import { api } from "../lib/api";
import { updateConfig } from "../data/actions";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";

const isDesktop = () => /Electron/i.test(navigator.userAgent);

export function RemindersDialog() {
  return <Dialog name="reminders" id="reminders-dialog"><Body /></Dialog>;
}

function Body() {
  const { config, cfg } = useData();
  const close = useUi((s) => s.closeDialog);
  const [r, setR] = useState<Reminders>(reminderCfg(config?.reminders));
  const [shutdownAt, setShutdownAt] = useState(cfg.shutdownAt || PLANNER_DEFAULTS.shutdownAt);
  const [dayEnd, setDayEnd] = useState(cfg.dayEnd || PLANNER_DEFAULTS.dayEnd);
  const set = <K extends keyof Reminders>(k: K, v: Reminders[K]) => setR((x) => ({ ...x, [k]: v }));
  const desktop = isDesktop();

  const save = async () => {
    try {
      await updateConfig((c) => ({ ...c, reminders: r, planner: { ...(c.planner || {}), shutdownAt, dayEnd } }));
      toast("Reminders saved");
      close("reminders");
    } catch (e) { toast(`Couldn't save: ${(e as Error).message}`); }
  };
  const test = async () => {
    try { await updateConfig((c) => ({ ...c, reminders: r })); await api("/api/desktop/test-nudge", { method: "POST" }); }
    catch (e) { toast(`Couldn't show one: ${(e as Error).message}`); }
  };

  return (
    <form id="reminders-form" className="planner-form reminders-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2>Reminders</h2>
      <p className="dialog-sub">When you're deep in something, Praxis taps you on the shoulder: a small card at the top of the screen, on top of everything (full-screen apps too), without taking your keyboard.</p>
      {!desktop && <p className="dialog-note">These work in the Praxis desktop app. In a browser tab you'll get ordinary notifications when a block starts.</p>}

      <div className="rem-list">
        <label className="switch-row"><input type="checkbox" id="rem-blocks" checked={r.blocks} onChange={(e) => set("blocks", e.target.checked)} /> <span>When a planned block starts</span></label>
        <label className={`rem-sub ${r.blocks ? "" : "off"}`}>A heads-up
          <select id="rem-headsup" value={r.headsUp} disabled={!r.blocks} onChange={(e) => set("headsUp", Number(e.target.value))}>
            <option value={0}>no heads-up</option><option value={2}>2 min before</option><option value={5}>5 min before</option><option value={10}>10 min before</option><option value={15}>15 min before</option>
          </select>
        </label>
        <label className="switch-row"><input type="checkbox" id="rem-focus" checked={r.focusEnd} onChange={(e) => set("focusEnd", e.target.checked)} /> <span>When a focus timer runs out</span></label>
        <label className="switch-row"><input type="checkbox" id="rem-shutdown" checked={r.shutdown} onChange={(e) => set("shutdown", e.target.checked)} /> <span>Shut down the day at</span>
          <input type="time" id="rem-shutdown-at" step={900} value={shutdownAt} onChange={(e) => setShutdownAt(e.target.value)} /></label>
        <label className="switch-row"><input type="checkbox" id="rem-wind" checked={r.windDown} onChange={(e) => set("windDown", e.target.checked)} /> <span>Wind down at</span>
          <input type="time" id="rem-wind-at" step={900} value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} /></label>
        <label className="switch-row rem-select"><span>Time checks when nothing is planned</span>
          <select id="rem-checks" value={r.timeChecks} onChange={(e) => set("timeChecks", Number(e.target.value))}>
            <option value={0}>off</option><option value={45}>every 45 min</option><option value={60}>every hour</option><option value={90}>every 90 min</option><option value={120}>every 2 hours</option>
          </select>
        </label>
      </div>

      <div className="form-row"><span className="form-label">Show them</span>
        <div className="seg rem-style" role="radiogroup">
          <button type="button" id="rem-style-overlay" className={r.style === "overlay" ? "on" : ""} onClick={() => set("style", "overlay")}>On top of everything</button>
          <button type="button" id="rem-style-windows" className={r.style === "windows" ? "on" : ""} onClick={() => set("style", "windows")}>As Windows notifications</button>
        </div>
      </div>
      {r.style === "windows" && <p className="dialog-note" id="rem-dnd-tip">Windows hides notifications while an app is full screen. To let Praxis through, add it under <b>Settings → System → Notifications → Set priority notifications</b>. <a href="ms-settings:notifications" target="_blank" rel="noopener">Open notification settings</a></p>}
      <label className="switch-row"><input type="checkbox" id="rem-sound" checked={r.sound} onChange={(e) => set("sound", e.target.checked)} /> <span>Play a soft chime</span></label>

      <div className="dialog-actions">
        {desktop && <button type="button" className="ghost-btn" id="rem-test" onClick={test}>Show a test reminder</button>}
        <span className="spacer" />
        <button type="button" className="ghost-btn" onClick={() => close("reminders")}>Cancel</button>
        <button type="submit" className="primary" id="rem-save">Save</button>
      </div>
    </form>
  );
}
