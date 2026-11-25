// The local Praxis server: serves the UI and relays requests to Todoist so your API
// token stays on disk and never sits in the UI. Used by the desktop app and by
// `npm run serve`. Only answers requests from this machine, from the Praxis UI itself.
import http from "http";
import fs from "fs";
import path from "path";
import { createStore } from "./store";
import { eventsForRange, testCalendar } from "./calendar";
import { ClaudeError, firstSteps, looksLikeKey, reviewBacklog, sortDump, tinyVersions, drawConstellation, nextMove, tagMottos, writeLegend, writeLetter, verifyKey, type Auth, type BacklogTask, type SortContext, type StuckTask } from "./claude";
import { cachedCliStatus, cliStatus } from "./claudecode";
import { CITY_FILES } from "../src/city/model";

export interface ServerOptions {
  dataDir: string;
  staticDir: string;
  todoistBase?: string;
  /** Where your mottos live (the desktop app passes your Pictures/Mottos folder). */
  mottosDir?: string;
  /** 3.9: where the city wallpaper's 5K paintings live (the desktop app passes Pictures/Praxis city kit/keyframes-5k). */
  cityDir?: string;
  /** Only in the desktop app: reminders that float above other windows. */
  desktop?: { nudge(action: string, key: string): void; test(): void; miniFit?(height: number): void; trayDial?(img16: string, img32: string, tip: string): void; taskbarDark?(): boolean;
    wallpaper?(action: string, arg?: string): Promise<unknown> };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".map": "application/json", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1e6) { reject(new Error("Body too large")); req.destroy(); }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readBinary(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
/** A motto file's name, only if it's a plain image file name (no folders, no tricks). */
export function safeMottoName(name: string) {
  const n = String(name || "");
  if (!n || n.length > 200 || n !== path.basename(n) || n.startsWith(".") || /[\\/:*?"<>|\0]/.test(n)) return null;
  return IMAGE_TYPES[path.extname(n).toLowerCase()] ? n : null;
}

// Blocks other websites from poking at the local server through your browser.
function isTrusted(req: http.IncomingMessage) {
  const host = (req.headers.host || "").split(":")[0];
  return (host === "localhost" || host === "127.0.0.1") && req.headers["x-planner"] === "1";
}

export function createPraxisServer(opts: ServerOptions) {
  const store = createStore(opts.dataDir);
  const todoistBase = opts.todoistBase || process.env.TODOIST_BASE || "https://api.todoist.com/api/v1";
  const staticDir = path.resolve(opts.staticDir);

  async function todoist(method: string, apiPath: string, token: string, body?: string) {
    const r = await fetch(todoistBase + apiPath, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body || undefined,
    });
    return { status: r.status, text: await r.text(), type: r.headers.get("content-type") || "application/json" };
  }

  type Provider = "auto" | "cli" | "api";
  const provider = (): Provider => { const p = (store.readConfig().ai as { provider?: Provider } | undefined)?.provider; return p === "cli" || p === "api" ? p : "auto"; };
  /** Which way to reach Claude right now: your choice, else an API key if you added one, else Claude Code if it's signed in. */
  async function auth(): Promise<Auth | null> {
    const p = provider(), key = store.getClaudeKey();
    if (p === "api") return key ? { kind: "api", key } : null;
    if (p === "cli") return (await cliStatus()).loggedIn ? { kind: "cli" } : null;
    if (key) return { kind: "api", key };
    return (await cliStatus()).loggedIn ? { kind: "cli" } : null;
  }
  const NO_AUTH = "Connect Claude first: ⋯ → Claude… (use your Claude subscription through Claude Code, or an API key).";
  // Find out about Claude Code in the background so the first status check is instant.
  cliStatus().catch(() => undefined);

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (!isTrusted(req)) return sendJSON(res, 403, { error: "Forbidden" });
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /api/status") {
      const p = provider(), key = Boolean(store.getClaudeKey()), cli = Boolean(cachedCliStatus()?.loggedIn);
      const claude = p === "api" ? key : p === "cli" ? cli : key || cli;
      return sendJSON(res, 200, { connected: Boolean(store.getToken()), claude, via: !claude ? null : (p === "api" || (p === "auto" && key)) ? "api" : "cli" });
    }
    if (route === "GET /api/ai") {
      const cli = await cliStatus(url.searchParams.get("fresh") === "1");
      return sendJSON(res, 200, { provider: provider(), apiKey: Boolean(store.getClaudeKey()), cli });
    }
    if (route === "POST /api/ai") {
      let body: { provider?: string };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      const p = body.provider === "cli" || body.provider === "api" ? body.provider : "auto";
      store.writeConfig({ ...store.readConfig(), ai: { provider: p } });
      return sendJSON(res, 200, { provider: p });
    }

    if (route === "POST /api/desktop/nudge" || route === "POST /api/desktop/test-nudge") {
      if (!opts.desktop) return sendJSON(res, 404, { error: "Only in the desktop app." });
      if (route.endsWith("test-nudge")) { opts.desktop.test(); return sendJSON(res, 200, { ok: true }); }
      let body: { action?: string; key?: string };
      try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      opts.desktop.nudge(String(body.action || "").slice(0, 20), String(body.key || "").slice(0, 200));
      return sendJSON(res, 200, { ok: true });
    }

    // ---------- the valley wallpaper (3.4) ----------
    const mottoDir = () => {
      const w = (store.readConfig() as { wallpaper?: { folder?: string } }).wallpaper;
      return path.resolve(w?.folder || opts.mottosDir || path.join(opts.dataDir, "Mottos"));
    };
    if (route === "GET /api/valley/mottos") {
      const dir = mottoDir();
      try {
        const names = fs.readdirSync(dir).filter((n) => safeMottoName(n)).sort();
        return sendJSON(res, 200, { folder: dir, names });
      } catch { return sendJSON(res, 200, { folder: dir, names: [], missing: true }); }
    }
    if (route === "GET /api/valley/motto") {
      const name = safeMottoName(url.searchParams.get("name") || "");
      if (!name) return sendJSON(res, 400, { error: "Not a motto file name." });
      const dir = mottoDir(), file = path.join(dir, name);
      if (path.dirname(file) !== dir || !fs.existsSync(file)) return sendJSON(res, 404, { error: "No such motto." });
      res.writeHead(200, { "Content-Type": IMAGE_TYPES[path.extname(name).toLowerCase()], "Cache-Control": "no-store" });
      return void fs.createReadStream(file).pipe(res);
    }
    // ---------- 3.9: the city wallpaper's paintings, read (never written) from the city kit folder ----------
    const cityDir = () => {
      const w = (store.readConfig() as { wallpaper?: { cityFolder?: string } }).wallpaper;
      return path.resolve(w?.cityFolder || opts.cityDir || path.join(opts.dataDir, "city"));
    };
    if (route === "GET /api/city/frame") {
      const name = url.searchParams.get("name") || "";
      if (!CITY_FILES.includes(name)) return sendJSON(res, 400, { error: "Not a city painting." });
      const dir = cityDir(), file = path.join(dir, `${name}.png`);
      if (!fs.existsSync(file)) return sendJSON(res, 404, { error: `No ${name}.png in the city folder.` });
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      return void fs.createReadStream(file).pipe(res);
    }
    if (route === "GET /api/city/status") {
      const dir = cityDir();
      const missing = CITY_FILES.filter((n) => !fs.existsSync(path.join(dir, `${n}.png`)));
      return sendJSON(res, 200, { folder: dir, found: CITY_FILES.length - missing.length, total: CITY_FILES.length, missing: missing.slice(0, 12) });
    }
    if (route === "POST /api/valley/frame") {
      let buf: Buffer;
      try { buf = await readBinary(req, 80e6); } catch { return sendJSON(res, 413, { error: "Picture too large." }); }
      if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendJSON(res, 400, { error: "Expected a PNG picture." });
      const dir = path.join(opts.dataDir, "wallpaper");
      fs.mkdirSync(dir, { recursive: true });
      // Windows only notices a new wallpaper if the file name changes, so alternate between two names (and keep no others).
      const prev = fs.readdirSync(dir).filter((n) => /^valley-[ab]\.png$/.test(n)).map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
      const name = prev[0]?.n === "valley-a.png" ? "valley-b.png" : "valley-a.png";
      const file = path.join(dir, name);
      fs.writeFileSync(file, buf);
      return sendJSON(res, 200, { file });
    }

    if (route === "GET /api/desktop/wallpaper" || route === "POST /api/desktop/wallpaper") {
      if (!opts.desktop?.wallpaper) return sendJSON(res, 404, { error: "The wallpaper works in the Praxis desktop app." });
      let body: { action?: unknown; folder?: unknown } = {};
      if (req.method === "POST") { try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); } }
      const action = req.method === "GET" ? "state" : String(body.action || "");
      if (!["state", "enable", "disable", "refresh", "folder", "pick-folder", "live-on", "live-off", "weather-on", "weather-off", "pick-city-folder"].includes(action)) return sendJSON(res, 400, { error: "Unknown action." });
      try { return sendJSON(res, 200, await opts.desktop.wallpaper(action, typeof body.folder === "string" ? body.folder.slice(0, 500) : undefined)); }
      catch (e) { return sendJSON(res, 500, { error: (e as Error).message }); }
    }
    if (route === "GET /api/desktop/taskbar") {
      if (!opts.desktop?.taskbarDark) return sendJSON(res, 404, { error: "Only in the desktop app." });
      return sendJSON(res, 200, { dark: !!opts.desktop.taskbarDark() });
    }
    if (route === "POST /api/desktop/tray") {
      if (!opts.desktop?.trayDial) return sendJSON(res, 404, { error: "Only in the desktop app." });
      let body: { img16?: unknown; img32?: unknown; tip?: unknown };
      try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      const ok = (v: unknown) => typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length < 60_000;
      if (!ok(body.img16) || !ok(body.img32)) return sendJSON(res, 400, { error: "Expected two small PNG images." });
      opts.desktop.trayDial(body.img16 as string, body.img32 as string, String(body.tip || "Praxis").slice(0, 200));
      return sendJSON(res, 200, { ok: true });
    }

    if (route === "POST /api/desktop/mini-fit") {
      if (!opts.desktop?.miniFit) return sendJSON(res, 404, { error: "Only in the desktop app." });
      let body: { height?: number };
      try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      const h = Number(body.height);
      if (Number.isFinite(h)) opts.desktop.miniFit(Math.round(h));
      return sendJSON(res, 200, { ok: true });
    }

    if (route === "POST /api/token") {
      const { token } = JSON.parse((await readBody(req)) || "{}");
      const clean = String(token || "").trim();
      if (!/^[A-Za-z0-9]{20,80}$/.test(clean)) return sendJSON(res, 400, { error: "That doesn't look like a Todoist API token." });
      const check = await todoist("GET", "/user", clean);
      if (check.status !== 200) return sendJSON(res, 401, { error: "Todoist didn't accept that token. Double-check you copied all of it." });
      store.setToken(clean);
      return sendJSON(res, 200, { connected: true });
    }
    if (route === "DELETE /api/token") { store.setToken(null); return sendJSON(res, 200, { connected: false }); }

    if (route === "POST /api/claude/key") {
      let body: { key?: string };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      const key = String(body.key || "").trim();
      if (!looksLikeKey(key)) return sendJSON(res, 400, { error: "That doesn't look like an Anthropic API key (it starts with sk-ant-)." });
      try { await verifyKey(key); } catch (e) { return sendJSON(res, (e as ClaudeError).status || 400, { error: (e as Error).message }); }
      store.setClaudeKey(key);
      return sendJSON(res, 200, { claude: true });
    }
    if (route === "DELETE /api/claude/key") { store.setClaudeKey(null); return sendJSON(res, 200, { claude: false }); }
    if (route === "POST /api/claude/steps" || route === "POST /api/claude/backlog" || route === "POST /api/claude/tiny") {
      const a = await auth();
      if (!a) return sendJSON(res, 401, { error: NO_AUTH });
      let body: { tasks?: unknown[]; today?: string };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      if (!Array.isArray(body.tasks) || !body.tasks.length || body.tasks.length > 80) return sendJSON(res, 400, { error: "Send between 1 and 80 tasks." });
      const today = String(body.today || new Date().toDateString()).slice(0, 40);
      try {
        if (route.endsWith("tiny")) return sendJSON(res, 200, await tinyVersions(a, body.tasks as StuckTask[], today));
        return sendJSON(res, 200, route.endsWith("steps") ? await firstSteps(a, body.tasks as StuckTask[], today) : await reviewBacklog(a, body.tasks as BacklogTask[], today));
      } catch (e) { return sendJSON(res, e instanceof ClaudeError ? e.status : 500, { error: (e as Error).message }); }
    }
    if (route === "POST /api/claude/motto-tags") {
      const a = await auth();
      if (!a) return sendJSON(res, 401, { error: NO_AUTH });
      let body: { names?: unknown };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      const names = (Array.isArray(body.names) ? body.names : []).map(String).filter((n) => safeMottoName(n)).slice(0, 400);
      if (!names.length) return sendJSON(res, 200, { tags: {} });
      try { return sendJSON(res, 200, { tags: await tagMottos(a, names) }); }
      catch (e) { const err = e as ClaudeError; return sendJSON(res, err.status || 502, { error: err.message }); }
    }
    if (route === "POST /api/claude/legend" || route === "POST /api/claude/letter") {
      const a = await auth();
      if (!a) return sendJSON(res, 401, { error: NO_AUTH });
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
      const strs = (v: unknown, k: number, n: number) => (Array.isArray(v) ? v : []).map((x) => str(x, n)).filter(Boolean).slice(0, k);
      const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(10000, Math.round(v))) : 0);
      try {
        if (route === "POST /api/claude/legend") {
          const name = str(body.name, 200); if (!name) return sendJSON(res, 400, { error: "Missing name" });
          return sendJSON(res, 200, { legend: await writeLegend(a, { name, steps: strs(body.steps, 40, 160), days: num(body.days) }) });
        }
        const projects = (Array.isArray(body.projects) ? body.projects : []).slice(0, 12).map((p: any) => ({ name: str(p?.name, 120), lit: num(p?.lit), finished: !!p?.finished })).filter((p) => p.name);
        return sendJSON(res, 200, await writeLetter(a, { week: str(body.week, 10), done: strs(body.done, 60, 140), kept: num(body.kept), committedDays: num(body.committedDays), projects, busiest: str(body.busiest, 12) || undefined, total: num(body.total) }));
      } catch (e) { const err = e as ClaudeError; return sendJSON(res, err.status || 502, { error: err.message }); }
    }
    if (route === "POST /api/claude/constellation" || route === "POST /api/claude/unstick") {
      const a = await auth();
      if (!a) return sendJSON(res, 401, { error: NO_AUTH });
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
      const today = str(body.today, 40) || new Date().toDateString();
      try {
        if (route.endsWith("constellation")) {
          const goal = str(body.goal, 600)?.trim();
          if (!goal) return sendJSON(res, 400, { error: "Describe the goal first." });
          return sendJSON(res, 200, await drawConstellation(a, { goal, notes: str(body.notes, 2000), deadline: str(body.deadline, 10), area: str(body.area, 60), today }));
        }
        const task = str(body.task, 300)?.trim();
        if (!task) return sendJSON(res, 400, { error: "Which task?" });
        const tried = Array.isArray(body.tried) ? body.tried.filter((x): x is string => typeof x === "string").slice(0, 8).map((x) => x.slice(0, 200)) : [];
        return sendJSON(res, 200, await nextMove(a, { task, notes: str(body.notes, 1000), project: str(body.project, 80), tried, minutesIn: Number(body.minutesIn) || 0, today }));
      } catch (e) { return sendJSON(res, e instanceof ClaudeError ? e.status : 500, { error: (e as Error).message }); }
    }
    if (route === "POST /api/claude/sort") {
      const a = await auth();
      if (!a) return sendJSON(res, 401, { error: NO_AUTH });
      let body: SortContext;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      if (typeof body?.text !== "string" || body.text.length > 20000 || (body.inbox && body.inbox.length > 80)) return sendJSON(res, 400, { error: "That's too much for one go. Try splitting it up." });
      try { return sendJSON(res, 200, await sortDump(a, body)); }
      catch (e) { return sendJSON(res, e instanceof ClaudeError ? e.status : 500, { error: (e as Error).message }); }
    }

    if (route === "GET /api/config") return sendJSON(res, 200, store.readConfig());
    // 4.3: what someone helping you needs to see, and nothing private: no tokens or keys (they're in .env, never read here),
    // no calendar links, no task titles, no letters. Settings that are about how Praxis behaves, counts for the rest, and the log's tail.
    if (route === "GET /api/diagnostics") {
      const c = store.readConfig() as Record<string, unknown>;
      const count = (k: string) => { const v = c[k]; return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0; };
      const { healNote: _h, ...planner } = (c.planner || {}) as Record<string, unknown>;
      const { bag: _b, tags: _t, ...wallpaper } = (c.wallpaper || {}) as Record<string, unknown>;
      const sky = c.sky as { cons?: Record<string, { finished?: string; rest?: string }> } | undefined;
      let log: string[] = [];
      try { log = fs.readFileSync(path.join(opts.dataDir, "praxis.log"), "utf8").split(/\r?\n/).filter(Boolean).slice(-200); } catch { /* no log outside the desktop app */ }
      return sendJSON(res, 200, {
        platform: `${process.platform} ${process.arch}`, node: process.version, desktop: !!opts.desktop,
        connected: Boolean(store.getToken()), claude: provider(),
        settings: { configVersion: c.configVersion ?? null, planner, ui: c.ui ?? null, reminders: c.reminders ?? null, wallpaper, lastOpen: c.lastOpen ?? null, lastSeenVersion: c.lastSeenVersion ?? null },
        counts: { areas: count("areas"), calendars: count("calendars"), historyDays: count("history"), samples: count("samples"), letters: count("letters"), reviews: count("reviews"), ideas: count("ideas"), tiny: count("tiny"),
          projects: Object.values(sky?.cons || {}).filter((x) => !x.finished).length, resting: Object.values(sky?.cons || {}).filter((x) => x.rest && !x.finished).length },
        log,
      });
    }
    if (route === "POST /api/config") {
      let cfg: unknown;
      try { cfg = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return sendJSON(res, 400, { error: "Settings must be an object" });
      const next = cfg as Record<string, unknown>, cur = store.readConfig();
      if (cur.ai && !("ai" in next)) next.ai = cur.ai; // set by the Claude dialog; a window with older settings mustn't drop it
      store.writeConfig(next);
      return sendJSON(res, 200, next);
    }

    if (route === "GET /api/calendar") {
      const from = Date.parse(url.searchParams.get("from") || ""), to = Date.parse(url.searchParams.get("to") || "");
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 62 * 86400000) {
        return sendJSON(res, 400, { error: "from/to must be a valid range of at most 62 days" });
      }
      const cals = store.readConfig().calendars || [];
      const result = await eventsForRange(cals, from, to, url.searchParams.get("refresh") === "1");
      return sendJSON(res, 200, { ...result, calendars: cals.filter((c) => c.enabled !== false).length });
    }
    if (route === "POST /api/calendar/test") {
      let body: { url?: string };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      try { return sendJSON(res, 200, await testCalendar(body.url)); } catch (e) { return sendJSON(res, 400, { error: (e as Error).message }); }
    }

    if (url.pathname.startsWith("/api/todoist/")) {
      const token = store.getToken();
      if (!token) return sendJSON(res, 401, { error: "Not connected to Todoist yet." });
      if (!["GET", "POST", "DELETE"].includes(req.method || "")) return sendJSON(res, 405, { error: "Method not allowed" });
      const body = req.method === "POST" ? await readBody(req) : undefined;
      const r = await todoist(req.method!, url.pathname.replace("/api/todoist", "") + url.search, token, body || undefined);
      res.writeHead(r.status, { "Content-Type": r.type, "Cache-Control": "no-store" });
      return res.end(r.text);
    }
    return sendJSON(res, 404, { error: "Not found" });
  }

  function serveStatic(res: http.ServerResponse, url: URL) {
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(staticDir, rel));
    if (!filePath.startsWith(staticDir + path.sep) && filePath !== staticDir) return sendJSON(res, 403, { error: "Forbidden" });
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      serveStatic(res, url);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJSON(res, 502, { error: "Couldn't reach Todoist. Are you online?" });
    }
  });

  /** Listen on 127.0.0.1, trying `port` first and the next few ports if it's taken. Resolves to the port used. */
  function listen(port: number, attempts = 10): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (p: number, left: number) => {
        server.once("error", (e: NodeJS.ErrnoException) => {
          if (e.code === "EADDRINUSE" && left > 0) tryPort(p + 1, left - 1);
          else reject(e);
        });
        server.listen(p, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
      };
      tryPort(port, attempts);
    });
  }

  return { server, listen, store };
}
