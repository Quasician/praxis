// Use Claude through Claude Code on this computer (signed in with a Claude subscription), instead of an API key.
// Praxis runs `claude -p` with no tools, no project context and a JSON schema, and reads the structured answer.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ClaudeError } from "./errors";

export interface CliStatus { installed: boolean; loggedIn: boolean; method: string; version: string; path: string; error?: string }

interface Launcher { cmd: string; pre: string[]; where: string }

const isWin = process.platform === "win32";
const exists = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Every place `claude` might be: PATH, then the usual install folders. */
function candidates(): string[] {
  const home = os.homedir();
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  // Install folders checked directly, because Praxis may have started before the install changed PATH.
  dirs.push(path.join(home, ".local", "bin"), path.join(home, ".claude", "local"));
  if (isWin && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
  if (isWin && process.env.LOCALAPPDATA) {
    const winget = path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet");
    dirs.push(path.join(winget, "Links"));
    try { for (const d of fs.readdirSync(path.join(winget, "Packages"))) if (/^Anthropic\.ClaudeCode/i.test(d)) dirs.push(path.join(winget, "Packages", d)); } catch { /* no WinGet packages */ }
  }
  const names = isWin ? ["claude.exe", "claude.cmd"] : ["claude"];
  const out: string[] = [];
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); if (exists(p) && !out.includes(p)) out.push(p); }
  return out;
}

/** How to start Claude Code without a shell (so nothing we pass can be misread as a command). */
function launcher(): Launcher | null {
  const forced = process.env.PRAXIS_CLAUDE_BIN; // tests (and unusual installs) can point at a specific binary
  if (forced) return exists(forced) ? { cmd: forced, pre: [], where: forced } : null;
  for (const p of candidates()) {
    if (!p.endsWith(".cmd")) return { cmd: p, pre: [], where: p };
    // npm's Windows shim: run the script it points at with Node directly.
    try {
      const m = fs.readFileSync(p, "utf8").match(/"%~?dp0%?\\([^"]+\.js)"/i);
      const script = m && path.join(path.dirname(p), m[1]);
      if (script && exists(script)) return { cmd: "node", pre: [script], where: p };
    } catch { /* try the next one */ }
  }
  return null;
}

function run(l: Launcher, args: string[], input: string, timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    // An API key in the environment would make Claude Code bill the API instead of the subscription.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-claude-")); // empty folder: no project files or settings to pick up
    const child = spawn(l.cmd, [...l.pre, ...args], { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new ClaudeError(504, "Claude took too long to answer. Try again, or send less at once.")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new ClaudeError(502, `Couldn't start Claude Code: ${e.message}`)); });
    child.on("close", (code) => { clearTimeout(timer); fs.rm(cwd, { recursive: true, force: true }, () => undefined); resolve({ code: code ?? 1, out, err }); });
    child.stdin.end(input);
  });
}

let cache: { at: number; status: CliStatus } | null = null;
export const cachedCliStatus = () => cache?.status || null;

/** Is Claude Code installed, and signed in? (Cached for 5 minutes.) */
export async function cliStatus(fresh = false): Promise<CliStatus> {
  if (!fresh && cache && Date.now() - cache.at < 5 * 60_000) return cache.status;
  const l = launcher();
  let status: CliStatus = { installed: false, loggedIn: false, method: "none", version: "", path: "" };
  if (l) {
    status = { ...status, installed: true, path: l.where };
    try {
      const v = await run(l, ["--version"], "", 20_000);
      status.version = (v.out.match(/\d+\.\d+\.\d+/) || [""])[0];
      const a = await run(l, ["auth", "status"], "", 20_000);
      const j = JSON.parse(a.out.trim() || "{}");
      status.method = String(j.authMethod || (a.code === 0 ? "unknown" : "none"));
      status.loggedIn = a.code === 0 && status.method !== "none";
    } catch (e) { status.error = (e as Error).message; }
  }
  cache = { at: Date.now(), status };
  return status;
}

/** One structured answer from Claude via Claude Code. */
export async function askCli(system: string, user: string, schema: object): Promise<Record<string, unknown>> {
  const l = launcher();
  if (!l) throw new ClaudeError(401, "Claude Code isn't installed on this computer. See ⋯ → Claude… for the two-minute setup.");
  const sysFile = path.join(os.tmpdir(), `praxis-system-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(sysFile, system);
  try {
    const r = await run(l, [
      "-p", "--output-format", "json", "--json-schema", JSON.stringify(schema),
      "--system-prompt-file", sysFile,
      "--model", process.env.PRAXIS_CLI_MODEL || "sonnet",
      "--tools", "", "--disallowedTools", "mcp__*", "--strict-mcp-config", "--disable-slash-commands",
      "--no-session-persistence", "--max-turns", "4",
    ], user, 180_000);
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(r.out.trim().split("\n").filter(Boolean).pop() || "{}"); } catch { /* not JSON */ }
    if (j.structured_output && typeof j.structured_output === "object") return j.structured_output as Record<string, unknown>;
    const msg = String(j.result || r.err || r.out || "").trim();
    if (/log ?in|logged in|authenticat|\/login/i.test(msg)) { cache = null; throw new ClaudeError(401, "Claude Code isn't signed in. Open a terminal, run `claude`, and sign in with your Claude account."); }
    if (/limit|usage|credit/i.test(msg)) throw new ClaudeError(429, `Claude Code says: ${msg.slice(0, 200)}`);
    throw new ClaudeError(502, msg ? `Claude Code couldn't do that: ${msg.slice(0, 240)}` : `Claude Code exited without an answer (code ${r.code}).`);
  } finally { fs.rm(sysFile, { force: true }, () => undefined); }
}
