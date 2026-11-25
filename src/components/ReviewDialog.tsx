// 4.0 The weekly review: the week against the plan, what the record says, and a decision for every stalled project.
import { useEffect, useMemo, useState } from "react";
import { addDays, startOfToday, ymd } from "../lib/dates";
import { adjustment, bands, insights, recordDays, span, weakHours } from "../domain/record";
import { reviewDue, reviewProjects, reviewWeek, type Decision, type ReviewProject } from "../domain/review";
import { keepGoing, saveReview, setCommitCount, setDown, shrink, wake } from "../data/review";
import { useActive, useCompleted, useStatus } from "../data/queries";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";
import { useSkyRecord } from "./SkyView";

const dayWord = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** A small card at the top of the list on Sunday and Monday, until the week has been reviewed. */
export function ReviewCard() {
  const { config } = useData();
  const open = useUi((s) => s.openDialog);
  const due = !!config && reviewDue(config.reviews);
  if (!due) return null;
  return <ReviewCardBody open={() => open("review")} />;
}
function ReviewCardBody({ open }: { open: () => void }) {
  const { sky } = useSkyRecord();   // brings the sky up to date with Todoist, even if the Sky tab hasn't been opened
  const r = reviewProjects(sky);
  const bits = [r.moved.length ? `${r.moved.length} moved` : "", r.stalled.length ? `${r.stalled.length} stalled` : ""].filter(Boolean).join(", ");
  return (
    <div className="letter-card review-card" id="review-card" role="status">
      <span className="letter-seal" aria-hidden="true">◎</span>
      <strong>Your weekly review is ready{bits ? `: ${bits}` : ""}.</strong>
      <span className="spacer" />
      <button type="button" id="review-open" className="ghost-btn" onClick={open}>Review the week</button>
    </div>
  );
}

export function ReviewDialog() {
  return <Dialog name="review" id="review-dialog" className="review-dialog"><ReviewBody /></Dialog>;
}

function ReviewBody() {
  const { config, cfg, connected } = useData();
  const status = useStatus();
  const completed = useCompleted(connected).data || [];
  const active = useActive(connected).data || [];
  const close = useUi((s) => s.closeDialog);
  const [decided, setDecided] = useState<Record<string, { d: Decision; note: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adjusted, setAdjusted] = useState<string | undefined>();

  const days = useMemo(() => recordDays(config, completed, active, 56, true), [config, completed, active]);
  const week = days.filter((d) => d.day > ymd(addDays(startOfToday(), -7)));
  const weak = useMemo(() => weakHours(bands(config, completed)), [config, completed]);
  const says = useMemo(() => insights(days, weak, config), [days, weak, config]);
  const adj = useMemo(() => adjustment(days, cfg), [days, cfg]);
  // The list is fixed once the sky is up to date, so a project you just decided on stays where it was, with its answer beside it.
  const { sky, ready } = useSkyRecord();
  const [fixed, setFixed] = useState<ReturnType<typeof reviewProjects> | null>(null);
  useEffect(() => { if (ready && !fixed) setFixed(reviewProjects(sky)); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const projects = fixed || { moved: [], quiet: [], stalled: [], resting: [], finished: [] };
  // On Sunday and Monday it's the review of the week that just ended; any other day, a look at the last seven days.
  const onTime = new Date().getDay() <= 1;
  const when = new Date(`${reviewWeek()}T12:00:00`).toLocaleDateString([], { month: "long", day: "numeric" });

  const run = async (p: ReviewProject, d: Decision, day?: string) => {
    setBusy(p.id);
    try {
      let note = "";
      if (d === "keep") note = `“${await keepGoing(p.id, day!)}” is on ${dayLabel(day!)}.`;
      else if (d === "shrink") note = `Added a 10-minute first step for ${dayLabel(day!)}: “${await shrink(p.id, day!, !!status.data?.claude)}”.`;
      else if (d === "rest") { const n = await setDown(p.id); note = `Set down. It stays in your sky, faint${n ? `, and ${n} of its steps lost their dates` : ""}. Pick it back up from here or from the sky.`; }
      else { await wake(p.id); note = "Picked back up."; }
      setDecided((x) => ({ ...x, [p.id]: { d, note } }));
    } catch (e) { toast(`Couldn't do that: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const done = async () => {
    await saveReview(Object.fromEntries(Object.entries(decided).map(([id, v]) => [id, v.d])), adjusted).catch(() => undefined);
    close("review");
    const n = Object.keys(decided).length;
    toast(n ? `Review done. ${n} ${n === 1 ? "decision" : "decisions"} made.` : "Review done.");
  };

  const undecided = projects.stalled.filter((p) => !decided[p.id]).length;
  const sum = (k: "planned" | "done" | "plannedMin" | "doneMin") => week.reduce((s, d) => s + d[k], 0);
  return (
    <div className="review" id="review">
      <header>
        <p className="letter-date">{onTime ? `Week ending ${when}` : "The last seven days"}</p>
        <h2>Weekly review</h2>
      </header>

      <section id="review-week">
        <h3>The week against the plan</h3>
        {week.length ? (
          <div className="rv-numbers">
            <div><b>{sum("done")} of {sum("planned")}</b><span>planned tasks done</span></div>
            <div><b>{span(sum("doneMin"))}</b><span>of {span(sum("plannedMin"))} planned</span></div>
            <div><b>{week.filter((d) => d.committed && d.committedDone >= d.committed).length} of {week.filter((d) => d.committed).length}</b><span>days every commitment was kept</span></div>
          </div>
        ) : <p className="dialog-sub">No day had a plan this week, so there's nothing to compare yet.</p>}
        {says.length > 0 && <ul className="rv-says">{says.slice(0, 3).map((s) => <li key={s.id} title={s.detail}>{s.text}</li>)}</ul>}
      </section>

      <section id="review-projects">
        <h3>Projects</h3>
        {projects.finished.map((p) => <p key={p.id} className="rv-line"><span className="rv-dot done" />{p.name} <small>finished this week</small></p>)}
        {projects.moved.map((p) => <p key={p.id} className="rv-line"><span className="rv-dot on" />{p.name} <small>{p.litWeek} {p.litWeek === 1 ? "star" : "stars"} lit · {p.lit} of {p.total}</small></p>)}
        {projects.quiet.map((p) => <p key={p.id} className="rv-line"><span className="rv-dot" />{p.name} <small>nothing this week · last star {dayWord(p.quiet)} ago</small></p>)}
        {!fixed && <p className="dialog-sub">Reading your projects…</p>}
        {fixed && !projects.moved.length && !projects.quiet.length && !projects.stalled.length && !projects.resting.length && !projects.finished.length && <p className="dialog-sub">No projects in your sky yet.</p>}

        {projects.stalled.length > 0 && <p className="rv-ask">{projects.stalled.length === 1 ? "One project hasn't" : `${projects.stalled.length} projects haven't`} had a star lit in three weeks or more. Decide what happens to {projects.stalled.length === 1 ? "it" : "each"}:</p>}
        {projects.stalled.map((p) => <Stalled key={p.id} p={p} answer={decided[p.id]} busy={busy === p.id} run={run} />)}

        {projects.resting.length > 0 && <h4>Set down</h4>}
        {projects.resting.map((p) => (
          <div key={p.id} className="rv-line rv-rest" data-id={p.id}>
            <span className="rv-dot rest" />{p.name} <small>{p.lit} of {p.total}</small><span className="spacer" />
            {decided[p.id] ? <small>{decided[p.id].note}</small> : <button type="button" className="ghost-btn" disabled={busy === p.id} onClick={() => run(p, "wake")}>Pick it back up</button>}
          </div>
        ))}
      </section>

      {adj && (
        <section id="review-adjust">
          <h3>One change for next week</h3>
          <div className="rv-adjust">
            <p><b>{adj.text}</b> {adj.why}</p>
            <button type="button" id="review-apply" className="ghost-btn" disabled={!!adjusted} onClick={async () => { setAdjusted(adj.id); await setCommitCount(adj.commitCount).catch(() => setAdjusted(undefined)); }}>{adjusted ? "Changed" : "Make the change"}</button>
          </div>
        </section>
      )}

      <div className="dialog-actions">
        {undecided > 0 && <span className="rv-left">{undecided} still to decide. You can also leave {undecided === 1 ? "it" : "them"} for next week.</span>}
        <span className="spacer" />
        <button type="button" id="review-done" className="primary" onClick={done}>Done</button>
      </div>
    </div>
  );
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "long" });

function Stalled({ p, answer, busy, run }: { p: ReviewProject; answer?: { d: Decision; note: string }; busy: boolean; run: (p: ReviewProject, d: Decision, day?: string) => void }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => ymd(addDays(startOfToday(), i + 1))), []);
  const [day, setDay] = useState(days[0]);
  return (
    <div className={`rv-stalled${answer ? " decided" : ""}`} data-id={p.id}>
      <div className="rv-stalled-head">
        <b>{p.name}</b>
        <small>{p.lit} of {p.total} stars · no star in {dayWord(p.quiet)}{p.target ? ` · due ${new Date(`${p.target.slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</small>
      </div>
      {p.next && <p className="rv-next">Next step: {p.next.title}</p>}
      {answer ? <p className="rv-answer">{answer.note}</p> : p.next ? (
        <div className="rv-choices">
          <label>On <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Which day">{days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}</select></label>
          <button type="button" data-do="keep" disabled={busy} title="Put the next step on that day" onClick={() => run(p, "keep", day)}>Do the next step</button>
          <button type="button" data-do="shrink" disabled={busy} title="Add a ten-minute first step on that day, so it's easy to start" onClick={() => run(p, "shrink", day)}>Start smaller</button>
          <span className="spacer" />
          <button type="button" data-do="rest" className="quiet" disabled={busy} title="Stop planning it for now. It stays in Todoist and, faint, in your sky." onClick={() => run(p, "rest")}>Set it down</button>
        </div>
      ) : (
        <div className="rv-choices"><span className="dialog-sub">It has no open steps in Todoist.</span><span className="spacer" /><button type="button" data-do="rest" className="quiet" disabled={busy} onClick={() => run(p, "rest")}>Set it down</button></div>
      )}
    </div>
  );
}
