import type { SyncCommand } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Calls the local Praxis server. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(path, {
    method: opts.method || "GET",
    headers: { "X-Planner": "1", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    if (data && typeof data === "object" && "error" in data) msg = String((data as { error: unknown }).error);
    else if (typeof data === "string" && data) msg = data;
    throw new ApiError(msg, r.status);
  }
  return data as T;
}

/** Todoist v1 list endpoints are paginated with next_cursor. */
export async function fetchAll<T>(path: string, limit = 200): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const data: unknown = await api(`/api/todoist${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (Array.isArray(data)) { out.push(...data); break; }
    const page = data as { results?: T[]; items?: T[]; next_cursor?: string | null };
    out.push(...(page.results || page.items || []));
    cursor = page.next_cursor || null;
  } while (cursor);
  return out;
}

export const uuid = () => crypto.randomUUID();
export const itemUpdate = (args: Record<string, unknown>): SyncCommand => ({ type: "item_update", uuid: uuid(), args });

/**
 * Sends Todoist sync commands in one request. Uses "item_update" the way Todoist's own
 * tools do, so a repeating task can be moved without losing its repeat rule.
 * Returns the commands Todoist rejected (empty = all applied).
 */
export async function sync(commands: SyncCommand[]): Promise<SyncCommand[]> {
  const res = await api<{ sync_status?: Record<string, unknown> }>("/api/todoist/sync", { method: "POST", body: { commands } });
  const st = res?.sync_status || {};
  return commands.filter((c) => st[c.uuid] !== "ok");
}
export async function syncOrThrow(commands: SyncCommand[]) {
  const bad = await sync(commands);
  if (bad.length) throw new Error(`Todoist rejected ${bad.length} change${bad.length > 1 ? "s" : ""}`);
}

export const closeTask = (id: string) => api(`/api/todoist/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
export const reopenTask = (id: string) => api(`/api/todoist/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" });
