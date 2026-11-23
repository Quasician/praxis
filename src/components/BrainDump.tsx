import { useEffect, useRef, useState } from "react";
import { DURATIONS, dateText, type Proposal, type Willpower } from "../domain/dump";
import { fmtDuration } from "../lib/dates";
import { colorOf, plain } from "../lib/text";
import { api } from "../lib/api";
import { acceptDump, sortWithClaude } from "../data/dump";
import { queryClient, qk, useStatus } from "../data/queries";
import { useData } from "../data/useData";
import { EMPTY_DUMP, useUi } from "../state/ui";
import { Dialog } from "./common";

export function BrainDumpDialog() {
  return <Dialog name="dump" id="dump-dialog" className="dump-dialog"><DumpBody /></Dialog>;
}
export function ClaudeDialog() {
  const close = useUi((s) => s.closeDialog);
  return <Dialog name="claude" id="claude-dialog" className="claude-dialog"><ClaudeKey onDone={() => close("claude")} /></Dialog>;
}

function DumpBody() {
  const status = useStatus();
  const { inbox: inboxAll } = useData();
  const inbox = inboxAll.filter((t) => !t.parent_id); // steps stay with their milestone
  const { dump, setDump, closeDialog } = useUi();
  const [busy, setBusy] = useState<"" | "sort" | "inbox" | "save">("");
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!dump.proposals) box.current?.focus(); }, [dump.proposals]);

  if (!status.data?.claude) return <ClaudeKey intro onDone={() => undefined} />;

  const run = async (kind: "sort" | "inbox") => {
    setBusy(kind); setError("");
    try {
      const ps = await sortWithClaude(kind === "sort" ? dump.text : "", kind === "inbox" ? inbox : []);
      if (!ps.length) setError("Claude didn't find anything to add.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };
  const save = async () => {
    setBusy("save"); setError("");
    try { if (await acceptDump(dump.proposals!, inbox) && !useUi.getState().dump.proposals) closeDialog("dump"); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };

  const ps = dump.proposals;
  const included = ps ? ps.filter((p) => p.include).length : 0;
  return (
    <div className="dump-form">
      <div className="dump-head">
        <div>
          <h2>Brain dump</h2>
          <p className="dialog-sub">{ps ? (dump.filing ? "Here's how Claude would file your Inbox. Change anything, then save." : "Here's what Claude made of it. Change anything, untick what you don't want, then add.")
            : "Get it all out of your head: errands, ideas, worries, plans. Claude turns it into tasks with a project, a date if you gave one, a duration and an effort level."}</p>
        </div>
      </div>

      {!ps && <>
        <textarea id="dump-text" ref={box} className="dump-text" value={dump.text} placeholder={"call mom about flights for dad's 60th\nrenew passport before March\nmaybe try bouldering?\nrowing 3x this week\nfix the squeaky door"}
          onChange={(e) => setDump({ text: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dump.text.trim() && !busy) run("sort"); }} />
        <div className="dump-row">
          <span className="dump-hint">Ctrl+Enter to sort · nothing is added until you review it</span>
          {inbox.length > 0 && <button type="button" id="dump-inbox" className="ghost-btn" disabled={!!busy} onClick={() => run("inbox")}>{busy === "inbox" ? "Sorting…" : `File my Inbox (${Math.min(inbox.length, 80)})`}</button>}
          <button type="button" id="dump-sort" className="primary" disabled={!dump.text.trim() || !!busy} onClick={() => run("sort")}>{busy === "sort" ? "Sorting…" : "Sort it"}</button>
        </div>
      </>}

      {ps && <>
        {dump.questions.length > 0 && <div className="dump-questions">{dump.questions.map((q, i) => <div key={i}>Claude asks: {q}</div>)}</div>}
        <ul id="dump-proposals" className="dump-list">{ps.map((p) => <ProposalRow key={p.key} p={p} />)}</ul>
      </>}

      {error && <p id="dump-error" className="dump-error">{error}</p>}

      <div className="dialog-actions">
        {ps && <button type="button" id="dump-back" className="ghost-btn" disabled={!!busy} onClick={() => setDump({ proposals: null, questions: [], filing: false })}>{dump.filing ? "Back" : "Back to my text"}</button>}
        {ps && <button type="button" id="dump-discard" className="ghost-btn" disabled={!!busy} onClick={() => { if (confirm("Throw away this brain dump?")) setDump(EMPTY_DUMP); }}>Discard</button>}
        <span className="spacer" />
        <button type="button" className="ghost-btn" onClick={() => closeDialog("dump")}>Close</button>
        {ps && <button type="button" id="dump-accept" className="primary" disabled={!included || !!busy} onClick={save}>
          {busy === "save" ? "Saving…" : `${dump.filing ? "File" : "Add"} ${included} task${included === 1 ? "" : "s"}`}
        </button>}
      </div>
    </div>
  );
}

const WP: { id: Willpower; label: string }[] = [{ id: "deep", label: "Deep" }, { id: "medium", label: "Med" }, { id: "light", label: "Light" }];

function ProposalRow({ p }: { p: Proposal }) {
  const { projectsQ, projects } = useData();
  const setDump = useUi((s) => s.setDump);
  const edit = (patch: Partial<Proposal>) => {
    const cur = useUi.getState().dump.proposals || [];
    setDump({ proposals: cur.map((x) => (x.key === p.key ? { ...x, ...patch } : x)) });
  };
  const proj = projects.get(p.projectId);
  return (
    <li className={`dump-item ${p.include ? "" : "off"}`} data-key={p.key} data-source={p.sourceId || ""} style={{ ["--c" as string]: colorOf(proj?.color) }}>
      <input type="checkbox" className="dump-include" checked={p.include} title="Include" onChange={(e) => edit({ include: e.target.checked })} />
      <div className="dump-main">
        <input className="dump-content" value={p.content} onChange={(e) => edit({ content: e.target.value })} aria-label="Task" />
        <div className="dump-meta">
          <select className="dump-project" value={p.projectId} onChange={(e) => edit({ projectId: e.target.value })} aria-label="Project">
            {(projectsQ.data || []).filter((x) => !x.is_archived).map((x) => <option key={x.id} value={x.id}>{plain(x.name)}</option>)}
          </select>
          {p.recurring
            ? <span className="dump-chip" title="Repeats">↻ {p.recurring}<button type="button" aria-label="Don't repeat" onClick={() => edit({ recurring: "" })}>×</button></span>
            : <label className="dump-date" title={dateText(p.date) || "No date"}>
                <input type="date" className="dump-date-input" value={p.date} onChange={(e) => edit({ date: e.target.value, time: e.target.value ? p.time : "" })} aria-label="Date" />
                {p.date && <input type="time" className="dump-time" value={p.time} onChange={(e) => edit({ time: e.target.value })} aria-label="Time" />}
              </label>}
          {p.deadline && <span className="dump-chip deadline" title="Deadline">⚑ {dateText(p.deadline)}<button type="button" aria-label="Remove deadline" onClick={() => edit({ deadline: "" })}>×</button></span>}
          <select className="dump-duration" value={p.duration} onChange={(e) => edit({ duration: Number(e.target.value) })} aria-label="Duration">
            {DURATIONS.map((d) => <option key={d} value={d}>{fmtDuration(d)}</option>)}
          </select>
          <span className="dump-wp" role="group" aria-label="Effort">
            {WP.map((w) => <button type="button" key={w.id} className={`wp-${w.id} ${p.willpower === w.id ? "on" : ""}`} onClick={() => edit({ willpower: w.id })}>{w.label}</button>)}
          </span>
          {p.priority > 1 && <span className={`dump-prio p${p.priority}`} title="Priority">P{5 - p.priority}</span>}
          {p.note && <span className="dump-note">{p.note}</span>}
        </div>
        {p.firstStep !== "" && !p.recurring && (
          <div className="dump-step">
            <span className="dump-step-label" title="The task becomes a milestone; this small step gets the date">First step</span>
            <input className="dump-step-input" value={p.firstStep} onChange={(e) => edit({ firstStep: e.target.value })} aria-label="First step" />
            <button type="button" aria-label="No first step" title="Keep it as one task" onClick={() => edit({ firstStep: "" })}>×</button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Paste / replace / remove the Anthropic API key. */
function ClaudeKey({ intro = false, onDone }: { intro?: boolean; onDone: () => void }) {
  const status = useStatus();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const has = !!status.data?.claude;
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/claude/key", { method: "POST", body: { key } });
      setKey("");
      await queryClient.refetchQueries({ queryKey: qk.status });
      if (!intro) onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <form className="claude-form" onSubmit={(e) => { e.preventDefault(); if (key.trim() && !busy) save(); }}>
      <h2>{intro ? "Connect Claude for brain dumps" : "Claude"}</h2>
      <p className="dialog-sub">
        Brain dumps use Claude through your own Anthropic API key. It's pay-as-you-go: a typical dump costs well under a cent.
        The key stays on this computer, next to your Todoist token.
      </p>
      {has && !intro && <p className="claude-ok" id="claude-connected">✓ Connected. Paste a new key below to replace it.</p>}
      <ol className="claude-steps">
        <li>Open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com → API keys</a> and sign in.</li>
        <li>Add a little credit under <b>Billing</b> if you haven't ($5 lasts a long time).</li>
        <li>Click <b>Create key</b>, name it "Praxis", copy it and paste it here.</li>
      </ol>
      <input id="claude-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
      {error && <p id="claude-error" className="dump-error">{error}</p>}
      <div className="dialog-actions">
        {has && !intro && <button type="button" id="claude-remove" className="ghost-btn danger" onClick={async () => {
          if (!confirm("Remove your Anthropic API key from Praxis?")) return;
          await api("/api/claude/key", { method: "DELETE" });
          await queryClient.refetchQueries({ queryKey: qk.status });
        }}>Remove key</button>}
        <span className="spacer" />
        {!intro && <button type="button" className="ghost-btn" onClick={onDone}>Close</button>}
        <button type="submit" id="claude-save" className="primary" disabled={!key.trim() || busy}>{busy ? "Checking…" : "Connect"}</button>
      </div>
    </form>
  );
}
