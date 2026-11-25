"""Masks the city renderer needs, worked out from one season's keyframes.
  sky.png     white where there is open sky or cloud (the sun, moon and stars are drawn only here)
  cloud.png   how much cloud covers each sky pixel (they glow through thin cloud, hide behind thick)
  lights.png  the lit windows at night (so they can switch on one by one through dusk)
usage: build_masks.py <keyframes dir> <season> <out dir> [season to borrow the hill line from]
The hills are the same in every season, so the line found in the season where it reads best can serve the others."""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
kf, season, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
load = lambda m: np.asarray(Image.open(f"{kf}/{season}-{m}.png").convert("RGB")).astype(np.float32)
lum = lambda a: a @ np.array([.299, .587, .114], dtype=np.float32)
F = {m: load(m) for m in ["noon", "golden", "sunset", "dusk", "night"]}
Lm = {m: lum(a) for m, a in F.items()}
H, W = Lm["noon"].shape
yy, xx = np.mgrid[0:H, 0:W]
S = W / 2640.0                      # sizes below are for 2640-wide frames
px = lambda v: max(1, int(round(v * S)))

def grad(l, s=0.7):
    g = ndi.gaussian_filter(l, s * S)
    return np.hypot(ndi.sobel(g, 0), ndi.sobel(g, 1))

# 1. Buildings are full of fine detail (windows, floor lines) in at least one frame; sky and cloud are smooth.
#    Their detail is also mostly straight (walls, floor lines), where the shading inside a cloud curves every which way.
def detail(l):
    g = ndi.gaussian_filter(l, 0.7 * S); gy, gx = ndi.sobel(g, 0), ndi.sobel(g, 1)
    e = np.hypot(gx, gy) > 24
    a = np.abs(np.arctan2(gy, gx)) % (np.pi / 2); a = np.minimum(a, np.pi / 2 - a)
    d = ndi.uniform_filter(e.astype(np.float32), px(15))
    straight = ndi.uniform_filter((e & (a < np.deg2rad(10))).astype(np.float32), px(15)) / np.maximum(d, 1e-3)
    return (d > 0.40) & (straight > 0.38)
core = np.logical_or.reduce([detail(Lm[m]) for m in ["noon", "golden", "night", "dusk"]])
core = ndi.binary_closing(core, iterations=px(6))
lab, n = ndi.label(core)
area = ndi.sum(core, lab, range(1, n + 1))
core = np.isin(lab, 1 + np.where(area >= px(60) ** 2)[0])          # scraps of cloud detail are small
core = np.maximum.accumulate(core, axis=0)                          # nothing below a building is sky

# 2. The exact outline: near the core, strong edges in the frames where buildings stand out against the sky.
def straight_edges(l):
    g = ndi.gaussian_filter(l, 1.0 * S); gy, gx = ndi.sobel(g, 0), ndi.sobel(g, 1)
    a = np.abs(np.arctan2(gy, gx)) % (np.pi / 2); a = np.minimum(a, np.pi / 2 - a)
    return (np.hypot(gx, gy) > 60) & (a < np.deg2rad(12))        # walls and roof lines; a cloud's outline curves
edge = np.logical_or.reduce([straight_edges(Lm[m]) for m in ["golden", "dusk", "sunset"]])
near = ndi.binary_dilation(core, iterations=px(60))
solid = core | (edge & near)
free = ~ndi.binary_dilation(solid, iterations=1)
lab, n = ndi.label(free)
seeds = np.unique(lab[0:3, :]); seeds = seeds[seeds > 0]
sky = np.isin(lab, seeds)
sky = ndi.binary_dilation(sky, iterations=1)
# what isn't sky and hangs off the buildings stays building (spires, masts); loose scraps of cloud outline go back to sky
non = ~sky
lab, n = ndi.label(non)
keep = np.unique(lab[core]); keep = keep[keep > 0]
non = np.isin(lab, keep)
non = ndi.binary_fill_holes(non)
# thin whiskers where a cloud's outline ran into a tower: drop anything outside the core that a small opening removes,
# unless it rises straight up from the core (a spire is taller than it is wide)
opened = ndi.binary_opening(non, iterations=px(3)) | core
thin = non & ~opened
lab, n = ndi.label(thin)
if n:
    sl = ndi.find_objects(lab)
    tall = [i + 1 for i, s_ in enumerate(sl) if (s_[0].stop - s_[0].start) >= 1.6 * (s_[1].stop - s_[1].start)]
    thin = np.isin(lab, tall)
non = opened | thin
sky = ~non

# 3. The hills: smooth like the sky, but always darker than the sky just above them. Find the ridge line column by column.
d = px(5)
def drop(l):
    g = ndi.gaussian_filter(l, (1.5 * S, 4 * S))
    v = np.zeros_like(g); v[d:-d] = g[:-2 * d] - g[2 * d:]          # bright above, dark below -> positive
    return v / (np.percentile(np.abs(v), 99) + 1e-6)
ridge_score = np.mean([drop(Lm[m]) for m in ["sunset", "dusk", "golden", "noon"]], axis=0)
top = np.where(non.any(0), non.argmax(0), H - 1)                      # first building row in each column
centre = ndi.binary_opening(top > 0.55 * H, iterations=px(20))        # columns with no tall tower in them
ctop = np.where(core.any(0), core.argmax(0), H - 1)                   # there, only detailed buildings count: the bridge's
top = np.where(centre, ctop, top)                                     # straight lines box in patches of sky otherwise
ridge = top.copy()
for x in np.where(centre)[0]:
    y0 = max(0, top[x] - px(100))          # the hills stand just above the far city; higher up is cloud
    col = ridge_score[y0:top[x], x]
    hit = np.where(col > 0.30)[0]
    if hit.size: ridge[x] = y0 + hit[0]
xs = np.where(centre)[0]
if xs.size:
    r = ridge.astype(np.float32)
    r[xs] = ndi.median_filter(r[xs], px(31), mode="nearest")
    wide = ndi.median_filter(r[xs], px(181), mode="nearest")
    r[xs] = np.maximum(r[xs], wide - px(14))                          # hills are broad: a narrow jump up is the bridge or a glow
    r[xs] = ndi.gaussian_filter1d(r[xs], px(3), mode="nearest")
    ridge = np.where(centre, np.round(r).astype(int), ridge)
hills = centre[None, :] & (yy >= ridge[None, :])
borrow = sys.argv[4] if len(sys.argv) > 4 else None
if borrow and os.path.exists(f"{out}/{borrow}-ridge.npy"):
    other = np.load(f"{out}/{borrow}-ridge.npy")
    ridge = np.where(centre & (other < H - 1), other, ridge)
np.save(f"{out}/{season}-ridge.npy", np.where(centre, ridge, H - 1))
sky = np.where(centre[None, :], yy < ridge[None, :], sky)
non = ~sky
soft = ndi.gaussian_filter(sky.astype(np.float32), 0.8 * S)
Image.fromarray((soft * 255).astype(np.uint8)).save(f"{out}/{season}-sky.png")

# 4. Cloud cover inside the sky: 0 for clear blue, 1 for solid cloud (how far from blue the noon sky is).
noon = F["noon"]; mx, mn = noon.max(2), noon.min(2)
sat = (mx - mn) / np.maximum(mx, 1)
cloud = np.clip((0.42 - sat) / 0.30, 0, 1) * np.clip((Lm["noon"] - 120) / 60, 0, 1) * sky
cloud = ndi.gaussian_filter(cloud, 1.5 * S)
Image.fromarray((cloud * 255).astype(np.uint8)).save(f"{out}/{season}-cloud.png")

# 5. Lit windows: small, bright, amber or cyan, in the buildings only. Lit trees and glows are too big or the wrong colour.
n_ = F["night"]; r, g, b = n_[..., 0], n_[..., 1], n_[..., 2]; nl = Lm["night"]
amber = (r > g) & (g > b) & (r - b > 70) & (r > 150)
cyan = (g > r + 45) & (b > r + 45) & (g > 150)
local = nl - ndi.uniform_filter(nl, px(21))
hillband = centre[None, :] & (yy >= ridge[None, :]) & (yy < ctop[None, :])     # the hills themselves, above the first rooftops
lit = (amber | cyan) & (local > 14) & non & ~hillband
lab, n = ndi.label(lit)
if n:
    area = ndi.sum(lit, lab, range(1, n + 1))
    lit = np.isin(lab, 1 + np.where(area <= px(16) * px(16))[0])
lights = ndi.gaussian_filter(lit.astype(np.float32), 0.6 * S) * np.clip((nl - 60) / 120, 0, 1)
lights = np.clip(lights * 1.6, 0, 1)
Image.fromarray((lights * 255).astype(np.uint8)).save(f"{out}/{season}-lights.png")
print(season, "sky %.1f%%" % (sky.mean() * 100), "cloud in sky %.1f%%" % (cloud[sky].mean() * 100), "lit px %.2f%%" % ((lights > .5).mean() * 100))
