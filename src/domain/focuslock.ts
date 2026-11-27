// 4.7 The gate and the focus lock.
// The gate: when a planned block starts, a full-screen card covers every screen until you choose to start it, move it or
// skip it (with a reason). The lock: while a block's focus timer runs, the apps and sites you listed (Firefox, Steam and its
// games, Reddit in any browser) are minimised and covered by a card naming the block and the time left. Everything else
// stays usable, so the work itself is never in the way. Getting out early is possible but slow, and it goes in the record.
// Pure rules here; the desktop app (electron/focus.ts) watches the window in front and shows the cards.

export interface FocusLockCfg {
  gate: boolean;            // a full-screen gate when a block starts
  committedOnly: boolean;   // only for blocks you committed to in the morning (off: every planned block)
  lock: boolean;            // lock the apps and sites below while a focus timer runs
  apps: string[];           // program names: "firefox" is firefox.exe; "steam" also covers Steam's games
  sites: string[];          // words in a browser tab's title: "reddit"
}
export const FOCUS_LOCK_DEFAULTS: FocusLockCfg = { gate: true, committedOnly: false, lock: true, apps: ["firefox", "steam"], sites: ["reddit"] };

const clean = (xs: unknown, fallback: string[]): string[] =>
  Array.isArray(xs) ? [...new Set(xs.map((x) => String(x).trim().toLowerCase().replace(/\.exe$/, "")).filter((x) => x && x.length <= 60))].slice(0, 30) : fallback;

export function lockCfg(raw: Partial<FocusLockCfg> | null | undefined): FocusLockCfg {
  const r = raw || {};
  return {
    gate: r.gate !== false, committedOnly: !!r.committedOnly, lock: r.lock !== false,
    apps: clean(r.apps, FOCUS_LOCK_DEFAULTS.apps), sites: clean(r.sites, FOCUS_LOCK_DEFAULTS.sites),
  };
}

/** "firefox, Steam ,reddit.com" → ["firefox", "steam", "reddit.com"] (for the settings box). */
export const splitList = (s: string): string[] => clean(s.split(/[,\n]/), []);

const BROWSERS = ["chrome", "msedge", "firefox", "brave", "opera", "opera_gx", "vivaldi", "arc", "librewolf", "waterfox", "zen", "floorp", "chromium", "iexplore"];
const NAMES: Record<string, string> = { firefox: "Firefox", steam: "Steam", chrome: "Chrome", msedge: "Edge", discord: "Discord", reddit: "Reddit", youtube: "YouTube" };
export const niceName = (s: string) => { const b = s.replace(/\.(com|org|net|tv|gg|io)$/, ""); return NAMES[b] || b.replace(/^./, (c) => c.toUpperCase()); };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The window in front: its program's full path and its title. */
export interface Front { exe: string; title: string }

/** Is the window in front one you locked? Returns a name to show ("Firefox", "Steam", "Reddit") or null. */
export function blockedBy(front: Front, cfg: Pick<FocusLockCfg, "apps" | "sites">): string | null {
  const path = front.exe.replace(/\//g, "\\").toLowerCase();
  const base = (path.split("\\").pop() || "").replace(/\.exe$/, "");
  if (!base || base === "praxis") return null;
  for (const a of cfg.apps) {
    if (base === a) return niceName(a);
    // Steam: the client's other windows, and any game installed through it.
    if (a === "steam" && (base.startsWith("steam") || path.includes("\\steamapps\\"))) return niceName(a);
  }
  if (BROWSERS.includes(base)) {
    const title = front.title.toLowerCase();
    for (const s of cfg.sites) {
      const word = s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const bare = word.replace(/\.(com|org|net|tv|gg|io)$/, "");
      if (bare && ((word.includes(".") && title.includes(word)) || new RegExp("(^|[^a-z0-9])" + escapeRe(bare) + "([^a-z0-9]|$)").test(title))) return niceName(word);
    }
  }
  return null;
}

/** A focus timer, as the settings keep it. */
export interface LockFocus { taskId: string; content: string; startedAt: string; minutes: number; lock?: boolean; unlockedAt?: string | null }

/** When the lock lifts (ms), or null when nothing is locked right now. */
export function lockedUntil(focus: LockFocus | null | undefined, now: number, cfg: Pick<FocusLockCfg, "lock">): number | null {
  if (!cfg.lock || !focus || !focus.lock || focus.unlockedAt) return null;
  const end = Date.parse(focus.startedAt) + focus.minutes * 60_000;
  return Number.isFinite(end) && now < end ? end : null;
}

/** Should this block's start open the gate? Every planned block, or only the ones you committed to. */
export const gates = (cfg: FocusLockCfg, committed: boolean) => cfg.gate && (!cfg.committedOnly || committed);

/** "Move it": to 15, 30 or 60 minutes from now, rounded up to 5, as long as it stays today. Minutes from midnight. */
export function moveChoices(now: Date): number[] {
  const m = now.getHours() * 60 + now.getMinutes();
  return [15, 30, 60].map((d) => Math.ceil((m + d) / 5) * 5).filter((x) => x < 24 * 60 - 5);
}

/** The phrase you type to lift the lock early. */
export const UNLOCK_PHRASE = "I'm choosing to stop";
export const UNLOCK_WAIT_S = 60;
