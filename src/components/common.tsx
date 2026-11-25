import { useEffect, useRef, type ReactNode } from "react";
import { plain } from "../lib/text";
import { RITUALS, useUi, type DialogName } from "../state/ui";
import { RITUAL_TITLES, useDueRituals } from "../data/rituals";

type DialogProps = { name: DialogName; id: string; className?: string; children: ReactNode };
/** A dialog, opened and closed from the UI store; its content mounts fresh each time it opens. Rituals (4.3) open in the
 *  docked panel at the side, everything else as a native <dialog> over the page. */
export function Dialog(p: DialogProps) {
  return RITUALS.includes(p.name) ? <RitualPanel {...p} /> : <ModalDialog {...p} />;
}

function ModalDialog({ name, id, className = "", children }: DialogProps) {
  const open = useUi((s) => s.dialogs[name]);
  const close = useUi((s) => s.closeDialog);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog id={id} className={`dialog ${className}`} ref={ref} onClose={() => close(name)}>
      {open && <div className="dialog-body">{children}</div>}
    </dialog>
  );
}

export function Toast() {
  const toast = useUi((s) => s.toast);
  const hide = useUi((s) => s.hideToast);
  return (
    <div id="toast" className="toast" hidden={!toast}>
      {toast && <span>{toast.msg}</span>}
      {toast?.action && <button onClick={() => { hide(); toast.action!.run(); }}>{toast.action.label}</button>}
    </div>
  );
}

export function DragGhost() {
  const drag = useUi((s) => s.drag);
  if (!drag || drag.kind !== "new") return null;
  return (
    <div className={`drag-ghost ${drag.overTimeline ? "faint" : ""}`} style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 10}px)` }}>
      {plain(drag.task.content)}
    </div>
  );
}

/** 4.3 The ritual panel: docked at the right, below the top bar. You can still see (and drag) your day beside it.
 *  Esc or × closes it; other rituals that are waiting are one click away at the top. */
function RitualPanel({ name, id, className = "", children }: DialogProps) {
  const open = useUi((s) => s.dialogs[name]);
  const close = useUi((s) => s.closeDialog);
  const openDialog = useUi((s) => s.openDialog);
  const due = useDueRituals().filter((d) => d.name !== name);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) { e.stopPropagation(); close(name); } };
    document.addEventListener("keydown", onKey);
    // Move focus into the panel so the keyboard reaches it first.
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("button.primary, button, input")?.focus({ preventScroll: true }));
    return () => document.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return (
    <aside id={id} ref={ref} className={`dialog ritual-panel ${className}`} role="dialog" aria-modal="false" aria-label={RITUAL_TITLES[name]} data-ritual={name}>
      <div className="rp-head">
        <span className="rp-title">{RITUAL_TITLES[name]}</span>
        {due.length > 0 && <span className="rp-next">Also waiting: {due.map((d) => <button key={d.name} type="button" className="rp-chip" data-ritual={d.name} onClick={() => openDialog(d.name)}>{d.short}</button>)}</span>}
        <span className="spacer" />
        <button type="button" className="icon-btn rp-close" aria-label="Close" title="Close (Esc)" onClick={() => close(name)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="dialog-body rp-body">{children}</div>
    </aside>
  );
}
