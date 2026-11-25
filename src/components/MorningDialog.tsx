import { useEffect, useState } from "react";
import { fmtMin, fmtSpan } from "../lib/dates";
import { willpower } from "../lib/tasks";
import { plain } from "../lib/text";
import { acceptPlan, computePlan } from "../data/planActions";
import { energyToday, fetchTiny, needsTiny, setEnergy, setTiny, starOnPhone } from "../data/habits";
import { bulkPlace } from "../data/actions";
import { spreadTasks } from "../domain/week";
import { addDays, parseDue, startOfToday, ymd } from "../lib/dates";
import { useActive, useStatus } from "../data/queries";
import type { Energy } from "../lib/types";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";
import { RitualSky } from "./Rituals";

export function MorningDialog() {
  return <Dialog name="morning" id="morning-dialog" className="morning-dialog"><MorningBody /></Dialog>;
}

/** One minute: confirm today's commitments, pick the one that matters, done. */
const ENERGY: { id: Energy; label: string; hint: string }[] = [
  { id: "full", label: "Full", hint: "A normal day" },
  { id: "low", label: "Low", hint: "Light work, tiny versions of the hard stuff" },
  { id: "slammed", label: "Slammed", hint: "One small thing. That's it." },
];

function MorningBody() {
  const { cfg, today, connected } = useData();
  const status = useStatus();
  const activeQ = useActive(connected);
  const { plan, setPlan, closeDialog } = useUi();
  const [loading, setLoading] = useState(!plan.active);
  const [one, setOne] = useState<string | null>(null);
  const [energy, setEnergyState] = useState<Energy>(energyToday());
  const [spreadRest, setSpreadRest] = useState(true);
  const [tinyBusy, setTinyBusy] = useState(false);

  useEffect(() => {
    if (plan.active) return;
    computePlan().then((p) => { setPlan({ ...p, active: true }); setLoading(false); }).catch(() => setLoading(false));
  }, []); // eslint-disable-line

  const replan = async () => { const p = await computePlan(); setPlan({ ...p, active: true }); };
  const pickEnergy = async (e: Energy) => {
    setEnergyState(e); setLoading(true);
    try { await setEnergy(e); await replan(); } finally { setLoading(false); }
  };
  const lowDay = energy !== "full";
  const needTiny = today.filter((t) => { const d = parseDue(t.due); return d && ymd(d.d) <= ymd(new Date()) && needsTiny(t); });
  const makeTiny = async () => {
    setTinyBusy(true);
    try { await fetchTiny(needTiny); await replan(); } catch (e) { toast((e as Error).message); } finally { setTinyBusy(false); }
  };

  const items = plan.items;
  const committed = items.filter((it) => it.committed);
  const bonus = items.filter((it) => !it.committed);
  const theOne = one && committed.some((it) => it.task.id === one) ? one : committed[0]?.task.id || null;
  const toggle = (id: string) => setPlan({ items: items.map((it) => (it.task.id === id ? { ...it, committed: !it.committed } : it)) });
  const hour = new Date().getHours();
  // 4.0: your commitments against what you usually finish on a day like today.
  const cap = plan.capacityMin ?? null, committedMin = committed.reduce((s, it) => s + it.dur, 0);
  const over = cap !== null && committed.length > 1 && committedMin > cap;
  const lateCommitted = committed.filter((it) => it.late).length;
  /** Turns the last commitments into bonus until what's left fits (the one that matters is kept). */
  const trim = () => {
    let total = committedMin; const drop = new Set<string>();
    for (const it of [...committed].reverse()) {
      if (total <= cap! || committed.length - drop.size <= 1) break;
      if (it.task.id === theOne) continue;
      drop.add(it.task.id); total -= it.dur;
    }
    setPlan({ items: items.map((it) => (drop.has(it.task.id) ? { ...it, committed: false } : it)) });
  };

  // Slammed: everything due today that isn't the one thing moves out of the way, spread over the week.
  const rest = energy === "slammed" ? today.filter((t) => { const d = parseDue(t.due); return d && ymd(d.d) <= ymd(new Date()) && !t.due?.is_recurring && !items.some((it) => it.task.id === t.id); }) : [];
  const commit = async () => {
    setPlan({ items: items.map((it) => ({ ...it, star: it.task.id === theOne })) });
    closeDialog("morning");
    await acceptPlan({ committed: true });
    const star = items.find((it) => it.task.id === theOne);
    await starOnPhone(star?.task).catch(() => undefined);
    if (rest.length && spreadRest) {
      const days = Array.from({ length: 6 }, (_, i) => addDays(startOfToday(), i + 1));
      await bulkPlace(spreadTasks(cfg, rest, days, activeQ.data || [], []), "over the rest of the week");
    }
    useUi.getState().celebrate("", "sunrise");
    if (star) toast(`Committed. The one that matters: “${plain(star.task.content).slice(0, 60)}”. It's p1 in Todoist today, so your phone shows it first.`);
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
          <div className="mc-meta">{fmtMin(it.start)} · {fmtSpan(it.dur)}{wp === 3 ? " · Deep" : wp === 1 ? " · Light" : ""}{it.source === "milestone" && it.milestone ? ` · ◆ ${plain(it.milestone.content).slice(0, 30)}` : ""}{it.late ? <span className="mc-late" title={`Blocks that start after ${fmtMin(plan.weakFrom ?? 0)} rarely get done, going by your record`}> · late slot</span> : null}</div>
          {it.tiny && <label className="mc-tiny"><span>Tiny version</span><input key={it.tiny} defaultValue={it.tiny} aria-label="Tiny version" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.tiny) { setTiny(it.task.id, v); setPlan({ items: useUi.getState().plan.items.map((x) => (x.task.id === it.task.id ? { ...x, tiny: v } : x)) }); } }} /></label>}
        </div>
        {it.committed && <label className="mc-one" title="The one task that would make today a good day">
          <input type="radio" name="the-one" checked={theOne === it.task.id} onChange={() => setOne(it.task.id)} /> the one
        </label>}
      </li>
    );
  };

  return (
    <div className="morning-form">
      <RitualSky kind="sunrise" progress={Math.min(1, committed.length / Math.max(1, cfg.commitCount)) * 0.8 + (theOne ? 0.2 : 0)} />
      <div>
        <h2>{hour < 12 ? "Good morning." : "Commit to today."}</h2>
        <p className="dialog-sub">Here's today's plan. ★ are your commitments, a day you can actually win. Bonus tasks only if you have energy left. Pick the one that matters most.</p>
      </div>
      <div className="mc-energy" role="radiogroup" aria-label="Energy today" id="mc-energy">
        <span className="mc-energy-q">How's today?</span>
        {ENERGY.map((e) => (
          <button type="button" key={e.id} role="radio" aria-checked={energy === e.id} data-energy={e.id} className={energy === e.id ? "on" : ""} title={e.hint} onClick={() => pickEnergy(e.id)}>{e.label}</button>
        ))}
        <span className="mc-energy-hint">{ENERGY.find((e) => e.id === energy)!.hint}</span>
      </div>
      {lowDay && status.data?.claude && needTiny.length > 0 && (
        <button type="button" id="mc-make-tiny" className="ghost-btn mc-tiny-btn" disabled={tinyBusy} onClick={makeTiny}>{tinyBusy ? "Thinking…" : "✦ Have Claude write tiny versions"}</button>
      )}
      {committed.length > cfg.commitCount && <p className="mc-warn">That's {committed.length} commitments. Fewer is easier to finish; {cfg.commitCount} is your setting.</p>}
      {cap !== null && (
        <div className={`mc-capacity${over ? " over" : ""}`} id="mc-capacity">
          <span className="mc-cap-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (committedMin / Math.max(cap, committedMin)) * 100)}%` }} /><b style={{ left: `${Math.min(100, (cap / Math.max(cap, committedMin)) * 100)}%` }} /></span>
          <span className="mc-cap-text">{over
            ? <>Your commitments add up to <b>{fmtSpan(committedMin)}</b>. On a day like this you usually finish about <b>{fmtSpan(cap)}</b>.</>
            : <>Commitments: <b>{fmtSpan(committedMin)}</b> of the roughly <b>{fmtSpan(cap)}</b> you usually finish on a day like this.</>}</span>
          {over && <button type="button" id="mc-trim" className="ghost-btn" onClick={trim}>Trim to fit</button>}
        </div>
      )}
      {lateCommitted > 0 && plan.weakFrom != null && <p className="mc-warn" id="mc-late-warn">{lateCommitted === 1 ? "One commitment starts" : `${lateCommitted} commitments start`} after {fmtMin(plan.weakFrom)}, when your blocks rarely get done. Move {lateCommitted === 1 ? "it" : "them"} earlier on the timeline, or make {lateCommitted === 1 ? "it" : "them"} a bonus.</p>}
      {plan.weakAll && plan.weakFrom != null && <p className="mc-later" id="mc-weak-all">All of today's free time is after {fmtMin(plan.weakFrom)}, when your blocks rarely get done. Keep today small.</p>}
      <section><h3>Committed <span className="n">{committed.length}</span></h3><ul className="mc-list" id="mc-committed">{committed.map(row)}</ul></section>
      {bonus.length > 0 && <section><h3>Bonus <span className="n">{bonus.length}</span></h3><ul className="mc-list bonus" id="mc-bonus">{bonus.map(row)}</ul></section>}
      {rest.length > 0 && <label className="mc-spread"><input type="checkbox" id="mc-spread" checked={spreadRest} onChange={(e) => setSpreadRest(e.target.checked)} /> Move the other {rest.length} task{rest.length === 1 ? "" : "s"} due today to the rest of the week</label>}
      {plan.unplaced.length > 0 && energy !== "slammed" && <p className="mc-later">Not today: {plan.unplaced.slice(0, 5).map((c) => plain(c.task.content)).join(" · ")}{plan.unplaced.length > 5 ? ` · +${plan.unplaced.length - 5} more` : ""}</p>}
      {plan.fillWhy && <p className="mc-later">Plan size: {plan.fillWhy}.</p>}
      <div className="dialog-actions">
        <button type="button" id="mc-adjust" className="ghost-btn" title="Close this and drag blocks around on the timeline" onClick={() => closeDialog("morning")}>Adjust on the timeline</button>
        <span className="spacer" />
        <button type="button" id="mc-commit" className="primary" disabled={!committed.length} onClick={commit}>Commit to {committed.length}</button>
      </div>
    </div>
  );
}
