// 3.9: the weather symbol next to the temperature on the wallpaper. Thin line drawings in white, so the wallpaper treats them
// like the rest of the lettering (soft shadow, contrast guard). Drawn on a canvas of their own, since outlines are cut with
// "destination-out", and then copied onto the lettering.
import type { SkyIcon } from "./weather";

type G = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A cloud: three overlapping round bumps on a flat base. `inset` shrinks it (to cut the outline out of the filled shape). */
function cloudPath(g: G, cx: number, cy: number, w: number, inset = 0) {
  const bumps: [number, number, number][] = [[-.27, .06, .19], [.0, -.1, .27], [.29, .06, .19]];
  g.beginPath();
  for (const [dx, dy, r] of bumps) { const rr = r * w - inset; if (rr > 0) { g.moveTo(cx + dx * w + rr, cy + dy * w); g.arc(cx + dx * w, cy + dy * w, rr, 0, Math.PI * 2); } }
  const x0 = cx - .46 * w + inset, x1 = cx + .48 * w - inset, y0 = cy + .02 * w, y1 = cy + .25 * w - inset;
  if (x1 > x0 && y1 > y0) g.rect(x0, y0, x1 - x0, y1 - y0);
}
function cloudOutline(g: G, cx: number, cy: number, w: number, lw: number) {
  g.fillStyle = "#fff"; cloudPath(g, cx, cy, w); g.fill("nonzero");
  g.save(); g.globalCompositeOperation = "destination-out"; cloudPath(g, cx, cy, w, lw); g.fill("nonzero"); g.restore();
}
function sun(g: G, cx: number, cy: number, r: number, lw: number, rays = 8) {
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < rays; i++) {
    const a = i * Math.PI * 2 / rays;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (r + lw * 2.1), cy + Math.sin(a) * (r + lw * 2.1)); g.lineTo(cx + Math.cos(a) * (r + lw * 3.9), cy + Math.sin(a) * (r + lw * 3.9)); g.stroke();
  }
}

/** Draws the symbol centred on (cx, cy), about `size` across, with lines `lw` thick, in white on a transparent canvas. */
export function drawSkyIcon(g: G, kind: SkyIcon, cx: number, cy: number, size: number, lw: number) {
  g.save();
  g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = lw; g.lineCap = "round"; g.lineJoin = "round";
  const w = size;
  switch (kind) {
    case "sun": sun(g, cx, cy, w * .2, lw); break;
    case "partly": {
      sun(g, cx - w * .14, cy - w * .14, w * .15, lw * .9);
      // the cloud sits in front: clear the sun behind it, then draw its outline
      g.save(); g.globalCompositeOperation = "destination-out"; cloudPath(g, cx + w * .08, cy + w * .1, w * .82, -lw * 1.2); g.fill(); g.restore();
      cloudOutline(g, cx + w * .08, cy + w * .1, w * .82, lw);
      break;
    }
    case "cloud": cloudOutline(g, cx, cy, w, lw); break;
    case "fog": {
      cloudOutline(g, cx, cy - w * .12, w * .86, lw);
      for (const [y, a, b] of [[.28, -.42, .3], [.42, -.3, .44]] as [number, number, number][]) { g.beginPath(); g.moveTo(cx + a * w, cy + y * w); g.lineTo(cx + b * w, cy + y * w); g.stroke(); }
      break;
    }
    case "rain": {
      cloudOutline(g, cx, cy - w * .14, w * .9, lw);
      for (const dx of [-.22, 0, .22]) { g.beginPath(); g.moveTo(cx + dx * w + w * .04, cy + w * .22); g.lineTo(cx + dx * w - w * .04, cy + w * .4); g.stroke(); }
      break;
    }
    case "snow": {
      cloudOutline(g, cx, cy - w * .14, w * .9, lw);
      for (const [dx, dy] of [[-.22, .27], [0, .38], [.22, .27]]) { g.beginPath(); g.arc(cx + dx * w, cy + dy * w, lw * .95, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case "storm": {
      cloudOutline(g, cx, cy - w * .14, w * .9, lw);
      g.beginPath(); g.moveTo(cx + w * .04, cy + w * .14); g.lineTo(cx - w * .08, cy + w * .32); g.lineTo(cx + w * .05, cy + w * .32); g.lineTo(cx - w * .06, cy + w * .5); g.stroke();
      break;
    }
  }
  g.restore();
}
