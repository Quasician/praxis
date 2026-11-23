import { useEffect, useState } from "react";
import { fmtMin, fmtSpan } from "../lib/dates";
import { willpower } from "../lib/tasks";
import { plain } from "../lib/text";
import { acceptPlan, computePlan } from "../data/planActions";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";

export function MorningDialog() {
  return <Dialog name="morning" id="morning-dialog" className="morning-dialog"><MorningBody /></Dialog>;
}

/** One minute: confirm today's commitments, pick the one that matters, done. */
function MorningBody() {
  const { cfg } = useData();
  const { plan, setPlan, closeDialog } = useUi();
  const [loading, setLoading] = useState(!plan.active);
  const [one, setOne] = useState<string | null>(null);

  useEffect(() => {
    if (plan.active) return;
    computePlan().then((p) => { setPlan({ ...p, active: true }); setLoading(false); }).catch(() => setLoading(false));
  }, []); // eslint-disable-line

  const items = plan.items;
  const committed = items.filter((it) => it.committed);
  const bonus = items.filter((it) => !it.committed);
  const theOne = one && committed.some((it) => it.task.id === one) ? one : committed[0]?.task.id || null;
  const toggle = (id: string) => setPlan({ items: items.map((it) => (it.task.id === id ? { ...it, committed: !it.committed } : it)) });
  const hour = new Date().getHours();

  const commit = async () => {
    setPlan({ items: items.map((it) => ({ ...it, star: it.task.id === theOne })) });
    closeDialog("morning");
    await acceptPlan({ committed: true });
    const star = items.find((it) => it.task.id === theOne);
    if (star) toast(`Committed. The one that matters: “${plain(star.task.content).slice(0, 60)}”. Start it from the Now card.`);
  };

  if (loading) return <div className="morning-form"><h2>Commit to today</h2><p className="dialog-sub">Drafting your plan…</p></div>;
  if (!items.length) {
    return (
      <div className="morning-form">
        <h2>Commit to today</h2>
        <p className="dialog-sub">{plan.unplaced.length ? "There's no free time left in today's planning window." : "Nothing is due today. Pull something from your Inbox, or enjoy the space."}</p>
        <div className="dialog-actions"><button type="button" className="primary" onClick={() => closeDialog("morning")}>OK</button></div>
      </div>
    );
  }

  const row = (it: (typeof items)[number]) => {
    const wp = willpower(it.task, cfg);
    return (
      <li key={it.task.id} className={`mc-row ${it.committed ? "on" : ""}`} data-id={it.task.id}>
        <button type="button" className="mc-toggle" title={it.committed ? "Make it a bonus" : "Commit to it"} onClick={() => toggle(it.task.id)}>{it.committed ? "★" : "☆"}</button>
        <div className="mc-main">
          <div className="mc-title">{plain(it.task.content)}</div>
          <div className="mc-meta">{fmtMin(it.start)} · {fmtSpan(it.dur)}{wp === 3 ? " · Deep" : wp === 1 ? " · Light" : ""}{it.source === "milestone" && it.milestone ? ` · ◆ ${plain(it.milestone.content).slice(0, 30)}` : ""}</div>
        </div>
        {it.committed && <label className="mc-one" title="The one task that would make today a good day">
          <input type="radio" name="the-one" checked={theOne === it.task.id} onChange={() => setOne(it.task.id)} /> the one
        </label>}
      </li>
    );
  };

  return (
    <div className="morning-form">
      <div>
        <h2>{hour < 12 ? "Good morning." : "Commit to today."}</h2>
        <p className="dialog-sub">Here's today's plan. ★ are your commitments, a day you can actually win. Bonus tasks only if you have energy left. Pick the one that matters most.</p>
      </div>
      {committed.length > cfg.commitCount && <p className="mc-warn">That's {committed.length} commitments. Fewer is easier to finish; {cfg.commitCount} is your setting.</p>}
      <section><h3>Committed <span className="n">{committed.length}</span></h3><ul className="mc-list" id="mc-committed">{committed.map(row)}</ul></section>
      {bonus.length > 0 && <section><h3>Bonus <span className="n">{bonus.length}</span></h3><ul className="mc-list bonus" id="mc-bonus">{bonus.map(row)}</ul></section>}
      {plan.unplaced.length > 0 && <p className="mc-later">Not today: {plan.unplaced.slice(0, 5).map((c) => plain(c.task.content)).join(" · ")}{plan.unplaced.length > 5 ? ` · +${plan.unplaced.length - 5} more` : ""}</p>}
      {plan.fillWhy && <p className="mc-later">Plan size: {plan.fillWhy}.</p>}
      <div className="dialog-actions">
        <button type="button" id="mc-adjust" className="ghost-btn" title="Close this and drag blocks around on the timeline" onClick={() => closeDialog("morning")}>Adjust on the timeline</button>
        <span className="spacer" />
        <button type="button" id="mc-commit" className="primary" disabled={!committed.length} onClick={commit}>Commit to {committed.length}</button>
      </div>
    </div>
  );
}
