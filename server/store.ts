// Where Praxis keeps your data on disk:
//   .env                → your Todoist API token
//   praxis.config.json  → areas, planner settings, calendars, slip history
// In the desktop app this folder is %APPDATA%/Praxis; when run from source it's the project folder.
import fs from "fs";
import path from "path";

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
  return {
    dataDir,
    getToken: () => process.env.TODOIST_TOKEN || env.TODOIST_TOKEN || "",
    setToken(token: string | null) {
      const { TODOIST_TOKEN: _old, ...rest } = env;
      env = token ? { ...rest, TODOIST_TOKEN: token } : rest;
      writeEnv(env);
    },
    readConfig(): Config {
      try { return JSON.parse(fs.readFileSync(configFile, "utf8")); } catch { return {}; }
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
