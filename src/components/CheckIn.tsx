// 4.6 Better actuals: a small card at the top of Today when a planned block has ended. How did it go, and how long did it take?
// Done ticks it off in Todoist; partly and didn't-happen leave it open. The answers feed the record and the time estimates.
import { useState } from "react";
import { fmtDuration, fmtTime } from "../lib/dates";
import { plain } from "../lib/text";
import { actualsOf, endedBlocks, lengthChoices, type EndedBlock, type Outcome } from "../domain/actuals";
import { answerBlock } from "../data/actuals";
import { useData } from "../data/useData";
import { toast } from "../state/ui";
import { useNow } from "./useNow";

export function CheckInCard() {
  const { today, config, cfg } = useData();
  const now = useNow();
  // After Done or Partly the card stays for one more question: how long it took (Done has already ticked it off).
  const [asking, setAsking] = useState<{ b: EndedBlock; o: Outcome } | null>(null);
  const [busy, setBusy] = useState(false);
  const ended = endedBlocks(today, now, actualsOf(config), config?.focus?.taskId);
  const b = asking?.b || ended[0];
  if (!b) return null;
  const more = ended.filter((x) => x.id !== b.id).length;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(`Couldn't save that: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const pick = (o: Outcome) => run(async () => {
    // Saved straight away with the planned length, so walking off without answering the second question still counts.
    await answerBlock(b, o, o === "skipped" ? undefined : o === "done" ? b.min : undefined, cfg);
    setAsking(o === "skipped" ? null : { b, o });
  });
  const length = (min: number | undefined) => run(async () => {
    if (min != null && asking) await answerBlock(b, asking.o, min, cfg, false);
    setAsking(null);
  });

  return (
    <div className="check-in" id="check-in" role="status" data-block={b.id}>
      <div className="ci-head">
        <span className="ci-when">{fmtTime(new Date(b.start))}–{fmtTime(new Date(b.end))}</span>
        <strong className="ci-title">{plain(b.title)}</strong>
      </div>
      {!asking ? (
        <>
          <div className="ci-q">This block has ended. How did it go?</div>
          <div className="ci-row">
            <button type="button" className="primary" id="ci-done" disabled={busy} onClick={() => pick("done")}>Done</button>
            <button type="button" className="ghost-btn" id="ci-partly" disabled={busy} onClick={() => pick("partly")}>Partly</button>
            <button type="button" className="ghost-btn" id="ci-skipped" disabled={busy} onClick={() => pick("skipped")}>Didn't happen</button>
          </div>
          {more > 0 && <div className="ci-more">{more} more block{more === 1 ? "" : "s"} to check in after this</div>}
        </>
      ) : (
        <>
          <div className="ci-q">{asking.o === "done" ? "How long did it really take?" : "How long did you put in?"} <span className="ci-planned">Planned {fmtDuration(b.min)}</span></div>
          <div className="ci-row">
            {lengthChoices(b.min, asking.o).map((m) => (
              <button type="button" key={m} className={`chip-btn${m === b.min ? " on" : ""}`} data-min={m} disabled={busy} onClick={() => length(m)}>{fmtDuration(m)}</button>
            ))}
            <button type="button" className="ghost-btn ci-skip" id="ci-skip-length" disabled={busy} onClick={() => length(undefined)}>Skip</button>
          </div>
        </>
      )}
    </div>
  );
}
