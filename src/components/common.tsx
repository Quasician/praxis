import { useEffect, useRef, type ReactNode } from "react";
import { plain } from "../lib/text";
import { useUi, type DialogName } from "../state/ui";

/** A native <dialog>, opened/closed from the UI store. Content mounts fresh each time it opens. */
export function Dialog({ name, id, className = "", children }: { name: DialogName; id: string; className?: string; children: ReactNode }) {
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
      {open && children}
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
