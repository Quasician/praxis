# Bakes the parts of the valley that never change, for Praxis's in-app renderer:
#   valley-a.png  height field (16-bit) + snow and patch noise       2560 x Kt
#   valley-b.png  nearest-visible-top field (16-bit) + forest noise  2560 x Kt
#   trees.png     tree and shrub shapes (alpha, tone, wood, snow)    atlas
#   valley.json   tree positions, curves (shore line, sides, groves), atlas rects
import os, sys, json, math, random
os.environ["S"] = "1"
ARG_OUT = sys.argv[1] if len(sys.argv) > 1 else None
sys.argv = [sys.argv[0], "__none__"]          # scene10 renders previews for any names given; give it none
import numpy as np
from PIL import Image
import scene10 as V

OUT = ARG_OUT or os.environ.get("VALLEY_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public_static", "valley")
os.makedirs(OUT, exist_ok=True)

# ---------- the land: height field at half resolution (it's smooth; silhouettes are found per pixel in the shader)
Kt, Wt = V.K // 2, V.W // 2
HT = V.HT.reshape(Kt, 2, Wt, 2).mean(axis=(1, 3))
NS = V.N_SNOW.reshape(Kt, 2, Wt, 2).mean(axis=(1, 3))
NP = V.N_PATCH.reshape(Kt, 2, Wt, 2).mean(axis=(1, 3))
NF = V.N_FOR.reshape(Kt, 2, Wt, 2).mean(axis=(1, 3))
ZS = ((np.arange(Kt, dtype=np.float32) + .5) / Kt)[:, None]
BASE = 1900 - 112 * ZS ** .85
YTOP = BASE - HT
MVIS = np.minimum.accumulate(YTOP, axis=0)
def u16(v, scale):
    q = np.clip(np.round(v / scale * 65535), 0, 65535).astype(np.uint32)
    return (q >> 8).astype(np.uint8), (q & 255).astype(np.uint8)
HS, YS = 2000.0, 2400.0
h1, h0 = u16(HT, HS); m1, m0 = u16(MVIS, YS)
b8 = lambda a: np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
Image.fromarray(np.dstack([h1, h0, b8(NS), b8(NP)]), "RGBA").save(f"{OUT}/valley-a.png", optimize=True)
Image.fromarray(np.dstack([m1, m0, b8(NF), np.full_like(m1, 255)]), "RGBA").save(f"{OUT}/valley-b.png", optimize=True)
print("land", Kt, Wt, "top of land at y =", float(MVIS.min()))

# ---------- tree shapes: every sprite at 512 px tall, packed in rows
SH = 512; PAD = 6
families = {}
order = ["spruce", "fir", "pine", "larch", "oak", "maple", "aspen", "birch", "poplar",
         "oak_thin", "maple_thin", "aspen_thin", "birch_thin", "poplar_thin", "bare_wide", "bare_slim", "shrub", "bare_shrub"]
tiles = []
for fam in order:
    for spr in V.SPRITES[fam]:
        w = max(4, round(SH * spr["asp"]))
        ch = [np.asarray(Image.fromarray((np.clip(spr[k], 0, 1) * 255).astype(np.uint8)).resize((w, SH), Image.LANCZOS)) for k in ("A", "T", "Wd", "Sn")]
        tiles.append((fam, np.dstack(ch)))
AW = 4096; x = y = 0; rows_h = SH + 2 * PAD; placed = []
for fam, t in tiles:
    w = t.shape[1] + 2 * PAD
    if x + w > AW: x = 0; y += rows_h
    placed.append((fam, x + PAD, y + PAD, t)); x += w
AH = y + rows_h
atlas = np.zeros((AH, AW, 4), np.uint8)
for fam, px, py, t in placed:
    atlas[py:py + SH, px:px + t.shape[1]] = t
    families.setdefault(fam, []).append([px, py, int(t.shape[1]), SH])
Image.fromarray(atlas, "RGBA").save(f"{OUT}/trees.png", optimize=True)
print("atlas", AW, AH, sum(len(v) for v in families.values()), "sprites")

# ---------- where the trees stand (the same every day; how each one looks depends on the date)
CON = ("spruce", "fir", "pine")
KIND = {k: i for i, k in enumerate(["spruce", "fir", "pine", "larch", "oak", "maple", "aspen", "birch", "poplar", "shrub"])}
def keep_ok(x, base, h):
    return not ((x + .5 * h > V.KEEPD[0] - 12 and x - .5 * h < V.KEEPD[2] + 12) and base - h * 1.2 < V.KEEPD[3] + 8)
air_k = lambda k, i: float(np.clip(.03 + .62 * V.ZS[k, 0] ** 1.15 + .2 * V.sm((60 - V.HT[k, i]) / 60) * V.ZS[k, 0], 0, .82))
forest = []
rf = random.Random(77)
for k in range(V.K - 1, -1, -max(1, V.K // 80)):
    z = float(V.ZS[k, 0])
    if z > .72: continue
    hgt = 13 + 64 * (1 - z) ** 1.5; x = rf.uniform(0, hgt); vis_ = V.YTOP[k] <= V.MVIS[k] + .6
    while x < 5120:
        i = min(V.W - 1, int(x)); fm = float(V.FORESTM[k, i])
        if fm > .4 and vis_[i] and rf.random() < fm * .9:
            st = float(V.N_STAND[k, i])
            kind = rf.choice(["spruce", "spruce", "fir"]) if st < .56 else "aspen" if st < .68 else "larch" if st < .75 else rf.choice(["maple", "oak", "birch", "spruce"])
            h = hgt * rf.uniform(.7, 1.3); base = float(V.YTOP[k, i]) + 1.5
            if keep_ok(x, base, h):
                forest.append([round(x, 1), round(base, 1), round(h, 1), round(min(.8, air_k(k, i) + .12), 3), KIND[kind], rf.randrange(1 << 30), round(z, 3)])
        x += hgt * rf.uniform(.22, .6)
print("forest trees", len(forest))

shore = []
rt = random.Random(21); rg = random.Random(31)
grove, grove2 = V.noise1(900, 520), V.noise1(901, 170)
def pick(rnd_, conifers=.58):
    if rnd_.random() < conifers: return rnd_.choices(["spruce", "fir", "pine", "larch"], [45, 30, 13, 12])[0]
    return rnd_.choices(["oak", "maple", "aspen", "birch", "poplar"], [24, 22, 22, 18, 14])[0]
for (dy, sc_, air_, dens_) in ((4, .62, .12, 1.0), (12, .8, .06, .95), (22, 1.0, .0, .8), (40, 1.22, .0, .5), (72, 1.45, .0, .3), (112, 1.7, .0, .16)):
    x = rt.uniform(0, 40)
    while x < 5120:
        i = int(np.clip(x, 0, V.W - 1)); sd = float(V.side[i])
        clump = float(V.sm((grove[i] * (.45 + .55 * grove2[i]) - .34) / .1))
        d_ = float(np.clip(clump * (.34 + .66 * sd) * 1.15 + .5 * sd * (.4 + .6 * clump), 0, 1)) * dens_ * ((.35 + .65 * sd) if dy > 30 else 1)
        if rt.random() < d_:
            kind = pick(rt, .55); hh = rt.uniform(120, 250) * sc_ * (.6 + .4 * sd); yb = float(V.NEAR[i]) + dy
            hh = hh if kind in ("spruce", "fir", "pine", "larch") else min(hh, 215)
            if yb < 2185 and keep_ok(x, yb, hh): shore.append([round(x, 1), round(yb, 1), round(hh, 1), air_, KIND[kind], rt.randrange(1 << 30), 0])
        x += rt.uniform(24, 60) * sc_
for _ in range(170):
    x = rg.uniform(0, 5120); i = int(np.clip(x, 0, V.W - 1)); t_ = rg.random() ** .8
    if rg.random() > .35 + .65 * float(V.side[i]) * .8 + .4 * float(grove[i]): continue
    yb = float(V.NEAR[i]) + 8 + t_ * (2176 - float(V.NEAR[i]))
    if yb < 2180: shore.append([round(x, 1), round(yb + 2, 1), round(rg.uniform(46, 92) * (.55 + 1.1 * t_), 1), 0, KIND["shrub"], rg.randrange(1 << 30), 0])
shore.sort(key=lambda q: q[1])
corners = [[px, 2196, hh, 0, KIND[kind], 1000 + j, -1] for j, (px, hh, kind) in enumerate(
    [(-20, 520, "spruce"), (150, 650, "fir"), (360, 470, "spruce"), (560, 380, "fir"), (5140, 540, "spruce"), (4975, 640, "fir"), (4770, 480, "spruce"), (4570, 370, "fir")])]
print("shore trees and shrubs", len(shore))

r1 = lambda a: [round(float(v), 1) for v in a]
r3 = lambda a: [round(float(v), 3) for v in a]
json.dump({
    "version": 1, "design": [5120, 2160], "keep": list(V.KEEPD), "horizon": V.HZ, "lakeY": V.LAKE_Y,
    "land": {"k": Kt, "w": Wt, "heightScale": HS, "topScale": YS, "zDepth": V.ZDEPTH, "top": float(MVIS.min())},
    "atlas": {"w": AW, "h": AH, "sprites": families},
    "near": r1(V.NEAR), "side": r3(V.side), "grove": r3(grove), "grove2": r3(grove2),
    "forest": forest, "shore": shore, "corners": corners,
    "kinds": list(KIND.keys()),
}, open(f"{OUT}/valley.json", "w"), separators=(",", ":"))
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(f"{OUT}/{f}") // 1024, "KB")
