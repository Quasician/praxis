import { useMemo, useState } from "react";
import { shapeOf } from "../domain/sky";
import { colorOf } from "../lib/text";
import { uuid } from "../lib/api";
import { createConstellation, drawWithClaude, type Draft, type DraftStep, type Effort } from "../data/constellation";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";

const MINUTES = [10, 15, 20, 30, 45, 60, 90, 120, 180];
const newSeed = () => Math.random().toString(36).slice(2, 10);

export function ConstellationDialog() {
  return <Dialog name="constellation" id="constellation-dialog" className="constellation-dialog"><Body /></Dialog>;
}

function Body() {
  const { config, projects, status } = useData();
  const close = useUi((s) => s.closeDialog);
  const openDialog = useUi((s) => s.openDialog);
  const areas = config?.areas || [];
  const projectList = useMemo(() => [...projects.values()].filter((p) => !p.inbox_project && !p.is_inbox_project && !p.is_archived), [projects]);
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");
  const [deadline, setDeadline] = useState("");
  const [projectId, setProjectId] = useState(() => areas.find((a) => a.projects.length)?.projects[0] || projectList[0]?.id || "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [seed, setSeed] = useState(newSeed);
  const [firstToday, setFirstToday] = useState(true);
  const [busy, setBusy] = useState<"" | "drawing" | "saving">("");
  const [err, setErr] = useState("");
  const area = areas.find((a) => a.projects.includes(projectId));
  const claudeOn = !!status.data?.claude;

  const draw = async () => {
    if (!goal.trim()) { setErr("Describe the goal first."); return; }
    setErr(""); setBusy("drawing");
    try { const d = await drawWithClaude(goal.trim(), { notes, deadline, area: area?.name }); setDraft(d); setSeed(newSeed()); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(""); }
  };
  const byHand = () => { setErr(""); setDraft({ name: goal.trim(), steps: [blank(), blank(), blank()] }); };
  const setStep = (key: string, patch: Partial<DraftStep>) => setDraft((d) => d && { ...d, steps: d.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const save = async () => {
    if (!draft) return;
    const steps = draft.steps.filter((s) => s.title.trim());
    if (!draft.name.trim()) { setErr("Give the project a name."); return; }
    if (!steps.length) { setErr("Add at least one step."); return; }
    if (!projectId) { setErr("Pick a Todoist project for it."); return; }
    setErr(""); setBusy("saving");
    try {
      await createConstellation({ name: draft.name, steps, projectId, deadline: deadline || undefined, seed, firstToday, areaId: area?.id });
      toast(`“${draft.name.trim()}” is in your sky`);
      close("constellation");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(""); }
  };

  if (!draft) {
    return (
      <form className="cons-form" id="cons-goal-form" onSubmit={(e) => { e.preventDefault(); if (claudeOn) draw(); else byHand(); }}>
        <h2>New project</h2>
        <p className="dialog-sub">Describe what you want to get done. Claude breaks it into steps you can start without thinking, and it becomes a constellation in your sky.</p>
        <label className="cons-field">What do you want to get done?
          <textarea id="cons-goal" rows={2} autoFocus value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Plan the Christmas trip for Dad's 60th" />
        </label>
        <label className="cons-field">Anything Claude should know? <span className="optional">optional</span>
          <textarea id="cons-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Constraints, what's done already, who's involved…" />
        </label>
        <div className="cons-row">
          <label className="cons-field">Deadline <span className="optional">optional</span><input type="date" id="cons-deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          <label className="cons-field">Todoist project
            <select id="cons-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        {err && <p className="form-error" id="cons-error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost-btn" id="cons-by-hand" onClick={byHand}>Write the steps myself</button>
          <span className="spacer" />
          {!claudeOn && <button type="button" className="ghost-btn" onClick={() => { close("constellation"); openDialog("claude"); }}>Connect Claude…</button>}
          <button type="submit" className="primary" id="cons-draw" disabled={busy === "drawing" || !claudeOn}>{busy === "drawing" ? "Drawing…" : "✦ Draw it with Claude"}</button>
        </div>
      </form>
    );
  }

  const live = draft.steps.filter((s) => s.title.trim());
  return (
    <form className="cons-form cons-preview" id="cons-preview-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="cons-sky">
        <Preview seed={seed} steps={live.length || 1} color={colorOf(area?.color) || "#8fb4ff"} />
        <button type="button" className="ghost-btn cons-reshape" id="cons-reshape" onClick={() => setSeed(newSeed())} title="Try a different shape">Reshape</button>
      </div>
      <div className="cons-edit">
        <input className="cons-name" id="cons-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Project name" />
        <p className="dialog-sub">{live.length} {live.length === 1 ? "step" : "steps"} · about {fmt(live.reduce((n, s) => n + s.minutes, 0))}{deadline ? ` · deadline ${new Date(`${deadline}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}{area ? ` · ${area.name}` : ""}</p>
        <ol className="cons-steps" id="cons-steps">
          {draft.steps.map((s, i) => (
            <li key={s.key} className="cons-step">
              <span className={`cons-dot ${i === 0 ? "first" : ""}`} />
              <input className="cons-step-title" value={s.title} placeholder={i === 0 ? "First step: something easy to start" : "Next step"} onChange={(e) => setStep(s.key, { title: e.target.value })} />
              <select value={s.minutes} onChange={(e) => setStep(s.key, { minutes: Number(e.target.value) })} aria-label="Minutes">
                {[...new Set([...MINUTES, s.minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{fmt(m)}</option>)}
              </select>
              <select value={s.effort} onChange={(e) => setStep(s.key, { effort: e.target.value as Effort })} aria-label="Effort">
                <option value="light">Light</option><option value="medium">Medium</option><option value="deep">Deep</option>
              </select>
              <button type="button" className="icon-btn cons-remove" aria-label="Remove step" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((x) => x.key !== s.key) })}>×</button>
            </li>
          ))}
        </ol>
        <button type="button" className="ghost-btn cons-add" id="cons-add-step" onClick={() => setDraft({ ...draft, steps: [...draft.steps, blank()] })}>+ Add a step</button>
        <label className="switch-row"><input type="checkbox" id="cons-first-today" checked={firstToday} onChange={(e) => setFirstToday(e.target.checked)} /> <span>Put the first step on today</span></label>
        {err && <p className="form-error" id="cons-error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost-btn" onClick={() => { setDraft(null); setErr(""); }}>Back</button>
          {claudeOn && <button type="button" className="ghost-btn" id="cons-redraw" disabled={!!busy} onClick={draw}>{busy === "drawing" ? "Drawing…" : "Try again"}</button>}
          <span className="spacer" />
          <button type="submit" className="primary" id="cons-save" disabled={!!busy}>{busy === "saving" ? "Adding…" : "Add to my sky"}</button>
        </div>
      </div>
    </form>
  );
}

const blank = (): DraftStep => ({ key: uuid(), title: "", minutes: 30, effort: "medium" });
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

/** The shape this project will have in your sky. */
function Preview({ seed, steps, color }: { seed: string; steps: number; color: string }) {
  const { pts, links } = shapeOf(seed, steps);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1;
  const s = Math.min(220 / w, 150 / h, 70);
  const P = pts.map((p) => ({ x: 150 + (p.x - minX - w / 2) * s, y: 110 + (p.y - minY - h / 2) * s }));
  return (
    <svg viewBox="0 0 300 220" className="cons-svg" role="img" aria-label={`A constellation with ${steps} stars`} style={{ "--c": color } as React.CSSProperties}>
      <rect width="300" height="220" rx="16" className="cons-svg-bg" />
      {links.map(([a, b], i) => <line key={`${seed}-${i}`} x1={P[a].x} y1={P[a].y} x2={P[b].x} y2={P[b].y} className="cons-line" style={{ animationDelay: `${i * 0.08}s` }} />)}
      {P.map((p, i) => (
        <g key={`${seed}-s${i}`} transform={`translate(${p.x} ${p.y})`}>
          <g className="cons-star" style={{ animationDelay: `${i * 0.08}s` }}>
            {i === 0 && <circle r="9" className="cons-ring" />}
            <circle r="3.2" className="cons-core" />
          </g>
        </g>
      ))}
    </svg>
  );
}
