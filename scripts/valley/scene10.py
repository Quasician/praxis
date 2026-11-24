# Motto wallpaper, take 3. One valley, one art style (flat layered shapes, two or three tones each, soft air),
# lit from wherever the sun or moon really is. Mountains have lit and shadowed faces, snow follows the terrain,
# trees come in several species that change with the season, and clouds are shaded by the light.
# Nothing but plain sky ever enters the zone the lettering uses.
import os, sys, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = float(os.environ.get("S", "1"))                 # 1 = full 5120x2160; 0.5 for quick drafts
W, H = round(5120 * S), round(2160 * S)
CLOUDS = os.environ.get("CLOUDS", "0") == "1"    # sky clouds are off unless asked for; ground mist and falling rain or snow stay
OPEN = os.environ.get("OPEN", "1") == "1"        # 1 = clouds and the sun or moon may pass behind the words; 0 = they keep outside
SRC = "/mnt/user-data/uploads/c/Users/thomas/Pictures/Mottos/"
RISE, SET = 6 * 60 + 55, 16 * 60 + 54
KEEPD = (800, 220, 4320, 1660)                      # every motto's lettering sits inside x 900..4220, y 320..1588
KEEP = tuple(round(v * S) for v in KEEPD)
HZ, LAKE_Y = 1778, 1905
X = (np.arange(W, dtype=np.float32) + .5) / S       # design-space x of each pixel column
Y = ((np.arange(H, dtype=np.float32) + .5) / S)[:, None]
hexc = lambda h: np.array([int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)
sm = lambda t: (lambda c: c * c * (3 - 2 * c))(np.clip(t, 0, 1))
mix = lambda a, b, t: tuple(float(x) * (1 - t) + float(y) * t for x, y in zip(a, b))
ti = lambda c: tuple(int(max(0, min(255, round(v)))) for v in c)
blur = lambda im, r: im.filter(ImageFilter.GaussianBlur(r * S))

def noise1(seed, wave):
    v = np.random.default_rng(seed).random(int(5120 / wave) + 3).astype(np.float32)
    p = X / wave; i = p.astype(int); f = sm(p - i)
    return v[i] * (1 - f) + v[i + 1] * f
def fbm1(seed, waves=((900, 1), (380, .5), (150, .26), (62, .13), (25, .06))):
    return sum(noise1(seed * 31 + k, w) * a for k, (w, a) in enumerate(waves)) / sum(a for _, a in waves)
rid1 = lambda seed, waves: 1 - np.abs(2 * fbm1(seed, waves) - 1)
def noise2(seed, wx, wy, shear=0.0):
    pad = int(abs(shear) * H) + 2
    gw, gh = int((W + pad) / S / wx) + 4, int(2160 / wy) + 4
    a = np.random.default_rng(seed).random((gh, gw)).astype(np.float32)
    im = Image.fromarray(a, "F").resize((W + pad, H), Image.BICUBIC)
    if shear: im = im.transform((W, H), Image.AFFINE, (1, shear, 0 if shear > 0 else pad, 0, 1, 0), Image.BILINEAR)
    else: im = im.crop((0, 0, W, H))
    return np.clip(np.asarray(im, np.float32), 0, 1)
def smooth1(a, r):
    k = max(1, int(r * S)); ker = np.hanning(2 * k + 1); ker /= ker.sum()
    return np.convolve(np.pad(a, k, mode="edge"), ker, mode="valid").astype(np.float32)

def poster(t, n=3, soft=.22):
    """Soft posterise: n flat tones with a short blend between them, for the illustrated look."""
    t = np.clip(t, 0, 1) * n; f = np.floor(t)
    return np.clip((f + sm((t - f - .5) / soft + .5)) / n, 0, 1)

# ------------------------------------------------------------------ the place (never changes)
D = np.abs(X - 2560)
def peaks(ps, power=1.16):
    h = np.zeros_like(X)
    for (px, ph, pw) in ps: h = np.maximum(h, ph * np.clip(1 - np.abs(X - px) / pw, 0, None) ** power)
    return h
gate = sm((D - 1786) / 250) ** .8                    # the massifs stand wholly outside the lettering's columns
env_m = peaks([(455, 780, 660), (120, 560, 560), (4680, 760, 620), (5000, 600, 560)], .9)
hm = env_m * (.52 + .6 * rid1(4, ((420, 1), (160, .5), (60, .25), (22, .12)))) * gate
env_f = peaks([(230, 520, 760), (760, 420, 520), (4890, 560, 780), (4380, 400, 520)], 1.0)
hf = env_f * (.55 + .5 * rid1(2, ((380, 1), (140, .5), (50, .25)))) * sm((D - 1786) / 330)
side = sm((D - 1790) / 520)
FAR = 1795 - 88 * rid1(1, ((700, 1), (260, .5), (110, .25), (45, .1))) - hf
MID = 1868 - 78 * fbm1(3, ((520, 1), (210, .5), (90, .25), (36, .12))) - hm
HILL = 1905 - 22 * fbm1(8, ((300, 1), (120, .5), (40, .3))) - side * 60 - 5 * np.abs(((X / 9) % 2) - 1)    # low wooded hills by the lake
NEAR = 2000 - 34 * fbm1(5) - side * (175 + 70 * fbm1(6)) + 58 * sm(1 - D / 1700)
for R_ in (FAR, MID, HILL, NEAR):                    # belt and braces
    c_ = (X >= KEEPD[0] - 8) & (X <= KEEPD[2] + 8); R_[c_] = np.maximum(R_[c_], KEEPD[3] + 8)
K = max(260, round(760 * S)); ZS = ((np.arange(K, dtype=np.float32) + .5) / K)[:, None]; ZDEPTH = 2600.0
def nz(seed, wx, wz):
    a = np.random.default_rng(seed).random((int(1 / wz) + 4, int(5120 / wx) + 4)).astype(np.float32)
    return np.clip(np.asarray(Image.fromarray(a, "F").resize((W, K), Image.BICUBIC), np.float32), 0, 1)
def ridged(seed, wx, wz, octs=6, gain=.52, lac=2.05):
    out = 0; amp = 1; tot = 0
    for o_ in range(octs):
        n_ = 1 - np.abs(2 * nz(seed + o_, wx / lac ** o_, wz / lac ** o_) - 1); out = out + n_ * n_ * amp; tot += amp; amp *= gain
    return out / tot
zb = lambda c, w: np.exp(-((ZS - c) / w) ** 2)
BASE = 1900 - 112 * ZS ** .85
_sf = (env_f / 560)[None, :] * sm((D - 1786) / 330)[None, :]
HT = (640 * (env_m / 780)[None, :] ** .8 * gate[None, :] * zb(.5, .22) * (.46 + .64 * ridged(11, 640, .5, 6, .5))        # the two massifs
      + 430 * _sf * zb(.74, .09) * (.4 + .7 * ridged(71, 520, .4, 5))                                                    # a second row behind them
      + (122 + 420 * _sf) * zb(.94, .055) * (.32 + .78 * ridged(21, 520, .3, 6))                                         # the far range, right across the back
      + (96 + 60 * side[None, :]) * zb(.8, .05) * (.3 + .55 * nz(81, 620, .4) + .3 * ridged(82, 300, .2, 4))             # rolling hills, far...
      + (92 + 50 * side[None, :]) * zb(.63, .055) * (.25 + .65 * nz(41, 480, .4) + .25 * ridged(42, 260, .2, 4))
      + (82 + 60 * side[None, :]) * zb(.44, .06) * (.25 + .65 * nz(91, 560, .4) + .25 * ridged(92, 240, .2, 4))
      + (58 + 150 * side[None, :]) * zb(.2, .12) * (.3 + .5 * nz(31, 520, .5) + .45 * ridged(32, 300, .22, 4)))          # ...to near
ALT = HT + 470 * sm((ZS - .86) / .05)             # the far range is high country: it carries snow when the near hills don't
_kc = (X >= KEEPD[0] - 8) & (X <= KEEPD[2] + 8)
HT[:, _kc] = np.minimum(HT[:, _kc], (BASE - (KEEPD[3] + 10)) * np.ones((1, int(_kc.sum())), np.float32))   # belt and braces
YTOP = BASE - HT; MVIS = np.minimum.accumulate(YTOP, axis=0)
_dhx = np.gradient(HT, axis=1) * S; _dhz = np.gradient(HT, axis=0) / (ZDEPTH / K)
SLOPE = np.hypot(_dhx, _dhz); _nn = np.sqrt(_dhx ** 2 + 1 + _dhz ** 2)
NX, NY, NZ = -_dhx / _nn, 1 / _nn, -_dhz / _nn
IDX = np.empty((H, W), np.int32); _yr = -Y[:, 0]
for _x in range(W): IDX[:, _x] = np.searchsorted(-MVIS[:, _x], _yr, side="left")
LAND = IDX < K; IDXC = np.minimum(IDX, K - 1); COLS = np.broadcast_to(np.arange(W)[None, :], (H, W))
N_SNOW, N_FOR, N_PATCH = nz(51, 150, .09), nz(52, 180, .1), nz(53, 34, .02)
_dx = np.maximum(np.maximum(KEEPD[0] - X, X - KEEPD[2]), 0)[None, :]; _dy = np.maximum(np.maximum(KEEPD[1] - Y, Y - KEEPD[3]), 0)
DIST = np.hypot(_dx, _dy)                            # distance outside the lettering zone (0 inside)

PH = {  # sky from the top of the screen to the horizon; sun colour; two glows round the sun; cloud and snow tones
 "dawn":  dict(stops=[(0, "#0a1230"), (.4, "#1a2452"), (.68, "#3d3566"), (.86, "#6e4570"), (.95, "#96586f"), (1, "#b87a70")], dark="#0c0c18",
               sun="#ffc49a", glowA=("#f08a78", .5, .30, .2), glowB=("#ffcf96", .7, .1, .085), stars=.3, light=.6, cl=("#ffbfa6", "#55486e"), snow=("#ffd6c2", "#5f6492")),
 "day":   dict(stops=[(0, "#08204a"), (.45, "#12407a"), (.8, "#245c94"), (.95, "#3b79ab"), (1, "#5f93bd")], dark="#081425",
               sun="#fff1d0", glowA=("#a5cdea", .28, .9, .1), glowB=("#ffffff", .0, .1, .1), stars=0, light=1.0, cl=("#dfe7f2", "#5f79a6"), snow=("#f3f6fb", "#6f8fc0")),
 "gold":  dict(stops=[(0, "#0d1838"), (.4, "#27305c"), (.66, "#5a4266"), (.84, "#8c5058"), (.94, "#b86a40"), (1, "#c98238")], dark="#0d0b13",
               sun="#ffb663", glowA=("#ff8a4a", .52, .28, .2), glowB=("#ffd480", .75, .1, .085), stars=.08, light=.95, cl=("#ffb070", "#5c4666"), snow=("#ffc79a", "#6a5f92")),
 "dusk":  dict(stops=[(0, "#070c22"), (.45, "#161a48"), (.72, "#3a2a66"), (.88, "#6a3570"), (.96, "#8f4668"), (1, "#a85a5a")], dark="#090818",
               sun="#e58aa4", glowA=("#c8508a", .45, .32, .2), glowB=("#ff9a5a", .55, .12, .06), stars=.5, light=.34, cl=("#e0809c", "#322c58"), snow=("#d79ab8", "#454a80")),
 "night": dict(stops=[(0, "#03050d"), (.55, "#080d22"), (.85, "#101a3c"), (1, "#1b2a55")], dark="#04060d",
               sun="#c9d6f2", glowA=("#3a4f8a", .28, .9, .14), glowB=("#ffffff", 0, .1, .1), stars=1, light=.3, cl=("#8fa0c8", "#161c36"), snow=("#a9b8dc", "#2a355c")),
}
SEASONS = {
 "spring": dict(snowline=1420, ground=(70, 118, 66), conifer=(38, 86, 66), leaves=[(126, 178, 96), (150, 196, 110), (104, 160, 90), (238, 170, 190), (246, 216, 226)], bare=.0, frozen=False),
 "summer": dict(snowline=1090, ground=(56, 102, 56), conifer=(28, 74, 56), leaves=[(58, 128, 74), (46, 110, 66), (80, 140, 70), (66, 122, 60)], bare=.0, frozen=False),
 "autumn": dict(snowline=1290, ground=(118, 96, 54), conifer=(30, 68, 54), leaves=[(232, 178, 52), (206, 78, 40), (226, 122, 40), (150, 84, 42), (240, 200, 70), (96, 122, 60)], bare=.14, frozen=False),
 "winter": dict(snowline=2400, ground=(196, 206, 226), conifer=(24, 56, 50), leaves=[], bare=1.0, frozen=True),
}


# ------------------------------------------------------------------ tree shapes (drawn once, stamped thousands of times)
SP = 560
_su = ((np.arange(SP) + .5) / SP * 2 - 1)[None, :].astype(np.float32); _sv = ((np.arange(SP) + .5) / SP)[:, None].astype(np.float32)
def sn2(seed, cells):
    a = np.random.default_rng(seed).random((cells + 3, cells + 3)).astype(np.float32)
    return np.clip(np.asarray(Image.fromarray(a, "F").resize((SP, SP), Image.BICUBIC), np.float32), 0, 1)
def _pack(A, T, Wd, Sn):
    m = (A + Wd) > .02; cols = np.where(m.any(axis=0))[0]; half = max(8, int(max(SP / 2 - cols.min(), cols.max() - SP / 2)) + 3)
    c0, c1 = SP // 2 - half, SP // 2 + half
    return dict(A=A[:, c0:c1], T=np.clip(T, 0, 1)[:, c0:c1], Wd=Wd[:, c0:c1], Sn=Sn[:, c0:c1], asp=(c1 - c0) / SP)
def conifer_sprite(seed, slim=.3, tiers=9, droop=.5, bare=.0, gaps=.0):
    vv = np.clip((_sv - .015) / .9, 0, 1)
    tv = (vv + droop * np.abs(_su) * .3) * tiers + .3 * (sn2(seed + 1, 6) - .5); fr = tv - np.floor(tv)
    w = slim * vv ** .8 * (.4 + .6 * fr ** .5) * (1 + .3 * (sn2(seed, 26) - .5))        # boughs flare out and droop, tier by tier
    leaf = (np.abs(_su) < w) & (_sv < .925) & (vv > bare)
    if gaps: leaf &= (sn2(seed + 3, 18) + .3 * fr) > gaps
    wood = (np.abs(_su) < .013 + .017 * _sv) & (_sv > .1)
    T = .5 + .36 * np.clip(_su / np.maximum(w, .02), -1, 1) + .36 * (.42 - fr) + .2 * (sn2(seed + 5, 34) - .5)
    snow = leaf & (fr < .46) & (sn2(seed + 7, 30) > .26)
    return _pack(leaf.astype(np.float32), T, (wood & ~leaf).astype(np.float32), snow.astype(np.float32))
def _branches(seed, top, length, width, depth, spread=(.25, .7)):
    im = Image.new("L", (SP, SP), 0); d = ImageDraw.Draw(im); rr = random.Random(seed)
    def br(x, y, a, l, w, dep):
        if dep == 0 or l < 3: return
        x2, y2 = x + math.sin(a) * l, y - math.cos(a) * l
        d.line([(x, y), (x2, y2)], fill=255, width=max(1, int(round(w))))
        for da in (rr.uniform(-spread[1], -spread[0]), rr.uniform(spread[0], spread[1])) + ((rr.uniform(-.14, .14),) if dep > 3 else ()):
            br(x2, y2, a + da, l * rr.uniform(.62, .78), w * .64, dep - 1)
    d.line([(SP / 2, SP * .998), (SP / 2, top)], fill=255, width=max(2, int(width)))
    br(SP / 2, top, rr.uniform(-.06, .06), length, width * .78, depth)
    return np.asarray(im, np.float32) / 255
def crown_sprite(seed, rxf, ryf, vc, thin=.0, trunk=.03):
    rr = random.Random(seed); Xp, Yp = _su * SP / 2, _sv * SP
    rx, ry, cy0 = rxf * SP, ryf * SP, vc * SP
    lobes = [(rr.uniform(-.38, .38) * rx, cy0 + rr.uniform(-.34, .3) * ry, rr.uniform(.5, .72)) for _ in range(5)]      # a few big boughs give the outline
    Z = np.zeros((SP, SP), np.float32)
    for i in range(int(300 * (1 - thin * .75))):                                             # hundreds of small leaf clusters fill them
        lx_, ly_, lr = rr.choice(lobes); a_ = rr.uniform(0, 6.28); q = rr.random() ** .5
        cx_, cy_ = lx_ + math.cos(a_) * q * rx * lr, ly_ + math.sin(a_) * q * ry * lr
        r = rr.uniform(.085, .15) * min(rx, ry)
        Z = np.maximum(Z, np.sqrt(np.clip(r * r - (Xp - cx_) ** 2 - (Yp - cy_) ** 2, 0, None)))
    A = (Z > 0).astype(np.float32)
    gy_, gx_ = np.gradient(Z); nz_ = 1 / np.sqrt(gx_ ** 2 + gy_ ** 2 + 1)
    leafy = (-gx_ * .58 + gy_ * .62 + .5) * nz_
    form = .5 + .5 * np.clip(Xp / rx * .62 - (Yp - cy0) / ry * .7, -1, 1)                    # the whole crown: light above and to one side
    T = .62 * form + .38 * (.1 + .8 * leafy)
    wood = _branches(seed + 9, cy0 + ry * .5, ry * .62, SP * trunk, 5 if thin else 4)
    return _pack(A, T, wood * (1 - A), np.zeros_like(A))
def bare_sprite(seed, spread=(.25, .7), trunk=.03, reach=.2):
    wood = _branches(seed, SP * .64, SP * reach, SP * trunk, 7, spread)
    return _pack(np.zeros((SP, SP), np.float32), np.full((SP, SP), .45, np.float32), wood, np.zeros((SP, SP), np.float32))
SPRITES = {
  "spruce": [conifer_sprite(10 + i, .30, 9, .5) for i in range(3)], "fir": [conifer_sprite(20 + i, .2, 12, .35) for i in range(3)],
  "pine": [conifer_sprite(30 + i, .34, 6, .7, bare=.3, gaps=.42) for i in range(2)], "larch": [conifer_sprite(40 + i, .26, 9, .6, gaps=.5) for i in range(2)],
  "oak": [crown_sprite(50 + i, .4, .3, .38) for i in range(3)], "maple": [crown_sprite(60 + i, .33, .33, .39) for i in range(3)],
  "aspen": [crown_sprite(70 + i, .19, .34, .40) for i in range(3)], "birch": [crown_sprite(80 + i, .18, .36, .41, trunk=.024) for i in range(2)],
  "poplar": [crown_sprite(90 + i, .115, .42, .46) for i in range(2)],
  "bare_wide": [bare_sprite(100 + i, (.3, .8), .034, .2) for i in range(3)], "bare_slim": [bare_sprite(110 + i, (.15, .45), .026, .22) for i in range(3)],
}
for k_, a_ in dict(oak=(.4, .3, .38), maple=(.33, .33, .39), aspen=(.19, .34, .40), birch=(.18, .36, .41), poplar=(.115, .42, .46)).items():
    SPRITES[k_ + "_thin"] = [crown_sprite(200 + len(k_) * 7 + i, a_[0], a_[1], a_[2], thin=.55 + .25 * i) for i in range(2)]
SPRITES["shrub"] = [crown_sprite(300 + i, .4, .2, .775, trunk=.012) for i in range(3)]
SPRITES["bare_shrub"] = [_pack(np.zeros((SP, SP), np.float32), np.full((SP, SP), .45, np.float32), _branches(320 + i, SP * .93, SP * .1, SP * .012, 6, (.3, .9)), np.zeros((SP, SP), np.float32)) for i in range(3)]
_spr_cache = {}
def sprite_at(spr, hpx, flip):
    key = (id(spr), hpx, flip)
    if key not in _spr_cache:
        wpx = max(2, round(hpx * spr["asp"]))
        def rz(a, mode):
            arr = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((wpx, hpx), mode), np.float32) / 255
            return arr[:, ::-1] if flip else arr
        _spr_cache[key] = (rz(spr["A"], Image.LANCZOS), rz(spr["T"], Image.BILINEAR), rz(spr["Wd"], Image.LANCZOS), rz(spr["Sn"], Image.BILINEAR))
    return _spr_cache[key]

FORESTM = sm((300 - HT + 90 * (N_FOR - .5)) / 70) * sm((1.25 - SLOPE) / .5) * sm((N_FOR - .55) / .1) * sm((.72 - ZS) / .08)
N_STAND = nz(54, 300, .16)

def sun_pos(t):
    alt = min(1.0, math.sin(math.pi * t) / 0.8)
    x = 60 + (t / .3) * 650 if t < .3 else 710 + ((t - .3) / .4) * 3700 if t < .7 else 4410 + ((t - .7) / .3) * 650
    return x, 1500 - alt * (1500 - 105)

def cloud_field(specs, seed):
    """Puffy, flat-bottomed clouds as a density image. specs: (centre x, base y, half-width, height)."""
    im = Image.new("L", (W, H), 0); d = ImageDraw.Draw(im); r = random.Random(seed)
    for (cx, by, hw, ht) in specs:
        n = max(5, int(hw / 42))
        for i in range(n):
            t = (i + .5) / n; x = cx + (t * 2 - 1) * hw + r.uniform(-18, 18)
            rad = ht * (.34 + .66 * math.sin(math.pi * t) ** .8) * r.uniform(.7, 1.1)
            d.ellipse([(x - rad * 1.15) * S, (by - rad * 1.7) * S, (x + rad * 1.15) * S, (by + rad * .12) * S], fill=255)
            if r.random() < .6:
                r2 = rad * r.uniform(.4, .6); x2 = x + r.uniform(-.5, .5) * rad; y2 = by - rad * r.uniform(1.2, 1.7)
                d.ellipse([(x2 - r2) * S, (y2 - r2) * S, (x2 + r2) * S, (y2 + r2) * S], fill=255)
    return im

def build(phase, minute, season, weather, seed=11, box=None, ink=None):
    p, se = PH[phase], SEASONS[season]
    scenery = np.zeros((H, W), bool)
    wet = weather in ("rain", "snow"); cloudy = weather in ("few", "broken", "rain", "snow", "mist")
    # ---------------- sky
    yn = np.clip(Y[:, 0] / HZ, 0, 1); col = np.zeros((H, 3), np.float32)
    for (a, ca), (b, cb) in zip(p["stops"], p["stops"][1:]):
        m = (yn >= a) & (yn <= b); t = sm((yn[m] - a) / (b - a))[:, None]; col[m] = hexc(ca) * (1 - t) + hexc(cb) * t
    img = np.repeat(col[:, None, :], W, axis=1)
    up = RISE < minute < SET
    t = (minute - RISE) / (SET - RISE) if up else ((minute - SET) % 1440) / (1440 - (SET - RISE))
    sx, sy = sun_pos(t)
    if OPEN:
        peak_y = ({"summer": 240, "spring": 430, "autumn": 430, "winter": 660}[season] if up else 330)
        sx, sy = 380 + t * 4360, 1560 - math.sin(math.pi * t) ** .8 * (1560 - peak_y)
        if box:                                           # the disc itself rides just over the top line of the words; only its glow passes behind them
            over = float(sm((sx - (box[0] - 330)) / 260) * sm(((box[2] + 330) - sx) / 260))
            sy = sy * (1 - over) + min(sy, max(96, box[1] - 125)) * over
    gx0 = sx if phase != "dusk" else 4950.0           # at dusk the afterglow stays where the sun went down
    calm = .42 + .58 * sm(DIST / 700)                 # the strongest colour stays out to the sides, away from the words
    for (gc, ga, gsx, gsy) in (p["glowA"], p["glowB"]):
        if ga <= 0: continue
        g = (np.exp(-((X - gx0) / (5120 * gsx)) ** 2)[None, :] * np.exp(-(np.clip(HZ - Y, 0, None) / (2160 * gsy)) ** 2) * ga * (.55 if wet else 1) * calm)[..., None]
        img = img * (1 - g) + hexc(gc) * g
    if wet: img = img * .78 + img.mean(axis=2, keepdims=True) * .14
    haze = img[min(H - 1, round((HZ - 46) * S))].copy()
    suncol = hexc(p["sun"]); dark = hexc(p["dark"]); L = p["light"] * (.6 if wet else 1)
    lightx = float(np.clip(((gx0 if phase == "dusk" else sx) - 2560) / 1500, -1, 1)); top = 1 - abs(lightx)

    # ---------------- stars, then the sun or moon
    layer = Image.new("RGB", (W, H), (0, 0, 0)); dr = ImageDraw.Draw(layer); rnd = random.Random(seed)
    for _ in range(int(980 * p["stars"] * (.2 if wet else 1))):
        x, yv = rnd.random() * 5120, rnd.random() ** 1.4 * HZ * 0.92
        r = rnd.choice([1.1, 1.3, 1.6, 2.1, 2.8]); b = int((90 + rnd.random() * 150) * min(1, .45 + p["stars"]))
        dr.ellipse([(x - r) * S, (yv - r) * S, (x + r) * S, (yv + r) * S], fill=(b, b, int(min(255, b * 1.1))))
    dim = .5 if wet else 1; rr = 30 if up else 26
    dr.ellipse([(sx - rr) * S, (sy - rr) * S, (sx + rr) * S, (sy + rr) * S], fill=ti(suncol * dim if up else np.array([226, 230, 244]) * dim))
    add = np.asarray(layer, np.float32) + np.asarray(blur(layer, 26), np.float32) * 1.5
    if up:
        halo = Image.new("L", (W, H), 0); ImageDraw.Draw(halo).ellipse([(sx - 105) * S, (sy - 105) * S, (sx + 105) * S, (sy + 105) * S], fill=int(120 * dim))
        add += np.asarray(blur(halo, 70), np.float32)[..., None] * (suncol / 255)
    else:
        bite = Image.new("L", (W, H), 0); ImageDraw.Draw(bite).ellipse([(sx - 4) * S, (sy - 38) * S, (sx + 54) * S, (sy + 20) * S], fill=255)
        add *= (1 - np.asarray(blur(bite, 1.2), np.float32)[..., None] / 255)
    img = img + add * (1 - img / 255)
    if not OPEN: scenery |= (X[None, :] - sx) ** 2 + (Y - sy) ** 2 < 34 ** 2

    # ---------------- clouds: groups of sculpted puffs, shaded in the same three flat tones as the land
    lpos = ((sx, sy) if phase != "dusk" else (gx0, float(HZ)))
    cn = noise2(seed + 60, 240, 150) * .42 + np.abs(2 * noise2(seed + 61, 120, 84) - 1) * .3 + noise2(seed + 62, 56, 40) * .18 + noise2(seed + 63, 24, 18) * .1
    def fogbank(regions, strength=.94, thresh=.33, edge=.07, flat=False):
        nonlocal img, scenery
        if not regions: return
        dens = np.zeros((H, W), np.float32)
        for (cx, by, hw, hh) in regions:
            u_ = (X[None, :] - cx) / hw; v_ = (by - Y) / hh
            dens = np.maximum(dens, np.clip(1 - u_ * u_, 0, 1) ** .7 * sm(v_ / .1) * np.clip(1 - v_, 0, 1) ** .55)
        d_ = (dens * sm((DIST - 70) / 190)) ** .8 * (.2 + 1.25 * cn) - thresh
        alpha = sm(d_ / edge) * strength * sm(DIST / 90)                     # never over the words
        Db = np.asarray(blur(Image.fromarray((np.clip(d_ * 2.4 + .25, 0, 1) * 255).astype(np.uint8)), 22), np.float32) / 255
        o = max(2, round(18 * S)); gxx = np.roll(Db, -o, 1) - np.roll(Db, o, 1); gyy = np.roll(Db, -o, 0) - np.roll(Db, o, 0)
        gxx[:, :o] = gxx[:, o:o + 1]; gxx[:, -o:] = gxx[:, -o - 1:-o]; gyy[:o] = gyy[o:o + 1]; gyy[-o:] = gyy[-o - 1:-o]      # no wrap-round at the screen edges
        lx_, ly_ = lpos[0] - X[None, :], lpos[1] - Y; n_ = np.hypot(lx_, ly_) + 1
        broad = np.zeros((H, W), np.float32)
        for (cx, by, hw, hh) in regions:                                     # the side of each cloud nearest the light
            w_ = np.clip(1 - np.abs(X[None, :] - cx) / (hw * 1.2), 0, 1) * np.clip(1 - np.abs(by - hh * .5 - Y) / (hh * 1.2), 0, 1)
            vx_, vy_ = lpos[0] - cx, lpos[1] - (by - hh * .5); nn_ = math.hypot(vx_, vy_) + 1
            broad += w_ * (((X[None, :] - cx) / hw) * vx_ / nn_ + ((Y - (by - hh * .5)) / hh) * vy_ / nn_ * 1.3)
        tone = sm(.42 + broad * .55 - (lx_ / n_ * gxx + ly_ / n_ * gyy) * 2.2)
        if flat: tone = tone * .25 + .6
        prox = np.exp(-n_ / 1400)[..., None]
        sh = hexc(p["cl"][1]) * .52 + haze[None, :, :] * .48
        lit = np.minimum(hexc(p["cl"][0]) * (.66 + .34 * prox) * (.7 if wet else 1), 255)
        cc = sh * (1 - tone[..., None]) + lit * tone[..., None]
        img = img * (1 - alpha[..., None]) + cc * alpha[..., None]
        scenery |= alpha > .02
    cl_sh = hexc(p["cl"][1]) * .56 + haze * .44; cl_lit = np.minimum(hexc(p["cl"][0]) * (.74 if wet else 1.0), 255)
    def cumulus(specs):
        nonlocal img, scenery
        for (cx, by, w, h, far, kind) in specs:
            rr = random.Random(int(cx * 7 + by * 13) + len(kind))
            x0, x1, y0, y1 = cx - w * .5 - 50 - h * .35, cx + w * .5 + 50 + h * .35, by - h * 1.3 - 30, by + h * .22 + 14
            if not OPEN and x1 > KEEPD[0] - 40 and x0 < KEEPD[2] + 40 and y1 > KEEPD[1] - 40 and y0 < KEEPD[3] + 40: continue      # never near the words
            px0, px1 = max(0, int(x0 * S)), min(W, int(x1 * S) + 1); py0, py1 = max(0, int(y0 * S)), min(H, int(y1 * S) + 1)
            if px1 - px0 < 3 or py1 - py0 < 3: continue
            Xl, Yl = X[px0:px1][None, :], Y[py0:py1]
            lxv, lyv = lpos[0] - cx, lpos[1] - (by - h * .5); nrm = math.hypot(lxv, lyv) + 1
            dx_, dy_ = lxv / nrm * .8, lyv / nrm * .8 - .5; dn = math.hypot(dx_, dy_) + 1e-6; dx_, dy_ = dx_ / dn, dy_ / dn       # toward the light, with some sky light from above
            prox = math.exp(-nrm / 1500); sky_here = img[py0:py1, px0:px1].mean(axis=(0, 1))
            sh_ = (hexc(p["cl"][1]) * .5 + sky_here * .5)[None, None, :]; lit_ = np.minimum(cl_lit * (.66 + .3 * prox), 255)[None, None, :]
            veil = (1 - .5 * (1 - sm(DIST[py0:py1, px0:px1] / 150))) if OPEN else 1.0       # thinner where it drifts behind the words
            if kind == "wisp":                                                           # high streaks of ice cloud: a few tapered, curved strokes
                lay = Image.new("L", (px1 - px0, py1 - py0), 0); d_ = ImageDraw.Draw(lay); slope = rr.uniform(-.1, .1)
                for _k in range(rr.randint(3, 6)):
                    yy = by - h * rr.uniform(.08, .95); xa = cx - w * .5 * rr.uniform(.45, 1); xb = cx + w * .5 * rr.uniform(.45, 1); curl = rr.uniform(-.3, .3) * h; hook = rr.uniform(-.5, .5) * h
                    prev = None
                    for j in range(25):
                        u = j / 24; q = ((xa + (xb - xa) * u) * S - px0, (yy + slope * (u - .5) * w + curl * math.sin(math.pi * u) + hook * u ** 3) * S - py0)
                        if prev: d_.line([prev, q], fill=int(255 * math.sin(math.pi * u) ** .6), width=max(1, round(h * .075 * math.sin(math.pi * u) ** .7 * S)))
                        prev = q
                a_ = np.asarray(blur(lay, h * .045 * S + 1.2), np.float32) / 255 * .5 * veil
                c = lit_ * .72 + sh_ * .28
                img[py0:py1, px0:px1] = img[py0:py1, px0:px1] * (1 - a_[..., None]) + c * a_[..., None]
                if not OPEN: scenery[py0:py1, px0:px1] |= a_ > .02
                continue
            flat = kind == "bank"; cores = []
            if kind == "tower":                                                          # masses stacked on a broad foot, leaning a little
                lean = rr.uniform(-.1, .1) * h; k_n = rr.randint(3, 4)
                for k_ in range(k_n):
                    u = k_ / (k_n - 1); R = h * (.34 - .14 * u) * rr.uniform(.9, 1.1)
                    cores.append((cx + lean * u + rr.uniform(-.06, .06) * h, by - R * .7 - u * h * .56, R))
                for sg in (-1, 1): cores.append((cx + sg * w * rr.uniform(.22, .32), by - h * .15, h * rr.uniform(.2, .27)))
            else:                                                                        # masses side by side along the base, one part of the cloud tallest
                pk = rr.uniform(.2, .8); x_ = cx - w * .5; first = True
                while True:
                    t_ = (x_ - (cx - w * .5)) / w
                    e_ = (rr.uniform(.72, 1.0) if flat else (.52 + .48 * math.exp(-((t_ - pk) / rr.uniform(.24, .36)) ** 2)) * rr.uniform(.82, 1.05))
                    R = h * (.5 if flat else .42) * e_
                    if first: x_ += R; first = False
                    if x_ + R > cx + w * .5 and len(cores) >= 2: break
                    cores.append((x_, by - R * rr.uniform(.45, .72), R)); x_ += R * rr.uniform(1.0, 1.35)
            puffs = []
            for (x_, y_, R) in cores:                                                    # each mass buds smaller turrets, and those bud smaller ones still
                puffs.append((x_, y_, R, True))
                for _b in range(rr.randint(2, 3) if flat else rr.randint(3, 5)):
                    a1 = math.radians(rr.uniform(-200, 20) if kind == "tower" else rr.uniform(-168, -12)); r1 = R * (rr.uniform(.3, .46) if flat else rr.uniform(.36, .6)); d1 = R * rr.uniform(.62, .9)
                    x1, y1 = x_ + math.cos(a1) * d1, y_ + math.sin(a1) * d1 * .92; puffs.append((x1, y1, r1, False))
                    for _c in range(rr.randint(1, 3)):
                        a2 = a1 + math.radians(rr.uniform(-70, 70)); r2 = r1 * rr.uniform(.4, .62); d2 = r1 * rr.uniform(.65, .9)
                        puffs.append((x1 + math.cos(a2) * d2, y1 + math.sin(a2) * d2, r2, False))
            sc = float(np.clip(h / (by - min(q[1] - q[2] for q in puffs)), .55, 1.12))     # bring the whole heap to the height asked for
            puffs = [(cx + (q[0] - cx) * sc, by - (by - q[1]) * sc, q[2] * sc, q[3]) for q in puffs if abs(q[0] - cx) * sc + q[2] * sc * 1.25 < w * .5 + 40 + h * .35]
            ext = .5 * (abs(dx_) * w + abs(dy_) * h) + 1
            M = np.zeros((py1 - py0, px1 - px0), np.float32); Lm = M.copy(); Hm = M.copy(); e_ = rr.uniform(2.4, 4.5)
            nzl = (cn[py0:py1, px0:px1] - .45) * .55                                      # the same drifting noise as the mist: no outline is a perfect circle
            for (ux, uy, r, core) in puffs:
                ax0, ax1 = max(0, int((ux - r * 1.45) * S) - px0), min(px1 - px0, int((ux + r * 1.45) * S) - px0 + 2)
                if ax1 <= ax0: continue
                Xs = Xl[:, ax0:ax1]; rn = r * (1 + nzl[:, ax0:ax1]); d2 = np.sqrt((Xs - ux) ** 2 + (Yl - uy) ** 2)
                m_ = sm((rn - d2) / e_ + .5)
                if core: m_ = np.maximum(m_, sm((rn * .86 - np.abs(Xs - ux)) / e_ + .5) * (Yl > uy))
                M[:, ax0:ax1] = np.maximum(M[:, ax0:ax1], m_)
                lf = float(np.clip(.8 + .5 * ((ux - cx) * dx_ + (uy - (by - h * .45)) * dy_) / ext, .34, 1))     # the side of the whole cloud that faces the light
                Lm[:, ax0:ax1] = np.maximum(Lm[:, ax0:ax1], lf * sm((rn * .86 - np.sqrt((Xs - ux - dx_ * r * .2) ** 2 + (Yl - uy - dy_ * r * .2) ** 2)) / (r * .34 + 3) + .5))
                Hm[:, ax0:ax1] = np.maximum(Hm[:, ax0:ax1], lf * sm((rn * .5 - np.sqrt((Xs - ux - dx_ * r * .4) ** 2 + (Yl - uy - dy_ * r * .4) ** 2)) / (r * .7 + 3) + .5))
            a_ = M * sm((by + h * .12 * nzl * 2 - Yl) / (h * .05 + 4)) * veil               # a level base, a little ragged
            gf = np.clip(.5 + .7 * ((Xl - cx) * dx_ + (Yl - (by - h * .45)) * dy_) / ext, 0, 1)
            tone = np.clip(.2 + .26 * gf + .42 * Lm + .22 * Hm - .26 * sm((Yl - (by - .3 * h)) / (.26 * h)), 0, 1)[..., None]
            c = sh_ * (1 - tone) + lit_ * tone
            c = c * (1 - far) + sky_here[None, None, :] * far                             # distant clouds sink into the air
            img[py0:py1, px0:px1] = img[py0:py1, px0:px1] * (1 - a_[..., None]) + c * a_[..., None]
            if not OPEN: scenery[py0:py1, px0:px1] |= a_ > .02
    rc = random.Random(seed + 40)
    cover = {"clear": 0, "few": .4, "mist": .35, "broken": .75, "rain": 1.0, "snow": 1.0}[weather]
    if not CLOUDS: cover = 0
    cons = []; r5 = random.Random(5); near_ink = None
    if OPEN and ink is not None:                          # constellations spread over the whole sky; a star never sits on a letter
        im_ink = Image.fromarray(((ink > .1) * 255).astype(np.uint8))
        inkd = np.asarray(blur(im_ink, 14), np.float32) / 255
        near_ink = np.clip(np.asarray(blur(im_ink, 70), np.float32) / 255 * 3, 0, 1)
        def clear(q):
            if not (120 < q[0] < 5000 and 110 < q[1] < (980 if (q[0] < 840 or q[0] > 4280) else 1470)): return False
            if math.hypot(q[0] - sx, q[1] - sy) < 190: return False
            return inkd[min(H - 1, int(q[1] * S)), min(W - 1, int(q[0] * S))] < .04
        centres = []
        for (n, lit_n, c) in [(5, 2, "#8fb4ff"), (6, 4, "#8fe0b0"), (4, 1, "#f0b75a"), (5, 5, "#c9a8ff"), (7, 3, "#ff9fb0"), (4, 4, "#9fd8ff"), (6, 0, "#b8c4e8")]:
            for _t in range(400):
                cx, cy = r5.uniform(240, 4880), r5.uniform(200, 1300)
                if clear((cx, cy)) and all(math.hypot(cx - o_[0], (cy - o_[1]) * 1.5) > 900 for o_ in centres): break
            else: continue
            centres.append((cx, cy)); pts = [(cx, cy)]; ang = r5.random() * 6.28
            for i in range(1, n):
                for _try in range(40):
                    a2 = ang + (0.7 + r5.random() * 1.2) * r5.choice([-1, 1]); Ln = 130 + r5.random() * 95
                    q = (pts[-1][0] + math.cos(a2) * Ln, pts[-1][1] + math.sin(a2) * Ln * .85)
                    if clear(q) and abs(q[1] - cy) < 250 and abs(q[0] - cx) < 430 and all(math.dist(q, o_) > 95 for o_ in pts): break
                else: break
                ang = a2; pts.append(q)
            if len(pts) >= 3: cons.append((pts, len(pts), min(lit_n, len(pts)), c))
    else:
      for (cx, cy, n, lit_n, c) in [(330, 250, 5, 2, "#8fb4ff"), (4760, 230, 6, 4, "#8fe0b0"), (4700, 570, 4, 1, "#f0b75a"), (380, 580, 5, 5, "#c9a8ff")]:
        pts = [(cx, cy)]; ang = r5.random() * 6.28
        for i in range(1, n):
            for _try in range(12):
                a2 = ang + (0.7 + r5.random() * 1.2) * r5.choice([-1, 1]); Ln = 105 + r5.random() * 60
                q = (pts[-1][0] + math.cos(a2) * Ln, pts[-1][1] + math.sin(a2) * Ln * .85)
                if (110 < q[0] < 700 or 4420 < q[0] < 5010) and abs(q[1] - cy) < 150 and all(math.dist(q, o_) > 70 for o_ in pts): break
            ang = a2; pts.append(q)
        cons.append((pts, n, lit_n, c))
    keep_pts = [(sx, sy, 150)]
    for (pts, n, lit_n, c) in cons:
        for i in range(n):
            keep_pts.append((pts[i][0], pts[i][1], 46))
            if i: keep_pts += [(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f_, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f_, 30) for f_ in (.25, .5, .75)]
    placed = []
    def place(lst, make, tries, olap=False):
        for k_ in range(tries):
            c_ = make(1 - .5 * k_ / tries); x0, x1, y0, y1 = c_[0] - c_[2] * .5 - 14, c_[0] + c_[2] * .5 + 14, c_[1] - c_[3] * 1.08 - 16, c_[1] + 14
            if y0 < 4 or y1 > 1600: continue
            if not OPEN and x1 > KEEPD[0] - 50 and x0 < KEEPD[2] + 50 and y1 > KEEPD[1] - 46 and y0 < KEEPD[3] + 46: continue
            if any(x0 - m_ < qx < x1 + m_ and y0 - m_ < qy < y1 + m_ for (qx, qy, m_) in keep_pts): continue
            if not olap and any(x0 < q[1] and x1 > q[0] and y0 < q[3] and y1 > q[2] for q in placed): continue
            placed.append((x0, x1, y0, y1)); lst.append(c_); return c_
    sky_clouds = []
    def add(kind, n, hr, ar, yr, olap=False, tries=40):
        for _ in range(n):
            def mk(k):
                by = rc.uniform(*yr); f = 1 - .5 * float(np.clip((by - 250) / 1250, 0, 1))        # smaller toward the horizon
                h_ = rc.uniform(*hr) * f * k; w_ = h_ * rc.uniform(*ar)
                x = rc.uniform(-100, 5220) if OPEN or rc.random() < .35 else rc.choice([rc.uniform(-80, 760), rc.uniform(4360, 5200)])
                return (x, by, w_, h_, .05 + .3 * ((1 - f) / .5) ** 1.5, "heap" if kind == "puffs" else kind)
            got = place(sky_clouds, mk, tries, olap)
            if got and kind == "puffs":                                                  # a little family: one or two smaller ones drifting alongside
                for _j in range(rc.randint(1, 2)):
                    sg = rc.choice([-1, 1]); k2 = rc.uniform(.45, .72)
                    place(sky_clouds, lambda k, g=got, sg=sg, k2=k2: (g[0] + sg * g[2] * rc.uniform(.75, 1.15), g[1] + g[3] * rc.uniform(-.25, .5), g[2] * k2, g[3] * k2, g[4], "heap"), 3)
    if cover:
        if weather == "few":
            add("wisp", 3, (90, 170), (4, 8), (130, 700)); add("tower", 1, (240, 330), (1.2, 1.7), (800, 1350)); add("heap", 3, (90, 170), (1.8, 3.4), (250, 1200))
            add("puffs", 3, (50, 80), (1.8, 2.8), (200, 1300)); add("bank", 2, (30, 46), (5, 9), (1150, 1560))
        elif weather == "mist":
            add("wisp", 3, (90, 160), (4, 8), (130, 650)); add("bank", 2, (60, 90), (3.2, 5), (200, 800)); add("heap", 2, (90, 150), (2, 3.2), (250, 1100))
            add("puffs", 2, (50, 76), (1.8, 2.8), (200, 1200))
        elif weather == "broken":
            add("heap", 2, (230, 330), (2.0, 3.0), (420, 1150)); add("tower", 1, (220, 320), (1.2, 1.7), (700, 1350)); add("bank", 4, (64, 110), (3.2, 5), (130, 900))
            add("heap", 5, (100, 190), (1.8, 3.4), (200, 1250)); add("puffs", 3, (50, 84), (1.8, 2.8), (200, 1350)); add("wisp", 2, (90, 150), (4, 8), (130, 520))
            add("bank", 3, (30, 46), (5, 9), (1150, 1560))
        else:                                                                             # rain or snow: a heavy layered deck, with loose cloud under it
            add("heap", 3, (170, 260), (2, 3), (420, 900)); add("heap", 5, (110, 200), (2, 3.4), (500, 1250)); add("puffs", 2, (56, 84), (1.8, 2.8), (700, 1350))
            add("bank", 4, (30, 46), (5, 9), (1150, 1560))
        if wet:
            d_ = cn * .95 + .8 * (1 - Y / 640) - .66
            al = sm(d_ / .2) * .9 * ((1 - .5 * (1 - sm(DIST / 150))) if OPEN else sm(DIST / 120))
            tn = (.2 + .5 * sm((cn - .36) / .3))[..., None]
            c_ = (hexc(p["cl"][1]) * .55 + img * .45) * (1 - tn) + cl_lit[None, None, :] * .8 * tn
            img = img * (1 - al[..., None]) + c_ * al[..., None]
            if not OPEN: scenery |= al > .02
        cumulus(sorted(sky_clouds, key=lambda q: (q[5] != "wisp", -q[1])))                 # wisps are highest and farthest; then far (low) ones first

    # ---------------- sample constellations (your projects), always on top of the clouds
    cl = Image.new("RGB", (W, H), (0, 0, 0)); cd = ImageDraw.Draw(cl)
    for (pts, n, lit_n, c) in cons:
        c3 = hexc(c); P_ = [(a * S, b * S) for a, b in pts]
        for i in range(1, n):
            a, b = P_[i - 1], P_[i]
            if i < lit_n: cd.line([a, b], fill=ti(c3 * .66), width=max(1, round(3 * S)))
            else:
                steps = max(2, int(math.dist(a, b) / (22 * S)))
                for s_ in range(0, steps, 2):
                    cd.line([(a[0] + (b[0] - a[0]) * s_ / steps, a[1] + (b[1] - a[1]) * s_ / steps), (a[0] + (b[0] - a[0]) * (s_ + 1) / steps, a[1] + (b[1] - a[1]) * (s_ + 1) / steps)], fill=ti(c3 * .36), width=max(1, round(2 * S)))
        for i, (x, yv) in enumerate(P_):
            if i < lit_n: r = (6 + r5.random() * 4) * S; cd.ellipse([x - r, yv - r, x + r, yv + r], fill=ti(c3 * .5 + 140))
            else: cd.ellipse([x - 5 * S, yv - 5 * S, x + 5 * S, yv + 5 * S], outline=ti(c3 * .6), width=max(1, round(2 * S)))
    addc = np.asarray(cl, np.float32) + np.asarray(blur(cl, 22), np.float32) * 1.4
    if near_ink is not None: addc *= (1 - .4 * near_ink)[..., None]              # a little quieter right among the words
    img = img + addc * (1 - img / 255)

    # ---------------- the land, lit from where the light really is; snow lies on what is high and not too steep
    winter = se["frozen"]
    snow_lit, snow_sh = hexc(p["snow"][0]) * (.4 + .3 * L), hexc(p["snow"][1]) * (.5 + .16 * L)
    alt = max(.06, min(1.0, math.sin(math.pi * t) / .8)) if phase != "dusk" else .05
    ld = np.array([lightx * .9, .22 + .7 * alt, -.4], np.float32); ld /= np.linalg.norm(ld)
    lam = np.clip(NX * ld[0] + NY * ld[1] + NZ * ld[2], 0, 1)
    tone = poster(lam ** .85 * 1.15, 3)[..., None]
    kd = (.9 - .42 * ZS)[..., None]
    sh = haze[None, :, :] * (1 - kd) + dark * kd
    rock = sh * (.74 + .14 * NY[..., None]) + suncol * (tone * .24 * L * (.55 + .45 * ZS[..., None] ** .5))
    forest = (sm((300 - HT + 90 * (N_FOR - .5)) / 70) * sm((1.25 - SLOPE) / .5) * sm((.8 - ZS) / .1))[..., None]
    if not winter:
        lv = np.array(se["leaves"][:4], np.float32); con = np.array(se["conifer"], np.float32)
        pick = np.clip((N_PATCH * 4.4 - .2), 0, 3.999).astype(int)
        leafmix = sm((N_PATCH - .5) / .16)[..., None] * (.6 if season == "autumn" else .35)
        tint = con * (1 - leafmix) + lv[pick] * leafmix
        rock = rock * (1 - .3 * forest) + tint * forest * (.03 + .15 * L * (.3 + .7 * tone))
    snow_alt = {"winter": -400, "spring": 400, "summer": 650, "autumn": 500}[season]
    sn = (sm((ALT - snow_alt + 120 * (N_SNOW - .5)) / 46) * (1 - .86 * sm((SLOPE - (1.5 if winter else 1.05)) / .6)))[..., None]
    if winter: sn = np.maximum(sn, .82 * sm((1.0 - SLOPE) / .5)[..., None])
    snow_c = snow_sh * (1 - tone) + snow_lit * tone
    colk = rock * (1 - sn) + snow_c * sn
    air = np.clip(.03 + .62 * ZS ** 1.15 + .2 * sm((60 - HT) / 60) * ZS, 0, .82)[..., None]
    colk = colk * (1 - air) + haze[None, :, :] * air
    img = np.where(LAND[..., None], colk[IDXC, COLS], img); scenery |= LAND
    # ---------------- trees. First the forests on the hills and lower slopes, far to near
    flip = lightx < 0
    sil = haze * .09 + dark * .91
    def stamp(spr, x, base, h, pal, snowy=False):
        nonlocal img, scenery
        hpx = max(5, int(round(h * S))); hpx = max(5, int(round(1.07 ** round(math.log(hpx) / math.log(1.07)))))
        A, T, Wd, Sn = sprite_at(spr, hpx, flip)
        wpx = A.shape[1]; x0 = int(round(x * S - wpx / 2)); y0 = int(round(base * S)) - hpx
        cx0, cy0 = max(0, -x0), max(0, -y0); cx1, cy1 = min(wpx, W - x0), min(hpx, H - y0)
        if cx1 <= cx0 or cy1 <= cy0: return
        A, T, Wd, Sn = A[cy0:cy1, cx0:cx1, None], T[cy0:cy1, cx0:cx1], Wd[cy0:cy1, cx0:cx1, None], Sn[cy0:cy1, cx0:cx1, None]
        t_ = poster(T, 3)[..., None]
        c = np.where(t_ < .5, pal["sh"] + (pal["mid"] - pal["sh"]) * (t_ * 2), pal["mid"] + (pal["lit"] - pal["mid"]) * (t_ * 2 - 1))
        if snowy: c = c * (1 - Sn * .92) + (pal["ssh"] * (1 - t_) + pal["slit"] * t_) * Sn * .92
        al = A + Wd * (1 - A)
        reg = img[y0 + cy0:y0 + cy1, x0 + cx0:x0 + cx1]
        img[y0 + cy0:y0 + cy1, x0 + cx0:x0 + cx1] = reg * (1 - al) + c * A + pal["wood"] * Wd * (1 - A)
        scenery[y0 + cy0:y0 + cy1, x0 + cx0:x0 + cx1] |= al[..., 0] > .1
    def pal_for(c, air_, xi, wood=(74, 58, 52), quiet=0.0):
        s_, hz = sil[xi], haze[xi]; c = np.array(c, np.float32) * .9; v = (.12 + .46 * L) * (1 - .5 * air_) * (1 - quiet)
        f = lambda col: (s_ * (1 - v) + col * v) * (1 - air_) + hz * air_
        return dict(sh=f(c * .42), mid=f(c * .78), lit=f(np.minimum(c * 1.02 + suncol * .22, 255)), wood=f(np.array(wood, np.float32) * .8),
                    ssh=snow_sh * (1 - air_) + hz * air_, slit=snow_lit * (1 - air_) + hz * air_)
    def plant(k, x, base, h, air_=0.0, rnd_=None, quiet=0.0):
        rnd_ = rnd_ or rt
        if (x + .5 * h > KEEPD[0] - 12 and x - .5 * h < KEEPD[2] + 12) and base - h * 1.2 < KEEPD[3] + 8: return      # never up into the words
        xi = int(np.clip(x * S, 0, W - 1)); con = se["conifer"]
        if k in ("spruce", "fir", "pine"):
            c = {"spruce": con, "fir": mix(con, (20, 52, 64), .35), "pine": mix(con, (70, 104, 62), .3)}[k]
            return stamp(rnd_.choice(SPRITES[k]), x, base, h * {"spruce": 1, "fir": 1.15, "pine": 1.05}[k], pal_for(c, air_, xi, quiet=quiet), winter)
        if k == "larch":                                                # the conifer that turns gold and drops its needles
            if winter: return stamp(rnd_.choice(SPRITES["bare_slim"]), x, base, h, pal_for(con, air_, xi))
            return stamp(rnd_.choice(SPRITES["larch"]), x, base, h * 1.05, pal_for({"autumn": (226, 168, 54), "spring": (150, 196, 104)}.get(season, (74, 134, 74)), air_, xi))
        wood = (200, 200, 208) if k == "birch" else (74, 58, 52)
        if winter or rnd_.random() < se["bare"]:
            return stamp(rnd_.choice(SPRITES["bare_slim" if k in ("aspen", "birch", "poplar") else "bare_wide"]), x, base, h, pal_for(con, air_, xi, wood))
        c = {"oak": {"autumn": (150, 84, 42)}, "aspen": {"autumn": (236, 184, 54)}, "maple": {"autumn": rnd_.choice([(206, 78, 40), (226, 122, 40), (188, 52, 44)]), "spring": (238, 170, 190)},
             "poplar": {"autumn": (240, 200, 70)}, "birch": {"autumn": (232, 178, 52)}}[k].get(season) or rnd_.choice(se["leaves"][:3])
        if season == "spring" and k == "aspen" and rnd_.random() < .3: c = (246, 216, 226)
        thin = season == "autumn" and rnd_.random() < .38
        stamp(rnd_.choice(SPRITES[k + ("_thin" if thin else "")]), x, base, h, pal_for(c, air_, xi, wood))
    def pick(rnd_, conifers=.58):
        if rnd_.random() < conifers: return rnd_.choices(["spruce", "fir", "pine", "larch"], [45, 30, 13, 12])[0]
        return rnd_.choices(["oak", "maple", "aspen", "birch", "poplar"], [24, 22, 22, 18, 14])[0]
    rf = random.Random(77)
    for k in range(K - 1, -1, -max(1, K // 80)):
        z = float(ZS[k, 0])
        if z > .72: continue                                                             # the far hills and range stay open
        hgt = 13 + 64 * (1 - z) ** 1.5; x = rf.uniform(0, hgt); vis_ = YTOP[k] <= MVIS[k] + .6
        while x < 5120:
            i = min(W - 1, int(x * S)); fm = float(FORESTM[k, i])
            if fm > .4 and vis_[i] and rf.random() < fm * .9:
                st = float(N_STAND[k, i])                                                # trees grow in stands of their own kind
                kind = rf.choice(["spruce", "spruce", "fir"]) if st < .56 else "aspen" if st < .68 else "larch" if st < .75 else rf.choice(["maple", "oak", "birch", "spruce"])
                if not (winter and kind not in ("spruce", "fir", "pine") and z > .4):       # bare trees vanish at that distance
                    plant(kind, x, float(YTOP[k, i]) + 1.5, hgt * rf.uniform(.7, 1.3), min(.8, float(air[k, i, 0]) + .12), rf)
            x += hgt * rf.uniform(.22, .6)
    if weather in ("mist", "rain", "snow"):                                                  # fog lying in the valley
        fogbank([(rc.uniform(0, 5120), rc.uniform(1830, 1890), rc.uniform(520, 900), rc.uniform(70, 110)) for _ in range(8)], .5, .3, .16, True)

    # ---------------- the lake: the scene upside down, a little darker; frozen and pale in winter
    lake = (Y >= LAKE_Y) & (Y < NEAR[None, :])
    r0 = round(LAKE_Y * S); rows = np.arange(r0, H); src = np.clip(r0 - ((rows - r0) * 2.0).astype(int) - 2, 0, H - 1)
    refl = img[src] * .76 + dark * .08
    r4 = np.random.default_rng(seed)
    if not se["frozen"]:
        for i in range(len(rows)): refl[i] = np.roll(refl[i], int(r4.integers(-6, 7) * (1 + i / (50 * S)) * S), axis=0)
        refl *= 1 + (r4.random((len(rows), 1, 1)) - .5) * .1
    else:
        ice = snow_sh * .5 + snow_lit * .5
        refl = refl * .42 + ice[None, None, :] * .58 * (.9 + .2 * noise2(77, 400, 30)[r0:, :, None])
    img[r0:] = np.where(lake[r0:][..., None], refl, img[r0:]); scenery |= lake

    # ---------------- the near shore and meadow: dark like the rest, with a little of the season in it
    m = Y >= NEAR[None, :]
    gcol = np.array(se["ground"], np.float32); sil = haze * .09 + dark * .91
    gn = noise2(400, 260, 70)[..., None]
    if se["frozen"]: ks = .5 + .26 * L; near_c = sil[None, :, :] * (1 - ks) + (snow_sh * (.7 - .25 * L) + snow_lit * (.3 + .25 * L))[None, None, :] * (ks + .1 * gn)
    else: kg = .1 + .3 * L; near_c = sil[None, :, :] * (1 - kg) + gcol[None, None, :] * kg * (.62 + .5 * gn)
    fall = (.3 * sm((Y - NEAR[None, :]) / 300))[..., None]
    near_c = near_c * (1 - fall) + dark * fall
    img = np.where(m[..., None], near_c, img); scenery |= m

    # ---------------- the foreground: rocks first, then shrubs and trees from the back to the front, then grass and flowers
    rt = random.Random(21); rg = random.Random(31); grove, grove2 = noise1(900, 520), noise1(901, 170)
    lit_dir = 1 if lightx >= 0 else -1; v_g = .12 + .42 * L
    gseason = np.array({"spring": (96, 150, 72), "summer": (78, 128, 62), "autumn": (176, 142, 70), "winter": (150, 142, 128)}[season], np.float32)
    def meadow_y(i, t_): return float(NEAR[i]) + 8 + t_ * (2176 - float(NEAR[i]))         # t_: 0 at the shore, 1 at your feet
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); dr2 = ImageDraw.Draw(im)
    rockc = np.array((116, 112, 118), np.float32)
    for _ in range(34):                                                                    # boulders, lit on the side that faces the light
        x = rg.uniform(0, 5120); i = int(np.clip(x * S, 0, W - 1)); t_ = rg.random() ** .7; yb = meadow_y(i, t_)
        if yb > 2170: continue
        sz = rg.uniform(16, 44) * (.55 + 1.3 * t_); s_ = sil[i]
        base = s_ * (1 - v_g) + rockc * v_g * .75; shd = base * .62 + s_ * .2; lit = np.minimum(base + suncol * .2 * L, 255)
        n_ = rg.randint(6, 8); pts = [(x + math.cos(math.pi * (1 - k_ / (n_ - 1))) * sz * rg.uniform(.85, 1.1), yb - math.sin(math.pi * k_ / (n_ - 1)) * sz * rg.uniform(.5, .8)) for k_ in range(n_)]
        P_ = lambda q: [(a_ * S, b_ * S) for a_, b_ in q]
        apex = min(pts, key=lambda q: q[1]); mid_ = (x - lit_dir * sz * .12, yb)
        dr2.polygon(P_(pts), fill=ti(base))
        dark_side = [q for q in pts if (q[0] - apex[0]) * lit_dir <= 0]
        if len(dark_side) >= 2: dr2.polygon(P_(dark_side + [mid_]), fill=ti(shd))
        lit_side_ = [q for q in pts if (q[0] - apex[0]) * lit_dir >= 0][:3] + [(apex[0] + lit_dir * sz * .25, yb - sz * .22)]
        if len(lit_side_) >= 3: dr2.polygon(P_(lit_side_), fill=ti(lit))
        if winter: dr2.polygon(P_([q for q in pts if q[1] < yb - sz * .3] + [(x + sz * .3, yb - sz * .3), (x - sz * .3, yb - sz * .32)]), fill=ti(snow_sh * .5 + snow_lit * .5))
    img = np.asarray(im, np.float32)

    things = []                                                                            # (depth, draw) so nearer things overlap farther ones
    for (dy, sc_, air_, dens_) in ((4, .62, .12, 1.0), (12, .8, .06, .95), (22, 1.0, .0, .8), (40, 1.22, .0, .5), (72, 1.45, .0, .3), (112, 1.7, .0, .16)):
        x = rt.uniform(0, 40)
        while x < 5120:
            i = int(np.clip(x * S, 0, W - 1)); sd = float(side[i])
            clump = float(sm((grove[i] * (.45 + .55 * grove2[i]) - .34) / .1))
            d_ = float(np.clip(clump * (.34 + .66 * sd) * 1.15 + .5 * sd * (.4 + .6 * clump), 0, 1)) * dens_ * ((.35 + .65 * sd) if dy > 30 else 1)
            if rt.random() < d_:
                kind = pick(rt, .55); hh = rt.uniform(120, 250) * sc_ * (.6 + .4 * sd); yb = float(NEAR[i]) + dy
                hh = hh if kind in ("spruce", "fir", "pine", "larch") else min(hh, 215)
                if yb < 2185: things.append((yb, ("tree", kind, x, yb, hh, air_)))
            x += rt.uniform(24, 60) * sc_
    shrub_cols = {"spring": [(104, 160, 84), (128, 176, 96), (232, 168, 190)], "summer": [(62, 122, 70), (84, 136, 72), (50, 104, 64)],
                  "autumn": [(196, 84, 44), (222, 132, 46), (168, 110, 48), (132, 60, 50)], "winter": [(70, 60, 62)]}[season]
    for _ in range(170):                                                                   # shrubs, thicker toward the sides and near the groves
        x = rg.uniform(0, 5120); i = int(np.clip(x * S, 0, W - 1)); t_ = rg.random() ** .8
        if rg.random() > .35 + .65 * float(side[i]) * .8 + .4 * float(grove[i]): continue
        yb = meadow_y(i, t_)
        if yb < 2180: things.append((yb, ("shrub", x, yb, rg.uniform(46, 92) * (.55 + 1.1 * t_))))
    for (yb, th) in sorted(things, key=lambda q: q[0]):
        if th[0] == "tree": plant(th[1], th[2], th[3], th[4], th[5])
        else:
            xi = int(np.clip(th[1] * S, 0, W - 1))
            stamp(rg.choice(SPRITES["bare_shrub" if winter else "shrub"]), th[1], th[2] + 2, th[3], pal_for(rg.choice(shrub_cols), 0.0, xi, (70, 58, 56)), False)
    for (px, hh, kind) in [(-20, 520, "spruce"), (150, 650, "fir"), (360, 470, "spruce"), (560, 380, "fir"),
                           (5140, 540, "spruce"), (4975, 640, "fir"), (4770, 480, "spruce"), (4570, 370, "fir")]:
        plant(kind, px, 2196, hh, 0.0, None, .45)

    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); dr2 = ImageDraw.Draw(im)
    def gcol_at(i, k_=1.0, lift=0.0):
        c_ = sil[i] * (1 - v_g) + gseason * v_g * k_
        return ti(np.minimum(c_ + suncol * lift * L, 255))
    lake_cols = np.where(NEAR > LAKE_Y + 30)[0]
    if len(lake_cols):                                                                     # reeds where the meadow meets the water
        for _ in range(46):
            i = int(rg.choice(lake_cols)); x = i / S; yb = float(NEAR[i]) + 3
            for _b in range(rg.randint(5, 11)):
                xx = x + rg.uniform(-26, 26); hh = rg.uniform(20, 48); lean = rg.uniform(-.12, .12)
                c_ = gcol_at(i, rg.uniform(.6, 1.0))
                dr2.line([(xx * S, yb * S), ((xx + lean * hh) * S, (yb - hh) * S)], fill=c_, width=max(1, round(1.6 * S)))
                if rg.random() < .45: dr2.ellipse([(xx + lean * hh - 2.2) * S, (yb - hh - 9) * S, (xx + lean * hh + 2.2) * S, (yb - hh + 3) * S], fill=ti(sil[i] * (1 - v_g) + np.array((70, 52, 40), np.float32) * v_g * .8))
    tufts = []
    for _ in range(5200):                                                                  # grass: fine at the shore, tall at your feet
        x = rg.uniform(0, 5120); i = int(np.clip(x * S, 0, W - 1)); t_ = rg.random() ** .75
        tufts.append((meadow_y(i, t_), x, i, t_))
    for (yb, x, i, t_) in sorted(tufts):
        if yb > 2200: continue
        hh = (9 + 50 * t_) * rg.uniform(.7, 1.25) * (.55 if winter else 1)
        for _b in range(3 + int(4 * t_)):
            xx = x + rg.uniform(-.4, .4) * hh; lean = rg.uniform(-.35, .35) + .1 * lit_dir; h2 = hh * rg.uniform(.55, 1.05)
            dr2.line([(xx * S, yb * S), ((xx + lean * h2 * .45) * S, (yb - h2 * .6) * S), ((xx + lean * h2) * S, (yb - h2) * S)],
                     fill=gcol_at(i, rg.uniform(.74, 1.14), rg.uniform(0, .05)), width=max(1, round(hh * .05 * S)))
    vf = .2 + .62 * L
    def dot(x, yb, r, c, i):
        c_ = ti(sil[i] * (1 - vf) + np.array(c, np.float32) * vf); dr2.ellipse([(x - r) * S, (yb - r * .8) * S, (x + r) * S, (yb + r * .8) * S], fill=c_)
    if season in ("spring", "summer"):                                                     # drifts of wildflowers
        cols_ = [(250, 244, 230), (248, 214, 90), (232, 150, 190), (170, 140, 230)] if season == "spring" else [(250, 244, 230), (248, 214, 90), (150, 120, 220)]
        for _ in range(58 if season == "spring" else 36):
            cx_ = rg.uniform(0, 5120); ct = rg.random() ** .7; c = rg.choice(cols_)
            for _f in range(rg.randint(14, 40)):
                x = cx_ + rg.gauss(0, 60 + 90 * ct); i = int(np.clip(x * S, 0, W - 1)); t_ = float(np.clip(ct + rg.gauss(0, .07), 0, 1)); yb = meadow_y(i, t_) - (6 + 26 * t_)
                if 0 < x < 5120 and yb < 2170: dot(x, yb, 1.6 + 3.4 * t_, c, i)
    elif season == "autumn":                                                               # fallen leaves
        for _ in range(1500):
            x = rg.uniform(0, 5120); i = int(np.clip(x * S, 0, W - 1)); t_ = rg.random() ** .7
            if rg.random() < .12 + .88 * float(side[i]): dot(x, meadow_y(i, t_) - 1, 1.4 + 3.2 * t_, rg.choice([(232, 178, 52), (206, 78, 40), (226, 122, 40), (150, 84, 42)]), i)
    else:                                                                                  # winter: long soft drifts of snow catching the light
        dl = Image.new("L", (W, H), 0); dd = ImageDraw.Draw(dl)
        for _ in range(240):
            x = rg.uniform(0, 5120); i = int(np.clip(x * S, 0, W - 1)); t_ = rg.random() ** .7; yb = meadow_y(i, t_); r = (5 + 20 * t_) * rg.uniform(.6, 1.3)
            dd.ellipse([(x - r * 9) * S, (yb - r * .5) * S, (x + r * 9) * S, (yb + r * .5) * S], fill=int(rg.uniform(90, 200)))
        dm = (np.asarray(blur(dl, 9), np.float32) / 255 * (Y >= NEAR[None, :] + 6))[..., None] * .6
        img = np.asarray(im, np.float32); img = img * (1 - dm) + (snow_sh * .45 + snow_lit * .55)[None, None, :] * dm
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    img = np.asarray(im, np.float32)

    # ---------------- rain or snow in the air, clearing round the words
    if wet:
        pr = Image.new("L", (W, H), 0); pd_ = ImageDraw.Draw(pr); r6 = random.Random(seed + 5)
        if weather == "rain":
            for _ in range(5200):
                x, yv = r6.random() * W, r6.random() * H; Ln = (26 + r6.random() * 30) * S
                pd_.line([(x, yv), (x - Ln * .22, yv + Ln)], fill=int(60 + r6.random() * 70), width=max(1, round(2 * S)))
            pa = np.asarray(blur(pr, .8), np.float32) / 255 * .5
        else:
            for _ in range(2100):
                x, yv = r6.random() * W, r6.random() * H; r = (1.5 + r6.random() ** 2 * 3.2) * S
                pd_.ellipse([x - r, yv - r, x + r, yv + r], fill=int(120 + r6.random() * 135))
            pa = np.asarray(blur(pr, 1.3), np.float32) / 255 * .8
        pa *= sm(DIST / 300)
        img = img * (1 - pa[..., None]) + np.array([214, 222, 238], np.float32) * (.5 + .4 * p["light"]) * pa[..., None]
        scenery |= pa > .12
    return img, int(scenery[KEEP[1]:KEEP[3], KEEP[0]:KEEP[2]].sum())

def lum(c):
    c = np.asarray(c, np.float32) / 255; c = np.where(c <= .03928, c / 12.92, ((c + .055) / 1.055) ** 2.4)
    return c[..., 0] * .2126 + c[..., 1] * .7152 + c[..., 2] * .0722

def compose(motto, phase, minute, season, weather, name):
    m0 = np.asarray(Image.open(SRC + motto).convert("RGB").resize((W, H), Image.LANCZOS), np.float32)
    a = np.clip(m0.max(axis=2) / 240.0, 0, 1) ** 0.78
    ys_, xs_ = np.where(a > .1); box = (xs_.min() / S, ys_.min() / S, xs_.max() / S, ys_.max() / S)
    s, inside = build(phase, minute, season, weather, box=box, ink=a)
    cxn, cyn = (X[None, :] - 2560) / (5120 * .30), (Y - 2160 * .42) / (2160 * .30)
    s *= (1 - 0.3 * np.exp(-(cxn ** 2 + cyn ** 2)))[..., None]
    s += np.random.default_rng(3).normal(0, 1.1, (H, W, 1)).astype(np.float32); s = np.clip(s, 0, 255)
    ok = box[0] >= KEEPD[0] + 60 and box[2] <= KEEPD[2] - 60 and box[1] >= KEEPD[1] + 60 and box[3] <= KEEPD[3] - 60
    sh = np.asarray(blur(Image.fromarray((a * 255).astype(np.uint8)), 9), np.float32) / 255
    s *= (1 - 0.35 * sh)[..., None]
    near = np.clip(np.asarray(blur(Image.fromarray((np.clip(a * 4, 0, 1) * 255).astype(np.uint8)), 46), np.float32) / 255 * 3.2, 0, 1)[..., None]
    smooth = np.asarray(blur(Image.fromarray(s.astype(np.uint8)).filter(ImageFilter.MedianFilter(9 if S >= 1 else 5)), 10), np.float32)
    if OPEN:
        medi = np.asarray(Image.fromarray(s.astype(np.uint8)).filter(ImageFilter.MedianFilter(9 if S >= 1 else 5)), np.float32)
        s = s * (1 - near) + medi * near                                                  # stars cleared from behind the letters; clouds keep their edges
        G = np.clip(np.asarray(blur(Image.fromarray((np.clip(a * 6, 0, 1) * 255).astype(np.uint8)), 28), np.float32) / 255 * 4, 0, 1)
        q = np.minimum(1, ((.15 + .05) / (lum(s) + .05)) ** (1 / 2.2))
        s = s * (1 - G * (1 - q))[..., None]
        q = np.minimum(1, ((.15 + .05) / (lum(s) + .05)) ** (1 / 2.2)); s = s * (1 - G * (1 - q))[..., None]
    else: s = s * (1 - near) + smooth * near
    ink = np.array([244, 241, 233], np.float32)
    behind = s[(a > .5)]; contrast = (lum(ink) + .05) / (lum(behind).max() + .05) if len(behind) else 0
    out = s * (1 - a[..., None]) + ink * a[..., None]
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    if not OPEN: name += "-framed"
    if S >= 1: im.save(f"out/{name}.jpg", quality=95, subsampling=0)
    im.resize((2000, 844), Image.LANCZOS).save(f"out/{name}-small.png")
    print(f"{name}: {'land' if OPEN else 'scenery'} inside the lettering zone = {inside} px; lettering within the zone = {ok}; lowest contrast behind the main lettering = {contrast:.1f}:1")

JOBS = [
  ("84a-book-in-the-morning-when-thou-risest-unwillingly-let-th.png", "dawn", 7 * 60 + 40, "autumn", "mist", "scene-1-dawn-autumn-mist"),
  ("20-latin-deeds-not-words.png", "day", 11 * 60 + 30, "summer", "clear", "scene-2-day-summer"),
  ("63a-letter-the-mountains-are-calling-and-i-must-go.png", "gold", 16 * 60 + 5, "autumn", "clear", "scene-3-golden-hour-autumn"),
  ("73-japanese-an-old-pond-a-frog-leaps-in-the-sound-of-water.png", "dusk", 17 * 60 + 30, "spring", "rain", "scene-4-dusk-spring-rain"),
  ("07-latin-through-hardship-to-the-stars.png", "night", 22 * 60, "winter", "clear", "scene-5-night-winter"),
  ("58b-book-in-the-depths-of-winter-i-finally-learned-that-wit.png", "day", 13 * 60 + 40, "winter", "clear", "scene-6-day-winter"),
]
if __name__ == "__main__":
    for j in JOBS:
        if len(sys.argv) < 2 or any(k in j[5] for k in sys.argv[1:]): compose(*j)
