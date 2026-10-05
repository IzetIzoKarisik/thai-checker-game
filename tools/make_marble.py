"""Makes the marble pictures for the boards (img/marble-*.webp): cream, brown, white, black, green, ivory,
and the little previews shown in Settings (img/board-marble.webp, board-onyx.webp, board-emerald.webp).

Real marble has long, soft veins that all run in roughly one direction, wander, branch, get thicker
and thinner, and fade out. (An earlier version drew cell borders, which looked like cracked glass.)
Here a vein is the line where a bent stripe pattern crosses a whole number: a few strands, each
with its own thickness, and a soft haze around the big ones. Three families (big, medium, hairline)
run at slightly different angles.

Usage: python3 tools/make_marble.py [kind ...]   (needs numpy and Pillow; results go to tools/out/, copy them to img/)"""
import numpy as np
from PIL import Image
import os, sys

N = int(os.environ.get("MARBLE_N", 1024))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
Y, X = np.mgrid[0:N, 0:N].astype(np.float32)

# ---------- soft random noise that can be asked for at any (rotated, bent) position ----------

def value_noise(rng, x, y):
    """Smooth random picture (0..1), made from a random grid by smooth blending."""
    grid = rng.random((256, 256)).astype(np.float32)
    xi, yi = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    fx, fy = x - xi, y - yi
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    x0, x1, y0, y1 = xi % 256, (xi + 1) % 256, yi % 256, (yi + 1) % 256
    a, b, c, d = grid[y0, x0], grid[y0, x1], grid[y1, x0], grid[y1, x1]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy

def fbm(rng, x, y, scale, octaves=4, gain=0.5):
    """Cloudy noise: big soft blobs (about 1/scale pixels wide) with smaller ones on top."""
    total, amp, norm = 0, 1.0, 0.0
    for o in range(octaves):
        total = total + amp * value_noise(rng, x * scale * 2 ** o, y * scale * 2 ** o)
        norm += amp; amp *= gain
    return total / norm

def turbulence(rng, x, y, scale, octaves=4):
    """Like fbm, but with sharp creases (where the noise crosses its middle value)."""
    total, amp, norm = 0, 1.0, 0.0
    for o in range(octaves):
        total = total + amp * np.abs(2 * value_noise(rng, x * scale * 2 ** o, y * scale * 2 ** o) - 1)
        norm += amp; amp *= 0.5
    return total / norm

def stretch(a):
    """Rescale to fill 0..1, so the thresholds below mean the same thing for every picture."""
    lo, hi = np.percentile(a[::7, ::7], [3, 97])
    return np.clip((a - lo) / (hi - lo), 0, 1)

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def hash01(k, salt):
    """A repeatable 'random' number between 0 and 1 for every whole number k."""
    h = (k.astype(np.int64) * 73856093) ^ (salt * 19349663)
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0

# ---------- veins ----------

def veins(rng, angle, period, warp, width, keep, salt):
    """One family of veins. angle: the way they run (degrees); period: distance between strands (pixels);
    warp: how much they wander; width: thickness of a strand (pixels); keep: share of strands that exist.
    Returns (core, haze): the thin line itself and the soft glow around it, both 0..1."""
    a = np.deg2rad(angle)
    u = X * np.cos(a) + Y * np.sin(a)            # along the veins
    v = -X * np.sin(a) + Y * np.cos(a)           # across the veins
    wander = stretch(fbm(rng, u, v, 1 / (period * 2.4), 3)) * 1.05 + turbulence(rng, u, v, 1 / (period * 1.1), 3) * 0.34
    phase = v / period + warp * wander           # every whole number of 'phase' is the middle of a strand
    strand = np.round(phase)
    gy, gx = np.gradient(phase)
    speed = np.maximum(np.hypot(gx, gy), 0.3 / period)
    dist = np.abs(phase - strand) / speed        # real distance in pixels to the middle of the nearest strand

    exists = smoothstep(1 - keep - .06, 1 - keep + .06, hash01(strand, salt))     # not every strand is there
    thick = width * (0.5 + 1.1 * hash01(strand, salt + 1))                        # each strand has its own thickness
    along = 0.35 + 1.15 * stretch(fbm(rng, u, v, 1 / (period * 1.5), 3))          # thicker and thinner along its length
    ragged = 0.75 + 0.5 * fbm(rng, u, v, 1 / 14.0, 2)                             # a slightly uneven edge
    fade = smoothstep(.28, .62, stretch(fbm(rng, u, v, 1 / (period * 1.9), 3)))   # strands fade in and out
    w = thick * along * ragged
    core = (1 - smoothstep(0, w, dist)) * exists * fade
    haze = (1 - smoothstep(0, w * 6 + 3, dist)) ** 2 * exists * fade
    return core, haze

def mix(img, color, alpha):
    c = np.array(color, np.float32)[None, None, :]
    return img * (1 - alpha[..., None]) + c * alpha[..., None]

# colours of each kind of marble: tone range of the stone, haze, and the colours of the three kinds of vein
KINDS = {
    #            tone dark           tone light        cloud tint        big vein (core, glow)             medium vein       hairline
    "white":  dict(lo=(231, 230, 227), hi=(251, 251, 250), tint=(212, 206, 196), core=(78, 74, 72),   glow=(196, 190, 182), mid=(140, 136, 132), fine=(186, 182, 176), power=.85),
    "black":  dict(lo=(19, 19, 21),    hi=(42, 42, 46),    tint=(64, 62, 66),    core=(222, 220, 216), glow=(118, 116, 116), mid=(170, 168, 164), fine=(112, 110, 110), power=.6),
    "cream":  dict(lo=(226, 217, 201), hi=(249, 245, 238), tint=(210, 194, 168), core=(146, 118, 90),  glow=(198, 172, 132), mid=(170, 144, 114), fine=(188, 170, 148), power=.85),
    "brown":  dict(lo=(54, 33, 23),    hi=(104, 70, 52),   tint=(138, 100, 72),  core=(222, 202, 172), glow=(158, 122, 90),  mid=(186, 160, 128), fine=(136, 108, 84), power=.72),
    "green":  dict(lo=(14, 62, 46),    hi=(34, 112, 84),   tint=(62, 134, 100),  core=(226, 238, 226), glow=(110, 170, 138), mid=(178, 208, 190), fine=(100, 148, 120), power=.72),
    "ivory":  dict(lo=(233, 227, 209), hi=(252, 248, 236), tint=(214, 216, 190), core=(58, 96, 74),    glow=(184, 184, 140), mid=(108, 138, 114), fine=(168, 172, 146), power=.85),
}

def make(kind, seed):
    rng = np.random.default_rng(seed)
    k = KINDS[kind]
    flow = 28 + 18 * rng.random()                       # the way all the veins run (degrees)
    a = np.deg2rad(flow)
    u, v = X * np.cos(a) + Y * np.sin(a), -X * np.sin(a) + Y * np.cos(a)
    # the stone itself: a slow cloudy change of tone, with soft streaks that run the way the veins run
    bend = (fbm(rng, X, Y, 1 / 500.0, 3) - .5) * 260
    cloud = stretch(fbm(rng, X + bend, Y - bend, 1 / 420.0, 5))
    streaks = stretch(fbm(rng, (u + bend) / 1300, v / 150, 1.0, 4))
    cloud = 0.4 * cloud + 0.6 * streaks
    cloud2 = stretch(fbm(rng, X - bend, Y + bend, 1 / 190.0, 4))
    lo, hi = np.array(k["lo"], np.float32), np.array(k["hi"], np.float32)
    img = lo + (hi - lo) * cloud[..., None]
    img = mix(img, k["tint"], 0.34 * smoothstep(.35, .95, cloud2))

    big, big_haze = veins(rng, flow, 360, 1.0, 3.6, 0.55, seed * 10 + 1)
    mid, mid_haze = veins(rng, flow + 24, 170, 0.9, 1.7, 0.65, seed * 10 + 3)
    fine, _ = veins(rng, flow - 18, 78, 0.8, 0.9, 0.55, seed * 10 + 5)

    img = mix(img, k["glow"], 0.34 * big_haze)                                  # soft glow round the big veins
    img = mix(img, k["glow"], 0.16 * mid_haze)
    img = mix(img, k["fine"], 0.42 * k["power"] * fine)
    img = mix(img, k["mid"], 0.62 * k["power"] * mid)
    img = mix(img, k["core"], 0.90 * k["power"] * big)
    img = img + rng.normal(0, 1.6, (N, N, 1)).astype(np.float32)               # a very fine grain
    return np.clip(img, 0, 255).astype(np.uint8)

def make_swatch(light, dark):
    """The little 4 x 4 board shown in the Settings window, cut from the two slabs like the real board."""
    size = 232
    light = Image.fromarray(light).resize((size, size), Image.LANCZOS)
    dark = Image.fromarray(dark).resize((size, size), Image.LANCZOS)
    board = Image.new("RGB", (size, size))
    step = size // 4
    for row in range(4):
        for col in range(4):
            box = (col * step, row * step, (col + 1) * step, (row + 1) * step)
            board.paste((dark if (row + col) % 2 else light).crop(box), box)
    return board

if __name__ == "__main__":
    kinds = sys.argv[1:] or ["cream", "brown", "white", "black", "green", "ivory"]
    seeds = {"cream": 11, "brown": 23, "white": 37, "black": 53, "green": 67, "ivory": 79}
    slabs = {}
    for k in kinds:
        slabs[k] = make(k, seeds[k])
        im = Image.fromarray(slabs[k])
        im.save(os.path.join(OUT, f"marble-{k}.webp"), quality=80, method=6)
        im.resize((560, 560), Image.LANCZOS).save(os.path.join(OUT, f"prev-{k}.png"))
        print(k, os.path.getsize(os.path.join(OUT, f"marble-{k}.webp")) // 1024, "KB")
    for name, (light, dark) in {"marble": ("cream", "brown"), "onyx": ("white", "black"), "emerald": ("ivory", "green")}.items():
        if light in slabs and dark in slabs:
            make_swatch(slabs[light], slabs[dark]).save(os.path.join(OUT, f"board-{name}.webp"), quality=88, method=6)
