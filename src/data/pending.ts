// 3.6 Never rot: the offline queue.
// When Todoist is down (or you're offline), changes you make are kept here, marked as waiting, and sent once
// Todoist is back. If a task also changed in Todoist meanwhile (on your phone, say), Todoist's version wins
// and Praxis tells you. Kept in this computer's storage, so a restart doesn't lose them.
import { useSyncExternalStore } from "react";
import { api, setOfflineHandler, todoistDown } from "../lib/api";
import type { SyncCommand } from "../lib/types";
import type { Task } from "../lib/types";
import { plain } from "../lib/text";
import { queryClient, qk } from "./queries";
import { toast } from "../state/ui";

export interface Pending { id: string; at: string; kind: "sync" | "close" | "reopen" | "quick"; commands?: SyncCommand[]; taskId?: string; text?: string; base?: Record<string, string | null> }
const KEY = "praxis.pending";
let items: Pending[] = load();
const subs = new Set<() => void>();
function load(): Pending[] { try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full: keep in memory */ } subs.forEach((f) => f()); }

const cachedTask = (id: string) => [qk.today, qk.inbox, qk.active].flatMap((k) => queryClient.getQueryData<Task[]>(k) || []).find((t) => t.id === id);
const idsOf = (p: Pending) => [...(p.commands || []).map((c) => String((c.args as { id?: string })?.id || "")), p.taskId || ""].filter(Boolean);

/** Called from the API layer when a change couldn't reach Todoist. Returns true if it's been kept for later. */
function keep(kind: Pending["kind"], payload: { commands?: SyncCommand[]; taskId?: string; text?: string }) {
  if (kind === "sync" && payload.commands?.some((c) => c.temp_id)) return false;    // new items need Todoist's ids now
  const base: Record<string, string | null> = {};
  for (const id of [...(payload.commands || []).map((c) => String((c.args as { id?: string })?.id || "")), payload.taskId || ""].filter(Boolean)) base[id] = (cachedTask(id) as Task & { updated_at?: string })?.updated_at ?? null;
  items = [...items, { id: crypto.randomUUID(), at: new Date().toISOString(), kind, ...payload, base }];
  persist();
  schedule(20_000);
  return true;
}

let timer: ReturnType<typeof setTimeout> | undefined, flushing = false;
function schedule(ms: number) { clearTimeout(timer); if (items.length) timer = setTimeout(() => { flush().catch(() => undefined); }, ms); }

/** Sends what's waiting, oldest first. Stops (and tries again later) if Todoist is still down. */
export async function flush(): Promise<{ sent: number; skipped: string[] }> {
  if (flushing || !items.length) return { sent: 0, skipped: [] };
  flushing = true;
  let sent = 0; const skipped: string[] = [];
  try {
    while (items.length) {
      const p = items[0];
      // Did the task change in Todoist while we waited? Then Todoist's version wins.
      const keepCmds: SyncCommand[] = [];
      const changedElsewhere = new Set<string>(), gone = new Set<string>();
      for (const id of idsOf(p)) {
        try {
          const now = await api<Task & { updated_at?: string; checked?: boolean }>(`/api/todoist/tasks/${encodeURIComponent(id)}`);
          const was = p.base?.[id];
          if (was && now.updated_at && now.updated_at !== was) changedElsewhere.add(id);
          if (p.kind === "close" && now.checked) gone.add(id);
        } catch (e) {
          if (todoistDown(e)) throw e;
          if ((e as { status?: number }).status === 404) gone.add(id);
        }
      }
      const name = (id: string) => plain(cachedTask(id)?.content || "a task").slice(0, 50);
      for (const id of changedElsewhere) skipped.push(name(id));
      if (p.kind === "sync") {
        for (const c of p.commands || []) { const id = String((c.args as { id?: string })?.id || ""); if (!changedElsewhere.has(id) && !gone.has(id)) keepCmds.push(c); }
        if (keepCmds.length) await api("/api/todoist/sync", { method: "POST", body: { commands: keepCmds } });
        sent += keepCmds.length;
      } else if (p.kind === "close" || p.kind === "reopen") {
        if (p.taskId && !changedElsewhere.has(p.taskId) && !gone.has(p.taskId)) { await api(`/api/todoist/tasks/${encodeURIComponent(p.taskId)}/${p.kind}`, { method: "POST" }); sent++; }
      } else if (p.kind === "quick" && p.text) {
        await api("/api/todoist/tasks/quick", { method: "POST", body: { text: p.text } }); sent++;
      }
      items = items.slice(1);
      persist();
    }
  } catch (e) {
    if (!todoistDown(e)) { items = items.slice(1); persist(); }        // a change Todoist refuses for good: drop it rather than retry forever
    schedule(30_000);
  } finally { flushing = false; }
  if (sent || skipped.length) {
    for (const k of [qk.today, qk.inbox, qk.active, qk.completed]) queryClient.invalidateQueries({ queryKey: k });
    if (skipped.length) toast(`Todoist is back. Sent ${sent} change${sent === 1 ? "" : "s"}; kept Todoist's version of “${skipped.slice(0, 2).join("”, “")}”${skipped.length > 2 ? ` and ${skipped.length - 2} more` : ""} (changed there while it was down).`);
    else toast(`Todoist is back: sent ${sent} waiting change${sent === 1 ? "" : "s"}.`);
  }
  return { sent, skipped };
}

/** Turns the queue on (main window only: the pop-outs leave sending to it). */
export function startPending() {
  setOfflineHandler(keep);
  window.addEventListener("online", () => schedule(1000));
  window.addEventListener("storage", (e) => { if (e.key === KEY) { items = load(); subs.forEach((f) => f()); } });
  schedule(3000);
}

export function usePending() {
  const list = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => items);
  return { count: list.length, ids: new Set(list.flatMap(idsOf)) };
}
export const queueQuickAdd = (text: string) => keep("quick", { text });
export const pendingCount = () => items.length;
