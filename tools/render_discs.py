"""Draws the "Black & gold" pieces (img/piece-gold.png, img/piece-lacquer.png): top-down discs from a height map with simple lighting.
Usage: python3 tools/render_discs.py   (needs numpy and Pillow; results go to tools/out/, copy them to img/)"""
import numpy as np
from PIL import Image
import os

S = 720                       # drawn at 720 px, shown at 360 px (smooth edges)
FINAL = 360
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

ax = (np.arange(S, dtype=np.float32) - (S - 1) / 2) / (S / 2)
X, Y = np.meshgrid(ax, ax)                     # Y points down the picture
R = np.hypot(X, Y)
TH = np.arctan2(Y, X)
PIX = 2.0 / S

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def height():
    rim = 0.070
    h = np.full_like(R, rim)
    edge = np.sqrt(np.clip(1 - ((R - 0.915) / 0.085) ** 2, 0, 1))           # the rounded outer edge
    h = np.where(R > 0.915, rim * edge, h)
    step = smooth(0.735, 0.805, R)                                          # the rim steps down to the field
    h = np.where(R <= 0.915, 0.020 + (rim - 0.020) * step, h)
    # fine concentric lines in the field, like a lathe-turned metal plate
    lines = (0.5 + 0.5 * np.cos(2 * np.pi * R / 0.030)) ** 8
    h = h - 0.0022 * lines * smooth(0.70, 0.60, R) * smooth(0.10, 0.18, R)
    # a lotus rosette in the middle: 8 petals and a little dome
    lobe = np.abs(np.cos(4 * TH))
    petal = 0.13 + 0.24 * lobe ** 0.9
    body = smooth(petal, petal - 0.045, R)
    h = h + 0.030 * body * (0.55 + 0.45 * np.clip(1 - R / petal, 0, 1))
    h = h + 0.022 * np.clip(1 - R / 0.075, 0, 1) ** 2
    ring = np.exp(-((R - 0.50) / 0.012) ** 2)                               # a thin raised ring around the rosette
    h = h + 0.010 * ring
    h = h + 0.060 * (1 - np.clip(R, 0, 1) ** 2)                             # the whole disc is very slightly domed, so the shine sweeps across it
    return h, body, ring

def normals(h):
    gy, gx = np.gradient(h, PIX)
    n = np.dstack([-gx, -gy, np.ones_like(h)])
    return n / np.linalg.norm(n, axis=2, keepdims=True)

LIGHT = np.array([-0.50, -0.58, 0.64], np.float32); LIGHT /= np.linalg.norm(LIGHT)

def environment(rd):
    """What a shiny surface sees: a bright studio sky with a soft box at the upper left."""
    up = -rd[..., 1]
    base = 0.22 + 0.60 * smooth(-0.55, 0.9, up)
    base *= 0.45 + 0.55 * smooth(0.95, -0.35, rd[..., 1])                    # darker floor below
    lobe = np.clip((rd * LIGHT).sum(axis=2), 0, 1)
    box = smooth(0.90, 0.985, lobe)
    glow = smooth(0.62, 0.95, lobe)
    sweep = smooth(-0.30, 0.30, -(rd[..., 0] * 0.55 + rd[..., 1] * 0.83))   # light from the upper left
    return 0.15 + 0.50 * base + 0.60 * sweep + 1.5 * box + 0.45 * glow

def reflect(n):
    v = np.array([0, 0, 1], np.float32)
    d = (n * v).sum(axis=2, keepdims=True)
    return 2 * d * n - v

def gauss_blur(a, sigma):
    """A Gaussian blur of a float picture (rows, then columns)."""
    radius = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2); k /= k.sum()
    pad = np.pad(a, radius, mode="edge")
    rows = np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 1, pad)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 0, rows)

def ao(h):
    blur = gauss_blur(h, S * 0.012)
    return np.clip(1 - 9 * (blur - h), 0.45, 1.0)

def to_image(rgb_linear, alpha):
    rgb = np.clip(rgb_linear, 0, 1) ** (1 / 2.2)
    a = np.dstack([rgb * 255, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(a, mode="RGBA").resize((FINAL, FINAL), Image.LANCZOS)
    return im

def gold(h, n, occlusion, fine):
    albedo = np.array([1.0, 0.63, 0.20], np.float32)
    env = environment(reflect(n))[..., None]
    diffuse = np.clip((n * LIGHT).sum(axis=2), 0, 1)[..., None]
    col = albedo * (0.05 + 0.12 * diffuse + 0.80 * env * 0.62) * occlusion[..., None] * fine[..., None]
    # a hotter, whiter highlight on the sharpest reflections
    col = col + 0.20 * np.clip(env - 1.0, 0, 1) * np.array([1.0, 0.95, 0.80], np.float32)
    return col

def lacquer(h, n, occlusion):
    env = environment(reflect(n))[..., None]
    cos_v = np.clip(n[..., 2:3], 0, 1)
    fresnel = 0.045 + 0.955 * (1 - cos_v) ** 5
    diffuse = np.clip((n * LIGHT).sum(axis=2), 0, 1)[..., None]
    base = np.array([0.006, 0.006, 0.009], np.float32)
    col = base * (0.5 + 0.8 * diffuse) + fresnel * env * np.array([0.95, 0.97, 1.0], np.float32) * 0.55
    return col * occlusion[..., None] ** 0.6

def disc(kind, seed):
    rng = np.random.default_rng(seed)
    h, body, ring = height()
    n = normals(h)
    occlusion = ao(h)
    fine = 1 + 0.035 * np.cos(2 * np.pi * R / 0.0075)          # very fine turning lines
    alpha = smooth(1.0, 0.982, R)
    if kind == "gold":
        col = gold(h, n, occlusion, fine)
    else:
        col = lacquer(h, n, occlusion)
        # gold inlay: the ring on the step, the rosette and the thin ring, plus a sprinkle of gold dust
        inlay = np.clip(np.exp(-((R - 0.770) / 0.016) ** 2) + body + ring * 0.9, 0, 1)
        dust = (rng.random(R.shape) > 0.9985).astype(np.float32)
        dust = gauss_blur(dust, 1.4) * 9
        dust = np.clip(dust, 0, 1) * smooth(0.74, 0.70, R) * (1 - body)
        mask = np.clip(inlay + dust * 0.8, 0, 1)[..., None]
        g = gold(h, n, occlusion, fine) * 0.95
        col = col * (1 - mask) + g * mask
    return to_image(col, alpha)

if __name__ == "__main__":
    for kind in ("gold", "lacquer"):
        im = disc(kind, 7)
        im.save(os.path.join(OUT, f"piece-{kind}.png"), optimize=True)
        print(kind, os.path.getsize(os.path.join(OUT, f"piece-{kind}.png")) // 1024, "KB")
