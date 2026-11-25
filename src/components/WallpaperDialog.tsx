// 3.4: your mottos on the valley, as the Windows wallpaper. Opt-in; turning it off puts your slideshow back.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";

const isDesktop = () => /Electron/i.test(navigator.userAgent);
interface WState {
  enabled?: boolean; folder?: string; defaultFolder: string; live?: boolean; mottos: number; windows: boolean;
  current?: { name: string } | null; last?: { at: string; motto: string; ms: number } | null; error?: string | null;
  saved?: { status: number; folder: string } | null;
  useWeather?: boolean; weather?: { kind: string; text: string; station?: string; source: string; at: string } | null; liveHow?: string | null;
  scene?: "valley" | "city"; city?: { folder: string; found: number; total: number };
}

export function WallpaperDialog() {
  return <Dialog name="wallpaper" id="wallpaper-dialog"><Body /></Dialog>;
}

const pretty = (name?: string) => (name || "").replace(/\.(png|jpe?g|webp)$/i, "").replace(/^[0-9a-z]{1,4}-/i, "").replace(/-/g, " ");

function Body() {
  const close = useUi((s) => s.closeDialog);
  const [st, setSt] = useState<WState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const desktop = isDesktop();
  const load = () => api<WState>("/api/desktop/wallpaper").then(setSt).catch(() => setSt(null));
  useEffect(() => { if (desktop) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (action: string, label: string) => {
    setBusy(label);
    try { const s = await api<WState>("/api/desktop/wallpaper", { method: "POST", body: { action } }); setSt(s); if (s.error) toast(s.error); }
    catch (e) { toast(`Couldn't do that: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const folder = st?.folder || st?.saved?.folder || st?.defaultFolder || "";
  const scene = st?.scene === "city" ? "city" : "valley";
  const cityReady = !!st?.city && st.city.found === st.city.total;

  return (
    <div className="planner-form wallpaper-form" id="wallpaper-form">
      <h2>Your mottos on the {scene}</h2>
      <p className="dialog-sub">Your desktop becomes a living scene behind your mottos: the season follows the calendar, the light follows the real sun and moon here, your projects shine as constellations, and the motto changes on the hour.</p>
      {!desktop && <p className="dialog-note">This works in the Praxis desktop app.</p>}
      {desktop && st && (
        <>
          <label className="switch-row"><input type="checkbox" id="wp-enabled" checked={!!st.enabled} disabled={!!busy}
            onChange={(e) => act(e.target.checked ? "enable" : "disable", e.target.checked ? "Drawing your first one…" : "Putting your wallpaper back…")} />
            <span>Use it as my desktop wallpaper</span></label>
          <div className="form-row wp-scene"><span className="form-label">Scene</span>
            <div className="seg" role="radiogroup" aria-label="Scene" id="wp-scene">
              {(["valley", "city"] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={scene === s} data-scene={s} className={scene === s ? "on" : ""} disabled={!!busy || (s === "city" && !cityReady && scene !== "city")}
                  title={s === "city" && !cityReady ? "The city needs its paintings: see below." : undefined}
                  onClick={() => scene !== s && act(`scene-${s}`, s === "city" ? "Painting the city…" : "Drawing the valley…")}>{s === "valley" ? "Valley" : "City"}</button>))}
            </div>
          </div>
          {st.city && (scene === "city" || !cityReady) && (
            <div className="form-row wp-folder"><span className="form-label">City paintings</span>
              <span className="wp-path" id="wp-city-folder" title={st.city.folder}>{st.city.folder}</span>
              <button type="button" className="ghost-btn" id="wp-pick-city" disabled={!!busy} onClick={() => act("pick-city-folder", "Choosing…")}>Change…</button>
            </div>)}
          {st.city && !cityReady && <p className="dialog-note" id="wp-city-note">{st.city.found ? `${st.city.found} of ${st.city.total} city paintings found there.` : "No city paintings found there yet."} The city needs all 32 paintings (spring-dawn.png … winter-overcast.png) and the 4 season masks in one folder.</p>}
          <label className="switch-row"><input type="checkbox" id="wp-weather" checked={st.useWeather !== false} disabled={!!busy || !st.enabled}
            onChange={(e) => act(e.target.checked ? "weather-on" : "weather-off", "Checking the weather…")} />
            <span>Match the real weather here {st.weather && st.useWeather !== false ? <em className="wp-wx" id="wp-wx">· now: {st.weather.text.toLowerCase()}{st.weather.station ? ` (${st.weather.station})` : ""}</em> : null}</span></label>
          <label className="switch-row"><input type="checkbox" id="wp-live" checked={!!st.live} disabled={!!busy || !st.enabled}
            onChange={(e) => act(e.target.checked ? "live-on" : "live-off", e.target.checked ? "Starting the moving wallpaper…" : "Stopping it…")} />
            <span>Make it move: {scene === "city" ? "twinkling stars, falling rain or snow" : "grass and trees in the wind, water, falling rain or snow"} <em className="wp-wx">(experimental)</em></span></label>
          {st.live && <p className="dialog-note" id="wp-live-note">The {scene} holds still while a full-screen app is in front, when the PC is locked, and on battery. If it ever stops showing, Praxis keeps the still picture underneath.</p>}
          <div className="form-row wp-folder"><span className="form-label">Mottos from</span>
            <span className="wp-path" id="wp-folder" title={folder}>{folder}</span>
            <button type="button" className="ghost-btn" id="wp-pick" disabled={!!busy} onClick={() => act("pick-folder", "Choosing…")}>Change…</button>
          </div>
          <p className="wp-status" id="wp-status">
            {busy ? busy
              : st.error ? <span className="wp-error">{st.error}</span>
              : st.enabled && st.last ? <>Showing “{pretty(st.last.motto)}” · drawn {new Date(st.last.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} in {(st.last.ms / 1000).toFixed(1)}s · {st.mottos} motto{st.mottos === 1 ? "" : "s"}</>
              : st.mottos ? `${st.mottos} motto${st.mottos === 1 ? "" : "s"} found.` : "No pictures found in that folder yet."}
          </p>
          <ul className="wp-notes">
            <li>Your mottos folder is only read, never changed. New mottos you add show up within the hour.</li>
            <li>Task names never appear on your wallpaper; your projects show only as stars.</li>
            <li>Weather comes from the US National Weather Service (weather.gov), checked every 15 minutes.</li>
            <li>{st.saved && (st.saved.status & 2) ? "Turning this off puts your Windows slideshow back as it was." : "Turning this off puts your previous wallpaper back."}</li>
          </ul>
        </>
      )}
      <div className="dialog-actions">
        {desktop && st?.enabled && <button type="button" className="ghost-btn" id="wp-refresh" disabled={!!busy} onClick={() => act("refresh", "Drawing…")}>Redraw now</button>}
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => close("wallpaper")}>Done</button>
      </div>
    </div>
  );
}
