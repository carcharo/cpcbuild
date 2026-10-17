"""Writes the image fixtures imageio.test.ts reads: <name>.<ext> and <name>.rgba (Pillow's convert("RGBA") bytes).
Usage: python3 imageio.gen.py OUTDIR"""
import random, struct, sys, io
from pathlib import Path
from PIL import Image

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
rnd = random.Random(7)

def emit(name, im, fmt, **kw):
    p = out / f"{name}.{fmt.lower()}"
    im.save(p, fmt, **kw)
    (out / f"{name}.rgba").write_bytes(Image.open(p).convert("RGBA").tobytes())

def noise(w, h, n, mode="P"):
    pal = [rnd.randrange(256) for _ in range(n * 3)]
    im = Image.new("P", (w, h))
    im.putpalette(pal + [0] * (768 - len(pal)))
    im.putdata([rnd.randrange(n) for _ in range(w * h)])
    return im

# GIF: sizes, palette sizes, transparency, interlace
for i, (w, h, n) in enumerate([(1, 1, 2), (7, 5, 4), (16, 16, 16), (33, 17, 200), (64, 3, 256), (5, 40, 3)]):
    im = noise(w, h, n)
    emit(f"gif_plain{i}", im, "GIF")
    emit(f"gif_trans{i}", im, "GIF", transparency=rnd.randrange(n))
    emit(f"gif_inter{i}", im, "GIF", interlace=True)
# GIF written with a transparent index through RGBA conversion
im = Image.new("RGBA", (12, 8))
im.putdata([(rnd.choice([0, 255]), rnd.choice([0, 255]), 0, rnd.choice([0, 255])) for _ in range(96)])
emit("gif_rgba", im, "GIF")
# animated: first frame only
frames = [noise(8, 8, 4) for _ in range(3)]
p = out / "gif_anim.gif"
frames[0].save(p, save_all=True, append_images=frames[1:], duration=50, loop=0)
(out / "gif_anim.rgba").write_bytes(Image.open(p).convert("RGBA").tobytes())

# BMP
for i, (w, h) in enumerate([(1, 1), (3, 3), (5, 2), (8, 8), (17, 9), (32, 4)]):
    rgb = Image.new("RGB", (w, h))
    rgb.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(w * h)])
    emit(f"bmp_rgb{i}", rgb, "BMP")
    emit(f"bmp_pal8_{i}", noise(w, h, 200), "BMP")
    emit(f"bmp_pal4_{i}", noise(w, h, 16).quantize(16) if False else noise(w, h, 16), "BMP")
    one = noise(w, h, 2).convert("1")
    emit(f"bmp_1bit{i}", one, "BMP")
    rgba = Image.new("RGBA", (w, h))
    rgba.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(w * h)])
    emit(f"bmp_rgba{i}", rgba, "BMP")
    emit(f"bmp_grey{i}", rgb.convert("L"), "BMP")

# 16-bit PNG (refused) and an 8-bit palette PNG with tRNS (control)
Image.new("I;16", (4, 4), 1000).save(out / "png16.png")

# hand-made 4-bit BMP (Pillow never writes one), bottom-up and top-down
def bmp4(w, h, topdown):
    pal = [(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(16)]
    idx = [[rnd.randrange(16) for _ in range(w)] for _ in range(h)]
    stride = ((w * 4 + 31) >> 5) * 4
    rows = []
    for y in range(h):
        r = bytearray(stride)
        for x in range(w):
            r[x // 2] |= idx[y][x] << (4 if x % 2 == 0 else 0)
        rows.append(bytes(r))
    if not topdown:
        rows.reverse()
    body = b"".join(rows)
    palb = b"".join(bytes((c[2], c[1], c[0], 0)) for c in pal)
    off = 14 + 40 + len(palb)
    hdr = b"BM" + struct.pack("<IHHI", off + len(body), 0, 0, off)
    dib = struct.pack("<IiiHHIIiiII", 40, w, -h if topdown else h, 1, 4, 0, len(body), 2835, 2835, 16, 0)
    data = hdr + dib + palb + body
    rgba = b"".join(bytes(pal[idx[y][x]]) + b"\xff" for y in range(h) for x in range(w))
    return data, rgba

for i, (w, h, td) in enumerate([(5, 3, False), (8, 4, True), (1, 1, False)]):
    d, r = bmp4(w, h, td)
    (out / f"bmp_4bit{i}.bmp").write_bytes(d)
    (out / f"bmp_4bit{i}.rgba").write_bytes(Image.open(out / f"bmp_4bit{i}.bmp").convert("RGBA").tobytes())
    assert (out / f"bmp_4bit{i}.rgba").read_bytes() == r

# a GIF whose frame is smaller than the logical screen
b = io.BytesIO()
noise(4, 3, 4).save(b, "GIF")
g = bytearray(b.getvalue())
g[6:10] = struct.pack("<HH", 9, 7)
(out / "gif_sub.gif").write_bytes(bytes(g))
(out / "gif_sub.rgba").write_bytes(Image.open(out / "gif_sub.gif").convert("RGBA").tobytes())
print("sub size", Image.open(out / "gif_sub.gif").size)
