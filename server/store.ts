// Where Praxis keeps your data on disk:
//   .env                → your Todoist API token (and Anthropic API key, if you added one)
//   praxis.config.json  → areas, planner settings, calendars, slip history
// In the desktop app this folder is %APPDATA%/Praxis; when run from source it's the project folder.
import fs from "fs";
import path from "path";
import { migrate } from "./migrate";

export type Config = Record<string, unknown> & { calendars?: CalendarConfig[] };
export interface CalendarConfig { id: string; name: string; url: string; color: string; enabled?: boolean }

export function createStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const envFile = path.join(dataDir, ".env");
  const configFile = process.env.PRAXIS_CONFIG || path.join(dataDir, "praxis.config.json");

  function readEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* no file yet */ }
    return out;
  }
  function writeEnv(values: Record<string, string | undefined>) {
    const lines = Object.entries(values).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(envFile, lines.join("\n") + "\n", { mode: 0o600 });
  }

  let env = readEnv();
  function setSecret(name: string, value: string | null) {
    const { [name]: _old, ...rest } = env;
    env = value ? { ...rest, [name]: value } : rest;
    writeEnv(env);
  }
  return {
    dataDir,
    getToken: () => process.env.TODOIST_TOKEN || env.TODOIST_TOKEN || "",
    setToken(token: string | null) { setSecret("TODOIST_TOKEN", token); },
    getClaudeKey: () => process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || "",
    setClaudeKey(key: string | null) { setSecret("ANTHROPIC_API_KEY", key); },
    /** Your settings, upgraded to this version's shape if an older Praxis wrote them (4.3, server/migrate.ts).
     *  A file that can't be read as settings is moved aside (never overwritten) and Praxis starts from empty settings. */
    readConfig(): Config {
      let text: string;
      try { text = fs.readFileSync(configFile, "utf8"); } catch { return {}; }       // no file yet
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { raw = null; }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        const aside = configFile.replace(/\.json$/, "") + `.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        try { fs.renameSync(configFile, aside); } catch { /* leave it where it is */ }
        console.warn(`Settings file couldn't be read; moved it to ${aside}`);
        return {};
      }
      const m = migrate(raw as Config);
      if (m.changed) {
        try { this.writeConfig(m.config as Config); } catch { /* still usable this session; tried again next time */ }
      }
      return m.config as Config;
    },
    writeConfig(cfg: Config) {
      // Write to a temp file first so a crash mid-write can't corrupt your settings.
      const tmp = configFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
      fs.renameSync(tmp, configFile);
    },
  };
}
export type Store = ReturnType<typeof createStore>;
