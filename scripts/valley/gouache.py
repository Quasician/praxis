# The valley as a gouache painting (preview renderer, take 1).
# Two halves, kept apart so the live wallpaper can do the second half in a shader:
#   bake():  the land (shaped by an erosion simulation), its forests and lake, as data: heights, normals, materials.
#   paint(): one moment in time: light in three values from the real sun or moon, chosen palettes, haze,
#            brush and paper texture, weather. Nothing here changes the land.
import os, sys, math, numpy as np
from PIL import Image, ImageFilter, ImageDraw
from numba import njit

S = float(os.environ.get("S", ".5"))            # .5 = 2560x1080 preview; 1 = full 5120x2160
W, H = round(5120 * S), round(2160 * S)
NX, K = 1280, 520                                # land grid: columns across the screen x depth slices (0 = near, K-1 = far)
CW = 5120 / NX                                   # design px per column
SRC = "/mnt/user-data/uploads/c/Users/thomas/Pictures/Mottos/"
OUT = os.environ.get("OUT", "out_g")
CACHE = "/tmp/gouache_land.npz"
XD = (np.arange(NX, dtype=np.float32) + .5) * CW            # design x of each column
TK = (((np.arange(K, dtype=np.float32) + .5) / K) ** 1.4)[:, None]   # depth of each slice, 0 near .. 1 far (more slices up close)
DZ = np.gradient(TK[:, 0] * 2600.0)[:, None]                  # depth step of each slice, in design px

# ------------------------------------------------------------------ noise
def h32(ix, iy, seed):
    h = ix.astype(np.int64).astype(np.uint32) * np.uint32(374761393) + iy.astype(np.int64).astype(np.uint32) * np.uint32(668265263) + np.uint32((seed * 1442695041) & 0xffffffff)
    h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
    h = h ^ (h >> np.uint32(16))
    return (h & np.uint32(0xffffff)).astype(np.float32) / np.float32(16777216)

def vnoise(x, y, seed):
    x = np.asarray(x, np.float32); y = np.asarray(y, np.float32)
    ix = np.floor(x); iy = np.floor(y); fx = x - ix; fy = y - iy
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = h32(ix, iy, seed); b = h32(ix + 1, iy, seed); c = h32(ix, iy + 1, seed); d = h32(ix + 1, iy + 1, seed)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy

def fbm(x, y, seed, oct=5, gain=.5):
    s = 0; amp = 1; tot = 0
    for o in range(oct):
        s = s + amp * vnoise(x * 2 ** o, y * 2 ** o, seed + 17 * o); tot += amp; amp *= gain
    return s / tot

def ridged(x, y, seed, oct=6, gain=.5):
    s = 0; amp = 1; tot = 0; w = 1
    for o in range(oct):
        n = 1 - np.abs(2 * vnoise(x * 2.03 ** o, y * 2.03 ** o, seed + 31 * o) - 1)
        n = n * n * w; w = np.clip(n * 1.6, 0, 1)
        s = s + amp * n; tot += amp; amp *= gain
    return s / tot

sm = lambda t: np.clip(t, 0, 1) ** 2 * (3 - 2 * np.clip(t, 0, 1))
def sstep(a, b, x): return sm((x - a) / (b - a))

# ------------------------------------------------------------------ erosion (rain droplets carving the mountains)
@njit(cache=True)
def _hg(hm, x, y):
    ix = int(x); iy = int(y); fx = x - ix; fy = y - iy
    a = hm[iy, ix]; b = hm[iy, ix + 1]; c = hm[iy + 1, ix]; d = hm[iy + 1, ix + 1]
    return (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy,
            (b - a) * (1 - fy) + (d - c) * fy, (c - a) * (1 - fx) + (d - b) * fx)

@njit(cache=True)
def erode(hm, mask, n, seed, inertia, cap, er, dep, evap, grav, R):
    np.random.seed(seed)
    Hn, Wn = hm.shape
    bw = np.zeros((2 * R + 1, 2 * R + 1)); tot = 0.0
    for by in range(-R, R + 1):
        for bx in range(-R, R + 1):
            d = math.sqrt(bx * bx + by * by)
            if d <= R:
                bw[by + R, bx + R] = 1 - d / (R + 1); tot += 1 - d / (R + 1)
    bw /= tot
    for i in range(n):
        x = np.random.random() * (Wn - 2); y = np.random.random() * (Hn - 2)
        if mask[int(y), int(x)] < np.random.random(): continue
        dx = 0.0; dy = 0.0; sp = 1.0; wat = 1.0; sed = 0.0
        for st in range(80):
            ix = int(x); iy = int(y); fx = x - ix; fy = y - iy
            h, gx, gy = _hg(hm, x, y)
            dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia)
            l = math.sqrt(dx * dx + dy * dy)
            if l < 1e-12: break
            dx /= l; dy /= l; x += dx; y += dy
            if x < 1 or y < 1 or x >= Wn - 2 or y >= Hn - 2: break
            nh = _hg(hm, x, y)[0]; dh = nh - h
            c = max(-dh, 0.002) * sp * wat * cap
            if sed > c or dh > 0:
                a = min(dh, sed) if dh > 0 else (sed - c) * dep
                sed -= a
                hm[iy, ix] += a * (1 - fx) * (1 - fy); hm[iy, ix + 1] += a * fx * (1 - fy)
                hm[iy + 1, ix] += a * (1 - fx) * fy; hm[iy + 1, ix + 1] += a * fx * fy
            else:
                a = min((c - sed) * er, -dh)
                for by in range(-R, R + 1):
                    for bx in range(-R, R + 1):
                        w = bw[by + R, bx + R]
                        yy = iy + by; xx = ix + bx
                        if w > 0 and yy >= 0 and xx >= 0 and yy < Hn and xx < Wn:
                            hm[yy, xx] -= a * w
                sed += a
            sp = math.sqrt(max(0.0, sp * sp - dh * grav))
            wat *= (1 - evap)
            if wat < .01: break
    return hm

@njit(cache=True)
def thermal(hm, it, talus, k):
    Hn, Wn = hm.shape
    for t in range(it):
        for y in range(1, Hn - 1):
            for x in range(1, Wn - 1):
                h = hm[y, x]
                for d in range(4):
                    yy = y + (1 if d == 0 else -1 if d == 1 else 0); xx = x + (1 if d == 2 else -1 if d == 3 else 0)
                    diff = h - hm[yy, xx]
                    if diff > talus:
                        m = (diff - talus) * k
                        hm[y, x] -= m; hm[yy, xx] += m; h -= m
    return hm

# ------------------------------------------------------------------ the place
def BASE(t): return 1730 + 560 * (1 - t) ** 2.6       # design-screen y of flat valley floor at depth t

def bake():
    if os.path.exists(CACHE) and os.environ.get("REBAKE") != "1":
        return dict(np.load(CACHE))
    x = XD[None, :]; t = TK
    kz = t * 2600.0                                           # depth in the same units as design px across (one slice ~ 5 px)
    def massif(xc, tc, A, wx, wt, seed, skew=0):
        dx = (x - xc) / wx; dt = (t - tc) / wt
        env = np.exp(-(dx ** 2) * (1 + skew * np.sign(dx)) - dt ** 2 * 1.2)
        rid = ridged(x / 520, kz / 520, seed, 6, .52)
        return A * env ** 1.15 * (.42 + .78 * rid)
    HT = np.zeros((K, NX), np.float32)
    HT += massif(560, .44, 1180, 470, .17, 3, .25)               # the big left massif
    HT += massif(240, .62, 820, 420, .14, 5)                     # its shoulder behind
    HT += massif(4580, .48, 960, 520, .16, 7, .2)                # the right massif
    HT += massif(4930, .66, 700, 380, .14, 9)
    far = sstep(.74, .86, t) * (1 - sstep(.985, 1.0, t))         # the distant high range across the back
    edge = sstep(1400, 2400, np.abs(x - 2560))
    HT += far * (55 + 80 * edge + 70 * ridged(x / 300, kz / 300, 13, 6, .55)) * (.75 + .5 * fbm(x / 900, 0 * x, 2, 3))
    hills = sstep(.44, .52, t) * (1 - sstep(.66, .76, t)) * sstep(700, 1100, np.abs(x - 2560))
    HT += hills * (120 + 110 * fbm(x / 260, kz / 260, 21, 4)) * (1 - sstep(.3, .6, sm((x - 2560) ** 2 / 2600 ** 2)) * 0)
    nearside = sstep(.0, .07, t) * (1 - sstep(.1, .24, t)) * sstep(900, 2500, np.abs(x - 2560))
    HT += nearside * (260 + 160 * fbm(x / 500, kz / 500, 23, 4))                  # the near slopes at the sides
    HT += sstep(.0, .05, t) * (1 - sstep(.0, .35, t)) * 38 * fbm(x / 300, kz / 300, 25, 4)          # rolling meadow
    # the lake: a basin in the middle distance
    lk = ((x - 2560) / 1350) ** 2 + ((t - .43) / .1) ** 2 + .35 * (fbm(x / 260, kz / 260, 41, 3) - .5)
    LAKE = np.clip((1 - lk) / .03 + .5, 0, 1).astype(np.float32)        # soft-edged, so the shoreline is smooth on screen
    HT = np.where(LAKE > .5, -2, HT * sstep(1.0, 1.7, lk)).astype(np.float32)

    # erosion: rain falls on the mountains and carves gullies, ridges and scree fans
    hm0 = (HT * .0022).astype(np.float64)
    mask = sstep(160, 480, HT).astype(np.float64)                 # rain only shapes the mountains, never the meadow
    hm = erode(hm0.copy(), mask, int(os.environ.get("DROPS", "300000")), 1, .04, 5.0, .3, .3, .025, 5.0, 3)
    hm = thermal(hm, 4, .008, .25)
    from scipy.ndimage import gaussian_filter
    delta = gaussian_filter(((hm - hm0) / .0022).astype(np.float32), 1.2)
    HT = np.where(LAKE > .5, -2, HT + delta * sstep(60, 260, HT)).astype(np.float32)

    # forests: rounded masses on the gentler middle slopes, below the treeline
    slope = np.hypot(np.gradient(HT, axis=1) / CW, np.gradient(HT, axis=0) / DZ)
    fz = fbm(x / 700, kz / 700, 51, 4)
    FOREST = (sstep(.45, .52, fz) * (1 - sstep(.55, .85, slope)) * (1 - sstep(360, 480, HT)) * sstep(30, 70, HT)
              * (1 - sstep(.7, .78, t)) * sstep(.13, .19, t) * (1 - LAKE)).astype(np.float32)
    from scipy.ndimage import gaussian_filter as _gf
    FOREST = sstep(.35, .6, _gf(FOREST, 2.5)).astype(np.float32)       # no stray specks: only forests big enough to read as a mass
    DECID = (FOREST * sstep(.42, .58, fbm(x / 300, kz / 300, 53, 3)) * (1 - sstep(160, 280, HT))).astype(np.float32)
    lsz = 26 + 60 * (1 - t) ** 2
    lump = fbm(x / lsz, kz / lsz, 55, 2)
    CAN = FOREST * (8 + 46 * (1 - t) ** 1.8) * (.5 + .8 * sstep(.3, .7, lump))
    d = dict(HT=HT, CAN=CAN.astype(np.float32), FOREST=FOREST, DECID=DECID, LAKE=LAKE)
    np.savez(CACHE, **d)
    return d

# ------------------------------------------------------------------ seeing it: which bit of land each pixel shows
@njit(cache=True)
def _project(mv, Hp):
    Kn, Wp = mv.shape
    kf = np.full((Hp, Wp), -1.0, np.float32)
    for c in range(Wp):
        k = 0
        for y in range(Hp):
            yc = y + .5
            while k < Kn and mv[k, c] > yc: k += 1
            if k >= Kn: continue          # sky (rows above everything); later rows are lower, so keep scanning
            if k == 0: kf[y, c] = 0.0
            else:
                a = mv[k - 1, c]; b = mv[k, c]
                kf[y, c] = (k - 1) + (a - yc) / max(a - b, 1e-4)
            # note: k only grows as y grows? no: lower rows are covered by nearer slices -> reset per row
    return kf

@njit(cache=True)
def project_cols(mv, Hp):
    # mv[k, c]: running-min top of slices 0..k (non-increasing in k). For row y, the visible slice is the first k with mv[k] <= y.
    Kn, Wp = mv.shape
    kf = np.full((Hp, Wp), -1.0, np.float32)
    for c in range(Wp):
        k = Kn - 1
        if mv[Kn - 1, c] > Hp: continue
        for y in range(Hp):
            yc = y + .5
            if mv[Kn - 1, c] > yc: continue            # above all land: sky
            # move k down (nearer) while the nearer slice still covers this row
            while k > 0 and mv[k - 1, c] <= yc: k -= 1
            if k == 0: kf[y, c] = 0.0
            else:
                a = mv[k - 1, c]; b = mv[k, c]
                kf[y, c] = (k - 1) + (a - yc) / max(a - b, 1e-4)
    return kf

def upx(a):                    # land grid columns -> screen pixel columns
    xs = (np.arange(W, dtype=np.float32) + .5) / W * NX - .5
    i0 = np.clip(np.floor(xs).astype(int), 0, NX - 1); i1 = np.clip(i0 + 1, 0, NX - 1); f = (xs - np.floor(xs)).astype(np.float32)
    return a[:, i0] * (1 - f) + a[:, i1] * f

def sample(field, kf, xg):     # bilinear sample of a (K, NX) field at fractional slice kf and grid column xg
    k0 = np.clip(np.floor(kf).astype(int), 0, K - 1); k1 = np.clip(k0 + 1, 0, K - 1); fk = np.clip(kf - k0, 0, 1)
    x0 = np.clip(np.floor(xg).astype(int), 0, NX - 1); x1 = np.clip(x0 + 1, 0, NX - 1); fx = np.clip(xg - x0, 0, 1)
    return (field[k0, x0] * (1 - fk) * (1 - fx) + field[k1, x0] * fk * (1 - fx) + field[k0, x1] * (1 - fk) * fx + field[k1, x1] * fk * fx)

def see(land):
    top = (BASE(TK) - (land["HT"] + land["CAN"])) * S                # pixel y of each slice's top
    mv = np.minimum.accumulate(upx(top.astype(np.float32)), axis=0)
    kf = project_cols(np.ascontiguousarray(mv), H)
    return kf


# ------------------------------------------------------------------ light, colour, weather
@njit(cache=True)
def cast_shadow(hm, xd, zw, lx, lz, tan_el, step, n):
    # March from each cell toward the light; shadowed where the land rises above the ray. Returns 0..1 (soft).
    Kn, Nx = hm.shape
    out = np.zeros((Kn, Nx), np.float32)
    cw = xd[1] - xd[0]; z0 = zw[0]; zmax = zw[Kn - 1]
    for k in range(Kn):
        for j in range(Nx):
            h0 = hm[k, j]; worst = 0.0
            for m in range(1, n):
                d = m * step
                px = xd[j] + lx * d; pz = zw[k] + lz * d
                if px < xd[0] or px > xd[Nx - 1] or pz < z0 or pz > zmax: break
                jj = int((px - xd[0]) / cw)
                lo = 0; hi = Kn - 1                       # slice for this depth (non-uniform spacing)
                while hi - lo > 1:
                    mid = (lo + hi) // 2
                    if zw[mid] <= pz: lo = mid
                    else: hi = mid
                ex = hm[lo, jj] - (h0 + d * tan_el)
                if ex > worst: worst = ex
                if worst > 40: break
            out[k, j] = min(1.0, worst / 40.0)
    return out

def mix(a, b, t): return a + (b - a) * t
def C(*v): return np.array(v, np.float32)

# Palettes: sky top / middle / horizon, the light's colour, the shadow's colour (cool, shared by everything in shade),
# haze colour and strength, sun-glow colour. Chosen like a painter would, not computed.
PAL = {
  "dawn":   dict(top=C(70, 84, 146), mid=C(170, 140, 172), hor=C(250, 192, 158), light=C(1.18, .93, .82), shade=C(.40, .38, .62), shadeTint=C(46, 38, 86),
                 haze=C(222, 176, 178), hazeK=.78, glow=C(255, 196, 150), sun=C(255, 238, 205), water=C(120, 110, 150)),
  "noon":   dict(top=C(58, 112, 186), mid=C(110, 160, 212), hor=C(196, 220, 232), light=C(1.1, 1.06, .97), shade=C(.46, .54, .70), shadeTint=C(30, 56, 90),
                 haze=C(186, 210, 226), hazeK=.62, glow=C(255, 250, 230), sun=C(255, 252, 238), water=C(70, 120, 160)),
  "gold":   dict(top=C(62, 92, 150), mid=C(170, 150, 150), hor=C(255, 194, 118), light=C(1.3, .98, .62), shade=C(.42, .38, .62), shadeTint=C(56, 40, 90),
                 haze=C(240, 190, 140), hazeK=.72, glow=C(255, 186, 100), sun=C(255, 232, 170), water=C(110, 90, 120)),
  "night":  dict(top=C(8, 14, 38), mid=C(16, 28, 64), hor=C(38, 56, 98), light=C(.40, .48, .70), shade=C(.12, .15, .30), shadeTint=C(8, 12, 34),
                 haze=C(34, 50, 92), hazeK=.55, glow=C(140, 160, 210), sun=C(236, 238, 246), water=C(14, 22, 50)),
  "rain":   dict(top=C(96, 108, 122), mid=C(132, 142, 152), hor=C(170, 176, 180), light=C(.82, .85, .88), shade=C(.56, .60, .68), shadeTint=C(50, 58, 72),
                 haze=C(160, 168, 174), hazeK=.86, glow=C(190, 196, 200), sun=C(220, 224, 226), water=C(90, 100, 112)),
  "fog":    dict(top=C(146, 164, 186), mid=C(196, 204, 210), hor=C(234, 230, 222), light=C(1.04, .98, .9), shade=C(.62, .64, .74), shadeTint=C(78, 84, 110),
                 haze=C(226, 224, 220), hazeK=.8, glow=C(255, 240, 214), sun=C(255, 246, 228), water=C(150, 160, 172)),
  "snow":   dict(top=C(140, 152, 170), mid=C(176, 186, 198), hor=C(212, 216, 222), light=C(.98, 1.0, 1.04), shade=C(.60, .66, .80), shadeTint=C(66, 78, 110),
                 haze=C(200, 206, 216), hazeK=.72, glow=C(230, 234, 240), sun=C(240, 242, 246), water=C(110, 124, 146)),
}
SEASON = {
  "autumn": dict(grass=C(190, 158, 90), grass2=C(128, 132, 74), conifer=C(48, 80, 66), decid=C(208, 112, 52), decid2=C(222, 164, 64), rock=C(132, 120, 112), snowline=820, groundSnow=0),
  "winter": dict(grass=C(232, 236, 242), grass2=C(214, 220, 230), conifer=C(40, 66, 60), decid=C(120, 100, 92), decid2=C(140, 118, 104), rock=C(118, 112, 112), snowline=0, groundSnow=1),
  "summer": dict(grass=C(118, 152, 72), grass2=C(92, 132, 66), conifer=C(44, 80, 60), decid=C(86, 136, 60), decid2=C(110, 150, 66), rock=C(134, 124, 114), snowline=1000, groundSnow=0),
  "spring": dict(grass=C(132, 170, 84), grass2=C(110, 156, 80), conifer=C(48, 84, 62), decid=C(150, 186, 96), decid2=C(226, 190, 206), rock=C(134, 124, 114), snowline=700, groundSnow=0),
}

FRAME_TREES = [(-60, 1180, 1), (150, 1420, 2), (390, 980, 3), (4730, 1000, 4), (4950, 1360, 5), (5180, 1150, 6)]   # (x, height, seed) in design px

def conifers(P, Q, L, phase, season):
    """Tall painted conifers at the edges of the frame: tiers of jagged shapes, a lit side toward the light, snow in winter."""
    U = 2; im = Image.new("RGBA", (W * U, H * U), (0, 0, 0, 0)); dr = ImageDraw.Draw(im)
    alb = Q["conifer"] * .8
    lit = np.clip(mix(alb, C(110, 120, 100), .3) * P["light"] * 1.05, 0, 255); shade = np.clip(alb * P["shade"] * .7 + P["shadeTint"] * .25, 0, 255)
    snowl = np.clip(C(246, 247, 250) * P["light"], 0, 255); snows = np.clip(C(246, 247, 250) * P["shade"] * .8 + P["shadeTint"] * .3, 0, 255)
    side = 1 if L[0] > 0 else -1
    q = lambda v: tuple(int(c) for c in v) + (255,)
    half = mix(shade, lit, .45); hi = mix(shade, lit, .85)
    for (bx, h, seed) in FRAME_TREES:
        rng = np.random.default_rng(seed)
        k = S * U; base = 2230; lean = rng.uniform(-.03, .03)
        dr.rectangle([(bx - 12) * k, (base - h * .2) * k, (bx + 12) * k, base * k], fill=q(shade * .75))
        tiers = 13
        for i in range(tiers):
            f = i / (tiers - 1)
            cx = bx + lean * h * f
            y_bot = base - h * (.12 + .84 * f) + rng.uniform(-.012, .012) * h
            y_top = y_bot - h * (.13 - .05 * f)
            wd = (h * .19 * (1 - f) ** .85 + 22) * rng.uniform(.8, 1.18)
            wl, wr = wd * rng.uniform(.85, 1.1), wd * rng.uniform(.85, 1.1)
            # the branch mass: drooping tips, ragged needles along the lower edge
            edge = []
            n = 9
            for j in range(n + 1):
                u = -1 + 2 * j / n; w_ = wl if u < 0 else wr
                droop = abs(u) ** 1.6 * h * .035
                edge.append((cx + u * w_ + rng.uniform(-6, 6), y_bot + droop + rng.uniform(-.4, .6) * h * .018))
            body = [(cx, y_top)] + edge
            dr.polygon([(x * k, y * k) for x, y in body], fill=q(shade))
            # the top of the branches catches light from the sky; the side toward the sun catches the sun
            ups = [(cx, y_top + 4)] + [(x, y - (y - y_top) * .45 - h * .006) for x, y in edge if (x - cx) * side > -wd * .35]
            if len(ups) > 2: dr.polygon([(x * k, y * k) for x, y in ups], fill=q(half))
            tip = [(cx + side * wd * .25, y_top + (y_bot - y_top) * .35)] + [(x, y - (y - y_top) * .62) for x, y in edge if (x - cx) * side > wd * .3]
            if len(tip) > 2 and phase != "night": dr.polygon([(x * k, y * k) for x, y in tip], fill=q(hi))
            if season == "winter":
                cap = [(cx, y_top)] + [(x, y - (y - y_top) * .55) for x, y in edge[1:-1]]
                dr.polygon([(x * k, y * k) for x, y in cap], fill=q(snows))
                capl = [(cx, y_top)] + [(x, y - (y - y_top) * .55) for x, y in edge[1:-1] if (x - cx) * side > -wd * .1]
                if len(capl) > 2: dr.polygon([(x * k, y * k) for x, y in capl], fill=q(snowl))
    im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im, np.float32); return a[..., :3], a[..., 3] / 255

def light_dir(sx, sy):
    el = math.radians(max(2, 68 * (1 - sy / 1730) ** 1.1)); az = math.radians((sx - 2560) / 2560 * 75)
    return np.array([math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el)], np.float32), el

def paint(phase, season, weather, sun, motto=None, name="x", moon=False):
    land = bake(); P = PAL[phase]; Q = SEASON[season]
    HT = land["HT"] + land["CAN"]
    xd = XD.astype(np.float64); zw = (TK[:, 0] * 2600.0).astype(np.float64)
    # --- the land's form, on its grid
    gx = np.gradient(HT, axis=1) / CW; gz = np.gradient(HT, axis=0) / DZ
    N = np.stack([-gx, np.ones_like(gx), -gz], -1); N /= np.linalg.norm(N, axis=-1, keepdims=True)
    L, el = light_dir(*sun)
    hdir = np.array([L[0], L[2]]); hl = np.linalg.norm(hdir) + 1e-6
    SH = cast_shadow(HT.astype(np.float64), xd, zw, L[0] / hl, L[2] / hl, L[1] / hl, 6.0, 260) if L[1] < .85 else np.zeros_like(HT)
    from scipy.ndimage import gaussian_filter
    SH = gaussian_filter(SH, 1.0)
    CAV = np.clip((HT - gaussian_filter(HT, 4)) / 30, -1, 1)          # gullies (negative) and crests (positive)
    snowy = sstep(Q["snowline"] - 60, Q["snowline"] + 60, land["HT"] + 90 * (fbm(XD[None, :] / 220, TK * 2600 / 220, 61, 3) - .5)) if Q["snowline"] > 0 else np.ones_like(HT)
    SNOW = np.clip(snowy * sstep(.45, .7, N[..., 1]) * (1 - land["LAKE"]), 0, 1)
    if Q["groundSnow"]: SNOW = np.maximum(SNOW, (1 - land["FOREST"]) * sstep(.3, .55, N[..., 1]) * (1 - land["LAKE"]))
    ROCK = np.clip(sstep(.45, .8, 1 - N[..., 1]) * sstep(60, 200, land["HT"]) + sstep(180, 420, land["HT"] + 120 * (fbm(XD[None, :] / 260, TK * 2600 / 260, 63, 3) - .5)), 0, 1)
    # --- what each pixel sees
    kf = see(land); sky = kf < 0; kq = np.maximum(kf, 0)
    xg = np.broadcast_to(((np.arange(W, dtype=np.float32) + .5) / W * NX - .5)[None, :], (H, W))
    smp = lambda f: sample(f, kq, xg)
    n = np.stack([smp(N[..., i]) for i in range(3)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
    t = smp(np.broadcast_to(TK, HT.shape)); sh = smp(SH); cav = smp(CAV)
    forest = smp(land["FOREST"]); decid = smp(land["DECID"]); lake = smp(land["LAKE"]); snow = smp(SNOW); rock = smp(ROCK); alt = smp(land["HT"])
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32); Xd = (xx + .5) / S; Yd = (yy + .5) / S
    # --- brush strokes follow the form: down the fall line on slopes, level on flat ground and water
    st = np.sqrt(np.clip(1 - n[..., 1] ** 2, 0, 1))
    dvx = n[..., 0] * 2 + (1 - st); dvy = st * 1.8; dl = np.hypot(dvx, dvy) + 1e-6; ca, sa = dvx / dl, dvy / dl
    fg = (1 - sstep(.04, .16, t)) * (1 - sstep(.5, .8, rock))            # near meadow: grass strokes stand up
    ca = mix(ca, .12, fg); sa = mix(sa, 1.0, fg); dl = np.hypot(ca, sa); ca, sa = ca / dl, sa / dl
    ca = np.where(sky | (lake > .5), 1, ca); sa = np.where(sky | (lake > .5), 0, sa)
    u = Xd * ca + Yd * sa; v = -Xd * sa + Yd * ca
    stroke = .6 * vnoise(u / 46, v / 5, 71) + .4 * vnoise(u / 18, v / 3, 73)
    # --- light in three values: shadow, half-tone, light
    d = (n * L).sum(-1)
    lit = sstep(-.08, .22, d) * (1 - sh)
    e = lit + (stroke - .5) * .26 + cav * .12
    val = .5 * sstep(.24, .3, e) + .5 * sstep(.6, .66, e)
    if weather in ("rain", "snow", "fog"): val = .25 + .5 * val                     # overcast: the light flattens to half-tones
    # --- colour of each surface (albedo), then lit
    patch = fbm(Xd / 380, Yd / 160, 81, 3)
    grass = mix(Q["grass"], Q["grass2"], sstep(.4, .6, patch)[..., None])
    alb = grass
    alb = mix(alb, Q["rock"] * (.9 + .2 * patch[..., None]), rock[..., None])
    tree = mix(Q["conifer"], mix(Q["decid"], Q["decid2"], sstep(.45, .6, fbm(Xd / 90, Yd / 60, 83, 2))[..., None]), decid[..., None])
    alb = mix(alb, tree, sstep(.3, .6, forest)[..., None])
    snowc = C(246, 247, 250)
    alb = mix(alb, snowc, (snow * (1 - .75 * sstep(.3, .6, forest) * (1 - sstep(.75, .9, n[..., 1]))))[..., None])
    lightc = alb * P["light"]; shadec = alb * P["shade"] * .78 + P["shadeTint"] * .32
    halfc = mix(shadec, lightc, .52)
    col = np.where(val[..., None] < .25, mix(shadec, halfc, (val / .25)[..., None]), mix(halfc, lightc, ((val - .5) / .5).clip(0, 1)[..., None]))
    col = np.where((val[..., None] >= .25) & (val[..., None] < .5), mix(shadec, halfc, ((val - .25) / .25 * 0 + 1)[..., None]), col)
    col *= (1 + (stroke[..., None] - .5) * (.1 + .14 * fg[..., None]))
    if phase == "night":                                                   # moonlight drains colour: everything goes toward blue-grey
        lm = (col * C(.3, .59, .11)).sum(-1, keepdims=True)
        col = mix(col, lm * C(.78, .9, 1.25), .65) * .8
    col *= (1 - .3 * sstep(1880, 2160, Yd) * (1 - sky))[..., None]                       # the foreground sits darker and frames the view
    # --- sky: a painted gradient, the sun's glow, stars at night
    hy = 1730.0
    f = np.clip(Yd / hy, 0, 1)
    skyc = np.where(f[..., None] < .55, mix(P["top"], P["mid"], (f / .55)[..., None] ** 1.1), mix(P["mid"], P["hor"], ((f - .55) / .45)[..., None] ** 1.3))
    sx, sy = sun
    r = np.hypot(Xd - sx, (Yd - sy) * 1.15)
    glow = (np.exp(-r / 900) * .5 + np.exp(-r / 260) * .5)[..., None]
    gk = .55 if phase in ("dawn", "gold") else .3 if phase != "night" else .25
    if weather == "rain": gk = .05
    skyc = skyc + (P["glow"] - skyc) * glow * gk
    su = Xd * .97 + Yd * .26; sv = -Xd * .26 + Yd * .97                 # long, slightly tilted brush sweeps
    skyc *= (1 + (fbm(su / 700, sv / 90, 91, 3)[..., None] - .5) * .05 + (fbm(Xd / 1100, Yd / 400, 93, 3)[..., None] - .5) * .05)
    if phase == "night":
        rng = np.random.default_rng(5); ns = int(2600 * S * S * 4)
        px_ = rng.uniform(0, W, ns); py_ = rng.uniform(0, H * .82, ns) ** 1.0; b = rng.uniform(.2, 1, ns) ** 3
        star = np.zeros((H, W), np.float32)
        np.add.at(star, (py_.astype(int), px_.astype(int)), b)
        star = gaussian_filter(star, .6) * 4
        skyc = skyc + C(255, 250, 235) * np.clip(star, 0, 1)[..., None] * (1 - f[..., None] ** 3)
    # --- haze: far things fade toward the air's colour
    hz = (1 - np.exp(-3.4 * t ** 1.5)) * P["hazeK"]
    hz = np.clip(hz + (1 - sstep(.0, .25, alt / 900)) * 0, 0, 1)
    col = mix(col, P["haze"], hz[..., None])
    img = np.where(sky[..., None], skyc, col)
    # --- rim light: low sun behind the land catches the tops of ridges
    if el < math.radians(22) and L[2] > .3 and phase != "night":
        above = np.vstack([np.full((3, W), True), sky[:-3]]) | (np.vstack([np.full((3, W), 1e9), kf[:-3]]) > kf + 25)
        rim = (above & ~sky).astype(np.float32)
        rim = gaussian_filter(rim, .7) * np.exp(-np.abs(Xd - sx) / 2200)
        img = img + (P["sun"] - img) * np.clip(rim * .7, 0, .8)[..., None] * (1 - hz[..., None] * .6)
    # --- the lake mirrors what's behind it, softened by ripples
    wat = (lake > .5) & ~sky
    first = np.where(wat.any(0), wat.argmax(0), H).astype(np.float32)
    first = np.round(gaussian_filter(np.where(first < H, first, np.nan_to_num(first)), 3)).astype(int)
    mirror = np.clip(2 * first[None, :] - yy.astype(int) - 2 + (vnoise(Xd / 300, Yd / 6, 97) * 6 - 3).astype(int), 0, H - 1)
    refl = img[mirror, xx.astype(int)]
    refl = gaussian_filter(refl, (0, 3.0 * S * 2, 0))
    waterc = mix(refl * .82, P["water"], .3) * (1 + (vnoise(Xd / 260, Yd / 3, 99)[..., None] - .5) * .12)
    shore = (wat & ~np.vstack([np.zeros((2, W), bool), wat[:-2]])).astype(np.float32)
    waterc = waterc + (P["hor"] - waterc) * gaussian_filter(shore, .6)[..., None] * .5
    img = np.where(wat[..., None], waterc, img)
    # --- the framing trees, nearest of all
    tc, ta = conifers(P, Q, L, phase, season)
    tc = tc * (1 + (stroke[..., None] * 0 + (vnoise(Xd / 30, Yd / 5, 121)[..., None] - .5) * .12))
    img = mix(img, tc, ta[..., None])
    # --- weather
    if weather == "fog":
        ft = 120 + 90 * fbm(Xd / 700, 0 * Xd + 3.1, 101, 4)               # how high the fog bank climbs (design px above the floor)
        fogz = sstep(.18, .5, t) * (1 - sstep(.0, .9, (BASE(t) - Yd) / 1 - (ft * (.4 + t)))) * 0
        above_floor = (BASE(t) - Yd) / (220 + 380 * t)
        fa = np.where(sky, sstep(1500, 1750, Yd) * .75, sstep(.12, .45, t) * (1 - sstep(.25, .9, above_floor + (fbm(Xd / 500, Yd / 140, 103, 3) - .5) * .5)))
        fa = np.clip(fa + sstep(.6, .9, t) * .7, 0, 1) * .92
        edge = np.clip(gaussian_filter(fa, 3) - gaussian_filter(fa, 9), 0, 1)
        img = mix(img, P["haze"], fa[..., None]) * (1 - edge[..., None] * .5)
    # --- paper and pigment
    grain = (vnoise(Xd / 2.2, Yd / 2.2, 111) - .5) * .05 + (fbm(Xd / 600, Yd / 600, 113, 3) - .5) * .06
    img = img * (1 + grain[..., None])
    if weather == "rain":
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); ov = Image.new("L", (W, H), 0); dr = ImageDraw.Draw(ov)
        rng = np.random.default_rng(9)
        for _ in range(int(3000 * S * S * 4)):
            x0 = rng.uniform(-200, W); y0 = rng.uniform(-50, H); l = rng.uniform(26, 60) * S * 2
            dr.line([(x0, y0), (x0 + l * .28, y0 + l)], fill=int(rng.uniform(25, 60)), width=max(1, round(S * 2 * rng.uniform(.8, 1.6))))
        ov = np.asarray(ov.filter(ImageFilter.GaussianBlur(.8)), np.float32)[..., None] / 255
        img = img + (C(220, 226, 232) - img) * ov
    if weather == "snow":
        rng = np.random.default_rng(11); fl = np.zeros((H, W), np.float32)
        for rad in (1.0, 1.8, 2.8):
            m = int(900 * S * S * 4 / rad ** 1.5)
            pyy = rng.uniform(0, H, m).astype(int); pxx = rng.uniform(0, W, m).astype(int)
            lay = np.zeros((H, W), np.float32); np.add.at(lay, (pyy, pxx), 1)
            fl = np.maximum(fl, np.clip(gaussian_filter(lay, rad * S * 2) * (rad * S * 2) ** 2 * 6, 0, 1) * (.6 + .15 * rad))
        img = img + (C(250, 251, 253) - img) * fl[..., None]
    return np.clip(img, 0, 255), sky, (sx, sy)

def lum(c):
    c = np.asarray(c, np.float32) / 255; c = np.where(c <= .03928, c / 12.92, ((c + .055) / 1.055) ** 2.4)
    return c[..., 0] * .2126 + c[..., 1] * .7152 + c[..., 2] * .0722

def sun_disc(img, sky, pos, col, r=34, glow=True):
    from scipy.ndimage import gaussian_filter
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.hypot((xx + .5) / S - pos[0], (yy + .5) / S - pos[1])
    disc = np.clip((r - d) / 3, 0, 1) * sky
    return img + (col - img) * disc[..., None]

def compose(motto, phase, season, weather, sun, name, disc=True):
    from scipy.ndimage import gaussian_filter
    img, sky, pos = paint(phase, season, weather, sun)
    a = None
    if motto:
        m0 = np.asarray(Image.open(SRC + motto).convert("RGB").resize((W, H), Image.LANCZOS), np.float32)
        a = np.clip(m0.max(axis=2) / 240.0, 0, 1) ** 0.78
        G = np.clip(gaussian_filter(np.clip(a * 6, 0, 1), 28 * S) * 4, 0, 1)
        for _ in range(2):
            q = np.minimum(1, ((.15 + .05) / (lum(img) + .05)) ** (1 / 2.2))
            img = img * (1 - G * (1 - q))[..., None]
        sh = gaussian_filter(a, 9 * S); img = img * (1 - .35 * sh)[..., None]
        img = img * (1 - a[..., None]) + C(244, 241, 233) * a[..., None]
    if disc and weather not in ("rain", "snow", "fog"):
        img = sun_disc(img, sky, pos, PAL[phase]["sun"], 30 if phase == "night" else 34)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(f"{OUT}/{name}.png")
    print(name, "done")

JOBS = [
  ("84a-book-in-the-morning-when-thou-risest-unwillingly-let-th.png", "dawn", "autumn", "clear", (1250, 1560), "g1-dawn"),
  ("20-latin-deeds-not-words.png", "noon", "autumn", "clear", (3450, 250), "g2-noon"),
  ("63a-letter-the-mountains-are-calling-and-i-must-go.png", "gold", "autumn", "clear", (3720, 1380), "g3-golden-hour"),
  ("07-latin-through-hardship-to-the-stars.png", "night", "autumn", "clear", (3950, 330), "g4-night"),
  ("73-japanese-an-old-pond-a-frog-leaps-in-the-sound-of-water.png", "rain", "autumn", "rain", (2900, 700), "g5-rain"),
  ("58b-book-in-the-depths-of-winter-i-finally-learned-that-wit.png", "snow", "winter", "snow", (3000, 600), "g6-snow"),
  ("59b-book-how-we-spend-our-days-is-of-course-how-we-spend-ou.png", "fog", "autumn", "fog", (1700, 1000), "g7-fog"),
]
if __name__ == "__main__":
    nomotto = os.environ.get("NOMOTTO") == "1"
    for j in JOBS:
        if len(sys.argv) < 2 or any(k in j[5] for k in sys.argv[1:]):
            compose(None if nomotto else j[0], *j[1:])
