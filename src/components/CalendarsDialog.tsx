import { useState } from "react";
import { api } from "../lib/api";
import type { CalendarSetting } from "../lib/types";
import { updateConfig } from "../data/actions";
import { refreshAll } from "../data/queries";
import { useData } from "../data/useData";
import { useUi } from "../state/ui";
import { Dialog } from "./common";
import { newId } from "../domain/areas";

const CAL_COLORS: Record<string, string> = {
  Tomato: "#d50000", Tangerine: "#f4511e", Banana: "#f6bf26", Basil: "#0b8043", Sage: "#33b679",
  Peacock: "#039be5", Blueberry: "#3f51b5", Lavender: "#7986cb", Grape: "#8e24aa", Graphite: "#616161",
};
// Never show the secret part of the link on screen.
const maskUrl = (u: string) => { try { const x = new URL(u); return `${x.host}/…${x.pathname.slice(-12)}`; } catch { return "…"; } };

export function CalendarsDialog() {
  return <Dialog name="calendars" id="calendars-dialog"><CalendarsBody /></Dialog>;
}

export function CalendarsBody() {
  const { config } = useData();
  const close = useUi((s) => s.closeDialog);
  // Local copy so toggles respond instantly; saved to settings on every change.
  const [cals, setCals] = useState<CalendarSetting[]>(() => config?.calendars || []);
  const used = new Set(cals.map((c) => c.color));
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => Object.values(CAL_COLORS).find((h) => !used.has(h)) || CAL_COLORS.Peacock);
  const [msg, setMsg] = useState<{ kind: "" | "ok" | "err"; text: string }>({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);

  const save = async (next: CalendarSetting[]) => { setCals(next); await updateConfig((c) => ({ ...c, calendars: next })); refreshAll(true); };

  const add = async () => {
    const u = url.trim();
    if (!u) return setMsg({ kind: "", text: "Paste the link first." });
    if (cals.some((c) => c.url === u)) return setMsg({ kind: "", text: "That calendar is already linked." });
    setBusy(true); setMsg({ kind: "", text: "" });
    try {
      const r = await api<{ name: string | null; upcoming: number }>("/api/calendar/test", { method: "POST", body: { url: u } });
      const n = name.trim() || r.name || "Calendar";
      await save([...cals, { id: newId("c"), name: n, url: u, color, enabled: true }]);
      setMsg({ kind: "ok", text: `Added “${n}”: ${r.upcoming} event${r.upcoming === 1 ? "" : "s"} in the next 7 days.` });
      setUrl(""); setName("");
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <form id="calendars-form" className="planner-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <h2>Calendars</h2>
      <p className="dialog-sub">Show your Google Calendar events on the timeline. The planner works around them.</p>
      <div id="cal-list" className="cal-list">
        {cals.length ? cals.map((c) => (
          <div key={c.id} className="cal-row" data-id={c.id}>
            <span className="cal-dot" style={{ background: c.color }} />
            <span className="cal-name">{c.name}</span>
            <span className="cal-url">{maskUrl(c.url)}</span>
            <label className="cal-toggle"><input type="checkbox" data-act="toggle" checked={c.enabled !== false} onChange={(e) => save(cals.map((x) => (x.id === c.id ? { ...x, enabled: e.target.checked } : x)))} /> Show</label>
            <button type="button" className="ghost-btn danger" data-act="remove" onClick={() => { if (confirm(`Unlink “${c.name}”? Your Google Calendar isn't changed.`)) save(cals.filter((x) => x.id !== c.id)); }}>Remove</button>
          </div>
        )) : <p className="dialog-sub">No calendars linked yet.</p>}
      </div>

      <details className="cal-help" open={!cals.length}>
        <summary>How to get your calendar's private link</summary>
        <ol>
          <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener">Google Calendar settings</a> on the web.</li>
          <li>On the left, under <b>Settings for my calendars</b>, click the calendar.</li>
          <li>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</li>
        </ol>
        <p>Anyone with that link can see the calendar, so it's only stored on this computer. Some work accounts hide this option.</p>
      </details>

      <div className="cal-add">
        <input id="cal-url" type="password" placeholder="Paste the secret iCal address (https://calendar.google.com/…/basic.ics)" autoComplete="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} />
        <input id="cal-name" type="text" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <select id="cal-color" aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)}>
          {Object.entries(CAL_COLORS).map(([n, hex]) => <option key={hex} value={hex}>{n}</option>)}
        </select>
        <button type="button" id="cal-add-btn" className="primary" disabled={busy} onClick={add}>{busy ? "Testing…" : "Test & add"}</button>
      </div>
      <p id="cal-msg" className={`cal-msg ${msg.kind}`} role="status">{msg.text}</p>

      <div className="dialog-actions">
        <button type="button" value="close" className="ghost-btn" onClick={() => close("calendars")}>Done</button>
      </div>
    </form>
  );
}
