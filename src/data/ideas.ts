// 3.8: ideas as clouds. Things from a brain dump that aren't tasks yet drift across today's sky until Claude turns them into tasks.
import type { Config } from "../lib/types";
import { updateConfig } from "./actions";
import { queryClient, qk } from "./queries";
import { toast, useUi } from "../state/ui";

export interface Idea { id: string; text: string; at: string }
const MAX = 24;
const ideasNow = () => (queryClient.getQueryData<Config>(qk.config)?.ideas as Idea[] | undefined) || [];
const newId = () => Math.random().toString(36).slice(2, 10);

/** Each non-empty line becomes an idea (bullets and numbering stripped). */
export function splitIdeas(text: string) {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).map((l) => l.slice(0, 200));
}

export async function keepIdeas(text: string) {
  const lines = splitIdeas(text);
  if (!lines.length) return 0;
  const at = new Date().toISOString();
  await updateConfig((c) => {
    const have = new Set(((c.ideas as Idea[]) || []).map((i) => i.text.toLowerCase()));
    const add = lines.filter((l) => !have.has(l.toLowerCase())).map((text) => ({ id: newId(), text, at }));
    return { ...c, ideas: [...((c.ideas as Idea[]) || []), ...add].slice(-MAX) };
  });
  return lines.length;
}

export async function dropIdeas(ids: string[]) {
  if (!ids.length) return;
  await updateConfig((c) => ({ ...c, ideas: ((c.ideas as Idea[]) || []).filter((i) => !ids.includes(i.id)) }));
}

/** Let an idea go (with an undo). */
export async function releaseIdea(id: string) {
  const idea = ideasNow().find((i) => i.id === id);
  if (!idea) return;
  await dropIdeas([id]);
  toast(`Let “${idea.text.slice(0, 40)}” drift away.`, { label: "Undo", run: async () => { await updateConfig((c) => ({ ...c, ideas: [...((c.ideas as Idea[]) || []), idea] })); } });
}

/** Hand ideas to the brain dump; once Claude's tasks are added, the clouds go. */
export function shapeIdeas(ids: string[]) {
  const chosen = ideasNow().filter((i) => ids.includes(i.id));
  if (!chosen.length) return;
  const ui = useUi.getState();
  ui.setDump({ text: chosen.map((i) => i.text).join("\n"), proposals: null, questions: [], filing: false, ideaIds: chosen.map((i) => i.id) });
  ui.openDialog("dump");
}
