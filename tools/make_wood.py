"""Makes the wood pictures for the Thai Teak board (img/wood-*.webp): light maple and dark walnut.
Each is one big slab; the board cuts every square out of it (like the marble boards), so the grain runs on across the tiles.
Usage: python3 tools/make_wood.py [kind ...]   (needs numpy and Pillow; results go to tools/out/, copy them to img/)"""
import numpy as np
from PIL import Image
import os, sys

N = int(os.environ.get("WOOD_N", 1024))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
Y, X = np.mgrid[0:N, 0:N].astype(np.float32)

def blur_noise(rng, cells_x, cells_y):
    """Smooth random picture. Few cells across = big soft blobs; cells_y small and cells_x big = streaks that run up and down."""
    grid = rng.random((cells_y + 3, cells_x + 3)).astype(np.float32)
    w, h = int(N * (cells_x + 3) / cells_x), int(N * (cells_y + 3) / cells_y)
    a = np.asarray(Image.fromarray(grid, mode="F").resize((w, h), Image.BICUBIC))
    ox, oy = int(N / cells_x), int(N / cells_y)
    return np.clip(a[oy:oy + N, ox:ox + N], 0, 1)

def fbm(rng, cells_x, cells_y, octaves=4, gain=0.5):
    total = np.zeros((N, N), np.float32); amp = 1.0; norm = 0.0
    for o in range(octaves):
        total += amp * blur_noise(rng, cells_x * 2 ** o, cells_y * 2 ** o); norm += amp; amp *= gain
    t = total / norm
    return (t - t.min()) / (t.max() - t.min())

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return np.array(a, np.float32)[None, None, :] * (1 - t[..., None]) + np.array(b, np.float32)[None, None, :] * t[..., None]

# Colours of the wood: the tone range of the plank, and the colour and strength of the ring lines (late wood),
# the thin streaks and the pores. The squares of the board use the quiet looks (bold=False), so the grain never
# fights with the pieces and the marks; the frame takes its grain from the bold look.
LOOKS = {
    ("maple", False):  dict(tone=((240, 221, 178), (233, 210, 160)), late=((214, 182, 128), .16), fibre=((222, 192, 140), .14), pores=((250, 236, 202), .14)),
    ("maple", True):   dict(tone=((243, 224, 184), (226, 192, 142)), late=((190, 140, 84), .30),  fibre=((198, 156, 100), .30), pores=((255, 244, 214), .30)),
    ("walnut", False): dict(tone=((138, 87, 49), (126, 78, 43)),     late=((96, 58, 31), .22),    fibre=((104, 63, 34), .16),   pores=((158, 104, 64), .10)),
    ("walnut", True):  dict(tone=((152, 98, 56), (120, 74, 41)),     late=((74, 41, 20), .52),    fibre=((88, 50, 25), .34),    pores=((170, 112, 70), .20)),
}

def make(kind, seed, bold=False):
    rng = np.random.default_rng(seed)
    # Growth rings: distance from a far-away tree centre, stretched up and down, bent by noise.
    # That gives the long arches of a plank sawn through the trunk.
    warp = (fbm(rng, 2, 2, 4) - .5) * 150 + (fbm(rng, 12, 3, 3) - .5) * 16
    cx, cy = N * (0.25 + 0.5 * rng.random()), N * 1.6
    r = np.sqrt(((X + warp - cx) / 1.0) ** 2 + ((Y * 0.30 + warp * 0.2 - cy * 0.30) / 1.0) ** 2)
    rings = r / (N / (34.0 if kind == "walnut" else 44.0))              # about 35–45 rings across the slab
    ring = rings - np.floor(rings)                                       # 0..1 inside one ring
    late = smoothstep(.62, .95, ring) * (1 - smoothstep(.95, 1.0, ring))  # late wood: the darker band at the end of a ring
    fibre = fbm(rng, 140, 3, 3)                                          # thin streaks along the grain
    fine = blur_noise(rng, N // 3, 6)                                    # very fine pores
    cloud = fbm(rng, 3, 3, 4)                                            # slow change of tone over the slab
    look = LOOKS[kind, bold]
    img = lerp(look["tone"][0], look["tone"][1], cloud)
    img = lerp_over(img, look["late"][0], look["late"][1] * late)
    img = lerp_over(img, look["fibre"][0], look["fibre"][1] * smoothstep(.45, .85, fibre))
    img = lerp_over(img, look["pores"][0], look["pores"][1] * smoothstep(.55, .95, fine))
    img = img + rng.normal(0, 1.6, (N, N, 1)).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)

def lerp_over(img, color, alpha):
    c = np.array(color, np.float32)[None, None, :]
    return img * (1 - alpha[..., None]) + c * alpha[..., None]

def make_frame():
    """Grey wood grain for the picture frame round the board (img/frame-grain.webp): the grain runs along each of the four sides,
    and the sides meet in mitred corners on the two diagonals. The page lays it over the board's own wood colour."""
    size = 1000
    def grain(seed, turn):
        rng_img = Image.fromarray(make("walnut", seed, bold=True)).convert("L").resize((size, size), Image.LANCZOS)
        a = np.asarray(rng_img, np.float32)
        a = (a - a.mean()) * 1.7 + 128                                  # centre on mid grey and stretch, so grain shows on any colour
        return a.T if turn else a
    top, bottom = grain(21, True), grain(22, True)                      # on the top and bottom the grain runs left to right
    left, right = grain(23, False), grain(24, False)                    # on the sides it runs up and down
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    above = y < x                                                        # above the falling diagonal
    over = y < size - x                                                  # above the rising diagonal
    img = np.where(above & over, top, np.where(~above & ~over, bottom, np.where(~above & over, left, right)))
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

def make_swatch(maple, walnut):
    """The little 4 x 4 board shown in the Settings window (img/board-teak.webp), cut from the two slabs like the real board."""
    size = 232
    light = Image.fromarray(maple).resize((size, size), Image.LANCZOS)
    dark = Image.fromarray(walnut).resize((size, size), Image.LANCZOS)
    board = Image.new("RGB", (size, size))
    step = size // 4
    for row in range(4):
        for col in range(4):
            box = (col * step, row * step, (col + 1) * step, (row + 1) * step)
            board.paste((dark if (row + col) % 2 else light).crop(box), box)
    return board

if __name__ == "__main__":
    kinds = sys.argv[1:] or ["maple", "walnut"]
    seeds = {"maple": 5, "walnut": 9}
    slabs = {}
    for k in kinds:
        slabs[k] = make(k, seeds[k])
        im = Image.fromarray(slabs[k])
        im.save(os.path.join(OUT, f"wood-{k}.webp"), quality=80, method=6)
        im.resize((560, 560), Image.LANCZOS).save(os.path.join(OUT, f"prev-wood-{k}.png"))
        print(k, os.path.getsize(os.path.join(OUT, f"wood-{k}.webp")) // 1024, "KB")
    make_frame().save(os.path.join(OUT, "frame-grain.webp"), quality=80, method=6)
    if len(slabs) == 2:
        make_swatch(slabs["maple"], slabs["walnut"]).save(os.path.join(OUT, "board-teak.webp"), quality=88, method=6)
