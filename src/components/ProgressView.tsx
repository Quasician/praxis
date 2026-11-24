import { dayStats, effectiveFill, habitStreak, timeSense, learn, rate, rateByArea, rateByWillpower, streak, type DayStat } from "../domain/progress";
import { fmtMin, fromYmd } from "../lib/dates";
import { colorOf } from "../lib/text";
import { useActive, useCompleted } from "../data/queries";
import { useData } from "../data/useData";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const sum = (xs: DayStat[], k: keyof DayStat) => xs.reduce((s, d) => s + (d[k] as number), 0);

export function ProgressView() {
  const { config, cfg, connected } = useData();
  const completedQ = useCompleted(connected);
  useActive(connected); // so repeating-task completions get their labels
  const completed = completedQ.data || [];
  const days = dayStats(config, completed, 28);
  const today = days[days.length - 1];
  const thisWeek = days.slice(-7), lastWeek = days.slice(-14, -7);
  const weeks = [0, 1, 2, 3].map((i) => days.slice(i * 7, i * 7 + 7));
  const byWp = rateByWillpower(config, completed);
  const areas = config?.areas || [];
  const byArea = rateByArea(config, completed, areas);
  const learned = learn(cfg, config?.samples, completed);
  const fill = effectiveFill(cfg, config, completed);
  const hasHistory = days.some((d) => d.planned > 0);
  const max = Math.max(1, ...days.map((d) => Math.max(d.planned, d.plannedDone + d.extra)));
  const wr = rate(sum(thisWeek, "plannedDone"), sum(thisWeek, "planned")), lr = rate(sum(lastWeek, "plannedDone"), sum(lastWeek, "planned"));

  return (
    <main id="progress-view" className="progress-view">
      <div className="areas-head pv-numbers-head">
        <div>
          <h2>The numbers</h2>
          <p className="areas-sub">What you planned vs. what got done, over the last four weeks. Tick things off as you finish them (on your phone too) so this stays true.</p>
        </div>
      </div>

      <div className="pv-tiles">
        <Tile id="pv-today" label="Committed today" value={today.committed ? `${today.committedDone} / ${today.committed}` : "—"} sub={today.committed ? (today.committedDone === today.committed ? "All done. Anything else is a bonus." : "★ tasks in your list") : "Commit in the morning (M)"} />
        <Tile id="pv-week" label="Plan done this week" value={pct(wr)} sub={lr === null ? `${sum(thisWeek, "plannedDone")} of ${sum(thisWeek, "planned")} planned tasks` : `last week ${pct(lr)}`} trend={wr !== null && lr !== null ? Math.sign(wr - lr) : 0} />
        <Tile id="pv-extra" label="Done outside the plan" value={String(sum(thisWeek, "extra"))} sub="this week" />
        <Tile id="pv-streak" label="Streak (never miss twice)" value={`${habitStreak(config, completed).days}`} sub={`days · closed ${streak(config, "shutdown")} in a row · mornings ${streak(config, "committedAt")}`} />
        <TimeSenseTile sense={timeSense(config?.samples)} />
      </div>

      {!hasHistory && <div className="pv-empty" id="pv-empty">Nothing to show yet. Accept a plan or do the morning commit, and each day's plan vs. done fills in here.</div>}

      <section className="pv-card" id="pv-days">
        <header><h3>Last 28 days</h3>
          <div className="pv-legend"><span><i className="sw done" />Planned, done</span><span><i className="sw extra" />Done, not planned</span><span><i className="sw track" />Planned, not done</span></div>
        </header>
        <div className="pv-chart" role="img" aria-label="Planned and completed tasks per day for the last 28 days">
          {days.map((d) => {
            const date = fromYmd(d.day);
            const tip = `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${d.plannedDone} of ${d.planned} planned done${d.extra ? `, +${d.extra} not planned` : ""}${d.committed ? ` · ★ ${d.committedDone}/${d.committed}` : ""}`;
            return (
              <div key={d.day} className={`pv-col ${date.getDay() === 1 ? "monday" : ""}`} title={tip} data-day={d.day}>
                <div className="pv-stack">
                  <div className="pv-track" style={{ height: `${(d.planned / max) * 100}%` }} />
                  <div className="pv-fill" style={{ height: `${((d.plannedDone + d.extra) / max) * 100}%` }}>
                    {d.extra > 0 && <div className="pv-extra" style={{ flexGrow: d.extra }} />}
                    {d.plannedDone > 0 && <div className="pv-done" style={{ flexGrow: d.plannedDone }} />}
                  </div>
                </div>
                <span className="pv-x">{date.getDay() === 1 || d === today ? date.toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="pv-grid">
        <section className="pv-card" id="pv-weeks">
          <h3>Plan done, week by week</h3>
          {weeks.map((w, i) => {
            const r = rate(sum(w, "plannedDone"), sum(w, "planned"));
            return <Bar key={i} label={i === 3 ? "This week" : `${3 - i} week${3 - i === 1 ? "" : "s"} ago`} r={r} detail={`${sum(w, "plannedDone")}/${sum(w, "planned")}`} />;
          })}
        </section>
        <section className="pv-card" id="pv-effort">
          <h3>By effort</h3>
          {([[3, "Deep"], [2, "Medium"], [1, "Light"]] as const).map(([wp, name]) => <Bar key={wp} label={name} r={rate(byWp[wp][0], byWp[wp][1])} detail={`${byWp[wp][0]}/${byWp[wp][1]}`} />)}
          {byWp[3][1] >= 4 && byWp[1][1] >= 4 && (rate(byWp[3][0], byWp[3][1]) ?? 0) < (rate(byWp[1][0], byWp[1][1]) ?? 0) - 0.25 &&
            <p className="pv-note">Deep tasks get done much less often. Try "First steps" in Needs a decision to make them easier to start.</p>}
        </section>
        <section className="pv-card" id="pv-areas">
          <h3>By area</h3>
          {areas.map((a) => { const [d, n] = byArea.get(a.id) || [0, 0]; return <Bar key={a.id} label={a.name} r={rate(d, n)} detail={`${d}/${n}`} color={colorOf(a.color)} />; })}
        </section>
        <section className="pv-card" id="pv-learned">
          <h3>What Praxis has learned</h3>
          <ul className="pv-learn">
            <li id="pv-fill"><b>Plans fill {fill.fill}% of your free time.</b> {fill.why ? `Because ${fill.why}.` : cfg.adaptive ? "This adjusts weekly to how much you finish." : "Fixed (adaptive planning is off)."}</li>
            <li id="pv-hours">{learned.deepHour !== null
              ? <><b>Your Deep work gets done around {fmtMin(learned.deepHour)}–{fmtMin(learned.deepHour + 120)}.</b> The planner puts Deep tasks there when it can.</>
              : <>Best hours for Deep work: needs {Math.max(0, 5 - learned.deepEvents)} more finished Deep task{5 - learned.deepEvents === 1 ? "" : "s"} to tell.</>}</li>
            <li id="pv-durations">{learned.samples >= 5
              ? <><b>Real durations:</b> {([[3, "Deep"], [2, "Medium"], [1, "Light"]] as const).map(([wp, n]) => `${n} ${learned.factor[wp] === 1 ? "as estimated" : `${learned.factor[wp]}×`}`).join(" · ")} ({learned.samples} timed sessions).</>
              : <>Real durations: time tasks with the <b>Now</b> card's Start button ({learned.samples}/5 sessions so far) and plans will use how long things really take.</>}</li>
          </ul>
        </section>
      </div>
    </main>
  );
}

function Tile({ id, label, value, sub, trend = 0 }: { id: string; label: string; value: string; sub: string; trend?: number }) {
  return (
    <div className="pv-tile" id={id}>
      <div className="pv-label">{label}</div>
      <div className="pv-value">{value}{trend !== 0 && <span className={`pv-trend ${trend > 0 ? "up" : "down"}`} title={trend > 0 ? "Up from last week" : "Down from last week"}>{trend > 0 ? "▲" : "▼"}</span>}</div>
      <div className="pv-sub">{sub}</div>
    </div>
  );
}

function Bar({ label, r, detail, color }: { label: string; r: number | null; detail: string; color?: string }) {
  return (
    <div className="pv-bar" title={`${label}: ${pct(r)} (${detail})`}>
      <span className="pv-bar-label">{color && <i style={{ background: color }} />}{label}</span>
      <span className="pv-bar-track"><span className="pv-bar-fill" style={{ width: `${(r ?? 0) * 100}%` }} /></span>
      <span className="pv-bar-value">{pct(r)}<small>{detail}</small></span>
    </div>
  );
}

function TimeSenseTile({ sense }: { sense: ReturnType<typeof timeSense> }) {
  if (!sense) return <Tile id="pv-timesense" label="Time sense" value="—" sub="Guess how long when you start a focus session" />;
  const lean = Math.abs(sense.lean) < 0.1 ? "no lean either way" : sense.lean > 0 ? `things take ${Math.round(sense.lean * 100)}% longer than you guess` : `you finish ${Math.round(-sense.lean * 100)}% sooner than you guess`;
  return <Tile id="pv-timesense" label="Time sense" value={`±${Math.round(sense.miss * 100)}%`} sub={`${lean} · ${sense.n} ${sense.n === 1 ? "guess" : "guesses"}${sense.improving ? " · getting sharper" : ""}`} trend={sense.improving ? 1 : 0} />;
}
