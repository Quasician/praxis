"""Packs the masks from build_masks.py into the one picture per season the city wallpaper reads, lined up with the 5K paintings.
  red    open sky (the sun, moon and stars show only here)
  green  cloud cover within the sky (they hide behind thick cloud)
  blue   lit windows at night (they switch on one by one through dusk)
The 5K paintings are the 2640 x 1104 keyframes upscaled to 5165 x 2160 and trimmed 22 px each side to 5120 x 2160,
so the masks get the same treatment, then are stored at half size (2560 x 1080).
usage: pack_masks.py <masks dir> <out dir>      writes <season>-mask.png for each season found"""
import sys, os, numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
# Where open sky stops and cloud starts differs by season: winter's pale sky reads as cloud unless its levels are lifted.
LEVELS = {"spring": (0, 255), "summer": (0, 255), "autumn": (110, 210), "winter": (205, 250)}
def to5k(a, mode):
    im = Image.fromarray(a).resize((5165, 2160), mode).crop((22, 0, 5142, 2160))
    return np.asarray(im.resize((2560, 1080), Image.BILINEAR))
for season, (lo, hi) in LEVELS.items():
    p = lambda k: os.path.join(src, f"{season}-{k}.png")
    if not os.path.exists(p("sky")): continue
    sky = np.asarray(Image.open(p("sky")).convert("L"))
    cl = np.asarray(Image.open(p("cloud")).convert("L")).astype(np.float32)
    cl = np.minimum(np.clip((cl - lo) / (hi - lo), 0, 1) * 255, sky).astype(np.uint8)
    li = np.asarray(Image.open(p("lights")).convert("L"))
    rgb = np.dstack([to5k(sky, Image.BILINEAR), to5k(cl, Image.BILINEAR), to5k(li, Image.BILINEAR)])
    Image.fromarray(rgb).save(os.path.join(out, f"{season}-mask.png"), optimize=True)
    print(season, "ok")
