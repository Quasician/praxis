// 4.6 Better actuals, 5.0 in one card: when planned blocks have ended, one card asks how each went (done, partly, didn't
// happen) and how long it took. Done ticks it off in Todoist; partly and didn't-happen leave it open. Several blocks that
// ended while you were away are asked about together, not one card after another.
import { useState } from "react";
import { create } from "zustand";
import { fmtDuration, fmtTime } from "../lib/dates";
import { plain } from "../lib/text";
import { actualsOf, endedBlocks, lengthChoices, type EndedBlock, type Outcome } from "../domain/actuals";
import { answerBlock } from "../data/actuals";
import { useData } from "../data/useData";
import { toast } from "../state/ui";
import { useNow } from "./useNow";

const SHOW = 4;

// Rows waiting for "how long did it take?" live outside the card, so the card keeps its turn in the queue while it asks
// (a block answered Done has already left today's list).
type Asking = Record<string, { b: EndedBlock; o: Outcome }>;
export const useAsking = create<{ asking: Asking }>(() => ({ asking: {} }));
const setAsking = (fn: (a: Asking) => Asking) => useAsking.setState((s) => ({ asking: fn(s.asking) }));

/** The blocks waiting for a check-in (for the attention queue). */
export function useEndedBlocks(): EndedBlock[] {
  const { today, config } = useData();
  const now = useNow();
  return endedBlocks(today, now, actualsOf(config), config?.focus?.taskId);
}

export function CheckInCard({ more = 0 }: { more?: number }) {
  const { cfg } = useData();
  const ended = useEndedBlocks();
  // After Done or Partly a row stays for one more question: how long it took (Done has already ticked it off).
  const asking = useAsking((s) => s.asking);
  const [busy, setBusy] = useState<string | null>(null);
  const rows: EndedBlock[] = [...Object.values(asking).map((a) => a.b), ...ended.filter((b) => !asking[b.id])].sort((a, b) => a.end - b.end);
  if (!rows.length) return null;
  const shown = rows.slice(0, SHOW), hidden = rows.length - shown.length;

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try { await fn(); } catch (e) { toast(`Couldn't save that: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  const pick = (b: EndedBlock, o: Outcome) => run(b.id, async () => {
    // Saved straight away with the planned length, so walking off without answering the second question still counts.
    await answerBlock(b, o, o === "done" ? b.min : undefined, cfg);
    if (o !== "skipped") setAsking((x) => ({ ...x, [b.id]: { b, o } }));
  });
  const length = (b: EndedBlock, min: number | undefined) => run(b.id, async () => {
    const a = asking[b.id];
    if (min != null && a) await answerBlock(b, a.o, min, cfg, false);
    setAsking((x) => { const y = { ...x }; delete y[b.id]; return y; });
  });

  return (
    <div className="check-in" id="check-in" role="status">
      <div className="ci-q ci-top">{rows.length === 1 ? "A block ended. How did it go?" : `${rows.length} blocks ended. How did they go?`}</div>
      {shown.map((b) => {
        const a = asking[b.id];
        return (
          <div className="ci-item" key={b.id} data-block={b.id}>
            <div className="ci-head">
              <span className="ci-when">{fmtTime(new Date(b.start))}–{fmtTime(new Date(b.end))}</span>
              <strong className="ci-title">{plain(b.title)}</strong>
            </div>
            {!a ? (
              <div className="ci-row">
                <button type="button" className="primary ci-done" disabled={busy === b.id} onClick={() => pick(b, "done")}>Done</button>
                <button type="button" className="ghost-btn ci-partly" disabled={busy === b.id} onClick={() => pick(b, "partly")}>Partly</button>
                <button type="button" className="ghost-btn ci-skipped" disabled={busy === b.id} onClick={() => pick(b, "skipped")}>Didn't happen</button>
              </div>
            ) : (
              <div className="ci-row">
                <span className="ci-sub">{a.o === "done" ? "Really took" : "Put in"}</span>
                {lengthChoices(b.min, a.o).map((m) => (
                  <button type="button" key={m} className={`chip-btn${m === b.min ? " on" : ""}`} data-min={m} disabled={busy === b.id} onClick={() => length(b, m)}>{fmtDuration(m)}</button>
                ))}
                <button type="button" className="ghost-btn ci-skip" disabled={busy === b.id} onClick={() => length(b, undefined)}>Skip</button>
              </div>
            )}
          </div>
        );
      })}
      {(hidden > 0 || more > 0) && <div className="ci-more">{[hidden > 0 && `${hidden} more block${hidden === 1 ? "" : "s"}`, more > 0 && `${more} more thing${more === 1 ? "" : "s"} after this`].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}
