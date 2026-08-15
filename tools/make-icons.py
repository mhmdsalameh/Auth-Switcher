"""Builds the extension icon set from a single source image.

    python tools/make-icons.py source.png

Chrome wants PNG with alpha at 16/32/48/128. The source art here is a light-background
render, so the background is knocked out to transparency by distance-from-corner-colour
rather than a hard threshold — a hard cut leaves a white halo on JPEG-compressed edges.

16px is the toolbar size and is where detail dies. Look at icons/icon16.png before
shipping: if you cannot tell what it is, the art needs simplifying, not rescaling.
"""

import sys
from pathlib import Path
from PIL import Image

SIZES = (16, 32, 48, 128)
# 128px store icon should sit in a ~96px live area; the rest is breathing room.
PAD_RATIO = 0.10


def knockout(im):
    """Background -> alpha, feathered so antialiased edges survive."""
    im = im.convert("RGB")
    bg = im.getpixel((2, 2))
    out = Image.new("RGBA", im.size)
    src, dst = im.load(), out.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            dst[x, y] = (r, g, b, min(255, dist * 4))
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Image.open(sys.argv[1])

    art = knockout(src)
    art = art.crop(art.getbbox())  # trim to the ink

    side = max(art.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(art, ((side - art.width) // 2, (side - art.height) // 2))

    out_dir = Path(__file__).resolve().parent.parent / "icons"
    out_dir.mkdir(exist_ok=True)

    for size in SIZES:
        pad = round(size * PAD_RATIO)
        live = size - pad * 2
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(square.resize((live, live), Image.LANCZOS), (pad, pad))
        canvas.save(out_dir / f"icon{size}.png")
        print(f"icons/icon{size}.png")


if __name__ == "__main__":
    main()
