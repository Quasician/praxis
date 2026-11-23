import { useMemo, useState } from "react";
import { api, itemUpdate, sync, uuid } from "../lib/api";
import { daysOverdue, startOfToday } from "../lib/dates";
import { DROPPED_LABEL, SOMEDAY_LABEL, hasLabel, isMilestone } from "../lib/tasks";
import { plain } from "../lib/text";
import type { SyncCommand, Task } from "../lib/types";
import { reconcileSoon } from "../data/actions";
import { queryClient, qk, useActive, useStatus } from "../data/queries";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";

type Action = "keep" | "someday" | "merge" | "drop";
interface Decision { action: Action; mergeInto?: string; reason: string }
const CHUNK = 60;
const LABEL: Record<Action, string> = { keep: "Keep", someday: "Someday", merge: "Merge", drop: "Drop" };

export function BacklogDialog() {
  return <Dialog name="backlog" id="backlog-dialog" className="backlog-dialog"><BacklogBody /></Dialog>;
}

/** Tasks worth reviewing: open, top-level, not repeating, not milestones, not already parked. */
export const backlogOf = (active: Task[]) => active.filter((t) => !t.parent_id && !t.due?.is_recurring && !isMilestone(t) && !hasLabel(t, SOMEDAY_LABEL));

function BacklogBody() {
  const { connected, projects } = useData();
  const openDialogClaude = () => useUi.getState().openDialog("claude");
  const status = useStatus();
  const activeQ = useActive(connected);
  const close = useUi((s) => s.closeDialog);
  const tasks = useMemo(() => backlogOf(activeQ.data || []), [activeQ.data]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const [decisions, setDecisions] = useState<Map<string, Decision> | null>(null);
  const [progress, setProgress] = useState("");
  const [filter, setFilter] = useState<Action | "changes">("changes");
  const [saving, setSaving] = useState(false);

  const review = async () => {
    const out = new Map<string, Decision>();
    try {
      for (let i = 0; i < tasks.length; i += CHUNK) {
        const chunk = tasks.slice(i, i + CHUNK);
        setProgress(`Reviewing ${Math.min(i + CHUNK, tasks.length)} of ${tasks.length}…`);
        const res = await api<{ decisions: { id: string; action: string; merge_into?: string; reason?: string }[] }>("/api/claude/backlog", {
          method: "POST",
          body: {
            today: new Date().toDateString(),
            tasks: chunk.map((t) => ({
              id: t.id, content: plain(t.content), project: projects.get(t.project_id)?.name, due: t.due?.date.slice(0, 10),
              ageDays: t.added_at ? Math.round((+startOfToday() - Date.parse(t.added_at)) / 864e5) : undefined,
              labels: t.labels || [], description: (t.description || "").slice(0, 160),
            })),
          },
        });
        const ids = new Set(chunk.map((t) => t.id));
        for (const d of res.decisions) {
          if (!ids.has(d.id) || out.has(d.id)) continue;
          const action = (["keep", "someday", "merge", "drop"].includes(d.action) ? d.action : "keep") as Action;
          const okMerge = action === "merge" && d.merge_into && d.merge_into !== d.id && byId.has(d.merge_into);
          out.set(d.id, { action: action === "merge" && !okMerge ? "keep" : action, mergeInto: okMerge ? d.merge_into : undefined, reason: String(d.reason || "").slice(0, 120) });
        }
      }
      // Merging into a task that is itself going away would lose both: keep the target.
      for (const [, d] of out) if (d.action === "merge" && out.get(d.mergeInto!)?.action !== "keep" && out.get(d.mergeInto!)) out.set(d.mergeInto!, { action: "keep", reason: "Others merge into this one" });
      for (const t of tasks) if (!out.has(t.id)) out.set(t.id, { action: "keep", reason: "" });
      setDecisions(out);
    } catch (e) { toast((e as Error).message); }
    finally { setProgress(""); }
  };

  const counts = useMemo(() => {
    const c: Record<Action, number> = { keep: 0, someday: 0, merge: 0, drop: 0 };
    decisions?.forEach((d) => c[d.action]++);
    return c;
  }, [decisions]);

  const apply = async () => {
    if (!decisions) return;
    const changes = [...decisions].filter(([, d]) => d.action !== "keep");
    if (!confirm(`Apply ${changes.length} changes?\n\n• Someday: no date, tagged @someday\n• Drop / merge: marked complete and tagged @dropped (you can still find them in Todoist's completed list)`)) return;
    setSaving(true);
    const cmds: SyncCommand[] = [];
    const notes = new Map<string, string[]>();
    for (const [id, d] of changes) {
      const t = byId.get(id);
      if (!t) continue;
      if (d.action === "someday") cmds.push(itemUpdate({ id, due: null, labels: [...new Set([...(t.labels || []), SOMEDAY_LABEL])] }));
      else {
        if (d.action === "merge") notes.set(d.mergeInto!, [...(notes.get(d.mergeInto!) || []), plain(t.content)]);
        cmds.push(itemUpdate({ id, labels: [...new Set([...(t.labels || []), DROPPED_LABEL])] }));
        cmds.push({ type: "item_close", uuid: uuid(), args: { id } });
      }
    }
    for (const [target, from] of notes) {
      const t = byId.get(target);
      if (t) cmds.push(itemUpdate({ id: target, description: `${t.description ? t.description + "\n\n" : ""}Merged in: ${from.join("; ")}` }));
    }
    let rejected = 0;
    try {
      for (let i = 0; i < cmds.length; i += 90) rejected += (await sync(cmds.slice(i, i + 90))).length; // Todoist takes up to 100 per request
      toast(rejected ? `Applied most changes; Todoist rejected ${rejected}.` : `Backlog cleaned: ${counts.someday} to Someday, ${counts.merge} merged, ${counts.drop} dropped. ${counts.keep} kept.`);
      close("backlog");
      setDecisions(null);
      queryClient.invalidateQueries({ queryKey: qk.active });
      reconcileSoon(0);
    } catch (e) { toast(`Couldn't apply: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  if (!status.data?.claude) {
    return (
      <div className="backlog-form">
        <h2>Clean up your backlog</h2>
        <p className="dialog-sub">This uses Claude. Connect it once (your Claude subscription through Claude Code, or an API key) and it works here and in brain dumps.</p>
        <div className="dialog-actions"><button type="button" className="ghost-btn" onClick={() => close("backlog")}>Close</button><button type="button" className="primary" onClick={() => { close("backlog"); openDialogClaude(); }}>Connect Claude…</button></div>
      </div>
    );
  }

  const rows = decisions ? [...decisions].filter(([, d]) => (filter === "changes" ? d.action !== "keep" : d.action === filter)) : [];
  return (
    <div className="backlog-form">
      <div>
        <h2>Clean up your backlog</h2>
        <p className="dialog-sub">{decisions ? "Claude's suggestions. Change any of them, then apply. Nothing changes until you do."
          : `${tasks.length} open tasks (not counting repeating tasks, milestones and Someday). Claude suggests what to keep, park, merge or drop, so the list you look at every day is one you trust.`}</p>
      </div>
      {!decisions && (
        <div className="dialog-actions">
          <button type="button" className="ghost-btn" onClick={() => close("backlog")}>Not now</button>
          <button type="button" id="backlog-review" className="primary" disabled={!!progress || !tasks.length || !activeQ.isSuccess} onClick={review}>{progress || `Review ${tasks.length} tasks`}</button>
        </div>
      )}
      {decisions && <>
        <div className="bl-filters" role="tablist">
          <button type="button" className={filter === "changes" ? "on" : ""} onClick={() => setFilter("changes")}>Changes <b>{counts.someday + counts.merge + counts.drop}</b></button>
          {(["someday", "merge", "drop", "keep"] as Action[]).map((a) => <button type="button" key={a} data-filter={a} className={filter === a ? "on" : ""} onClick={() => setFilter(a)}>{LABEL[a]} <b>{counts[a]}</b></button>)}
        </div>
        <ul className="bl-list" id="bl-list">
          {rows.map(([id, d]) => {
            const t = byId.get(id);
            if (!t) return null;
            const overdue = daysOverdue(t);
            return (
              <li key={id} className={`bl-row act-${d.action}`} data-id={id}>
                <div className="bl-main">
                  <div className="bl-title">{plain(t.content)}</div>
                  <div className="bl-meta">
                    {projects.get(t.project_id)?.name}{overdue > 0 ? ` · ${overdue}d overdue` : ""}{d.reason ? ` · ${d.reason}` : ""}
                    {d.action === "merge" && d.mergeInto && <> · into “{plain(byId.get(d.mergeInto)?.content || "").slice(0, 50)}”</>}
                  </div>
                </div>
                <select className="bl-action" value={d.action} aria-label="Action" onChange={(e) => {
                  const action = e.target.value as Action;
                  if (action === "merge" && !d.mergeInto) return;
                  setDecisions(new Map(decisions).set(id, { ...d, action }));
                }}>
                  {(["keep", "someday", "drop", ...(d.mergeInto ? ["merge"] : [])] as Action[]).map((a) => <option key={a} value={a}>{LABEL[a]}</option>)}
                </select>
              </li>
            );
          })}
          {!rows.length && <li className="bl-none">Nothing here.</li>}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="ghost-btn" onClick={() => setDecisions(null)}>Start over</button>
          <span className="spacer" />
          <button type="button" className="ghost-btn" onClick={() => close("backlog")}>Close</button>
          <button type="button" id="backlog-apply" className="primary" disabled={saving || !(counts.someday + counts.merge + counts.drop)} onClick={apply}>{saving ? "Applying…" : `Apply ${counts.someday + counts.merge + counts.drop} changes`}</button>
        </div>
      </>}
    </div>
  );
}
