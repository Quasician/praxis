// Runs the tests in tests/: bundles each with esbuild (the same tool the build uses), then hands them to Node's own test runner.
import { build } from "esbuild";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const out = "dist-tests";
fs.rmSync(out, { recursive: true, force: true });
const entries = fs.readdirSync("tests").filter((f) => f.endsWith(".test.ts")).map((f) => path.join("tests", f));
await build({ entryPoints: entries, outdir: out, bundle: true, platform: "node", format: "esm", target: "node20", outExtension: { ".js": ".mjs" }, logLevel: "warning" });
const r = spawnSync(process.execPath, ["--test", ...fs.readdirSync(out).map((f) => path.join(out, f))], { stdio: "inherit", env: { ...process.env, TZ: "America/Los_Angeles" } });
fs.rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
