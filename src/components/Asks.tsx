// 5.0 One thing asking at a time: the spot at the top of Today where check-ins, the leftovers note and what's new take
// turns (see domain/asks.ts). Nothing shows while a ritual is open.
import { pickAsk, type AskKind } from "../domain/asks";
import { RITUALS, useUi } from "../state/ui";
import { updateConfig } from "../data/actions";
import { useData } from "../data/useData";
import { NEWS, newer, newsSince } from "../data/news";
import { VERSION } from "../lib/version";
import { CheckInCard, useAsking, useEndedBlocks } from "./CheckIn";
import { HealNoteCard, healNoteDue } from "./HealNote";

export function AskSlot() {
  const { config } = useData();
  const ended = useEndedBlocks();
  const asking = useAsking((s) => Object.keys(s.asking).length);
  const ritualOpen = useUi((s) => RITUALS.some((r) => s.dialogs[r]));
  const due: Partial<Record<AskKind, boolean>> = {
    "check-in": ended.length > 0 || asking > 0,
    "heal-note": healNoteDue(config),
    "whats-new": newsSince(config?.lastSeenVersion, VERSION).length > 0,
  };
  const { now, waiting } = pickAsk(due, ritualOpen);
  if (now === "check-in") return <CheckInCard more={waiting} />;
  if (now === "heal-note") return <HealNoteCard />;
  if (now === "whats-new") return <WhatsNewCard />;
  return null;
}

/** After an update: a few lines on what changed, once. */
export function WhatsNewCard({ always = false, onClose }: { always?: boolean; onClose?: () => void } = {}) {
  const { config } = useData();
  const since = newsSince(config?.lastSeenVersion, VERSION);
  // From the menu: this version's lines even when you've seen them.
  const news = since.length || !always ? since : NEWS.filter((n) => !newer(n.v, VERSION)).slice(0, 1);
  if (!news.length) return null;
  const dismiss = () => { onClose?.(); updateConfig((c) => ({ ...c, lastSeenVersion: VERSION })).catch(() => undefined); };
  return (
    <div className="whats-new" id="whats-new" role="status">
      <div className="wn-head"><span className="wn-kicker">✦ Updated to {VERSION}</span><span className="spacer" /><button type="button" className="ghost-btn" id="wn-ok" onClick={dismiss}>Got it</button></div>
      {news.map((n) => (
        <div className="wn-version" key={n.v} data-v={n.v}>
          <strong className="wn-title">{n.title}</strong>{news.length > 1 && <span className="wn-v"> · {n.v}</span>}
          <ul className="wn-lines">{n.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}
