// 5.0 One settings page: everything that changes how Praxis behaves, in sections, with a search box.
// (Each section is the same form that used to be its own dialog, so nothing about saving changed.)
import { useMemo, useState, type ReactNode } from "react";
import { updateConfig } from "../data/actions";
import { useData } from "../data/useData";
import { copyDiagnostics } from "../lib/diagnostics";
import { VERSION } from "../lib/version";
import { toast, useUi } from "../state/ui";
import { ClaudeKey } from "./BrainDump";
import { CalendarsBody } from "./CalendarsDialog";
import { Dialog } from "./common";
import { PlannerBody } from "./PlannerSettings";
import { RemindersBody } from "./RemindersDialog";
import { WallpaperBody } from "./WallpaperDialog";

type Key = "look" | "planner" | "reminders" | "calendars" | "wallpaper" | "claude" | "app";
interface Section { key: Key; label: string; words: string; render: () => ReactNode }

export function SettingsDialog() {
  return <Dialog name="settings" id="settings-dialog" className="settings-dialog"><Body /></Dialog>;
}

/** Open the settings at a section (from anywhere). */
export const openSettings = (at?: Key) => { useUi.setState({ settingsAt: at }); useUi.getState().openDialog("settings"); };

function Body() {
  const start = useUi((s) => s.settingsAt) as Key | undefined;
  const [at, setAt] = useState<Key>(start || "look");
  const [q, setQ] = useState("");
  const close = () => useUi.getState().closeDialog("settings");
  const sections: Section[] = useMemo(() => [
    { key: "look", label: "Look", words: "theme dark light auto warm evening colors canvas tabs horizon classic day layout focus mode", render: () => <Look /> },
    { key: "planner", label: "Planner", words: "work hours day start end shutdown wind down plan auto morning commit energy weekly letter learn chime deep light labels", render: () => <PlannerBody /> },
    { key: "reminders", label: "Reminders, gate and lock", words: "reminders nudges heads up notifications sound chime block gate full screen lock focus firefox steam reddit apps sites shutdown time check", render: () => <RemindersBody /> },
    { key: "calendars", label: "Calendars", words: "calendar google outlook ics events links", render: () => <CalendarsBody /> },
    { key: "wallpaper", label: "Wallpaper", words: "wallpaper mottos city desktop background slideshow weather", render: () => <WallpaperBody /> },
    { key: "claude", label: "Claude", words: "claude ai anthropic key brain dump command bar", render: () => <ClaudeKey onDone={() => toast("Saved")} /> },
    { key: "app", label: "App and help", words: "version update diagnostics help shortcuts keyboard login strip tray todoist", render: () => <AppSection /> },
  ], []);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? sections.filter((s) => words.every((w) => (s.label + " " + s.words).toLowerCase().includes(w))) : sections;
  const cur = shown.find((s) => s.key === at) || shown[0];
  return (
    <div className="settings" id="settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <input id="settings-search" className="settings-search" placeholder="Search settings (e.g. lock, theme, shutdown)" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="icon-btn" aria-label="Close" id="settings-close" onClick={close}>×</button>
      </div>
      <div className="settings-main">
        <nav className="settings-nav" aria-label="Sections">
          {shown.map((s) => <button type="button" key={s.key} data-section={s.key} className={cur?.key === s.key ? "on" : ""} onClick={() => setAt(s.key)}>{s.label}</button>)}
          {!shown.length && <p className="dialog-note">Nothing matches “{q}”.</p>}
        </nav>
        <section className="settings-body" data-section={cur?.key}>{cur?.render()}</section>
      </div>
    </div>
  );
}

function Look() {
  const { config } = useData();
  const setView = useUi((s) => s.setView);
  const ui = config?.ui || {};
  const set = (patch: Record<string, unknown>) => updateConfig((c) => ({ ...c, ui: { ...(c.ui || {}), ...patch } })).catch(() => undefined);
  return (
    <div className="settings-look">
      <div className="form-row"><span className="form-label">Theme</span>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(["auto", "dark", "light"] as const).map((t) => (
            <button type="button" key={t} role="radio" aria-checked={(ui.theme || "auto") === t} data-theme-opt={t} className={(ui.theme || "auto") === t ? "on" : ""} onClick={() => set({ theme: t })}>{t === "auto" ? "Auto" : t === "dark" ? "Dark" : "Light"}</button>
          ))}
        </div>
      </div>
      <label className="switch-row"><input type="checkbox" id="warm-evenings" checked={ui.warmEvenings !== false} onChange={(e) => set({ warmEvenings: e.target.checked })} /> <span>Warmer colors after 8 PM</span></label>
      <label className="switch-row"><input type="checkbox" id="canvas-layout" checked={ui.canvas !== false} onChange={(e) => { set({ canvas: e.target.checked }); if (useUi.getState().view === "progress") setView("day"); }} /> <span>One canvas (off: the four tabs)</span></label>
      <label className="switch-row"><input type="checkbox" id="horizon-layout" checked={ui.dayLayout !== "classic"} onChange={(e) => set({ dayLayout: e.target.checked ? "horizon" : "classic" })} /> <span>Day as a horizon, left to right (off: top to bottom)</span></label>
      <label className="switch-row"><input type="checkbox" id="focus-mode" checked={!!ui.focus} onChange={(e) => set({ focus: e.target.checked })} /> <span>Focus mode (F): only what's next</span></label>
    </div>
  );
}

function AppSection() {
  const open = useUi((s) => s.openDialog);
  return (
    <div className="settings-app">
      <p className="dialog-note">Praxis {VERSION}. Updates install by themselves; the tray icon's menu has <b>Check for updates</b>, <b>Open at login</b> and the <b>Edge horizon</b> strip at the top of the screen.</p>
      <div className="settings-row">
        <button type="button" className="ghost-btn" id="settings-news" onClick={() => useUi.setState({ newsOpen: true })}>What's new</button>
        <button type="button" className="ghost-btn" onClick={() => open("help")}>Keyboard shortcuts</button>
        <button type="button" className="ghost-btn" id="settings-diagnostics" onClick={async () => {
          try { toast(await copyDiagnostics() ? "Diagnostics copied. Paste them into your chat with Claude." : "Couldn't copy the diagnostics."); }
          catch (e) { toast(`Couldn't gather the diagnostics: ${(e as Error).message}`); }
        }}>Copy diagnostics</button>
      </div>
    </div>
  );
}
