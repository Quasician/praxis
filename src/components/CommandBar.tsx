// 5.0 The command bar: press / (or Ctrl+K) and say what you want in plain words. Each change comes with Undo.
import { useEffect, useRef, useState } from "react";
import type { Command } from "../domain/commands";
import { runCommand, type Result } from "../data/commands";
import type { Task } from "../lib/types";
import { plain } from "../lib/text";
import { parseDue, fmtMin, minOfDay } from "../lib/dates";
import { useUi } from "../state/ui";

const EXAMPLES = ["move groceries to 4", "push the report 30 min", "skip gym, too tired", "focus on taxes for 45 min", "done laundry", "add call mom tomorrow", "plan my day"];

export function CommandBar() {
  const open = useUi((s) => !!s.cmdOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [undone, setUndone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setRes(null); setUndone(false); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const close = () => { useUi.setState({ cmdOpen: false }); setText(""); };

  const go = async (pick?: { cmd: Command; task: Task }) => {
    if (busy || (!text.trim() && !pick)) return;
    setBusy(true); setUndone(false);
    try {
      const r = await runCommand(text.trim(), pick);
      setRes(r);
      if (r.ok) { setText(""); if (!r.msg) close(); }
    } catch (e) { setRes({ ok: false, msg: `Couldn't do that: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const when = (t: Task) => { const d = parseDue(t.due); return d ? (d.hasTime ? fmtMin(minOfDay(d.d)) : d.d.toLocaleDateString([], { month: "short", day: "numeric" })) : ""; };

  return (
    <div className="cmd-scrim" id="cmd-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cmd-bar" id="cmd-bar" role="dialog" aria-label="Command bar">
        <form onSubmit={(e) => { e.preventDefault(); go(); }}>
          <input ref={input} id="cmd-input" className="cmd-input" value={text} disabled={busy} autoComplete="off" spellCheck={false}
                 placeholder="What would you like to do? e.g. move groceries to 4"
                 onChange={(e) => { setText(e.target.value); if (res && !res.ok) setRes(null); }}
                 onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }} />
        </form>
        {busy && <div className="cmd-line muted">Working on it…</div>}
        {!busy && res && (
          <div className={`cmd-line ${res.ok ? "ok" : "no"}`} id="cmd-result">
            <span>{undone ? "Undone." : res.msg}</span>
            {res.ok && res.undo && !undone && <button type="button" className="link-like" id="cmd-undo" onClick={async () => { await res.undo!().catch(() => undefined); setUndone(true); }}>Undo</button>}
          </div>
        )}
        {!busy && res && !res.ok && res.choices && (
          <div className="cmd-choices" id="cmd-choices">
            {res.choices.map((t) => <button type="button" key={t.id} className="cmd-choice" data-id={t.id} onClick={() => go({ cmd: res.cmd!, task: t })}><span>{plain(t.content)}</span><span className="cmd-when">{when(t)}</span></button>)}
          </div>
        )}
        {!res && !busy && <div className="cmd-hints">{EXAMPLES.map((x) => <button type="button" key={x} className="cmd-hint" onClick={() => { setText(x); input.current?.focus(); }}>{x}</button>)}</div>}
      </div>
    </div>
  );
}
