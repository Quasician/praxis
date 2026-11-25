// 4.3 The settings file carries a version (configVersion). When Praxis reads a file written by an older version, it upgrades it
// one tested step at a time before anything else sees it. A step only ever adds or reshapes; it never drops your data.
// To change the file's shape in a release: add a step here, raise CONFIG_VERSION, and add a test in tests/migrate.test.ts.
export type Config = Record<string, unknown>;

export const CONFIG_VERSION = 2;

/** STEPS[n] turns a version n-1 file into a version n file. */
const STEPS: Record<number, (c: Config) => Config> = {
  // 1 (Praxis 4.3): files from before had no version. Nothing about them changes except that they now say which version they are.
  1: (c) => c,
  // 2 (Praxis 4.4): the one canvas becomes the default (on for everyone, once; it can be switched off in the menu), and the
  // valley wallpaper is retired: a wallpaper set to the valley moves to the city.
  2: (c) => ({
    ...c,
    ui: { ...((c.ui as Record<string, unknown>) || {}), canvas: true },
    ...(c.wallpaper && typeof c.wallpaper === "object" ? { wallpaper: { ...(c.wallpaper as Record<string, unknown>), scene: "city" } } : {}),
  }),
};

export interface Migrated { config: Config; from: number; changed: boolean; newer: boolean }

/** Brings a settings object up to the current version. A file from a newer Praxis (after going back a version) is left alone. */
export function migrate(input: Config): Migrated {
  const from = typeof input.configVersion === "number" && Number.isFinite(input.configVersion) ? input.configVersion : 0;
  if (from > CONFIG_VERSION) return { config: input, from, changed: false, newer: true };
  let c: Config = input;
  for (let v = from + 1; v <= CONFIG_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`No upgrade step to settings version ${v}.`);
    c = { ...step({ ...c }), configVersion: v };
  }
  return { config: c, from, changed: from !== CONFIG_VERSION, newer: false };
}
