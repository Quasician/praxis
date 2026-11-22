// Day Planner — local server
// No installs needed: uses only what ships with Node.js (v18 or newer).
// Serves the app from ./public and relays requests to Todoist so your
// API token stays in this folder (in the .env file) and never sits in the browser.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT) || 4321;
const HOST = "127.0.0.1";
const TODOIST_BASE = process.env.TODOIST_BASE || "https://api.todoist.com/api/v1";
const ENV_FILE = path.join(__dirname, ".env");
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------- token storage (.env in this folder) ----------
function readEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return out;
}
function writeEnv(values) {
  const lines = Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n", { mode: 0o600 });
}
let env = readEnv();
const getToken = () => process.env.TODOIST_TOKEN || env.TODOIST_TOKEN || "";

// ---------- helpers ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error("Body too large")); req.destroy(); }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function todoist(method, apiPath, token, body) {
  const r = await fetch(TODOIST_BASE + apiPath, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body || undefined,
  });
  const text = await r.text();
  return { status: r.status, text, type: r.headers.get("content-type") || "application/json" };
}

// Only allow requests from this app itself (blocks other websites from
// poking at your local server through your browser).
function isTrusted(req) {
  const host = (req.headers.host || "").split(":")[0];
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  return req.headers["x-planner"] === "1";
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      if (!isTrusted(req)) return sendJSON(res, 403, { error: "Forbidden" });

      // Is a token saved?
      if (url.pathname === "/api/status" && req.method === "GET") {
        return sendJSON(res, 200, { connected: Boolean(getToken()) });
      }

      // Save a token (checks it with Todoist first)
      if (url.pathname === "/api/token" && req.method === "POST") {
        const { token } = JSON.parse((await readBody(req)) || "{}");
        const clean = String(token || "").trim();
        if (!/^[A-Za-z0-9]{20,80}$/.test(clean)) {
          return sendJSON(res, 400, { error: "That doesn't look like a Todoist API token." });
        }
        const check = await todoist("GET", "/user", clean);
        if (check.status !== 200) {
          return sendJSON(res, 401, { error: "Todoist didn't accept that token. Double-check you copied all of it." });
        }
        env = { ...env, TODOIST_TOKEN: clean };
        writeEnv(env);
        return sendJSON(res, 200, { connected: true });
      }

      // Forget the token
      if (url.pathname === "/api/token" && req.method === "DELETE") {
        const { TODOIST_TOKEN, ...rest } = env;
        env = rest;
        writeEnv(env);
        return sendJSON(res, 200, { connected: false });
      }

      // Relay everything under /api/todoist/* to Todoist
      if (url.pathname.startsWith("/api/todoist/")) {
        const token = getToken();
        if (!token) return sendJSON(res, 401, { error: "Not connected to Todoist yet." });
        const apiPath = url.pathname.replace("/api/todoist", "") + url.search;
        if (!["GET", "POST", "DELETE"].includes(req.method)) return sendJSON(res, 405, { error: "Method not allowed" });
        const body = req.method === "POST" ? await readBody(req) : undefined;
        const r = await todoist(req.method, apiPath, token, body || undefined);
        res.writeHead(r.status, { "Content-Type": r.type, "Cache-Control": "no-store" });
        return res.end(r.text);
      }

      return sendJSON(res, 404, { error: "Not found" });
    }

    // Static files
    let filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "Forbidden" });
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Not found");
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    sendJSON(res, 502, { error: "Couldn't reach Todoist. Are you online?" });
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`\nDay Planner already seems to be running. Open http://localhost:${PORT}\n`);
    openBrowser();
    setTimeout(() => process.exit(0), 1500);
  } else {
    throw e;
  }
});

function openBrowser() {
  if (!process.argv.includes("--open")) return;
  const u = `http://localhost:${PORT}`;
  const cmd = process.platform === "win32" ? `start "" "${u}"` : process.platform === "darwin" ? `open "${u}"` : `xdg-open "${u}"`;
  exec(cmd, () => {});
}

server.listen(PORT, HOST, () => {
  console.log(`\n  Day Planner is running at http://localhost:${PORT}`);
  console.log("  Keep this window open while you use it. Close it to stop.\n");
  openBrowser();
});
