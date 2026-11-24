// 3.6: asking once about self-healing days, and the morning note that lists what moved.
import { useMemo, useState } from "react";
import { answerHeal, dismissHealNote, healDue, undoHeal, type HealNote as Note } from "../data/heal";
import { useData } from "../data/useData";
import { ymd } from "../lib/dates";
import { dayLabel } from "../domain/week";
import { plain } from "../lib/text";
import { useUi } from "../state/ui";
import { Dialog } from "./common";

export function HealAskDialog() {
  return <Dialog name="heal" id="heal-dialog" className="fresh-dialog"><Ask /></Dialog>;
}
function Ask() {
  const { config, today } = useData();
  const close = useUi((s) => s.closeDialog);
  const left = useMemo(() => healDue(config, today), [config, today]);
  const [busy, setBusy] = useState(false);
  const go = async (on: boolean) => { setBusy(true); try { await answerHeal(on, left); } finally { setBusy(false); close("heal"); } };
  return (
    <div className="fresh-form">
      <h2>Yesterday didn't get a shutdown.</h2>
      <p className="dialog-sub">{left.length} task{left.length === 1 ? " was" : "s were"} left over. When this happens, Praxis can re-home the leftovers by itself:
        it spreads them over the next few days within your capacity, puts missed repeats back on today, and leaves you a note in the morning listing what moved, with an undo.</p>
      <ul className="fresh-list">{left.slice(0, 5).map((t) => <li key={t.id}>{plain(t.content)}</li>)}{left.length > 5 && <li className="more">and {left.length - 5} more</li>}</ul>
      <div className="fresh-actions">
        <button type="button" id="heal-yes" className="primary" disabled={busy} onClick={() => go(true)}>Yes, re-home them for me (now and from now on)</button>
        <button type="button" id="heal-no" className="ghost-btn" disabled={busy} onClick={() => go(false)}>No, I'll sort them myself</button>
      </div>
      <p className="fresh-note">You can change this any time under ⋯ → Planner settings.</p>
    </div>
  );
}

/** The morning note: what moved overnight, with an undo. Sits at the top of the task list until you dismiss it. */
export function HealNoteCard() {
  const { config } = useData();
  const note = (config?.planner as { healNote?: Note } | undefined)?.healNote;
  const [busy, setBusy] = useState(false);
  if (!note || note.seen || note.day !== ymd(new Date()) || !note.moves.length) return null;
  return (
    <div className="heal-note" id="heal-note" role="status">
      <div className="heal-head">
        <strong>{note.undone ? "Put back where they were." : `I re-homed ${note.moves.length} leftover${note.moves.length === 1 ? "" : "s"} from yesterday.`}</strong>
        <span className="spacer" />
        {!note.undone && <button type="button" id="heal-undo" className="ghost-btn" disabled={busy} onClick={async () => { setBusy(true); try { await undoHeal(); } finally { setBusy(false); } }}>Undo</button>}
        <button type="button" id="heal-ok" className="ghost-btn" onClick={() => dismissHealNote()}>OK</button>
      </div>
      {!note.undone && <ul className="heal-list">{note.moves.slice(0, 6).map((m) => <li key={m.id}><span className="heal-title">{m.title}</span><span className="heal-to">→ {m.to === ymd(new Date()) ? "today" : dayLabel(m.to)}</span></li>)}
        {note.moves.length > 6 && <li className="more">and {note.moves.length - 6} more</li>}</ul>}
    </div>
  );
}
