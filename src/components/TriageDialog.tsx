import { createContext, useContext, useState } from "react";
import { ageText, nextDate, SLIP_LIMIT, TRIAGE_GROUPS, type TriageItem } from "../domain/triage";
import { willpower } from "../lib/tasks";
import { Inline, colorOf } from "../lib/text";
import { breakDown, bulkSomeday, finishTask, moveToSomeday, setTaskDate } from "../data/actions";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";
import { ymd } from "../lib/dates";
import { api } from "../lib/api";
import { plain } from "../lib/text";
import { useStatus } from "../data/queries";

/** Claude's suggested first step per task id (filled by "Suggest first steps"). */
const Steps = createContext<Map<string, string>>(new Map());

export function TriageDialog() {
  return (
    <Dialog name="triage" id="triage-dialog" className="triage-dialog">
      <TriageBody />
    </Dialog>
  );
}

function TriageBody() {
  const { tray, projects } = useData();
  const close = useUi((s) => s.closeDialog);
  const status = useStatus();
  const [steps, setSteps] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const stuck = tray.filter((x) => !x.recurring);
  const suggest = async () => {
    setBusy(true);
    try {
      const res = await api<{ steps: { id: string; step: string }[] }>("/api/claude/steps", {
        method: "POST",
        body: {
          today: new Date().toDateString(),
          tasks: stuck.slice(0, 40).map((x) => ({ id: x.task.id, content: plain(x.task.content), description: x.task.description || "", project: projects.get(x.task.project_id)?.name, overdueDays: x.days, moves: x.moves })),
        },
      });
      const ids = new Set(stuck.map((x) => x.task.id));
      setSteps(new Map(res.steps.filter((s) => ids.has(s.id) && typeof s.step === "string" && s.step.trim()).map((s) => [s.id, s.step.trim().slice(0, 200)])));
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <form className="triage-form" onSubmit={(e) => e.preventDefault()}>
      <div className="triage-head">
        <div>
          <h2>Needs a decision</h2>
          <p className="dialog-sub">Tasks that are 2+ days overdue or keep getting pushed back. Give each one a decision so nothing gets lost.</p>
        </div>
        <div className="triage-side">
          {status.data?.claude && stuck.length > 0 && <button type="button" id="suggest-steps" className="ghost-btn" disabled={busy} title="Claude writes one small, concrete first step for each stuck task" onClick={suggest}>{busy ? "Thinking…" : "✦ Suggest first steps"}</button>}
          <span id="triage-count" className="triage-count">{tray.length ? `${tray.length} to decide` : "All clear"}</span>
        </div>
      </div>
      <Steps.Provider value={steps}>
      <div id="triage-body" className="triage-body">
        {!tray.length ? <div className="empty"><div className="big">Nothing waiting on you.</div>Every overdue task has a decision. Nice.</div>
          : TRIAGE_GROUPS.map((g) => {
            const xs = tray.filter(g.test);
            if (!xs.length) return null;
            const bulkable = xs.filter((x) => !x.recurring);
            return (
              <section key={g.key} className="tri-group" data-group={g.key}>
                <header>
                  <h3>{g.title} <span className="n">{xs.length}</span></h3>
                  {bulkable.length >= 3 && (
                    <button type="button" className="ghost-btn" data-bulk="someday" data-group={g.key} onClick={() => {
                      if (confirm(`Move ${bulkable.length} tasks from “${g.title}” to Someday? They keep everything except the date, and get tagged @someday.`)) bulkSomeday(bulkable.map((x) => x.task));
                    }}>Move {bulkable.length} to Someday</button>
                  )}
                </header>
                <ul>{xs.map((x) => <TriageRow key={x.task.id} x={x} />)}</ul>
              </section>
            );
          })}
      </div>
      </Steps.Provider>
      <div className="dialog-actions"><button type="button" value="close" className="ghost-btn" onClick={() => close("triage")}>Close</button></div>
    </form>
  );
}

function TriageRow({ x }: { x: TriageItem }) {
  const { projects, cfg } = useData();
  const [breaking, setBreaking] = useState(false);
  const [step, setStep] = useState("");
  const suggested = useContext(Steps).get(x.task.id);
  const t = x.task;
  const proj = projects.get(t.project_id);
  const wp = willpower(t, cfg);

  const pick = (value: string) => {
    if (!value) return;
    let date = value;
    if (value === "custom") {
      const answer = prompt("Which day? (YYYY-MM-DD)", nextDate("tomorrow"));
      if (!answer || !/^\d{4}-\d{2}-\d{2}$/.test(answer)) return;
      date = answer;
    } else date = nextDate(value as "tomorrow" | "weekend" | "nextweek");
    setTaskDate(t, date, new Date(date + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }));
  };
  const createStep = () => { if (step.trim()) breakDown(t, step.trim()); };

  return (
    <li className="tri-row" data-id={t.id}>
      <div className="tri-main">
        <div className="tri-title"><Inline text={t.content} /></div>
        <div className="meta">
          {proj && <span className="proj"><i style={{ background: colorOf(proj.color) }} />{proj.name}</span>}
          <span className={x.days > 31 ? "late" : ""}>{ageText(x)}</span>
          {x.recurring && <span title={`Repeats: ${t.due?.string || ""}`}>↻ {t.due?.string || "repeats"}</span>}
          {x.moves > 0 && <span className="slips" title={`Pushed back ${x.moves} times`}>moved {x.moves}×</span>}
          {wp === 3 && <span className="pbadge wp3">Deep</span>}
        </div>
        {suggested && !breaking && (
          <div className="tri-step" data-step>
            <span className="tri-step-label">✦ First step</span> <span className="tri-step-text">{suggested}</span>
            <button type="button" className="mini" data-act="use-step" title="Make this a milestone with this as today's first step" onClick={() => breakDown(t, suggested)}>Use it</button>
            <button type="button" className="mini ghost-on" data-act="edit-step" onClick={() => { setStep(suggested); setBreaking(true); }}>Edit</button>
          </div>
        )}
        {x.moves >= SLIP_LIMIT && !x.recurring && !suggested && <div className="tri-hint">This keeps slipping. It may be too big or unclear. Try <b>Break down</b> into one small first step.</div>}
      </div>
      <div className="tri-actions">
        {breaking ? (
          <div className="tri-break">
            <input type="text" autoFocus value={step} onChange={(e) => setStep(e.target.value)} placeholder="One small first step, e.g. “Find the login and check the balance”" aria-label="First step"
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createStep(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setBreaking(false); } }} />
            <button type="button" className="mini" data-act="create-step" onClick={createStep}>Create</button>
            <button type="button" className="mini ghost-on" data-act="cancel-break" onClick={() => setBreaking(false)}>Cancel</button>
          </div>
        ) : x.recurring ? (
          <>
            <button type="button" className="mini" data-act="today" onClick={() => setTaskDate(t, ymd(new Date()), "today")}>Do today</button>
            <button type="button" className="mini ghost-on" data-act="skip" title="Mark this occurrence done and move to the next one" onClick={() => finishTask(t, "skip")}>Skip to next</button>
          </>
        ) : (
          <>
            <button type="button" className="mini" data-act="today" onClick={() => setTaskDate(t, ymd(new Date()), "today")}>Today</button>
            <select className="tri-pick" data-act="pick" aria-label="Pick a day" value="" onChange={(e) => pick(e.target.value)}>
              <option value="">Pick a day…</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="weekend">This weekend</option>
              <option value="nextweek">Next week (Mon)</option>
              <option value="custom">Choose a date…</option>
            </select>
            <button type="button" className="mini ghost-on" data-act="someday" title="Remove the date and tag @someday. Resurfaces in the Friday review." onClick={() => moveToSomeday(t)}>Someday</button>
            <button type="button" className="mini ghost-on" data-act="breakdown" title="Turn it into a milestone with a first small step" onClick={() => setBreaking(true)}>Break down</button>
            <button type="button" className="mini ghost-on" data-act="done" onClick={() => finishTask(t, "done")}>Done</button>
            <button type="button" className="mini ghost-on danger" data-act="drop" title="Complete it tagged @dropped (recoverable in Todoist)" onClick={() => finishTask(t, "drop")}>Drop</button>
          </>
        )}
      </div>
    </li>
  );
}
