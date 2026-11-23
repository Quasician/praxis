// Bundles the local server and the Electron main process into dist/ (CommonJS for Node/Electron).
import { build } from "esbuild";

const common = { bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true, logLevel: "info" };
await build({ ...common, entryPoints: ["server/standalone.ts"], outfile: "dist/server/standalone.cjs" });
await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist/electron/main.cjs", external: ["electron", "electron-updater"] });
