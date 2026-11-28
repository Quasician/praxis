// 5.1 the living sky: the maths behind the wallpaper (no drawing).
import test from "node:test";
import assert from "node:assert/strict";
import { ARC, MOTTO_ZONE, SLOTS, TRAIL_FADE, historyStars, lightAt, mottoFit, onArc, placeProjects, realSky, shortName, skyWeather, trailOf } from "../src/livingsky/model";

const at = (s: string) => new Date(s);   // tests run in America/Los_Angeles

test("light: the sun is on the arc's left end at sunrise, at the top at midday and on the right end at sunset", () => {
  const day = lightAt(at("2026-11-27T12:00:00"));
  assert.ok(day.rise > 6.5 && day.rise < 7.3, `sunrise ${day.rise}`);
  assert.ok(day.set > 16.6 && day.set < 17.2, `sunset ${day.set}`);
  const noon = lightAt(at(`2026-11-27T${String(Math.floor((day.rise + day.set) / 2)).padStart(2, "0")}:${String(Math.round((((day.rise + day.set) / 2) % 1) * 60)).padStart(2, "0")}:00`));
  assert.ok(Math.abs(noon.dayT - 0.5) < 0.01);
  assert.ok(noon.sunUp && !noon.moonUp && noon.night === 0);
  const night = lightAt(at("2026-11-27T22:00:00"));
  assert.ok(!night.sunUp && night.moonUp && night.night === 1);
  assert.deepEqual(onArc(0), { x: ARC.cx - ARC.rx, y: ARC.hy });
  assert.ok(Math.abs(onArc(0.5).y - (ARC.hy - ARC.ry)) < 1e-9);
});

test("light: the arc follows the seasons (a longer day in June)", () => {
  const dec = lightAt(at("2026-12-21T12:00:00")), jun = lightAt(at("2026-06-21T12:00:00"));
  assert.ok(jun.set - jun.rise > dec.set - dec.rise + 4);
});

test("trails: they stop exactly at the sun and the moon, and never run ahead of them", () => {
  for (const h of ["08:10", "11:47", "15:02", "16:40"]) {
    const L = lightAt(at(`2026-11-27T${h}:00`)), segs = trailOf("sun", L, 1);
    const head = onArc(L.dayT), last = segs[segs.length - 1];
    assert.ok(Math.hypot(last.x1 - head.x, last.y1 - head.y) < 1e-6, `sun trail head at ${h}`);
    for (const s of segs) assert.ok(s.x0 <= head.x + 1e-6 && s.x1 <= head.x + 1e-6, `nothing ahead of the sun at ${h}`);
  }
  const L = lightAt(at("2026-11-27T21:30:00")), segs = trailOf("moon", L, 1), head = onArc(L.nT);
  const last = segs[segs.length - 1];
  assert.ok(Math.hypot(last.x1 - head.x, last.y1 - head.y) < 1e-6);
});

test("trails: the sun's trail has faded from every spot before the moon gets there, and the other way round", () => {
  const start = at("2026-11-27T00:00:00").getTime();
  for (let m = 0; m < 24 * 60; m += 10) {
    const L = lightAt(new Date(start + m * 60_000));
    const sun = trailOf("sun", L, 1), moon = trailOf("moon", L, 1);
    if (!sun.length || !moon.length) continue;
    const sunX = [Math.min(...sun.map((s) => s.x0)), Math.max(...sun.map((s) => s.x1))];
    const moonX = [Math.min(...moon.map((s) => s.x0)), Math.max(...moon.map((s) => s.x1))];
    assert.ok(sunX[1] <= moonX[0] + 1e-6 || moonX[1] <= sunX[0] + 1e-6, `trails overlap at minute ${m}`);
  }
  assert.ok(TRAIL_FADE < 9.5);
});

test("motto: short mottos keep their size; long ones shrink to stay inside the zone, centred", () => {
  const native = 1680 / 5120;
  const short = mottoFit(1400, 380, native);           // a one-line motto's lettering, in picture pixels
  assert.equal(short.s, native);
  const long = mottoFit(3000, 1000, native);           // four lines and the attribution
  assert.ok(long.s < native);
  for (const f of [short, long, mottoFit(4800, 400, native), mottoFit(900, 1600, native)]) {
    assert.ok(f.x >= MOTTO_ZONE.x0 - 1e-6 && f.x + f.w <= MOTTO_ZONE.x1 + 1e-6, "inside left/right");
    assert.ok(f.y >= MOTTO_ZONE.y0 - 1e-6 && f.y + f.h <= MOTTO_ZONE.y1 + 1e-6, "inside top/bottom");
    assert.ok(Math.abs(f.x + f.w / 2 - 840) < 1e-6, "centred");
  }
});

test("constellations: every slot stays clear of the motto zone, the arc and the weather box, and of each other", () => {
  const box = { x0: 30, y0: 26, x1: 330, y1: 114 };
  const overlaps = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const rects = SLOTS.map((s) => ({ x0: s.cx - s.w / 2, x1: s.cx + s.w / 2, y0: s.cy - s.h / 2, y1: s.cy + s.h / 2 }));
  rects.forEach((r, i) => {
    assert.ok(!overlaps(r, { x0: MOTTO_ZONE.x0, x1: MOTTO_ZONE.x1, y0: MOTTO_ZONE.y0, y1: MOTTO_ZONE.y1 }), `slot ${i} vs motto`);
    assert.ok(!overlaps(r, box), `slot ${i} vs weather box`);
    rects.forEach((q, j) => { if (j > i) assert.ok(!overlaps(r, q), `slots ${i} and ${j}`); });
    // the arc: sample it and keep 12 units away from each slot
    for (let t = 0; t <= 1; t += 0.002) {
      const p = onArc(t);
      assert.ok(!(p.x > r.x0 - 12 && p.x < r.x1 + 12 && p.y > r.y0 - 12 && p.y < r.y1 + 12), `slot ${i} touches the arc at t=${t.toFixed(3)}`);
    }
  });
  const placed = placeProjects([{ id: "a", steps: [{ lit: true }, { lit: true }, { lit: false }, { lit: false }, { lit: false }] }]);
  assert.equal(placed[0].stars.filter((s) => s.lit).length, 2);
  assert.equal(placed[0].label.t, "2 / 5");
});

test("constellations: each is labelled with its project's name, kept short", () => {
  const placed = placeProjects([{ id: "a", name: "Praxis 5.0", steps: [{ lit: true }, { lit: false }] }, { id: "b", steps: [{ lit: false }] }]);
  assert.equal(placed[0].label.name, "PRAXIS 5.0");
  assert.equal(placed[1].label.name, "");
  assert.equal(shortName("Learn the **Moonlight** sonata, all three movements"), "LEARN THE MOONLIG…");
  assert.equal(shortName("[Arete](https://github.com/Quasician/arete) v1"), "ARETE V1");
  assert.equal(shortName("Moonlight Sonata, first movement"), "MOONLIGHT SONATA…");
});

test("history: one star per finished thing in the last year, today on the right, older days dimmer", () => {
  const when = at("2026-11-27T21:00:00");
  const h = historyStars({ days: { "2026-11-27": 3, "2026-06-01": 2, "2025-11-01": 9 }, milestones: ["2026-11-20"] }, when);
  assert.equal(h.total, 6);                              // the day from over a year ago is left out
  const today = h.stars.filter((s) => s.x > 1610);
  assert.ok(today.length >= 3);
  const june = h.stars.filter((s) => s.x > 800 && s.x < 1000);
  assert.ok(june.every((s) => s.o < today[0].o));
  assert.equal(h.stars.filter((s) => s.mile).length, 1);
  assert.equal(h.months.length, 11);
  assert.equal(h.months[h.months.length - 1].t, "NOV");
});

test("real sky: Pegasus is up on a November evening, Orion later that night", () => {
  const evening = realSky(at("2026-11-27T20:00:00")).labels.map((l) => l.t);
  assert.ok(evening.includes("PEGASUS"), evening.join(","));
  const late = realSky(at("2026-11-28T01:00:00")).labels.map((l) => l.t);
  assert.ok(late.includes("ORION"), late.join(","));
});

test("weather: the forecast's symbol picks the sky's weather", () => {
  assert.equal(skyWeather("partly", "cloudy"), "partly");
  assert.equal(skyWeather("storm"), "rain");
  assert.equal(skyWeather(null, "mist"), "fog");
  assert.equal(skyWeather(undefined, undefined), "clear");
});
