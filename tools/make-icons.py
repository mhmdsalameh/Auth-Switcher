"""Builds the extension icon set from a single source image.

    python tools/make-icons.py source.png              # background -> transparent
    python tools/make-icons.py source.png --keep-background

Chrome wants PNG at 16/32/48/128. By default the flat background is knocked out to
transparency by distance-from-corner-colour rather than a hard threshold — a hard cut
leaves a halo on JPEG-compressed edges.

Use --keep-background when the art contains light or white elements. Knocked out, those
go invisible against a light toolbar; kept, the dark tile guarantees contrast on any
theme. That is a real tradeoff, not a preference: check both before choosing.

16px is the toolbar size and is where detail dies. Look at icons/icon16.png before
shipping: if you cannot tell what it is, the art needs simplifying, not rescaling.
"""

import sys
from pathlib import Path
from PIL import Image

SIZES = (16, 32, 48, 128)
# 128px store icon should sit in a ~96px live area; the rest is breathing room.
PAD_RATIO = 0.10


# A "flat" background out of a JPEG encoder is not flat. Anything within this distance of
# the corner colour is treated as background, otherwise compression noise survives as a
# faint haze that both dirties the edges and inflates the bounding box.
NOISE_FLOOR = 34


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
            alpha = 0 if dist <= NOISE_FLOOR else min(255, (dist - NOISE_FLOOR) * 4)
            dst[x, y] = (r, g, b, alpha)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    keep_bg = "--keep-background" in sys.argv
    out_dir = Path(__file__).resolve().parent.parent / "icons"
    if "--out" in sys.argv:
        out_dir = Path(sys.argv[sys.argv.index("--out") + 1])

    src = Image.open(args[0]).convert("RGB")
    bg = src.getpixel((2, 2))

    art = knockout(src)
    art = art.crop(art.getbbox())  # trim to the ink, so padding is measured from the glyph

    side = max(art.size)
    fill = (*bg, 255) if keep_bg else (0, 0, 0, 0)
    square = Image.new("RGBA", (side, side), fill)
    square.paste(art, ((side - art.width) // 2, (side - art.height) // 2), art)

    out_dir.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        pad = round(size * PAD_RATIO)
        live = size - pad * 2
        canvas = Image.new("RGBA", (size, size), fill)
        canvas.paste(square.resize((live, live), Image.LANCZOS), (pad, pad))
        canvas.save(out_dir / f"icon{size}.png")
        print(f"{out_dir.name}/icon{size}.png")


if __name__ == "__main__":
    main()
