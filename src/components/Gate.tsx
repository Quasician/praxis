// 4.7 The full-screen cards: the gate when a block starts, and the lock when you open something you locked.
// The desktop app opens them in their own windows over every screen; the buttons go back to it through the local server.
import { useEffect, useState } from "react";
import { clockText } from "../domain/nudges";
import { moveChoices, UNLOCK_PHRASE, UNLOCK_WAIT_S } from "../domain/focuslock";
import { api } from "../lib/api";
import { plain } from "../lib/text";
import { skyAt } from "./useAppearance";

const parse = <T,>(k: string): T => { try { return JSON.parse(new URLSearchParams(location.search).get(k) || "{}") as T; } catch { return {} as T; } };
const minText = (m: number) => { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return clockText(+d); };
const span = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`; };

function useDoc() {
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    document.documentElement.dataset.theme = q.get("theme") === "light" ? "light" : "dark";
    document.documentElement.dataset.sky = skyAt(new Date());
    document.documentElement.classList.add("gate-doc");
  }, []);
}

function useClock(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

interface GateJob { key: string; taskId: string; title: string; start: number; end: number; main?: boolean }

export function GateCard() {
  useDoc();
  const g = parse<GateJob>("gate");
  const now = useClock();
  const [step, setStep] = useState<"ask" | "move" | "skip">("ask");
  const [why, setWhy] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const send = (action: string, body: Record<string, unknown> = {}) => {
    setSent(true);
    api("/api/desktop/gate", { method: "POST", body: { action, ...body } }).catch((e) => { setSent(false); setErr(`Couldn't reach Praxis: ${(e as Error).message}`); });
  };
  const left = g.end - now;

  if (!g.main) {
    return (
      <main className="gate gate-side" id="gate" data-side="1">
        <div className="gate-side-text"><strong>{plain(g.title || "Your block")}</strong> is starting. Answer on your main screen.</div>
      </main>
    );
  }
  return (
    <main className="gate" id="gate">
      <div className="gate-card">
        <div className="gate-kicker">Your block is starting · {clockText(g.start)}–{clockText(g.end)}</div>
        <h1 className="gate-title" id="gate-title">{plain(g.title || "Your block")}</h1>
        {step === "ask" && (
          <>
            <p className="gate-sub">Start it now, give it a new time, or skip it. Nothing else until you choose.</p>
            <div className="gate-row">
              <button type="button" className="primary gate-big" id="gate-start" disabled={sent} onClick={() => send("start")}>Start · {span(left)} left</button>
              <button type="button" className="ghost-btn gate-big" id="gate-move" disabled={sent} onClick={() => setStep("move")}>Move it</button>
              <button type="button" className="ghost-btn gate-big" id="gate-skip" disabled={sent} onClick={() => setStep("skip")}>Skip it</button>
            </div>
            <p className="gate-note">Starting runs a focus timer to the end of the block, with your locked apps and sites out of reach.</p>
          </>
        )}
        {step === "move" && (
          <>
            <p className="gate-sub">When will you do it?</p>
            <div className="gate-row">
              {moveChoices(new Date(now)).map((m) => (
                <button type="button" key={m} className="ghost-btn gate-big" data-at={m} disabled={sent} onClick={() => send("move", { at: m })}>{minText(m)}</button>
              ))}
              <button type="button" className="link-btn" id="gate-back" onClick={() => setStep("ask")}>Back</button>
            </div>
          </>
        )}
        {step === "skip" && (
          <form className="gate-skip" onSubmit={(e) => { e.preventDefault(); if (why.trim().length >= 3) send("skip", { reason: why.trim() }); }}>
            <p className="gate-sub">Why are you skipping it? It goes in your record, so next week's plan can learn from it.</p>
            <input autoFocus id="gate-why" className="gate-input" value={why} maxLength={300} placeholder="e.g. a call ran over; too tired for deep work" onChange={(e) => setWhy(e.target.value)} />
            <div className="gate-row">
              <button type="submit" className="primary gate-big" id="gate-skip-go" disabled={sent || why.trim().length < 3}>Skip it</button>
              <button type="button" className="link-btn" onClick={() => setStep("ask")}>Back</button>
            </div>
          </form>
        )}
        {err && <p className="gate-err" role="alert">{err}</p>}
      </div>
    </main>
  );
}

interface LockJob { what: string; title: string; until: number }

export function LockCard() {
  useDoc();
  const l = parse<LockJob>("lock");
  const now = useClock();
  const [asked, setAsked] = useState<number | null>(null);   // when you asked to unlock early
  const [typed, setTyped] = useState("");
  const send = (action: string) => api("/api/desktop/lock", { method: "POST", body: { action } }).catch(() => undefined);
  const wait = asked ? Math.max(0, UNLOCK_WAIT_S - Math.floor((now - asked) / 1000)) : UNLOCK_WAIT_S;
  const ok = typed.trim().toLowerCase().replace(/[’']/g, "'") === UNLOCK_PHRASE.toLowerCase();
  return (
    <main className="gate lock" id="lock">
      <div className="gate-card">
        <div className="gate-kicker">{l.what || "That"} is locked until {clockText(l.until)} · {span(l.until - now)} left</div>
        <h1 className="gate-title">You're on: {plain(l.title || "your block")}</h1>
        {!asked ? (
          <>
            <p className="gate-sub">It's minimised for now. Everything you didn't lock still works.</p>
            <div className="gate-row">
              <button type="button" className="primary gate-big" id="lock-back" onClick={() => send("back")}>Back to work</button>
              <button type="button" className="link-btn" id="lock-ask" onClick={() => setAsked(Date.now())}>Unlock early…</button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (!wait && ok) send("unlock"); }}>
            <p className="gate-sub">{wait ? `Wait ${wait} s, then type “${UNLOCK_PHRASE}”. It goes in your record.` : `Type “${UNLOCK_PHRASE}” to unlock until the timer ends. It goes in your record.`}</p>
            <input id="lock-phrase" className="gate-input" value={typed} disabled={wait > 0} placeholder={UNLOCK_PHRASE} onChange={(e) => setTyped(e.target.value)} autoFocus />
            <div className="gate-row">
              <button type="submit" className="ghost-btn gate-big" id="lock-unlock" disabled={wait > 0 || !ok}>Unlock</button>
              <button type="button" className="primary gate-big" onClick={() => send("back")}>Back to work</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
