// 3.7: an optional soft note on each completion. Each one climbs the chosen scale, so a good day plays a little tune.
import { noteFor, type ScaleName } from "../domain/rewards";

let ctx: AudioContext | null = null;
const KEY = "praxis.chime";

/** Which note of the day this is (resets each morning). */
function nextIndex() {
  const day = new Date().toDateString();
  let n = 0;
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); if (v.day === day) n = v.n || 0; localStorage.setItem(KEY, JSON.stringify({ day, n: n + 1 })); } catch { /* storage unavailable: always the first note */ }
  return n;
}

/** A plucked, bell-like note: two sine partials with a fast attack and a long, soft decay. Quiet by design. */
export function playNote(freq: number, volume = 0.16) {
  try {
    ctx = ctx || new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
    const t = ctx.currentTime, out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    out.connect(ctx.destination);
    for (const [mult, g] of [[1, 1], [2, 0.18], [3.01, 0.05]] as const) {
      const o = ctx.createOscillator(), gg = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq * mult; gg.gain.value = g;
      o.connect(gg).connect(out); o.start(t); o.stop(t + 1.7);
    }
    (window as unknown as { __praxisLastNote?: number }).__praxisLastNote = freq;
  } catch { /* no audio here: silence is fine */ }
}

export function chime(scale: ScaleName | undefined) {
  if (!scale || scale === "off") return;
  const f = noteFor(scale, nextIndex());
  if (f) playNote(f);
}

/** For the settings preview: the first five notes of the scale. */
export function previewScale(scale: ScaleName) {
  if (scale === "off") return;
  for (let i = 0; i < 5; i++) setTimeout(() => { const f = noteFor(scale, i); if (f) playNote(f, 0.12); }, i * 220);
}
