// Brain dump: ask Claude to sort text (or the Inbox) into tasks, then add them all in one Todoist batch.
import { cleanProposals, proposalCommands, type Proposal } from "../domain/dump";
import { plannerCfg } from "../domain/planner";
import { api, fetchAll, sync } from "../lib/api";
import { fmtMin, startOfToday, toMin, ymd } from "../lib/dates";
import { plain } from "../lib/text";
import type { Config, Project, Task } from "../lib/types";
import { EMPTY_DUMP, toast, useUi } from "../state/ui";
import { reconcileSoon } from "./actions";
import { queryClient, qk, inboxOf } from "./queries";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let labelCache: string[] | null = null;

/** Sends the dump (and optionally the Inbox) to Claude; the proposals land in the UI store. */
export async function sortWithClaude(text: string, inbox: Task[] = []) {
  const projects = (queryClient.getQueryData<Project[]>(qk.projects) || []).filter((p) => !p.is_archived);
  const config = queryClient.getQueryData<Config>(qk.config);
  const cfg = plannerCfg(config);
  const inboxProject = inboxOf(projects);
  if (!labelCache) labelCache = (await fetchAll<{ name: string }>("/labels").catch(() => [])).map((l) => l.name);
  const areaOf = new Map<string, string>();
  for (const a of config?.areas || []) for (const pid of a.projects) areaOf.set(pid, a.name);
  const now = startOfToday();
  const res = await api<{ tasks: unknown[]; questions: string[] }>("/api/claude/sort", {
    method: "POST",
    body: {
      text,
      inbox: inbox.map((t) => ({ id: t.id, content: plain(t.content), description: t.description || "" })),
      today: `${now.toLocaleDateString("en-US", { weekday: "long" })}, ${ymd(now)}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      projects: projects.map((p) => ({ id: p.id, name: p.name, area: areaOf.get(p.id) })),
      labels: labelCache.filter((l) => ![cfg.deepLabel, cfg.lightLabel].includes(l)),
      planner: {
        workDays: cfg.workDays.map((d) => DAYS[d]).join(", "),
        workHours: `${fmtMin(toMin(cfg.workStart))}–${fmtMin(toMin(cfg.workEnd))}`,
        deepLabel: cfg.deepLabel, lightLabel: cfg.lightLabel,
      },
    },
  });
  const proposals = cleanProposals(res.tasks, projects, inboxProject?.id || "", inbox, labelCache);
  useUi.getState().setDump({ proposals, questions: res.questions || [], filing: inbox.length > 0 });
  return proposals;
}

/** Adds the included proposals to Todoist in one batch. Returns how many were saved. */
export async function acceptDump(ps: Proposal[], inbox: Task[]) {
  const cfg = plannerCfg(queryClient.getQueryData<Config>(qk.config));
  const chosen = ps.filter((p) => p.include && p.content.trim());
  const { cmds, owner } = proposalCommands(chosen, cfg, inbox);
  if (!cmds.length) return 0;
  const failedKeys = (rej: { uuid: string }[], own: Map<string, string>) => new Set(rej.map((r) => own.get(r.uuid)!));
  let failed = failedKeys(await sync(cmds), owner);
  // Some Todoist accounts don't take deadlines through sync: retry those once without one.
  const retryable = chosen.filter((p) => failed.has(p.key) && p.deadline);
  if (retryable.length) {
    const again = proposalCommands(retryable, cfg, inbox, false);
    const stillBad = failedKeys(await sync(again.cmds), again.owner);
    failed = new Set([...failed].filter((k) => !retryable.some((p) => p.key === k) || stillBad.has(k)));
  }
  const saved = chosen.length - failed.size;
  const filed = chosen.some((p) => p.sourceId);
  toast(failed.size ? `Saved ${saved} of ${chosen.length}. Todoist rejected ${failed.size}; they're still here to fix.`
    : `${filed ? "Filed" : "Added"} ${saved} task${saved === 1 ? "" : "s"}.`);
  useUi.getState().setDump(failed.size ? { proposals: chosen.filter((p) => failed.has(p.key)) } : EMPTY_DUMP);
  reconcileSoon(0);
  return saved;
}
