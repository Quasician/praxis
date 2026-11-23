// Run Praxis's server on its own (development and tests): `npm run serve`.
// The desktop app doesn't use this file; it starts the same server internally.
import path from "path";
import { createPraxisServer } from "./app";

const port = Number(process.env.PORT) || 4321;
const dataDir = process.env.PRAXIS_DATA_DIR || process.cwd();
const staticDir = path.join(__dirname, "..", "renderer");

createPraxisServer({ dataDir, staticDir })
  .listen(port, process.env.PORT ? 0 : 10)
  .then((p) => console.log(`\n  Praxis is running at http://localhost:${p}\n  Data folder: ${dataDir}\n`))
  .catch((e) => { console.error(e); process.exit(1); });
