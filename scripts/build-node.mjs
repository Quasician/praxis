// Bundles the local server and the Electron main process into dist/ (CommonJS for Node/Electron).
import { build } from "esbuild";
import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const common = { bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true, logLevel: "info", loader: { ".cs": "text" } };
await build({ ...common, entryPoints: ["server/standalone.ts"], outfile: "dist/server/standalone.cjs" });
await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist/electron/main.cjs", external: ["electron", "electron-updater"] });

// The wallpaper's helper program, built here so the installed app never has to compile it or start PowerShell
// (both are console programs and can flash a terminal window). It's a windowed program: it has no console at all.
// Only Windows can build it; anywhere else the folder stays empty and the app builds its own copy on first use.
const out = "native-build";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
if (process.platform === "win32") {
  const src = path.resolve("electron/wallpaper-native.cs");
  const name = `praxis-wall-${crypto.createHash("sha1").update(fs.readFileSync(src, "utf8")).digest("hex").slice(0, 12)}.exe`;
  const exe = path.resolve(out, name);
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      `Add-Type -TypeDefinition (Get-Content -LiteralPath '${src}' -Raw -Encoding UTF8) -OutputAssembly '${exe}' -OutputType WindowsApplication`], { stdio: "inherit" });
    console.log(`  ${out}/${name}`);
  } catch (e) {
    // A release must ship it (without it the installed app would compile its own, which can flash a terminal window).
    if (process.env.CI) throw e;
    console.warn("Couldn't prebuild the wallpaper helper; the app will build it on first use.", e?.message || e);
  }
}
