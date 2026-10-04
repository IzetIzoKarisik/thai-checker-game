"""Makes the marble pictures for the boards (img/marble-*.jpg): cream, brown, white, black, green, ivory.
Usage: python3 tools/make_marble.py [kind ...]   (needs numpy and Pillow; results go to tools/out/, copy them to img/)"""
import numpy as np
from PIL import Image
import os, sys

N = int(os.environ.get('MARBLE_N', 1400))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
Y, X = np.mgrid[0:N, 0:N].astype(np.float32)

def smooth_noise(rng, cells, size=N):
    grid = rng.random((cells + 3, cells + 3)).astype(np.float32)
    s = int(size * (cells + 3) / cells)
    a = np.asarray(Image.fromarray(grid, mode="F").resize((s, s), Image.BICUBIC))
    off = int(size / cells)
    return np.clip(a[off:off + size, off:off + size], 0, 1)

def fbm(rng, base=3, octaves=5, gain=0.5, size=N):
    total = np.zeros((size, size), np.float32); amp = 1.0; norm = 0.0
    for o in range(octaves):
        total += amp * smooth_noise(rng, base * 2 ** o, size); norm += amp; amp *= gain
    t = total / norm
    return (t - t.min()) / (t.max() - t.min())

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def cracks(rng, points, warp, width, wobble=0.6):
    """A network of veins: the borders between random cells, bent by noise. width is in pixels."""
    pts = []
    min_d = 0.78 * N / np.sqrt(points)                              # centres keep their distance, so no sliver cells
    tries = 0
    while len(pts) < points and tries < 20000:
        c = rng.random(2) * N; tries += 1
        if all(np.hypot(*(c - p)) > min_d for p in pts): pts.append(c)
    pts = np.array(pts, np.float32)
    wx = (fbm(rng, base=3, octaves=4) - .5) * warp
    wy = (fbm(rng, base=3, octaves=4) - .5) * warp
    fx, fy = X + wx, Y + wy
    d1 = np.full((N, N), 1e9, np.float32); d2 = np.full((N, N), 1e9, np.float32)
    for px, py in pts:
        d = np.hypot(fx - px, fy - py)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        d1 = np.where(closer, d, d1)
    edge = d2 - d1                                              # 0 on the border between two cells
    w = width * (1 - wobble + 2 * wobble * fbm(rng, base=4, octaves=3))   # the vein gets thicker and thinner
    vein = 1 - smoothstep(0, w, edge)
    patchy = smoothstep(.30, .62, fbm(rng, base=3, octaves=3))   # some parts of the slab have no veins
    return vein * (0.25 + 0.75 * patchy)

def mix(img, color, alpha):
    c = np.array(color, np.float32)[None, None, :]
    return img * (1 - alpha[..., None]) + c * alpha[..., None]

def make(kind, seed):
    rng = np.random.default_rng(seed)
    cloud = fbm(rng, base=2, octaves=5); cloud2 = fbm(rng, base=5, octaves=4)
    if kind == "white":
        img = np.array([232, 231, 228], np.float32) + (np.array([251, 251, 250], np.float32) - np.array([232, 231, 228], np.float32)) * cloud[..., None]
        img = mix(img, (212, 205, 192), 0.28 * smoothstep(.5, .95, cloud2))
        v1 = cracks(rng, 18, 150, 7.5, 0.4); v2 = cracks(rng, 60, 100, 3.0, 0.4); v3 = cracks(rng, 220, 45, 1.5, 0.4)
        img = mix(img, (198, 168, 124), 0.55 * np.clip(v1 * 1.3, 0, 1) ** 0.6)        # warm halo around the big veins
        img = mix(img, (54, 50, 48), 0.92 * (v1 ** 2.2))                                # dark core
        img = mix(img, (92, 86, 80), 0.60 * v2)
        img = mix(img, (150, 142, 132), 0.38 * v3)
    elif kind == "black":
        img = np.array([20, 20, 22], np.float32) + (np.array([46, 46, 50], np.float32) - np.array([20, 20, 22], np.float32)) * cloud[..., None]
        img = mix(img, (70, 68, 72), 0.30 * smoothstep(.5, .95, cloud2))
        v1 = cracks(rng, 18, 150, 7.5, 0.4); v2 = cracks(rng, 60, 100, 3.0, 0.4); v3 = cracks(rng, 220, 45, 1.5, 0.4)
        img = mix(img, (150, 146, 142), 0.50 * np.clip(v1 * 1.3, 0, 1) ** 0.6)
        img = mix(img, (244, 240, 235), 0.92 * (v1 ** 2.2))
        img = mix(img, (196, 192, 188), 0.62 * v2)
        img = mix(img, (130, 128, 128), 0.38 * v3)
    elif kind == "cream":
        img = np.array([226, 217, 201], np.float32) + (np.array([249, 245, 238], np.float32) - np.array([226, 217, 201], np.float32)) * cloud[..., None]
        img = mix(img, (210, 194, 168), 0.50 * smoothstep(.45, .9, cloud2))
        v1 = cracks(rng, 16, 150, 7.0, 0.4); v2 = cracks(rng, 56, 100, 3.0, 0.4); v3 = cracks(rng, 200, 45, 1.5, 0.4)
        img = mix(img, (196, 168, 128), 0.55 * np.clip(v1 * 1.3, 0, 1) ** 0.6)
        img = mix(img, (118, 98, 80), 0.88 * (v1 ** 2.2))
        img = mix(img, (150, 130, 108), 0.55 * v2)
        img = mix(img, (176, 160, 140), 0.38 * v3)
    elif kind == "brown":
        img = np.array([52, 31, 22], np.float32) + (np.array([108, 73, 54], np.float32) - np.array([52, 31, 22], np.float32)) * cloud[..., None]
        img = mix(img, (140, 100, 72), 0.40 * smoothstep(.5, .95, cloud2))
        v1 = cracks(rng, 16, 150, 7.0, 0.4); v2 = cracks(rng, 56, 100, 3.0, 0.4); v3 = cracks(rng, 200, 45, 1.5, 0.4)
        img = mix(img, (168, 128, 96), 0.50 * np.clip(v1 * 1.3, 0, 1) ** 0.6)
        img = mix(img, (236, 216, 188), 0.90 * (v1 ** 2.2))
        img = mix(img, (204, 180, 150), 0.58 * v2)
        img = mix(img, (150, 120, 92), 0.38 * v3)
    elif kind == "green":
        img = np.array([14, 62, 46], np.float32) + (np.array([34, 112, 84], np.float32) - np.array([14, 62, 46], np.float32)) * cloud[..., None]
        img = mix(img, (62, 134, 100), 0.34 * smoothstep(.5, .95, cloud2))
        v1 = cracks(rng, 16, 150, 7.0, 0.4); v2 = cracks(rng, 56, 100, 3.0, 0.4); v3 = cracks(rng, 200, 45, 1.5, 0.4)
        img = mix(img, (118, 176, 142), 0.50 * np.clip(v1 * 1.3, 0, 1) ** 0.6)
        img = mix(img, (240, 247, 238), 0.92 * (v1 ** 2.2))
        img = mix(img, (196, 222, 202), 0.60 * v2)
        img = mix(img, (110, 156, 128), 0.38 * v3)
    elif kind == "ivory":
        img = np.array([233, 227, 209], np.float32) + (np.array([252, 248, 236], np.float32) - np.array([233, 227, 209], np.float32)) * cloud[..., None]
        img = mix(img, (214, 216, 190), 0.45 * smoothstep(.45, .9, cloud2))
        v1 = cracks(rng, 16, 150, 7.0, 0.4); v2 = cracks(rng, 56, 100, 3.0, 0.4); v3 = cracks(rng, 200, 45, 1.5, 0.4)
        img = mix(img, (190, 186, 140), 0.55 * np.clip(v1 * 1.3, 0, 1) ** 0.6)
        img = mix(img, (70, 104, 82), 0.86 * (v1 ** 2.2))
        img = mix(img, (118, 146, 122), 0.55 * v2)
        img = mix(img, (172, 176, 150), 0.38 * v3)
    img = img + rng.normal(0, 1.8, (N, N, 1)).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)

if __name__ == "__main__":
    kinds = sys.argv[1:] or ["cream", "brown", "white", "black"]
    seeds = {"cream": 11, "brown": 23, "white": 37, "black": 53, "green": 67, "ivory": 79}
    for k in kinds:
        im = Image.fromarray(make(k, seeds[k]))
        im.save(os.path.join(OUT, f"marble-{k}.jpg"), quality=84, optimize=True)
        im.resize((560, 560), Image.LANCZOS).save(os.path.join(OUT, f"prev-{k}.png"))
        print(k, os.path.getsize(os.path.join(OUT, f"marble-{k}.jpg")) // 1024, "KB")
