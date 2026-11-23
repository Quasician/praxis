import { useMemo, useState } from "react";
import { AREA_COLORS, computeArea, newId, type AreaStats, type MilestoneInfo } from "../domain/areas";
import { fmtSpan, parseDue, sameDay, startOfToday } from "../lib/dates";
import { Inline, colorOf, plain } from "../lib/text";
import { closeTask, reopenTask } from "../lib/api";
import type { Area, Task } from "../lib/types";
import { addMilestone, addStep, doToday, reconcileSoon, removeTask, updateConfig } from "../data/actions";
import { useActive, useCompleted } from "../data/queries";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";

const onToday = (t: Task) => { const d = parseDue(t.due); return !!(d && sameDay(d.d, new Date())); };

/** side = the narrow column shown next to the day view on very wide screens. */
export function AreasView({ side = false }: { side?: boolean } = {}) {
  const { config, connected } = useData();
  const activeQ = useActive(connected);
  const completedQ = useCompleted(connected);
  const openDialog = useUi((s) => s.openDialog);
  const areas = config?.areas;
  const ready = !!areas && activeQ.isSuccess && completedQ.isSuccess;
  const computed = useMemo(() => (ready ? areas!.map((a) => computeArea(a, activeQ.data!, completedQ.data!)) : []), [ready, areas, activeQ.data, completedQ.data]);

  const totalMin = computed.reduce((s, c) => s + c.weekMin, 0);
  const totalDone = computed.reduce((s, c) => s + c.weekDone, 0);
  const quiet = computed.filter((c) => c.quiet).map((c) => c.area.name);
  const msCount = computed.reduce((s, c) => s + c.milestones.length, 0);

  return (
    <main id={side ? "areas-side" : "areas-view"} className={`areas-view${side ? " side" : ""}`}>
      <div className="areas-head">
        <div>
          <h2>{side ? "Areas" : "Areas of your life"}</h2>
          <p id="areas-sub" className="areas-sub">
            {ready && <>
              This week: <b>{totalDone}</b> done{totalMin ? <> · <b>{fmtSpan(totalMin)}</b> timed</> : null}
              {" · "}<b>{msCount}</b> active milestone{msCount === 1 ? "" : "s"}{" · "}
              {quiet.length ? <span className="quiet-note">Gone quiet: {quiet.join(", ")}</span> : "Every area got attention recently"}
            </>}
          </p>
        </div>
        <button id="edit-areas-btn" className="ghost-btn" onClick={() => openDialog("areas")}>Edit areas</button>
      </div>
      <div id="areas-grid" className="areas-grid">
        {!ready ? Array.from({ length: 4 }, (_, i) => <div key={i} className="area-card skeleton-card"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>)
          : computed.length ? computed.map((c) => <AreaCard key={c.area.id} x={c} />)
          : <div className="empty"><div className="big">No areas yet.</div>Click “Edit areas” to group your projects into areas of your life.</div>}
      </div>
      <AreaEditor />
    </main>
  );
}

function Spark({ spark, color }: { spark: AreaStats["spark"]; color: string }) {
  const max = Math.max(30, ...spark.map((s) => s.min));
  return (
    <div className="spark" style={{ ["--c" as string]: color }} aria-label="Activity over the last 7 days">
      {spark.map((s, i) => {
        const day = s.day.toLocaleDateString([], { weekday: "short" });
        return <span key={i} title={`${day}: ${s.n} done${s.n ? ` (~${fmtSpan(s.min)})` : ""}`}><i style={{ height: `${s.n ? Math.max(8, Math.round((s.min / max) * 100)) : 0}%` }} /><b>{day[0]}</b></span>;
      })}
    </div>
  );
}

function fmtTarget(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  const days = Math.round((+d - +startOfToday()) / 864e5);
  const label = d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  if (days < 0) return <span className="ms-target late">was due {label}</span>;
  if (days === 0) return <span className="ms-target soon">due today</span>;
  return <span className={`ms-target ${days <= 7 ? "soon" : ""}`}>by {label}{days <= 7 ? ` · ${days}d left` : ""}</span>;
}

function InlineAdd({ placeholder, onAdd, className = "" }: { placeholder: string; onAdd: (text: string) => Promise<void>; className?: string }) {
  const [text, setText] = useState("");
  return (
    <form className={`inline-add ${className}`} autoComplete="off" onSubmit={async (e) => {
      e.preventDefault();
      const v = text.trim();
      if (!v) return;
      setText("");
      try { await onAdd(v); } catch (err) { setText(v); toast(`Couldn't save: ${(err as Error).message}`); }
    }}>
      <input type="text" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
    </form>
  );
}

function Milestone({ x }: { x: MilestoneInfo }) {
  const { m, steps, doneSteps, total, pct, next, target } = x;
  const [leaving, setLeaving] = useState(false);
  const complete = async () => {
    if (steps.length && !confirm(`This milestone still has ${steps.length} open step${steps.length > 1 ? "s" : ""}. Mark it done anyway?`)) return;
    setLeaving(true);
    const undo = removeTask(m.id);
    try {
      await closeTask(m.id);
      toast(`Milestone done: “${plain(m.content).slice(0, 50)}” 🎉`, { label: "Undo", run: async () => { await reopenTask(m.id); reconcileSoon(0); } });
    } catch (e) { undo(); setLeaving(false); toast(`Couldn't complete it: ${(e as Error).message}`); }
    reconcileSoon(500);
  };
  return (
    <div className={`ms ${leaving ? "done" : ""}`} data-id={m.id}>
      <div className="ms-top">
        <button className="ms-check" data-act="complete" title="Mark milestone done" aria-label="Mark milestone done" onClick={complete}>
          <svg viewBox="0 0 24 24" width="11" height="11"><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </button>
        <span className="ms-title"><Inline text={m.content} /></span>
        <a className="open-link" href={`https://app.todoist.com/app/task/${encodeURIComponent(m.id)}`} target="_blank" rel="noopener" title="Open in Todoist">↗</a>
      </div>
      <div className="ms-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="ms-meta"><span>{total ? `${doneSteps} of ${total} steps` : "No steps"}</span>{fmtTarget(target)}</div>
      {next ? (
        <div className="ms-next">
          <span className="ms-next-label">Next</span>
          <span className="ms-next-title"><Inline text={next.content} /></span>
          {onToday(next) ? <span className="ms-on-today">On today ✓</span> : <button className="mini" data-act="today" onClick={() => doToday(next)}>Do today</button>}
        </div>
      ) : (
        <div className="ms-next ms-none">{total ? "All steps done. Tick the milestone when it's finished." : "No steps yet. Add the first one below."}</div>
      )}
      {steps.length > 1 && (
        <details className="ms-steps">
          <summary>{steps.length - 1} more step{steps.length > 2 ? "s" : ""}</summary>
          <ul>{steps.slice(1).map((s) => (
            <li key={s.id}><span><Inline text={s.content} /></span>
              {onToday(s) ? <span className="ms-on-today">today</span> : <button className="mini ghost" data-act="today" onClick={() => doToday(s)}>Do today</button>}
            </li>
          ))}</ul>
        </details>
      )}
      <InlineAdd placeholder="+ Add a step" onAdd={async (v) => { await addStep(m.id, v); toast("Step added"); }} />
    </div>
  );
}

function NewMilestone({ area }: { area: Area }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const submit = async () => {
    const v = title.trim();
    if (!v) return;
    setTitle(""); setTarget(""); setOpen(false);
    try { await addMilestone(area.projects[0], v, target); toast("Milestone added"); }
    catch (e) { setTitle(v); toast(`Couldn't save: ${(e as Error).message}`); }
  };
  return (
    <form className={`inline-add ms-new ${open || title ? "open" : ""}`} autoComplete="off" onSubmit={(e) => { e.preventDefault(); submit(); }}
          onFocus={() => setOpen(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && !title) setOpen(false); }}>
      <input type="text" name="title" placeholder="+ New milestone, e.g. “Finish the rowing program”" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="ms-new-extra">
        <label>Target <input type="date" name="target" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <button className="mini" type="submit">Add</button>
      </div>
    </form>
  );
}

function AreaCard({ x }: { x: AreaStats }) {
  const { projects } = useData();
  const { area, open, milestones, upNext, spark, weekMin, weekDone, quietFor, everActive, quiet } = x;
  const color = colorOf(area.color);
  const projNames = area.projects.map((id) => projects.get(id)?.name).filter(Boolean).join(", ");
  return (
    <article className={`area-card ${quiet ? "is-quiet" : ""}`} style={{ ["--c" as string]: color }} data-area={area.id}>
      <header className="area-top">
        <span className="area-dot" />
        <h3>{area.name}</h3>
        <span className="area-open" title={projNames}>{open.length} open</span>
      </header>
      <div className="area-stats">
        <div className="stat"><b>{weekMin ? fmtSpan(weekMin) : "—"}</b><span>timed this week</span></div>
        <div className="stat"><b>{weekDone}</b><span>done this week</span></div>
        <Spark spark={spark} color={color} />
      </div>
      {!area.projects.length ? <div className="nudge">No projects yet. Use “Edit areas” to add some.</div>
        : quiet ? <div className="nudge">{everActive ? `Quiet for ${quietFor} days.` : "Nothing finished here in the last 3 months."} {upNext.length || milestones.some((ms) => ms.next) ? "Maybe plan one small thing today?" : "Add a milestone or a task to get it moving."}</div>
        : null}
      {milestones.length > 0 && <section className="area-sec"><h4>Milestones</h4>{milestones.map((ms) => <Milestone key={ms.m.id} x={ms} />)}</section>}
      {upNext.length > 0 && (
        <section className="area-sec"><h4>Up next</h4>
          <ul className="upnext">{upNext.map((t) => {
            const d = parseDue(t.due);
            return (
              <li key={t.id} className={`p${t.priority || 1}`}><span className="dot" /><span className="t"><Inline text={t.content} /></span>
                {d && <span className="when">{sameDay(d.d, new Date()) ? "today" : d.d.toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
                {!onToday(t) && <button className="mini ghost" data-act="today" onClick={() => doToday(t)}>Do today</button>}
              </li>
            );
          })}</ul>
        </section>
      )}
      {area.projects.length > 0 && <NewMilestone area={area} />}
    </article>
  );
}

function AreaEditor() {
  return (
    <Dialog name="areas" id="areas-dialog">
      <AreaEditorBody />
    </Dialog>
  );
}

function AreaEditorBody() {
  const { config, projects } = useData();
  const close = useUi((s) => s.closeDialog);
  const [areas, setAreas] = useState<Area[]>(() => JSON.parse(JSON.stringify(config?.areas || [])));
  const all = [...projects.values()].filter((p) => !(p.inbox_project || p.is_inbox_project) && !p.is_archived);
  const owner = new Map<string, Area>();
  for (const a of areas) for (const pid of a.projects) owner.set(pid, a);
  const edit = (id: string, patch: Partial<Area>) => setAreas((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const pick = (areaId: string, pid: string, on: boolean) => setAreas((as) => as.map((a) => ({
    ...a, projects: a.id === areaId ? (on ? [...a.projects.filter((x) => x !== pid), pid] : a.projects.filter((x) => x !== pid)) : a.projects.filter((x) => x !== pid),
  })));
  const save = async () => {
    try { await updateConfig((c) => ({ ...c, areas: areas.map((a) => ({ ...a, name: a.name.trim() || "Untitled" })) })); toast("Areas saved"); close("areas"); }
    catch (e) { toast(`Couldn't save: ${(e as Error).message}`); }
  };
  return (
    <form id="areas-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <h2>Edit areas</h2>
      <p className="dialog-sub">Group your Todoist projects into areas of your life. A project can belong to one area.</p>
      <div id="areas-editor">
        {areas.length ? areas.map((a) => (
          <fieldset key={a.id} className="area-edit" data-id={a.id} style={{ ["--c" as string]: colorOf(a.color) }}>
            <div className="area-edit-top">
              <span className="area-dot" />
              <input className="area-name" value={a.name} aria-label="Area name" onChange={(e) => edit(a.id, { name: e.target.value })} />
              <select className="area-color" aria-label="Color" value={a.color} onChange={(e) => edit(a.id, { color: e.target.value })}>
                {AREA_COLORS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
              </select>
              <button type="button" className="ghost-btn danger" onClick={() => setAreas((as) => as.filter((x) => x.id !== a.id))}>Remove</button>
            </div>
            <div className="proj-picks">{all.map((p) => {
              const o = owner.get(p.id), mine = o && o.id === a.id;
              return (
                <label key={p.id} className={`proj-pick ${mine ? "on" : ""} ${o && !mine ? "taken" : ""}`} title={o && !mine ? `Currently in ${o.name}; picking it here moves it` : ""}>
                  <input type="checkbox" value={p.id} checked={!!mine} onChange={(e) => pick(a.id, p.id, e.target.checked)} />
                  <i style={{ background: colorOf(p.color) }} />{p.name}{o && !mine ? <small> ({o.name})</small> : null}
                </label>
              );
            })}</div>
          </fieldset>
        )) : <p className="dialog-sub">No areas. Add one below.</p>}
      </div>
      <button type="button" id="add-area-btn" className="ghost-btn" onClick={() => {
        const used = new Set(areas.map((a) => a.color));
        setAreas([...areas, { id: newId(), name: "New area", color: AREA_COLORS.find((c) => !used.has(c)) || "charcoal", projects: [] }]);
      }}>+ Add area</button>
      <div className="dialog-actions">
        <button type="button" value="cancel" className="ghost-btn" onClick={() => close("areas")}>Cancel</button>
        <button type="submit" value="save" id="save-areas-btn" className="primary">Save</button>
      </div>
    </form>
  );
}
