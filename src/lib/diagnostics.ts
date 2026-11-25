// 4.3 "Copy diagnostics": everything someone helping you needs, as text on the clipboard. Nothing private (see GET /api/diagnostics).
import { api } from "./api";
import { VERSION } from "./version";

export async function diagnosticsText(): Promise<string> {
  const d = await api<Record<string, unknown> & { log: string[] }>("/api/diagnostics");
  const { log, ...rest } = d;
  const view = { screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`, window: `${window.innerWidth}x${window.innerHeight}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: new Date().toString() };
  return [`Praxis ${VERSION} diagnostics`, "```json", JSON.stringify({ ...rest, view }, null, 2), "```", `Log (last ${log.length} lines)`, "```", ...log, "```"].join("\n");
}

/** Copies the diagnostics; true if it worked. */
export async function copyDiagnostics(): Promise<boolean> {
  const text = await diagnosticsText();
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}
