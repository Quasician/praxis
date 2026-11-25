// The valley, drawn on the graphics card. The land's shape, the trees' shapes and where they stand were baked once
// (public_static/valley); everything that changes — light, season, weather, your constellations, the motto — is drawn here.
import { hash01, imageTexture, instances, program, rng, target, texture, type GL, type Prog, type Target } from "./gl";
import { leafState, sceneAt, DESIGN_H, DESIGN_W, KEEP, type RGB, type Scene, type Weather } from "./model";
import { shapeOf } from "../domain/sky";
import type { CityPlan } from "../city/model";

export interface ValleyData {
  version: number; keep: number[]; horizon: number; lakeY: number;
  land: { k: number; w: number; heightScale: number; topScale: number; zDepth: number; top: number };
  atlas: { w: number; h: number; sprites: Record<string, [number, number, number, number][]> };
  near: number[]; side: number[]; grove: number[]; grove2: number[];
  forest: number[][]; shore: number[][]; corners: number[][]; kinds: string[];
}
export interface ValleyAssets { a: ImageBitmap; b: ImageBitmap; trees: ImageBitmap; data: ValleyData }

export async function loadAssets(base = "/valley"): Promise<ValleyAssets> {
  const bmp = async (name: string) => createImageBitmap(await (await fetch(`${base}/${name}`)).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const [a, b, trees, data] = await Promise.all([bmp("valley-a.png"), bmp("valley-b.png"), bmp("trees.png"), fetch(`${base}/valley.json`).then((r) => r.json())]);
  return { a, b, trees, data };
}

/** One of your projects, for the sky: how many steps, which are lit, its colour. */
export interface SkyProject { id: string; seed?: string; steps: { lit: boolean; min: number }[]; color: string }
export interface RenderOpts {
  when: Date; weather?: Weather; motto?: ImageBitmap | null; projects?: SkyProject[];
  mask?: boolean;           // draw only the scenery (white) on black: for checking nothing reaches the words
  time?: number;            // seconds, for the moving (live) version
  wind?: number;            // 0..1
  events?: SkyEvents;       // 3.7: rewards that show in the sky
  city?: CityInput | null;  // 3.9: draw the city paintings instead of the valley
}
/** 3.9: the city: what to show at this moment, and the paintings it needs (by file name, as loaded from the city kit folder). */
export interface CityInput { plan: CityPlan; images: Record<string, ImageBitmap> }
/** 3.7: a shooting star after you finish "the one" (its age in seconds), and the aurora after a week of kept commitments. */
export interface SkyEvents { meteorAge?: number | null; aurora?: number }
export interface RenderInfo { scene: Scene; box: [number, number, number, number] | null; constellations: number; ms: number }

const FULL_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;
const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uMask;
out vec4 outColor;
const vec4 KEEP = vec4(${KEEP.map((v) => v.toFixed(1)).join(", ")});
vec2 dpos() { return vec2(gl_FragCoord.x / uRes.x * 5120.0, (uRes.y - gl_FragCoord.y) / uRes.y * 2160.0); }
float sm(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float distOut(vec2 p) { return length(vec2(max(max(KEEP.x - p.x, p.x - KEEP.z), 0.0), max(max(KEEP.y - p.y, p.y - KEEP.w), 0.0))); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float poster(float t, float n, float soft) { t = clamp(t, 0.0, 1.0) * n; float f = floor(t); return clamp((f + sm((t - f - 0.5) / soft + 0.5)) / n, 0.0, 1.0); }
uniform sampler2D uHaze;
uniform vec3 uDark;
vec3 haze(float x) { return texture(uHaze, vec2(clamp(x / 5120.0, 0.0, 1.0), 0.5)).rgb * 255.0; }
vec3 sil(float x) { return haze(x) * 0.09 + uDark * 0.91; }
uniform sampler2D uNear;
float nearAt(float x) { return texelFetch(uNear, ivec2(clamp(int(x), 0, 5119), 0), 0).r; }
`;
// Instanced shapes are placed in design units (5120 x 2160, y down).
const DESIGN_TO_CLIP = `vec4 clipOf(vec2 d) { return vec4(d.x / 5120.0 * 2.0 - 1.0, 1.0 - d.y / 2160.0 * 2.0, 0.0, 1.0); }`;

const SKY_FS = COMMON + `
uniform sampler2D uGrad;
uniform vec3 uGlowC0, uGlowC1, uGlow0, uGlow1;   // colour; amount, width, height
uniform float uGlowX, uGrey, uDim, uMoonPhase, uUp;
uniform vec4 uSun;                                // x, y, radius
uniform vec3 uSunC;
uniform float uAurora, uTime, uStarsVis;
void main() {
  if (uMask > 0.5) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 p = dpos();
  vec3 c = texture(uGrad, vec2(0.5, clamp(p.y / 1778.0, 0.0, 1.0) * 255.0 / 256.0 + 0.5 / 256.0)).rgb * 255.0;
  float calm = 0.42 + 0.58 * sm(distOut(p) / 700.0);
  float up = max(0.0, 1778.0 - p.y);
  float a0 = exp(-pow((p.x - uGlowX) / (5120.0 * uGlow0.y), 2.0)) * exp(-pow(up / (2160.0 * uGlow0.z), 2.0)) * uGlow0.x * calm;
  c = mix(c, uGlowC0, a0);
  float a1 = exp(-pow((p.x - uGlowX) / (5120.0 * uGlow1.y), 2.0)) * exp(-pow(up / (2160.0 * uGlow1.z), 2.0)) * uGlow1.x * calm;
  c = mix(c, uGlowC1, a1);
  if (uGrey > 0.0) { float m = (c.r + c.g + c.b) / 3.0; c = c * (1.0 - 0.22 * uGrey) + m * 0.14 * uGrey; }
  float px = 5120.0 / uRes.x;
  vec2 q = p - uSun.xy; float d = length(q), r = uSun.z;
  vec3 add = vec3(0.0);
  if (uUp > 0.5) {
    float disc = 1.0 - smoothstep(r - px, r + px, d);
    add += uSunC * uDim * disc;
    add += uSunC * uDim * 0.73 * exp(-d * d / (2.0 * (26.0 * 26.0 + r * r * 0.25)));
    add += uSunC * uDim * 0.32 * exp(-d * d / (2.0 * 88.0 * 88.0));
  } else {
    // The moon, in its real phase: lit on the right while it waxes, on the left as it wanes.
    vec3 mc = vec3(226.0, 230.0, 244.0) * uDim;
    float disc = 1.0 - smoothstep(r - px, r + px, d);
    vec2 n = q / r;
    float edge = sqrt(max(0.0, 1.0 - n.y * n.y));
    float th = 6.2831853 * uMoonPhase;
    float lit = uMoonPhase < 0.5 ? smoothstep(-0.04, 0.04, n.x - cos(th) * edge) : smoothstep(-0.04, 0.04, -cos(th) * edge - n.x);
    float k = (1.0 - cos(th)) * 0.5;
    add += mc * disc * (0.09 + 0.91 * lit);
    add += mc * 0.6 * k * exp(-d * d / (2.0 * (26.0 * 26.0 + r * r * 0.25)));
  }
  c = c + add * (1.0 - c / 255.0);
  // 3.7: the aurora, after a week of kept commitments. Curtains of light low in the night sky, quieter near the words.
  if (uAurora > 0.0 && uStarsVis > 0.12) {
    float lower = 800.0 + 420.0 * (vnoise(vec2(p.x / 1100.0 + uTime * 0.008, 1.7)) - 0.5) + 160.0 * (vnoise(vec2(p.x / 280.0 - uTime * 0.02, 5.3)) - 0.5);
    float rise = max(0.0, lower - p.y);
    float v = smoothstep(lower + 60.0, lower - 40.0, p.y) * exp(-rise / 300.0);
    float curtain = smoothstep(0.32, 0.85, vnoise(vec2(p.x / 300.0 + uTime * 0.02, 4.1)) * 0.65 + vnoise(vec2(p.x / 90.0 - uTime * 0.05, 9.3)) * 0.35);
    float rays = 0.55 + 0.45 * vnoise(vec2(p.x / 14.0 + uTime * 0.25, 2.3));
    float a = uAurora * curtain * rays * v * min(1.0, uStarsVis * 1.5) * (0.3 + 0.7 * sm(distOut(p) / 500.0)) * 0.6;
    vec3 col = mix(vec3(96.0, 240.0, 168.0), vec3(156.0, 104.0, 246.0), smoothstep(lower - 90.0, lower - 480.0, p.y));
    c = c + col * a * (1.0 - c / 255.0);
  }
  outColor = vec4(c / 255.0, 1.0);
}`;

// Small round lights added on top (stars, constellation stars and lines): "screen" blending.
const SEG_VS = `#version 300 es
in vec2 aCorner;
in vec4 aSeg;      // x0 y0 x1 y1
in vec4 aCol;      // r g b alpha (0..255, 0..1)
in vec4 aShape;    // width, glow, dash (unused), sway
in vec4 aSway;     // height above ground at each end (0..1), phase, stiffness
uniform float uTime, uWind, uPx;
out vec2 vP; flat out vec4 vSeg; flat out vec4 vCol; flat out vec4 vShape;
${DESIGN_TO_CLIP}
void main() {
  vec4 s = aSeg;
  float sw = uWind * (0.6 + 0.4 * sin(uTime * 1.7 + aSway.z)) * aShape.w;
  s.x += sw * aSway.x * aSway.x; s.z += sw * aSway.y * aSway.y;
  vec2 a = s.xy, b = s.zw, dir = b - a; float len = max(length(dir), 1e-3); dir /= len;
  vec2 nrm = vec2(-dir.y, dir.x);
  float pad = aShape.x * 0.5 + 2.0 * uPx + aShape.y * 66.0;
  vec2 d = a - dir * pad + dir * (len + 2.0 * pad) * aCorner.x + nrm * pad * (aCorner.y * 2.0 - 1.0);
  vP = d; vSeg = s; vCol = aCol; vShape = aShape;
  gl_Position = clipOf(d);
}`;
const SEG_FS = COMMON + `
in vec2 vP; flat in vec4 vSeg; flat in vec4 vCol; flat in vec4 vShape;
uniform float uScreen, uPx, uClipNear;
uniform sampler2D uInk4; uniform float uInkFade;
void main() {
  vec2 a = vSeg.xy, b = vSeg.zw, ab = b - a;
  float t = clamp(dot(vP - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(vP - (a + ab * t));
  float w = max(vShape.x * 0.5, uPx * 0.5);
  float core = (1.0 - smoothstep(w - uPx * 0.7, w + uPx * 0.7, d)) * min(1.0, vShape.x / uPx);
  float glow = vShape.y * exp(-d * d / (2.0 * 22.0 * 22.0));
  float al = clamp(core + glow, 0.0, 1.0) * vCol.a;
  if (uClipNear > 0.5 && vP.y < nearAt(vP.x) + 1.0) al = 0.0;
  if (uInkFade > 0.0) al *= 1.0 - uInkFade * clamp(texture(uInk4, vec2(gl_FragCoord.x / uRes.x, gl_FragCoord.y / uRes.y)).a * 3.0, 0.0, 1.0);
  if (al <= 0.001) discard;
  if (uMask > 0.5) { outColor = uScreen > 0.5 ? vec4(0.0) : vec4(al); return; }
  outColor = uScreen > 0.5 ? vec4(vCol.rgb / 255.0 * al, 0.0) : vec4(vCol.rgb / 255.0 * al, al);
}`;
const DOT_VS = `#version 300 es
in vec2 aCorner;
in vec4 aDot;      // x y rx ry
in vec4 aCol;      // r g b alpha
in vec4 aShape;    // soft (design units), ring width, glow, clip to meadow
uniform float uPx;
out vec2 vP; flat out vec4 vDot; flat out vec4 vCol; flat out vec4 vShape;
${DESIGN_TO_CLIP}
void main() {
  float pad = 2.0 * uPx + aShape.x * 3.0 + aShape.z * 66.0;
  vec2 d = aDot.xy + (aCorner * 2.0 - 1.0) * (aDot.zw + pad);
  vP = d; vDot = aDot; vCol = aCol; vShape = aShape;
  gl_Position = clipOf(d);
}`;
const DOT_FS = COMMON + `
in vec2 vP; flat in vec4 vDot; flat in vec4 vCol; flat in vec4 vShape;
uniform float uScreen, uPx;
uniform sampler2D uInk4; uniform float uInkFade;
void main() {
  vec2 q = (vP - vDot.xy) / max(vDot.zw, vec2(1e-3));
  float r = length(q), rad = max(vDot.z, vDot.w);
  float dd = (r - 1.0) * min(vDot.z, vDot.w);          // distance to the edge, about
  float aa = max(uPx * 0.7, vShape.x);
  float fill = 1.0 - smoothstep(-aa, aa, dd);
  if (vShape.y > 0.0) fill *= smoothstep(-aa, aa, dd + vShape.y);   // a ring
  float glow = vShape.z * exp(-pow(r * rad, 2.0) / (2.0 * 22.0 * 22.0));
  float al = clamp(fill + glow, 0.0, 1.0) * vCol.a;
  if (vShape.w > 0.5 && vP.y < nearAt(vP.x) + 6.0) al = 0.0;
  if (uInkFade > 0.0) al *= 1.0 - uInkFade * clamp(texture(uInk4, vec2(gl_FragCoord.x / uRes.x, gl_FragCoord.y / uRes.y)).b * 3.2, 0.0, 1.0);
  if (al <= 0.001) discard;
  if (uMask > 0.5) { outColor = uScreen > 0.5 ? vec4(0.0) : vec4(al); return; }
  outColor = uScreen > 0.5 ? vec4(vCol.rgb / 255.0 * al, 0.0) : vec4(vCol.rgb / 255.0 * al, al);
}`;

const LAND_FS = COMMON + `
uniform sampler2D uA, uB;
uniform float uK, uTW, uHS, uYS, uZD, uTop;
uniform vec3 uLd, uSunC, uSnowLit, uSnowSh, uCon;
uniform vec3 uLeaves[4];
uniform float uL, uLeafMix, uGS, uSnowAlt;
int K, TW;
float ht(int k, int i) { vec4 t = texelFetch(uA, ivec2(clamp(i, 0, TW - 1), clamp(k, 0, K - 1)), 0); return (t.r * 65280.0 + t.g * 255.0) / 65535.0 * uHS; }
float mv(int k, int i) { vec4 t = texelFetch(uB, ivec2(clamp(i, 0, TW - 1), clamp(k, 0, K - 1)), 0); return (t.r * 65280.0 + t.g * 255.0) / 65535.0 * uYS; }
float htx(int k, float cx) { int i = int(floor(cx)); float f = cx - floor(cx); return mix(ht(k, i), ht(k, i + 1), f); }
float mvx(int k, float cx) { int i = int(floor(cx)); float f = cx - floor(cx); return mix(mv(k, i), mv(k, i + 1), f); }
vec4 ax(int k, float cx) { int i = int(floor(cx)); float f = cx - floor(cx); return mix(texelFetch(uA, ivec2(clamp(i, 0, TW - 1), k), 0), texelFetch(uA, ivec2(clamp(i + 1, 0, TW - 1), k), 0), f); }
vec4 bx(int k, float cx) { int i = int(floor(cx)); float f = cx - floor(cx); return mix(texelFetch(uB, ivec2(clamp(i, 0, TW - 1), k), 0), texelFetch(uB, ivec2(clamp(i + 1, 0, TW - 1), k), 0), f); }
void main() {
  K = int(uK); TW = int(uTW);
  vec2 p = dpos();
  if (p.y < uTop - 4.0) discard;
  if (p.x > KEEP.x - 8.0 && p.x < KEEP.z + 8.0 && p.y < KEEP.w + 8.0) discard;      // never into the words
  float cx = p.x / 2.0 - 0.5;
  if (mvx(K - 1, cx) > p.y) discard;                                                 // sky
  int lo = 0, hi = K - 1;
  for (int it = 0; it < 12; it++) { if (lo >= hi) break; int mid = (lo + hi) / 2; if (mvx(mid, cx) <= p.y) hi = mid; else lo = mid + 1; }
  int k = lo;
  float z = (float(k) + 0.5) / uK;
  float H = htx(k, cx);
  float dhx = (htx(k, cx + 1.0) - htx(k, cx - 1.0)) / 4.0;
  float dhz = (htx(k + 1, cx) - htx(k - 1, cx)) / (2.0 * uZD / uK);
  float slope = length(vec2(dhx, dhz));
  vec3 n = normalize(vec3(-dhx, 1.0, -dhz));
  vec4 A = ax(k, cx), B = bx(k, cx);
  float nSnow = A.b, nPatch = A.a, nFor = B.b;
  if (uMask > 0.5) { outColor = vec4(1.0); return; }
  vec3 hz = haze(p.x);
  float lam = clamp(dot(n, uLd), 0.0, 1.0);
  float tone = poster(pow(lam, 0.85) * 1.15, 3.0, 0.22);
  float kd = 0.9 - 0.42 * z;
  vec3 sh = hz * (1.0 - kd) + uDark * kd;
  vec3 rock = sh * (0.74 + 0.14 * n.y) + uSunC * (tone * 0.24 * uL * (0.55 + 0.45 * sqrt(z)));
  float forest = sm((300.0 - H + 90.0 * (nFor - 0.5)) / 70.0) * sm((1.25 - slope) / 0.5) * sm((0.8 - z) / 0.1);
  int pick = int(clamp(nPatch * 4.4 - 0.2, 0.0, 3.999));
  vec3 lv = uLeaves[0]; if (pick == 1) lv = uLeaves[1]; if (pick == 2) lv = uLeaves[2]; if (pick == 3) lv = uLeaves[3];
  float leafmix = sm((nPatch - 0.5) / 0.16) * uLeafMix;
  vec3 tint = uCon * (1.0 - leafmix) + lv * leafmix;
  float green = 1.0 - uGS;
  rock = rock * (1.0 - 0.3 * forest * green) + tint * forest * (0.03 + 0.15 * uL * (0.3 + 0.7 * tone)) * green;
  float alt = H + 470.0 * sm((z - 0.86) / 0.05);
  float sn = sm((alt - uSnowAlt + 120.0 * (nSnow - 0.5)) / 46.0) * (1.0 - 0.86 * sm((slope - mix(1.05, 1.5, uGS)) / 0.6));
  sn = max(sn, uGS * 0.82 * sm((1.0 - slope) / 0.5));
  vec3 snowc = uSnowSh * (1.0 - tone) + uSnowLit * tone;
  vec3 col = mix(rock, snowc, sn);
  float air = clamp(0.03 + 0.62 * pow(z, 1.15) + 0.2 * sm((60.0 - H) / 60.0) * z, 0.0, 0.82);
  col = mix(col, hz, air);
  outColor = vec4(col / 255.0, 1.0);
}`;

const TREE_VS = `#version 300 es
in vec2 aCorner;
in vec4 aTree;     // x, base, height, air
in vec4 aRect;     // atlas x, y, w, h (pixels)
in vec4 aCol;      // leaf colour, quiet
in vec4 aWood;     // wood colour, snowy
uniform float uFlip, uTime, uWind;
uniform vec2 uAtlas;
out vec2 vUV; flat out vec4 vTree; flat out vec4 vCol; flat out vec4 vWood;
${DESIGN_TO_CLIP}
void main() {
  float w = aTree.z * aRect.z / aRect.w;
  vec2 d = vec2(aTree.x - w * 0.5 + aCorner.x * w, aTree.y - aTree.z + aCorner.y * aTree.z);
  float sway = uWind * (1.0 - aCorner.y) * (1.0 - aCorner.y) * aTree.z * 0.012 * sin(uTime * 1.1 + aTree.x * 0.013);
  d.x += sway;
  float u = uFlip > 0.5 ? 1.0 - aCorner.x : aCorner.x;
  vUV = (aRect.xy + vec2(u * aRect.z, aCorner.y * aRect.w)) / uAtlas;
  vTree = aTree; vCol = aCol; vWood = aWood;
  gl_Position = clipOf(d);
}`;
const TREE_FS = COMMON + `
in vec2 vUV; flat in vec4 vTree; flat in vec4 vCol; flat in vec4 vWood;
uniform sampler2D uAtlasT;
uniform float uL;
uniform vec3 uSunC, uSnowLit, uSnowSh;
void main() {
  vec4 s = texture(uAtlasT, vUV);
  float A = s.r, T = s.g, Wd = s.b, Sn = s.a;
  float al = A + Wd * (1.0 - A);
  if (al < 0.004) discard;
  if (uMask > 0.5) { outColor = vec4(al); return; }
  float air = vTree.w, quiet = vCol.a;
  vec3 hz = haze(vTree.x), s_ = hz * 0.09 + uDark * 0.91;
  vec3 c = vCol.rgb * 0.9;
  float v = (0.12 + 0.46 * uL) * (1.0 - 0.5 * air) * (1.0 - quiet);
  vec3 shc = (s_ * (1.0 - v) + c * 0.42 * v) * (1.0 - air) + hz * air;
  vec3 mid = (s_ * (1.0 - v) + c * 0.78 * v) * (1.0 - air) + hz * air;
  vec3 lit = (s_ * (1.0 - v) + min(c * 1.02 + uSunC * 0.22, vec3(255.0)) * v) * (1.0 - air) + hz * air;
  vec3 wood = (s_ * (1.0 - v) + vWood.rgb * 0.8 * v) * (1.0 - air) + hz * air;
  vec3 ssh = uSnowSh * (1.0 - air) + hz * air, slit = uSnowLit * (1.0 - air) + hz * air;
  float t = poster(T, 3.0, 0.22);
  vec3 col = t < 0.5 ? mix(shc, mid, t * 2.0) : mix(mid, lit, t * 2.0 - 1.0);
  col = mix(col, mix(ssh, slit, t), Sn * 0.92 * vWood.a);
  vec3 pre = col * A + wood * Wd * (1.0 - A);
  outColor = vec4(pre / 255.0, al);
}`;

const FOG_FS = COMMON + `
uniform vec4 uFog[8];
uniform vec3 uClLit, uClSh;
uniform vec2 uLight;
uniform float uTime;
float cn(vec2 p) {
  p.x += uTime * 6.0;
  return vnoise(p / vec2(240.0, 150.0)) * 0.42 + abs(2.0 * vnoise(p / vec2(120.0, 84.0) + 7.1) - 1.0) * 0.3 + vnoise(p / vec2(56.0, 40.0) + 3.3) * 0.18 + vnoise(p / vec2(24.0, 18.0) + 9.7) * 0.1;
}
void main() {
  vec2 p = dpos();
  if (p.y < 1700.0 || p.y > 1960.0) discard;
  float dens = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uFog[i];
    float u = (p.x - r.x) / r.z, v = (r.y - p.y) / r.w;
    dens = max(dens, pow(clamp(1.0 - u * u, 0.0, 1.0), 0.7) * sm(v / 0.1) * pow(clamp(1.0 - v, 0.0, 1.0), 0.55));
  }
  float dist = distOut(p);
  float d_ = pow(dens * sm((dist - 70.0) / 190.0), 0.8) * (0.2 + 1.25 * cn(p)) - 0.3;
  float al = sm(d_ / 0.16) * 0.5 * sm(dist / 90.0);
  if (al < 0.003) discard;
  if (uMask > 0.5) { outColor = vec4(al); return; }
  float prox = exp(-length(uLight - p) / 1400.0);
  vec3 sh = uClSh * 0.52 + haze(p.x) * 0.48;
  vec3 lit = uClLit * (0.66 + 0.34 * prox);
  vec3 c = mix(sh, lit, 0.72);
  outColor = vec4(c / 255.0 * al, al);
}`;

const LAKE_FS = COMMON + `
uniform sampler2D uFrame;
uniform float uIce, uTime, uLakeY;
uniform vec3 uSnowLit, uSnowSh;
void main() {
  vec2 p = dpos();
  if (p.y < uLakeY || p.y >= nearAt(p.x)) discard;
  if (uMask > 0.5) { outColor = vec4(1.0); return; }
  float row = floor(p.y - uLakeY);
  float jit = (floor(hash(vec2(row, 7.0 + floor(uTime * 2.0))) * 13.0) - 6.0) * (1.0 + row / 50.0);
  float sy = uLakeY - (p.y - uLakeY) * 2.0 - 2.0;
  vec3 still = texture(uFrame, vec2(p.x / 5120.0, 1.0 - sy / 2160.0)).rgb * 255.0;
  vec3 src = texture(uFrame, vec2((p.x - jit) / 5120.0, 1.0 - sy / 2160.0)).rgb * 255.0;
  vec3 water = (src * 0.76 + uDark * 0.08) * (1.0 + (hash(vec2(row, 3.0)) - 0.5) * 0.1);
  vec3 ice = (uSnowSh * 0.5 + uSnowLit * 0.5);
  vec3 frozen = (still * 0.76 + uDark * 0.08) * 0.42 + ice * 0.58 * (0.9 + 0.2 * vnoise(p / vec2(400.0, 30.0)));
  outColor = vec4(mix(water, frozen, uIce) / 255.0, 1.0);
}`;

const MEADOW_FS = COMMON + `
uniform vec3 uGround, uSnowLit, uSnowSh;
uniform float uL, uGS;
void main() {
  vec2 p = dpos();
  float ny = nearAt(p.x);
  if (p.y < ny) discard;
  if (uMask > 0.5) { outColor = vec4(1.0); return; }
  vec3 s = sil(p.x);
  float gn = vnoise(p / vec2(260.0, 70.0));
  float kg = 0.1 + 0.3 * uL;
  vec3 green = s * (1.0 - kg) + uGround * kg * (0.62 + 0.5 * gn);
  float ks = 0.5 + 0.26 * uL;
  vec3 snowy = s * (1.0 - ks) + (uSnowSh * (0.7 - 0.25 * uL) + uSnowLit * (0.3 + 0.25 * uL)) * (ks + 0.1 * gn);
  vec3 c = mix(green, snowy, uGS);
  float fall = 0.3 * sm((p.y - ny) / 300.0);
  c = mix(c, uDark, fall);
  outColor = vec4(c / 255.0, 1.0);
}`;

const TRI_VS = `#version 300 es
in vec2 aPos; in vec4 aCol;
out vec4 vCol;
${DESIGN_TO_CLIP}
void main() { vCol = aCol; gl_Position = clipOf(aPos); }`;
const TRI_FS = `#version 300 es
precision highp float;
in vec4 vCol; out vec4 outColor; uniform float uMask;
void main() { outColor = uMask > 0.5 ? vec4(vCol.a) : vec4(vCol.rgb / 255.0 * vCol.a, vCol.a); }`;

// The motto: its lettering as a mask, and the soft versions of it the picture needs.
const INK_FS = `#version 300 es
precision highp float;
uniform sampler2D uImg; uniform vec2 uRes; out vec4 outColor;
void main() { vec3 c = texture(uImg, vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y)).rgb;
  float a = pow(clamp(max(c.r, max(c.g, c.b)) / (240.0 / 255.0), 0.0, 1.0), 0.78); outColor = vec4(a, 0.0, 0.0, 1.0); }`;
const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uRes, uSrcRes; out vec4 outColor;
void main() {
  vec2 base = (gl_FragCoord.xy - 0.5) * 4.0;
  float s = 0.0, hit = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) { float a = texture(uSrc, (base + vec2(float(i), float(j)) + 0.5) / uSrcRes).r; s += a; hit = max(hit, step(0.1, a)); }
  float a = s / 16.0;
  outColor = vec4(a, clamp(a * 6.0, 0.0, 1.0), clamp(a * 4.0, 0.0, 1.0), hit);
}`;
const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uRes, uDir; uniform vec4 uSigma; out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 acc = vec4(0.0), wsum = vec4(0.0);
  float maxS = max(max(uSigma.x, uSigma.y), max(uSigma.z, uSigma.w));
  int R = int(ceil(maxS * 2.6));
  for (int i = -80; i <= 80; i++) {
    if (i < -R || i > R) continue;
    float x = float(i);
    vec4 w = exp(-x * x / (2.0 * uSigma * uSigma + 1e-4));
    acc += texture(uSrc, uv + uDir * x / uRes) * w; wsum += w;
  }
  outColor = acc / wsum;
}`;
const COMPOSE_FS = COMMON + `
uniform sampler2D uScene, uInk, uInk4;
uniform float uHasInk, uVig;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 s = texture(uScene, uv).rgb * 255.0;
  if (uMask > 0.5) { outColor = vec4(s / 255.0, 1.0); return; }
  vec2 p = dpos();
  vec2 cn = vec2((p.x - 2560.0) / (5120.0 * 0.3), (p.y - 2160.0 * 0.42) / (2160.0 * 0.3));
  s *= 1.0 - 0.3 * uVig * exp(-dot(cn, cn));
  s += (hash(gl_FragCoord.xy * 0.731) - 0.5) * 3.8;
  s = clamp(s, 0.0, 255.0);
  if (uHasInk > 0.5) {
    float a = texture(uInk, uv).r;
    vec4 b = texture(uInk4, uv);
    s *= 1.0 - 0.35 * b.r;
    float G = clamp(b.g * 4.0, 0.0, 1.0);
    for (int i = 0; i < 2; i++) {
      vec3 l = s / 255.0; l = mix(l / 12.92, pow((l + 0.055) / 1.055, vec3(2.4)), step(0.03928, l));
      float lum = dot(l, vec3(0.2126, 0.7152, 0.0722));
      float q = min(1.0, pow(0.2 / (lum + 0.05), 1.0 / 2.2));
      s *= 1.0 - G * (1.0 - q);
    }
    s = mix(s, vec3(244.0, 241.0, 233.0), a);
  }
  outColor = vec4(s / 255.0, 1.0);
}`;


// 3.9: the city. Two paintings blended for the time of day, the grey-day painting's light laid over them for weather,
// windows that switch on one by one, and the sun, moon, stars and your constellations where the mask says there is sky.
const CITY_FS = COMMON + `
uniform sampler2D uFA, uFB, uFO, uCM, uStarL, uConL;
uniform float uMix, uOver, uRain, uMist, uNight, uLOn, uLGate, uMoonPhase, uAurora, uStarsVis, uTime;
uniform vec4 uSunB, uMoonB;
uniform vec3 uSunC;
vec3 soft(sampler2D t, vec2 q) { return textureLod(t, clamp(q, vec2(0.002), vec2(0.998)), 4.5).rgb; }
void main() {
  vec2 p = dpos();
  vec2 tu = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec3 m = texture(uCM, tu).rgb;
  if (uMask > 0.5) { outColor = vec4(vec3(1.0 - m.r), 1.0); return; }
  float sky = m.r, cloud = m.g;
  vec3 base = mix(texture(uFA, tu).rgb, texture(uFB, tu).rgb, uMix);
  vec3 was = mix(soft(uFA, tu), soft(uFB, tu), uMix);
  vec3 col = base;
  // Weather: the grey day's light and colour, from blurred copies, so no two paintings' edges ever double up.
  // Half from a wide average (so a dark tower beside bright sky throws no halo), half local (so small clouds grey too).
  if (uOver > 0.0) {
    vec3 wa = vec3(0.0), wo = vec3(0.0);
    for (int i = -2; i <= 2; i++) for (int j = -1; j <= 1; j++) {
      vec2 o = vec2(float(i) * 0.035, float(j) * 0.05);
      wa += mix(soft(uFA, tu + o), soft(uFB, tu + o), uMix); wo += soft(uFO, tu + o);
    }
    vec3 wide = clamp(wo / max(wa, vec3(0.03)), 0.35, 1.8);
    vec3 near = clamp(soft(uFO, tu) / max(was, vec3(0.03)), 0.4, 2.2);
    vec3 g = sqrt(wide * near);
    vec3 b2 = mix(base, vec3(dot(base, vec3(0.3, 0.55, 0.15))), 0.22 * uOver);
    col = mix(base, b2 * g, uOver);
  }
  // Window lights: each window has its own time to switch on through dusk; some go out late at night.
  float L = m.b * uLGate;
  if (L > 0.002) {
    vec2 wc = floor(p / vec2(17.5, 23.3));
    float th = 0.03 + 0.94 * hash(wc + 91.7);
    float on = smoothstep(th - 0.03, th + 0.03, uLOn);
    vec3 wall = mix(was, soft(uFO, tu), uOver) * vec3(0.82, 0.84, 0.90);
    float lift = clamp(dot(col - wall, vec3(0.3, 0.5, 0.2)) / 0.10, 0.0, 1.0);
    col = mix(col, min(col, wall), L * lift * (1.0 - on));
    col += vec3(1.0, 0.70, 0.36) * L * on * (0.06 + 0.06 * hash(wc + 5.3));
  }
  // Rain: cooler, flatter light and a band of haze along the horizon. Mist: just the haze.
  float wet = max(uRain, 0.0);
  if (wet > 0.0) {
    vec3 grey = vec3(dot(col, vec3(0.3, 0.55, 0.15)));
    col = mix(col, mix(grey, col, 0.5) * vec3(0.93, 0.97, 1.05), 0.6 * wet);
    col *= 1.0 - 0.12 * wet;
  }
  float hz = exp(-pow((tu.y - 0.64) / 0.10, 2.0));
  col = mix(col, vec3(0.50, 0.54, 0.60) * (0.30 + 0.70 * (1.0 - uNight)), hz * (0.30 * wet + 0.35 * uMist));
  float behind = sky * (1.0 - 0.92 * cloud) * (1.0 - uRain);   // how much of something in the sky shows through here
  // Stars: only in open sky. Your constellations: through thin cloud too, quieter.
  vec2 fu = gl_FragCoord.xy / uRes;
  col += texture(uStarL, fu).rgb * sky * smoothstep(0.30, 0.04, cloud) * (1.0 - uOver) * (1.0 - uRain);
  col += texture(uConL, fu).rgb * sky * (1.0 - 0.6 * cloud) * (1.0 - 0.7 * uRain);
  // The aurora (3.7), low over the hills behind the clouds.
  if (uAurora > 0.0 && uStarsVis > 0.12) {
    float lower = 1060.0 + 260.0 * (vnoise(vec2(p.x / 1100.0 + uTime * 0.008, 1.7)) - 0.5) + 110.0 * (vnoise(vec2(p.x / 280.0 - uTime * 0.02, 5.3)) - 0.5);
    float v = smoothstep(lower + 60.0, lower - 40.0, p.y) * exp(-max(0.0, lower - p.y) / 260.0);
    float curtain = smoothstep(0.32, 0.85, vnoise(vec2(p.x / 300.0 + uTime * 0.02, 4.1)) * 0.65 + vnoise(vec2(p.x / 90.0 - uTime * 0.05, 9.3)) * 0.35);
    float rays = 0.55 + 0.45 * vnoise(vec2(p.x / 14.0 + uTime * 0.25, 2.3));
    float a = uAurora * curtain * rays * v * min(1.0, uStarsVis * 1.5) * sky * (1.0 - 0.8 * cloud) * 0.6;
    vec3 ac = mix(vec3(0.38, 0.94, 0.66), vec3(0.61, 0.41, 0.96), smoothstep(lower - 90.0, lower - 480.0, p.y));
    col += ac * a * (1.0 - col);
  }
  // The sun: a solid disc with a soft bloom and a wide glow, hidden by the buildings and hills, dimmed by cloud.
  vec2 d = p - uSunB.xy; float r = length(d), R = uSunB.z;
  float sv = uSunB.w;
  if (sv > 0.0) {
    float disc = smoothstep(R, R * 0.82, r);
    float glow = exp(-r * r / (R * R * 14.0)) * 0.30 + exp(-r / (R * 7.0)) * 0.10;
    col += uSunC * sv * glow * (0.35 + 0.65 * sky) * (1.0 - 0.5 * cloud) * 1.4 * (1.0 - 0.8 * uRain);
    col = mix(col, min(uSunC * 1.12, vec3(1.0)), clamp(disc * behind * sv, 0.0, 1.0));
    col += uSunC * sv * exp(-max(r - R, 0.0) / (R * 0.6)) * 0.25 * behind;
  }
  // The moon, in its real phase: lit on the right while it waxes, on the left as it wanes.
  if (uMoonB.w > 0.0) {
    vec2 q = p - uMoonB.xy; float rm = length(q), Rm = uMoonB.z;
    float md = smoothstep(Rm, Rm * 0.9, rm);
    vec2 n = q / Rm;
    float edge = sqrt(max(0.0, 1.0 - n.y * n.y)), th = 6.2831853 * uMoonPhase;
    float lit = uMoonPhase < 0.5 ? smoothstep(-0.04, 0.04, n.x - cos(th) * edge) : smoothstep(-0.04, 0.04, -cos(th) * edge - n.x);
    float full = (1.0 - cos(th)) * 0.5;
    float halo = exp(-rm / (Rm * 5.0)) * 0.22 * (0.3 + 0.7 * full);
    col += vec3(0.93, 0.95, 1.0) * uMoonB.w * (md * (0.1 + 0.9 * lit) * behind + halo * sky * (1.0 - 0.6 * cloud) * (1.0 - uRain)) * (1.0 - 0.85 * uOver);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ---------------------------------------------------------------------------------------------------------------------
const CONIFERS = new Set(["spruce", "fir", "pine"]);
const STAR_COLORS = ["#8fb4ff", "#8fe0b0", "#f0b75a", "#c9a8ff", "#ff9fb0", "#9fd8ff", "#b8c4e8"];
const hexRGB = (h: string): RGB => { const s = h.replace("#", ""); const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 200) as RGB; };
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class ValleyRenderer {
  gl: GL; W: number; H: number;
  private progs: Record<string, Prog>;
  private tex: Record<string, WebGLTexture>;
  private A!: Target; private B!: Target; private OUT!: Target; private INK!: Target; private INK4!: Target; private INK4b!: Target;
  private float: boolean;

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas, public assets: ValleyAssets, width = DESIGN_W, height = DESIGN_H) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false, alpha: false }) as GL | null;
    if (!gl) throw new Error("This computer can't draw the valley (no WebGL 2).");
    this.gl = gl;
    this.float = !!gl.getExtension("EXT_color_buffer_float");
    this.W = width; this.H = height;
    canvas.width = width; canvas.height = height;
    this.progs = {
      sky: program(gl, FULL_VS, SKY_FS), land: program(gl, FULL_VS, LAND_FS), fog: program(gl, FULL_VS, FOG_FS),
      lake: program(gl, FULL_VS, LAKE_FS), meadow: program(gl, FULL_VS, MEADOW_FS), compose: program(gl, FULL_VS, COMPOSE_FS),
      ink: program(gl, FULL_VS, INK_FS), down: program(gl, FULL_VS, DOWN_FS), blur: program(gl, FULL_VS, BLUR_FS),
      seg: program(gl, SEG_VS, SEG_FS), dot: program(gl, DOT_VS, DOT_FS), tree: program(gl, TREE_VS, TREE_FS), tri: program(gl, TRI_VS, TRI_FS),
      city: program(gl, FULL_VS, CITY_FS),
    };
    const d = assets.data;
    const nearData = new Float32Array(5120);
    for (let i = 0; i < 5120; i++) nearData[i] = d.near[Math.min(d.near.length - 1, i)];
    this.tex = {
      a: imageTexture(gl, assets.a, { filter: gl.NEAREST }), b: imageTexture(gl, assets.b, { filter: gl.NEAREST }),
      atlas: imageTexture(gl, assets.trees, { mip: true }),
      near: texture(gl, 5120, 1, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST, data: nearData }),
      grad: texture(gl, 1, 256), haze: texture(gl, 1024, 1),
    };
    this.allocate();
  }

  private allocate() {
    const gl = this.gl, W = this.W, H = this.H;
    this.A = target(gl, W, H, this.float); this.B = target(gl, W, H, this.float); this.OUT = target(gl, W, H, false);
    this.INK = target(gl, W, H, false);
    const w4 = Math.ceil(W / 4), h4 = Math.ceil(H / 4);
    this.INK4 = target(gl, w4, h4, false); this.INK4b = target(gl, w4, h4, false);
  }

  private full(p: Prog, dest: Target | null, setup: () => void, blend: "none" | "over" = "none") {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fb : null);
    gl.viewport(0, 0, dest ? dest.w : this.W, dest ? dest.h : this.H);
    gl.useProgram(p.p);
    gl.uniform2f(p.u("uRes"), dest ? dest.w : this.W, dest ? dest.h : this.H);
    if (blend === "over") { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    setup();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  private bind(p: Prog, name: string, tex: WebGLTexture, unit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(p.u(name), unit);
  }
  private common(p: Prog, sc: Scene, mask: boolean) {
    const gl = this.gl;
    gl.uniform1f(p.u("uMask"), mask ? 1 : 0);
    gl.uniform3fv(p.u("uDark"), sc.dark);
    this.bind(p, "uHaze", this.tex.haze, 0);
    this.bind(p, "uNear", this.tex.near, 1);
  }

  private fgCache: { key: string; tris: number[]; shore: number[]; corners: number[]; fg: number[]; fd: number[] } | null = null;
  private forestCache: { key: string; data: number[] } | null = null;
  private inkCache: { img: ImageBitmap | null | undefined; out: ReturnType<ValleyRenderer["inkPass"]> } | null = null;
  /** The motto's ink, worked out once per motto (the live wallpaper draws many frames of the same one). */
  private inkFor(img: ImageBitmap | null | undefined) {
    if (this.inkCache && this.inkCache.img === img) return this.inkCache.out;
    const out = this.inkPass(img);
    this.inkCache = { img, out };
    return out;
  }
  /** The motto's lettering: a crisp mask, a quarter-size soft copy, its bounding box and where it's clear of words. */
  private inkPass(img: ImageBitmap | null | undefined) {
    const gl = this.gl;
    if (!img) {
      for (const t of [this.INK, this.INK4, this.INK4b]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      return { box: null as [number, number, number, number] | null, grid: null as null | { w: number; h: number; d: Uint8Array } };
    }
    const src = imageTexture(gl, img);
    this.full(this.progs.ink, this.INK, () => { this.bind(this.progs.ink, "uImg", src, 0); });
    gl.deleteTexture(src);
    this.full(this.progs.down, this.INK4, () => { this.bind(this.progs.down, "uSrc", this.INK.tex, 0); gl.uniform2f(this.progs.down.u("uSrcRes"), this.W, this.H); });
    const w4 = this.INK4.w, h4 = this.INK4.h;
    const px = new Uint8Array(w4 * h4 * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.INK4.fb);
    gl.readPixels(0, 0, w4, h4, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    const grid = new Uint8Array(w4 * h4);
    for (let j = 0; j < h4; j++) for (let i = 0; i < w4; i++) {
      const v = px[(j * w4 + i) * 4 + 3];
      const row = h4 - 1 - j;                       // GL rows run bottom-up
      grid[row * w4 + i] = v;
      if (v > 0) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, row); y1 = Math.max(y1, row); }
    }
    const sx = DESIGN_W / w4, sy = DESIGN_H / h4;
    const box: [number, number, number, number] | null = x1 >= 0 ? [x0 * sx, y0 * sy, (x1 + 1) * sx, (y1 + 1) * sy] : null;
    // Soft copies: shadow under the letters (9), the contrast guard (28), clearing stars (46), keeping constellations quieter (70).
    const k = this.W / DESIGN_W / 4;
    const sig = [9 * k, 28 * k, 46 * k, 70 * k];
    const blur = this.progs.blur;
    this.full(blur, this.INK4b, () => { this.bind(blur, "uSrc", this.INK4.tex, 0); gl.uniform2f(blur.u("uDir"), 1, 0); gl.uniform4fv(blur.u("uSigma"), sig); });
    this.full(blur, this.INK4, () => { this.bind(blur, "uSrc", this.INK4b.tex, 0); gl.uniform2f(blur.u("uDir"), 0, 1); gl.uniform4fv(blur.u("uSigma"), sig); });
    return { box, grid: { w: w4, h: h4, d: grid } };
  }

  /** A path for the shooting star: high in the sky, clear of the words and the sun. */
  private meteorPath(sc: Scene, grid: { w: number; h: number; d: Uint8Array } | null, skyOk?: ((x: number, y: number) => boolean) | null): [number, number, number, number] | null {
    const ok = (x: number, y: number) => {
      if (Math.hypot(x - sc.sunX, y - sc.sunY) < 220) return false;
      if (skyOk && !skyOk(x, y)) return false;
      if (!grid) return true;
      const i = Math.floor(x / DESIGN_W * grid.w), j = Math.floor(y / DESIGN_H * grid.h);
      for (let dj = -10; dj <= 10; dj += 2) for (let di = -10; di <= 10; di += 2) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < grid.w && jj < grid.h && grid.d[jj * grid.w + ii]) return false; }
      return true;
    };
    for (const [x0, y0] of [[3900, 120], [1700, 110], [4500, 260], [900, 240], [2800, 90], [600, 520], [4700, 560]] as [number, number][]) {
      const x1 = x0 - 560, y1 = y0 + 210;
      let clear = true;
      for (let u = 0; u <= 1; u += .1) if (!ok(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u)) { clear = false; break; }
      if (clear) return [x0, y0, x1, y1];
    }
    return null;
  }

  /** Your projects as constellations, placed where the sky is clear of the words and the sun. */
  placeConstellations(projects: SkyProject[], sc: Scene, grid: { w: number; h: number; d: Uint8Array } | null, skyOk?: ((x: number, y: number) => boolean) | null) {
    const out: { pts: [number, number][]; links: [number, number][]; lit: boolean[]; r: number[]; color: RGB }[] = [];
    // The words, grown by about 50 design units, so no star or line comes close to a letter.
    let grown: Uint8Array | null = null;
    if (grid) {
      const R = Math.ceil(50 / (DESIGN_W / grid.w)), w = grid.w, h = grid.h, tmp = new Uint8Array(w * h);
      grown = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) { let run = -1e9; for (let i = 0; i < w; i++) { if (grid.d[j * w + i]) run = i; if (i - run <= R) tmp[j * w + i] = 1; } run = 1e9; for (let i = w - 1; i >= 0; i--) { if (grid.d[j * w + i]) run = i; if (run - i <= R) tmp[j * w + i] = 1; } }
      for (let i = 0; i < w; i++) { let run = -1e9; for (let j = 0; j < h; j++) { if (tmp[j * w + i]) run = j; if (j - run <= R) grown[j * w + i] = 1; } run = 1e9; for (let j = h - 1; j >= 0; j--) { if (tmp[j * w + i]) run = j; if (run - j <= R) grown[j * w + i] = 1; } }
    }
    const inkAt = (x: number, y: number) => {
      if (!grid || !grown) return 0;
      const i = Math.floor(x / DESIGN_W * grid.w), j = Math.floor(y / DESIGN_H * grid.h);
      return i >= 0 && j >= 0 && i < grid.w && j < grid.h ? grown[j * grid.w + i] : 0;
    };
    const clear = (x: number, y: number) => {
      if (skyOk) { if (!(x > 120 && x < 5000 && y > 110) || !skyOk(x, y)) return false; }
      else if (!(x > 120 && x < 5000 && y > 110 && y < ((x < 840 || x > 4280) ? 980 : 1470))) return false;
      if (Math.hypot(x - sc.sunX, y - sc.sunY) < 190) return false;
      return inkAt(x, y) === 0;
    };
    const r5 = rng(5);
    const centres: [number, number][] = [];
    projects.slice(0, 7).forEach((pr, ci) => {
      const n = Math.max(2, Math.min(14, pr.steps.length));
      const shape = shapeOf(pr.seed || pr.id, n);
      const S = 175;
      for (let tries = 0; tries < 500; tries++) {
        const cx = 240 + r5() * 4640, cy = 200 + r5() * 1100;
        if (!centres.every(([x, y]) => Math.hypot(cx - x, (cy - y) * 1.5) > 820)) continue;
        const mx = shape.pts.reduce((a, p) => a + p.x, 0) / n, my = shape.pts.reduce((a, p) => a + p.y, 0) / n;
        const pts = shape.pts.map((p) => [cx + (p.x - mx) * S, cy + (p.y - my) * S] as [number, number]);
        if (!pts.every(([x, y]) => clear(x, y))) continue;
        // The lines between the stars stay clear too.
        if (!shape.links.every(([i, j]) => { for (let u = 0.1; u < 1; u += 0.1) if (!clear(pts[i][0] + (pts[j][0] - pts[i][0]) * u, pts[i][1] + (pts[j][1] - pts[i][1]) * u)) return false; return true; })) continue;
        centres.push([cx, cy]);
        out.push({ pts, links: shape.links, lit: pr.steps.slice(0, n).map((s) => s.lit), r: pr.steps.slice(0, n).map((s) => 6 + Math.min(4, (s.min || 20) / 30)), color: hexRGB(pr.color || STAR_COLORS[ci % STAR_COLORS.length]) });
        break;
      }
    });
    return out;
  }

  render(o: RenderOpts): RenderInfo {
    const t0 = performance.now();
    const gl = this.gl, P = this.progs, d = this.assets.data, mask = !!o.mask, time = o.time || 0, wind = o.wind ?? 0;
    const ink = this.inkFor(mask ? null : o.motto);
    const sc = sceneAt({ when: o.when, weather: o.weather, width: this.W, height: this.H, box: ink.box });
    const city = o.city || null, plan = city?.plan || null;
    const cityTex = city ? this.cityTextures(city) : null;
    const skyOk = city ? this.skyTest(city) : null;
    if (plan) { sc.sunX = plan.sun.x; sc.sunY = plan.sun.strength > 0 ? plan.sun.y : -9999; }
    const se = sc.season, L = sc.light, gs = se.groundSnow, winter = gs > 0.5;
    const pxD = DESIGN_W / this.W;                // design units per pixel

    // Per-moment lookup textures: the sky column and the air at the horizon.
    const g8 = new Uint8Array(256 * 4), h8 = new Uint8Array(1024 * 4);
    for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) g8[i * 4 + c] = Math.round(sc.gradient[i * 3 + c]);
    for (let i = 0; i < 1024; i++) for (let c = 0; c < 3; c++) h8[i * 4 + c] = Math.round(sc.haze[i * 3 + c]);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.grad); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, g8);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.haze); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, h8);

    // 1. Sky, sun or moon (the city's are in its paintings and its own pass).
    if (!plan) this.full(P.sky, this.A, () => {
      const p = P.sky; this.common(p, sc, mask); this.bind(p, "uGrad", this.tex.grad, 2);
      gl.uniform3fv(p.u("uGlowC0"), sc.glows[0].color); gl.uniform3f(p.u("uGlow0"), sc.glows[0].amount, sc.glows[0].sx, sc.glows[0].sy);
      gl.uniform3fv(p.u("uGlowC1"), sc.glows[1].color); gl.uniform3f(p.u("uGlow1"), sc.glows[1].amount, sc.glows[1].sx, sc.glows[1].sy);
      gl.uniform1f(p.u("uGlowX"), sc.glowX); gl.uniform1f(p.u("uGrey"), sc.grey); gl.uniform1f(p.u("uDim"), sc.wet ? 0.5 : sc.weather === "cloudy" ? 0.75 : 1);
      gl.uniform1f(p.u("uMoonPhase"), sc.moon); gl.uniform1f(p.u("uUp"), sc.up ? 1 : 0);
      gl.uniform4f(p.u("uSun"), sc.sunX, sc.sunY, sc.up ? 30 : 26, 0); gl.uniform3fv(p.u("uSunC"), sc.sun);
      gl.uniform1f(p.u("uAurora"), mask ? 0 : o.events?.aurora || 0); gl.uniform1f(p.u("uTime"), time); gl.uniform1f(p.u("uStarsVis"), sc.stars);
    });

    // 2. Stars and your constellations, added as light.
    const dots: number[] = [], segs: number[] = [], starDots: number[] = [];
    const rs = rng(11);
    const nStars = Math.round(980 * sc.stars);
    for (let i = 0; i < 980; i++) {
      const x = rs() * 5120, y = Math.pow(rs(), 1.4) * 1778 * 0.92, r = [1.1, 1.3, 1.6, 2.1, 2.8][Math.floor(rs() * 5)], b = (90 + rs() * 150) * Math.min(1, 0.45 + sc.stars);
      const tw = 0.82 + 0.18 * Math.sin(time * (1.3 + (i % 7) * 0.31) + i);
      if (i < nStars) starDots.push(x, y, r, r, b * tw, b * tw, Math.min(255, b * 1.1) * tw, 1, 0, 0, 0, 0);
    }
    const cons = this.placeConstellations(o.projects || [], sc, ink.grid, skyOk);
    const vis = Math.max(0.35, Math.min(1, sc.stars * 1.4 + 0.35));   // constellations stay visible by day, quieter
    for (const c of cons) {
      for (const [a, b] of c.links) {
        const [x0, y0] = c.pts[a], [x1, y1] = c.pts[b];
        const lit = c.lit[a] && c.lit[b];
        if (lit) segs.push(x0, y0, x1, y1, c.color[0] * .66, c.color[1] * .66, c.color[2] * .66, vis, 3, 0.08, 0, 0, 0, 0, 0, 0);
        else {
          const L_ = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(2, Math.floor(L_ / 22));
          for (let s = 0; s < steps; s += 2) {
            const u0 = s / steps, u1 = (s + 1) / steps;
            segs.push(x0 + (x1 - x0) * u0, y0 + (y1 - y0) * u0, x0 + (x1 - x0) * u1, y0 + (y1 - y0) * u1, c.color[0] * .36, c.color[1] * .36, c.color[2] * .36, vis, 2, 0, 0, 0, 0, 0, 0, 0);
          }
        }
      }
      c.pts.forEach(([x, y], i) => {
        if (c.lit[i]) dots.push(x, y, c.r[i], c.r[i], c.color[0] * .5 + 140, c.color[1] * .5 + 140, c.color[2] * .5 + 140, vis, 0, 0, 0.12, 0);
        else dots.push(x, y, 5, 5, c.color[0] * .6, c.color[1] * .6, c.color[2] * .6, vis, 0, 2, 0, 0);
      });
    }
    const age = o.events?.meteorAge;
    if (age !== null && age !== undefined && age >= 0 && age < 3 * 3600) {
      const path = this.meteorPath(sc, ink.grid, skyOk);
      if (path) {
        // Still picture: the streak as it passes. Moving wallpaper: it crosses again every 90 seconds for the first hour.
        const live = !!o.time, cyc = 90, t = live ? ((time % cyc) / 1.1) : 0.75;
        if (!live || (age < 3600 && t <= 1.4)) {
          const head = Math.min(1, t), [x0, y0, x1, y1] = path;
          const hx = x0 + (x1 - x0) * head, hy = y0 + (y1 - y0) * head, fade = live ? Math.max(0, 1 - Math.max(0, t - 1) / .4) : 1;
          for (let k = 0; k < 14; k++) {
            const u0 = Math.max(0, head - .5 * (k + 1) / 14), u1 = Math.max(0, head - .5 * k / 14);
            const a = (1 - k / 14) * .9 * fade * Math.max(.4, Math.min(1, sc.stars * 1.5 + .4));
            segs.push(x0 + (x1 - x0) * u0, y0 + (y1 - y0) * u0, x0 + (x1 - x0) * u1, y0 + (y1 - y0) * u1, 255, 246, 220, a, 3.2 - 2 * k / 14, k < 3 ? .12 : 0, 0, 0, 0, 0, 0, 0);
          }
          dots.push(hx, hy, 3.6, 3.6, 255, 250, 232, .95 * fade, 0, 0, .12, 0);
        }
      }
    }
    if (plan && cityTex) {
      // The city: stars and constellations go on layers of their own, which its pass lets through only where there is sky.
      for (const t of [this.B, this.OUT]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, this.W, this.H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
      if (!mask) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.B.fb); this.drawDots(starDots, sc, true, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.OUT.fb); this.drawSegs(segs, sc, true, time, 0, 0.4); this.drawDots(dots, sc, true, 1);
      }
      const at = (n: string, or?: string) => cityTex[`${plan.season}-${n}`] || (or ? cityTex[`${plan.season}-${or}`] : undefined);
      const fa = at(plan.a), fb = at(plan.b, plan.a), fo = at("overcast", plan.a), cm = cityTex[`${plan.season}-mask`];
      if (!fa || !fb || !fo || !cm) throw new Error(`The city kit is missing a painting for ${plan.season} ${plan.a}.`);
      this.full(P.city, this.A, () => {
        const p = P.city; this.common(p, sc, mask);
        this.bind(p, "uFA", fa, 2); this.bind(p, "uFB", fb, 3); this.bind(p, "uFO", fo, 4); this.bind(p, "uCM", cm, 5);
        this.bind(p, "uStarL", this.B.tex, 6); this.bind(p, "uConL", this.OUT.tex, 7);
        gl.uniform1f(p.u("uMix"), plan.k); gl.uniform1f(p.u("uOver"), plan.over); gl.uniform1f(p.u("uRain"), plan.rain); gl.uniform1f(p.u("uMist"), plan.mist);
        gl.uniform1f(p.u("uNight"), plan.night); gl.uniform1f(p.u("uLOn"), plan.lights.on); gl.uniform1f(p.u("uLGate"), plan.lights.gate);
        gl.uniform1f(p.u("uMoonPhase"), plan.moon.phase); gl.uniform1f(p.u("uAurora"), mask ? 0 : o.events?.aurora || 0);
        gl.uniform1f(p.u("uStarsVis"), sc.stars); gl.uniform1f(p.u("uTime"), time);
        gl.uniform4f(p.u("uSunB"), plan.sun.x, plan.sun.y, plan.sun.r, plan.sun.strength * (1 - .85 * plan.over));
        gl.uniform3f(p.u("uSunC"), plan.sun.color[0] / 255, plan.sun.color[1] / 255, plan.sun.color[2] / 255);
        gl.uniform4f(p.u("uMoonB"), plan.moon.x, plan.moon.y, plan.moon.r, plan.moon.strength);
      });
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.A.fb); gl.viewport(0, 0, this.W, this.H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
      if (!mask) {
        this.drawSegs(segs, sc, true, time, 0, 0.4);
        this.drawDots(starDots.concat(dots), sc, true, 1);
      }
    }

    if (!plan) {
    // 3. The land.
    const landP = P.land;
    this.full(landP, this.A, () => {
      this.common(landP, sc, mask); this.bind(landP, "uA", this.tex.a, 2); this.bind(landP, "uB", this.tex.b, 3);
      gl.uniform1f(landP.u("uK"), d.land.k); gl.uniform1f(landP.u("uTW"), d.land.w); gl.uniform1f(landP.u("uHS"), d.land.heightScale);
      gl.uniform1f(landP.u("uYS"), d.land.topScale); gl.uniform1f(landP.u("uZD"), d.land.zDepth); gl.uniform1f(landP.u("uTop"), d.land.top);
      gl.uniform3fv(landP.u("uLd"), sc.lightDir); gl.uniform3fv(landP.u("uSunC"), sc.sun); gl.uniform3fv(landP.u("uSnowLit"), sc.snowLit); gl.uniform3fv(landP.u("uSnowSh"), sc.snowShade);
      gl.uniform3fv(landP.u("uCon"), se.conifer); gl.uniform3fv(landP.u("uLeaves"), se.forestLeaves.flat());
      gl.uniform1f(landP.u("uL"), L); gl.uniform1f(landP.u("uLeafMix"), 0.35 + 0.25 * se.autumnish); gl.uniform1f(landP.u("uGS"), gs); gl.uniform1f(landP.u("uSnowAlt"), se.snowAlt);
    }, "over");

    // 4. The forests on the hills, far to near.
    const flip = sc.lightX < 0;
    const fk = `${sc.when.toDateString()}|${Math.floor(sc.minute / 5)}|${sc.weather}`;
    const forest = this.forestCache?.key === fk ? this.forestCache.data : this.treeInstances(d.forest, sc, winter);
    this.forestCache = { key: fk, data: forest };
    this.drawTrees(forest, sc, mask, flip, time, wind * 0.4);

    // 5. Mist lying in the valley.
    if (sc.weather === "mist" || sc.wet) {
      const rf = rng(51), regions: number[] = [];
      for (let i = 0; i < 8; i++) regions.push(rf() * 5120, 1830 + rf() * 60, 520 + rf() * 380, 70 + rf() * 40);
      this.full(P.fog, this.A, () => {
        const p = P.fog; this.common(p, sc, mask);
        gl.uniform4fv(p.u("uFog"), regions); gl.uniform3fv(p.u("uClLit"), sc.cloudLit.map((v) => v * (sc.wet ? .7 : 1))); gl.uniform3fv(p.u("uClSh"), sc.cloudShade);
        gl.uniform2f(p.u("uLight"), sc.up ? sc.sunX : sc.glowX, sc.up ? sc.sunY : 1778); gl.uniform1f(p.u("uTime"), time);
      }, "over");
    }

    // 6. The lake: everything above it, upside down; frozen in deep winter.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.A.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.B.fb);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    this.full(P.lake, this.A, () => {
      const p = P.lake; this.common(p, sc, mask); this.bind(p, "uFrame", this.B.tex, 2);
      gl.uniform1f(p.u("uIce"), Math.max(0, Math.min(1, (gs - 0.35) / 0.4))); gl.uniform1f(p.u("uTime"), time); gl.uniform1f(p.u("uLakeY"), d.lakeY);
      gl.uniform3fv(p.u("uSnowLit"), sc.snowLit); gl.uniform3fv(p.u("uSnowSh"), sc.snowShade);
    }, "none");

    // 7. The meadow.
    this.full(P.meadow, this.A, () => {
      const p = P.meadow; this.common(p, sc, mask);
      gl.uniform3fv(p.u("uGround"), se.ground); gl.uniform3fv(p.u("uSnowLit"), sc.snowLit); gl.uniform3fv(p.u("uSnowSh"), sc.snowShade);
      gl.uniform1f(p.u("uL"), L); gl.uniform1f(p.u("uGS"), gs);
    }, "over");

    // 8. Rocks, shrubs and trees on the near shore, then the dark corner firs.
    const fgKey = `${sc.when.toDateString()}|${Math.floor(sc.minute)}|${sc.weather}|${flip}`;
    const built = this.fgCache?.key === fgKey ? this.fgCache : null;
    const rg = rng(31);
    const nearAt = (x: number) => d.near[Math.max(0, Math.min(5119, Math.floor(x)))];
    const sideAt = (x: number) => d.side[Math.max(0, Math.min(5119, Math.floor(x)))];
    const meadowY = (x: number, t: number) => nearAt(x) + 8 + t * (2176 - nearAt(x));
    const hazeAt = (x: number): RGB => { const i = Math.max(0, Math.min(1023, Math.floor(x / 5120 * 1024))); return [sc.haze[i * 3], sc.haze[i * 3 + 1], sc.haze[i * 3 + 2]]; };
    const silAt = (x: number): RGB => { const h = hazeAt(x); return [h[0] * .09 + sc.dark[0] * .91, h[1] * .09 + sc.dark[1] * .91, h[2] * .09 + sc.dark[2] * .91]; };
    const tris: number[] = built ? built.tris : [];
    const litDir = sc.lightX >= 0 ? 1 : -1, vG = 0.12 + 0.42 * L;
    const rockc: RGB = [116, 112, 118];
    for (let n = 0; n < (built ? 0 : 34); n++) {
      const x = rg() * 5120, t = Math.pow(rg(), .7), yb = meadowY(x, t);
      if (yb > 2170) continue;
      const sz = (16 + rg() * 28) * (.55 + 1.3 * t), s_ = silAt(x);
      const base = s_.map((v, i) => v * (1 - vG) + rockc[i] * vG * .75) as RGB;
      const shd = base.map((v, i) => v * .62 + s_[i] * .2) as RGB;
      const lit = base.map((v, i) => Math.min(255, v + sc.sun[i] * .2 * L)) as RGB;
      const k = 6 + Math.floor(rg() * 3);
      const pts: [number, number][] = [];
      for (let j = 0; j < k; j++) pts.push([x + Math.cos(Math.PI * (1 - j / (k - 1))) * sz * (.85 + rg() * .25), yb - Math.sin(Math.PI * j / (k - 1)) * sz * (.5 + rg() * .3)]);
      const apex = pts.reduce((a, q) => (q[1] < a[1] ? q : a), pts[0]);
      fan(tris, [[x, yb], ...pts], base);
      const darkSide = pts.filter((q) => (q[0] - apex[0]) * litDir <= 0);
      if (darkSide.length >= 2) fan(tris, [[x - litDir * sz * .12, yb], ...darkSide], shd);
      const litSide = pts.filter((q) => (q[0] - apex[0]) * litDir >= 0).slice(0, 3);
      if (litSide.length >= 2) fan(tris, [[apex[0] + litDir * sz * .25, yb - sz * .22], ...litSide], lit);
      if (gs > 0.3) {
        const cap = pts.filter((q) => q[1] < yb - sz * .3);
        if (cap.length >= 2) fan(tris, [[x, yb - sz * .3], ...cap], sc.snowShade.map((v, i) => (v * .5 + sc.snowLit[i] * .5)) as RGB, Math.min(1, (gs - 0.3) / 0.4));
      }
    }
    this.drawTris(tris, mask);

    const shore = built ? built.shore : this.treeInstances(d.shore, sc, winter);
    this.drawTrees(shore, sc, mask, flip, time, wind);
    const corners = built ? built.corners : this.treeInstances(d.corners, sc, winter);
    this.drawTrees(corners, sc, mask, flip, time, wind * 0.5);

    // 9. Reeds, grass, flowers or fallen leaves or snow drifts.
    const gcol = (x: number, k: number, lift = 0): RGB => { const s_ = silAt(x); return s_.map((v, i) => Math.min(255, v * (1 - vG) + se.grass[i] * vG * k + sc.sun[i] * lift * L)) as RGB; };
    const fg: number[] = built ? built.fg : [], fd: number[] = built ? built.fd : [];
    const lakeCols: number[] = [];
    for (let x = 0; x < 5120; x += 4) if (nearAt(x) > d.lakeY + 30) lakeCols.push(x);
    if (lakeCols.length && !built) for (let n = 0; n < 46; n++) {
      const x = lakeCols[Math.floor(rg() * lakeCols.length)], yb = nearAt(x) + 3;
      for (let b = 0, m = 5 + Math.floor(rg() * 7); b < m; b++) {
        const xx = x + (rg() * 52 - 26), hh = 20 + rg() * 28, lean = rg() * .24 - .12, c = gcol(x, .6 + rg() * .4);
        if (gs > 0.6) continue;
        fg.push(xx, yb, xx + lean * hh, yb - hh, c[0], c[1], c[2], 1, 1.6, 0, 0, 1, 0, 1, rg() * 6.28, 1);
        if (rg() < .45) { const s_ = silAt(x); fd.push(xx + lean * hh, yb - hh - 3, 2.2, 6, ...s_.map((v, i) => v * (1 - vG) + [70, 52, 40][i] * vG * .8), 1, 0, 0, 0, 0); }
      }
    }
    const tufts: [number, number, number][] = [];
    if (!built) for (let n = 0; n < 5200; n++) { const x = rg() * 5120, t = Math.pow(rg(), .75); tufts.push([meadowY(x, t), x, t]); }
    tufts.sort((a, b) => a[0] - b[0]);
    for (const [yb, x, t] of tufts) {
      if (yb > 2200) continue;
      const hh = (9 + 50 * t) * (.7 + rg() * .55) * (winter ? .55 : 1);
      for (let b = 0, m = 3 + Math.floor(4 * t); b < m; b++) {
        const xx = x + (rg() * .8 - .4) * hh, lean = rg() * .7 - .35 + .1 * litDir, h2 = hh * (.55 + rg() * .5);
        const c = gcol(x, .74 + rg() * .4, rg() * .05), wdt = Math.max(pxD, hh * .05), ph = rg() * 6.28;
        const mx = xx + lean * h2 * .45, my = yb - h2 * .6, tx = xx + lean * h2, ty = yb - h2;
        fg.push(xx, yb, mx, my, c[0], c[1], c[2], 1, wdt, 0, 0, 1, 0, .6, ph, 1);
        fg.push(mx, my, tx, ty, c[0], c[1], c[2], 1, wdt, 0, 0, 1, .6, 1, ph, 1);
      }
    }
    const vf = .2 + .62 * L;
    const dot = (x: number, y: number, r: number, c: RGB) => { const s_ = silAt(x); fd.push(x, y, r, r * .8, ...s_.map((v, i) => v * (1 - vf) + c[i] * vf), 1, 0, 0, 0, 0); };
    if (se.flowers > 0.02 && !built) {
      for (let n = 0, m = Math.round(58 * se.flowers); n < m; n++) {
        const cx = rg() * 5120, ct = Math.pow(rg(), .7), c = se.flowerColors[Math.floor(rg() * se.flowerColors.length)];
        for (let f = 0, k = 14 + Math.floor(rg() * 26); f < k; f++) {
          const x = cx + gauss(rg) * (60 + 90 * ct), t = Math.max(0, Math.min(1, ct + gauss(rg) * .07)), y = meadowY(x, t) - (6 + 26 * t);
          if (x > 0 && x < 5120 && y < 2170) dot(x, y, 1.6 + 3.4 * t, c);
        }
      }
    }
    if (se.fallen > 0.02 && !built) {
      const cols: RGB[] = [[232, 178, 52], [206, 78, 40], [226, 122, 40], [150, 84, 42]];
      for (let n = 0, m = Math.round(1500 * se.fallen); n < m; n++) {
        const x = rg() * 5120, t = Math.pow(rg(), .7);
        if (rg() < .12 + .88 * sideAt(x)) dot(x, meadowY(x, t) - 1, 1.4 + 3.2 * t, cols[Math.floor(rg() * 4)]);
      }
    }
    if (gs > 0.05 && !built) {
      const sc_ = sc.snowShade.map((v, i) => v * .45 + sc.snowLit[i] * .55) as RGB;
      for (let n = 0; n < 240; n++) {
        const x = rg() * 5120, t = Math.pow(rg(), .7), yb = meadowY(x, t), r = (5 + 20 * t) * (.6 + rg() * .7);
        fd.push(x, yb, r * 9, r * .5, sc_[0], sc_[1], sc_[2], (90 + rg() * 110) / 255 * .6 * Math.min(1, gs / 0.6), 9, 0, 0, 1);
      }
    }
    if (!built) this.fgCache = { key: fgKey, tris, shore, corners, fg, fd };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.A.fb); gl.viewport(0, 0, this.W, this.H);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawSegs(fg, sc, false, time, wind, 0, mask);
    this.drawDots(fd, sc, false, 0, mask);

    }

    // 10. Rain or snow in the air, clearing round the words.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.A.fb); gl.viewport(0, 0, this.W, this.H);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (sc.wet) {
      const r6 = rng(16), pr: number[] = [], ps: number[] = [];
      const c = [214, 222, 238].map((v) => v * (.5 + .4 * L));
      const fallY = (time * (sc.weather === "rain" ? 900 : 90)) % 2160;
      if (sc.weather === "rain") for (let n = 0; n < 5200; n++) {
        const x = r6() * 5120, y = (r6() * 2160 + fallY) % 2160, len = 26 + r6() * 30, a = (60 + r6() * 70) / 255 * .5;
        pr.push(x, y, x - len * .22, y + len, c[0], c[1], c[2], a * sm01(distOut(x, y) / 300), 2, 0, 0, 0, 0, 0, 0, 0);
      } else for (let n = 0; n < 2100; n++) {
        const x = (r6() * 5120 + Math.sin(time * .7 + n) * 30) % 5120, y = (r6() * 2160 + fallY * (0.6 + (n % 5) * .1)) % 2160, r = 1.5 + Math.pow(r6(), 2) * 3.2, a = (120 + r6() * 135) / 255 * .8;
        ps.push(x, y, r, r, c[0], c[1], c[2], a * sm01(distOut(x, y) / 300), 1.2, 0, 0, 0);
      }
      this.drawSegs(pr, sc, false, time, 0, 0, mask);
      this.drawDots(ps, sc, false, 0, mask);
    }

    // 11. The motto on top: soft shadow, a guard so nothing bright sits behind the letters, then the lettering.
    this.full(P.compose, this.OUT, () => {
      const p = P.compose; this.common(p, sc, mask);
      this.bind(p, "uScene", this.A.tex, 2); this.bind(p, "uInk", this.INK.tex, 3); this.bind(p, "uInk4", this.INK4.tex, 4);
      gl.uniform1f(p.u("uHasInk"), o.motto && !mask ? 1 : 0);
      gl.uniform1f(p.u("uVig"), plan ? 0 : 1);       // the city's paintings bring their own light; no extra darkening in the middle
    });
    gl.finish();
    return { scene: sc, box: ink.box, constellations: cons.length, ms: performance.now() - t0 };
  }

  // ---------- 3.9: the city's paintings as textures ----------
  private cityCache = new Map<string, { img: ImageBitmap; tex: WebGLTexture }>();
  /** Textures for the paintings this moment needs (with mipmaps, for the soft copies the weather uses); others are let go. */
  private cityTextures(city: CityInput) {
    const gl = this.gl, out: Record<string, WebGLTexture> = {};
    for (const name of city.plan.files) {
      const img = city.images[name];
      if (!img) continue;
      let e = this.cityCache.get(name);
      if (!e || e.img !== img) {
        if (e) gl.deleteTexture(e.tex);
        e = { img, tex: imageTexture(gl, img, { mip: !name.endsWith("-mask") }) };
        this.cityCache.set(name, e);
      }
      out[name] = e.tex;
    }
    for (const [name, e] of this.cityCache) if (!city.plan.files.includes(name)) { gl.deleteTexture(e.tex); this.cityCache.delete(name); }
    return out;
  }
  private skyCache: { img: ImageBitmap; w: number; h: number; d: Uint8ClampedArray } | null = null;
  /** Whether a point (design units) is sky in the city, from the season's mask: where stars and constellations may go. */
  private skyTest(city: CityInput) {
    const img = city.images[`${city.plan.season}-mask`];
    if (!img) return () => false;
    if (!this.skyCache || this.skyCache.img !== img) {
      const w = 640, h = 270, c = new OffscreenCanvas(w, h), g = c.getContext("2d")!;
      g.drawImage(img, 0, 0, w, h);
      this.skyCache = { img, w, h, d: g.getImageData(0, 0, w, h).data };
    }
    const s = this.skyCache;
    return (x: number, y: number) => {
      const i = Math.floor(x / DESIGN_W * s.w), j = Math.floor(y / DESIGN_H * s.h);
      return i >= 0 && j >= 0 && i < s.w && j < s.h && s.d[(j * s.w + i) * 4] > 220;
    };
  }

  private treeInstances(list: number[][], sc: Scene, winter: boolean) {
    const d = this.assets.data, sp = d.atlas.sprites, se = sc.season, out: number[] = [];
    const con = se.conifer;
    for (const [x, base, h, air, kindI, seed, z] of list) {
      const kind = d.kinds[kindI];
      const r = hash01(seed), r2 = hash01(seed + 7);
      let fam = kind, color: RGB = con, wood: RGB = [74, 58, 52], hm = 1, snowy = 0, quiet = z === -1 ? .45 : 0;
      if (CONIFERS.has(kind)) {
        color = kind === "spruce" ? con : kind === "fir" ? mixRGB(con, [20, 52, 64], .35) : mixRGB(con, [70, 104, 62], .3);
        hm = kind === "spruce" ? 1 : kind === "fir" ? 1.15 : 1.05; snowy = se.groundSnow;
      } else if (kind === "shrub") {
        if (winter) { fam = "bare_shrub"; } else color = se.shrubColors[Math.floor(r2 * se.shrubColors.length)];
        wood = [70, 58, 56];
      } else {
        const st = leafState(kind, r, se.doy);
        if (kind === "birch") wood = [200, 200, 208];
        if (st.look === "bare") {
          if (z > .4) continue;                                     // far away, bare trees vanish into the hillside
          fam = kind === "larch" || kind === "aspen" || kind === "birch" || kind === "poplar" ? "bare_slim" : "bare_wide";
        } else {
          color = st.color;
          fam = kind === "larch" ? "larch" : st.look === "thin" ? `${kind}_thin` : kind;
          if (kind === "larch") hm = 1.05;
        }
      }
      const list_ = sp[fam] || sp.spruce;
      const rect = list_[Math.floor(hash01(seed + fam.length * 13) * list_.length)];
      out.push(x, base, h * hm, air, rect[0], rect[1], rect[2], rect[3], color[0], color[1], color[2], quiet, wood[0], wood[1], wood[2], snowy);
    }
    return out;
  }

  private drawTrees(data: number[], sc: Scene, mask: boolean, flip: boolean, time: number, wind: number) {
    if (!data.length) return;
    const gl = this.gl, p = this.progs.tree;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.A.fb); gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(p.p);
    gl.uniform2f(p.u("uRes"), this.W, this.H);
    this.common(p, sc, mask);
    this.bind(p, "uAtlasT", this.tex.atlas, 2);
    gl.uniform2f(p.u("uAtlas"), this.assets.data.atlas.w, this.assets.data.atlas.h);
    gl.uniform1f(p.u("uFlip"), flip ? 1 : 0); gl.uniform1f(p.u("uTime"), time); gl.uniform1f(p.u("uWind"), wind);
    gl.uniform1f(p.u("uL"), sc.light); gl.uniform3fv(p.u("uSunC"), sc.sun); gl.uniform3fv(p.u("uSnowLit"), sc.snowLit); gl.uniform3fv(p.u("uSnowSh"), sc.snowShade);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const inst = instances(gl, p, [["aTree", 4], ["aRect", 4], ["aCol", 4], ["aWood", 4]], new Float32Array(data));
    inst.draw(); inst.free();
  }

  private drawSegs(data: number[], sc: Scene, screen: boolean, time: number, wind: number, inkFade: number, mask = false) {
    if (!data.length) return;
    const gl = this.gl, p = this.progs.seg;
    gl.useProgram(p.p);
    gl.uniform2f(p.u("uRes"), this.W, this.H);
    this.common(p, sc, mask);
    this.bind(p, "uInk4", this.INK4.tex, 2);
    gl.uniform1f(p.u("uInkFade"), inkFade); gl.uniform1f(p.u("uScreen"), screen ? 1 : 0); gl.uniform1f(p.u("uPx"), DESIGN_W / this.W);
    gl.uniform1f(p.u("uTime"), time); gl.uniform1f(p.u("uWind"), wind * 9); gl.uniform1f(p.u("uClipNear"), 0);
    const inst = instances(gl, p, [["aSeg", 4], ["aCol", 4], ["aShape", 4], ["aSway", 4]], new Float32Array(data));
    inst.draw(); inst.free();
  }
  private drawDots(data: number[], sc: Scene, screen: boolean, inkFade: number, mask = false) {
    if (!data.length) return;
    const gl = this.gl, p = this.progs.dot;
    gl.useProgram(p.p);
    gl.uniform2f(p.u("uRes"), this.W, this.H);
    this.common(p, sc, mask);
    this.bind(p, "uInk4", this.INK4.tex, 2);
    gl.uniform1f(p.u("uInkFade"), inkFade); gl.uniform1f(p.u("uScreen"), screen ? 1 : 0); gl.uniform1f(p.u("uPx"), DESIGN_W / this.W);
    const inst = instances(gl, p, [["aDot", 4], ["aCol", 4], ["aShape", 4]], new Float32Array(data));
    inst.draw(); inst.free();
  }
  private drawTris(data: number[], mask: boolean) {
    if (!data.length) return;
    const gl = this.gl, p = this.progs.tri;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.A.fb); gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(p.p);
    gl.uniform1f(p.u("uMask"), mask ? 1 : 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const a = p.attr("aPos"), c = p.attr("aCol");
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c, 4, gl.FLOAT, false, 24, 8);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    gl.bindVertexArray(null); gl.deleteBuffer(buf); gl.deleteVertexArray(vao);
  }

  /** The finished picture, top row first, as RGBA bytes. */
  pixels(): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl, W = this.W, H = this.H;
    const px = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.OUT.fb);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out = new Uint8ClampedArray(new ArrayBuffer(W * H * 4)), row = W * 4;
    for (let y = 0; y < H; y++) out.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    return out;
  }
  /** Shows the finished picture on the canvas itself (for the live wallpaper and previews). */
  present() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.OUT.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  dispose() {
    const gl = this.gl;
    for (const t of Object.values(this.tex)) gl.deleteTexture(t);
    for (const e of this.cityCache.values()) gl.deleteTexture(e.tex);
    this.cityCache.clear();
    for (const t of [this.A, this.B, this.OUT, this.INK, this.INK4, this.INK4b]) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

function fan(out: number[], pts: [number, number][], c: RGB, a = 1) {
  for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) out.push(q[0], q[1], c[0], c[1], c[2], a);
}
function gauss(r: () => number) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const sm01 = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
function distOut(x: number, y: number) { return Math.hypot(Math.max(KEEP[0] - x, x - KEEP[2], 0), Math.max(KEEP[1] - y, y - KEEP[3], 0)); }
