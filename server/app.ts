// The local Praxis server: serves the UI and relays requests to Todoist so your API
// token stays on disk and never sits in the UI. Used by the desktop app and by
// `npm run serve`. Only answers requests from this machine, from the Praxis UI itself.
import http from "http";
import fs from "fs";
import path from "path";
import { createStore } from "./store";
import { eventsForRange, testCalendar } from "./calendar";
import { ClaudeError, firstSteps, looksLikeKey, reviewBacklog, sortDump, verifyKey, type Auth, type BacklogTask, type SortContext, type StuckTask } from "./claude";
import { cachedCliStatus, cliStatus } from "./claudecode";

export interface ServerOptions {
  dataDir: string;
  staticDir: string;
  todoistBase?: string;
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
    if (route === "POST /api/claude/steps" || route === "POST /api/claude/backlog") {
      const a = await auth();
      if (!a) return sendJSON(res, 401, { error: NO_AUTH });
      let body: { tasks?: unknown[]; today?: string };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }
      if (!Array.isArray(body.tasks) || !body.tasks.length || body.tasks.length > 80) return sendJSON(res, 400, { error: "Send between 1 and 80 tasks." });
      const today = String(body.today || new Date().toDateString()).slice(0, 40);
      try {
        return sendJSON(res, 200, route.endsWith("steps") ? await firstSteps(a, body.tasks as StuckTask[], today) : await reviewBacklog(a, body.tasks as BacklogTask[], today));
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
