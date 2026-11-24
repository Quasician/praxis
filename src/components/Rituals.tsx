// 3.8: dawn and dusk. The morning commit is a sunrise (the sun climbs as you choose your commitments);
// the shutdown is a sunset (it sinks as each leftover gets a home, and the stars come out when you close the day).
import { useMemo } from "react";
import { seeded } from "../domain/sky";

const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
const NIGHT_TOP = [22, 28, 64], NIGHT_LOW = [52, 52, 100];
const DAWN_TOP = [96, 128, 200], DAWN_LOW = [252, 186, 140];
const GOLD_TOP = [92, 112, 180], GOLD_LOW = [250, 170, 98];
const DUSK_TOP = [30, 30, 74], DUSK_LOW = [150, 84, 120];

/** progress 0..1. Sunrise: the sun comes up from below the hills. Sunset: it goes down behind them. */
export function RitualSky({ kind, progress }: { kind: "sunrise" | "sunset"; progress: number }) {
  const p = Math.max(0, Math.min(1, progress));
  const rise = kind === "sunrise";
  // Sun height above the horizon (px): sunrise -18 → 30; sunset 34 → -6 (just slipping under).
  const h = rise ? -18 + 48 * p : 34 - 40 * p;
  const light = rise ? p : 1 - p;                      // how much daylight is in the sky
  const top = rise ? mix(NIGHT_TOP, DAWN_TOP, p) : mix(GOLD_TOP, DUSK_TOP, p);
  const low = rise ? mix(NIGHT_LOW, DAWN_LOW, Math.min(1, p * 1.3)) : mix(GOLD_LOW, DUSK_LOW, p);
  const stars = useMemo(() => { const r = seeded(`ritual-${kind}`); return Array.from({ length: 26 }, () => ({ x: r() * 100, y: 6 + r() * 48, s: .6 + r() * .9 })); }, [kind]);
  const H = 96, HZ = 72;
  return (
    <div className={`ritual-sky ${kind}`} id={`ritual-${kind}`} data-progress={p.toFixed(2)} aria-hidden="true">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="ritual-bg">
        <defs><linearGradient id={`rg-${kind}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={top} /><stop offset="1" stopColor={low} /></linearGradient></defs>
        <rect width="100" height={H} fill={`url(#rg-${kind})`} />
        {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.s * .35} fill="#fff" opacity={Math.max(0, (1 - light * 1.6)) * .85} />)}
      </svg>
      <div className="ritual-sun" style={{ bottom: H - HZ + h - 14, opacity: h < -12 ? 0 : 1, boxShadow: `0 0 ${18 + 24 * light}px ${6 + 10 * light}px rgba(255,${rise ? 200 : 160},${rise ? 120 : 80},${.35 + .3 * light})` }} />
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="ritual-hills">
        <path d={`M0 ${HZ + 4} C 14 ${HZ - 6}, 26 ${HZ - 4}, 38 ${HZ + 1} S 62 ${HZ - 8}, 76 ${HZ - 1} S 92 ${HZ - 3}, 100 ${HZ + 2} L100 ${H} L0 ${H} Z`} fill={mix([40, 44, 80], [70, 92, 96], light)} />
        <path d={`M0 ${HZ + 12} C 20 ${HZ + 4}, 40 ${HZ + 10}, 58 ${HZ + 8} S 86 ${HZ + 4}, 100 ${HZ + 10} L100 ${H} L0 ${H} Z`} fill={mix([28, 30, 58], [52, 72, 74], light)} />
      </svg>
    </div>
  );
}
