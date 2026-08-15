"""Composes raw popup captures into Chrome Web Store screenshots.

    python tools/make-screenshots.py

Reads store/raw/N.png and writes store/screenshots/NN-slug.png at 1280x800.

The popup is 320px wide. Dropped unscaled onto a 1280x800 canvas it reads as a postage
stamp, so each capture is scaled to fill its half of the frame and paired with a caption
that says what the user is looking at. Listing order is deliberate: the store shows the
first image largest and most often, so the fullest screen leads and the empty state is
last.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 800
BG = (30, 30, 30)          # --bg
SURFACE = (37, 37, 38)     # --surface
BORDER = (60, 60, 60)      # --border
TEXT = (228, 228, 228)     # --text
MUTED = (157, 157, 157)    # --muted
ACCENT = (74, 158, 255)    # --accent

FONTS = "C:/Windows/Fonts/"
H1 = ImageFont.truetype(FONTS + "segoeuib.ttf", 46)
BODY = ImageFont.truetype(FONTS + "segoeui.ttf", 23)
TAG = ImageFont.truetype(FONTS + "segoeuib.ttf", 17)

# (source file, slug, eyebrow, headline, body)
SHOTS = [
    ("5.png", "switch", "ONE CLICK", "Switch between logins\ninstantly",
     "Every account you need for a site, in one list.\nClick a name and the browser is signed in as\nthem — no restart, no clearing anything by hand."),
    ("4.png", "per-site", "PER SITE", "Each site tracks its own\nsigned-in user",
     "DEV, UAT and PROD each keep their own account\nand their own session. Switching on one leaves\nthe others exactly as they were."),
    ("3.png", "domains", "YOU DECIDE", "Credentials go only where\nyou say",
     "Nothing is sent until you add a domain. The list\nyou configure is the only place your credentials\nare ever offered."),
    ("2.png", "backup", "PORTABLE", "Encrypted backup and\nrestore",
     "Move your accounts to another machine with an\nAES-256-GCM encrypted file. Import merges, so\nnothing you already have is overwritten."),
    ("1.png", "empty", "PRIVATE BY DEFAULT", "No server, no telemetry,\nnothing to configure",
     "Everything stays in your own copy of Chrome.\nThere is no account, no sync and no analytics —\nthe extension has nowhere to send anything."),
]


def shadowed(img, radius=26, spread=16):
    """Lifts the capture off the flat background so it doesn't look pasted on."""
    pad = radius + spread
    layer = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    block = Image.new("RGBA", img.size, (0, 0, 0, 190))
    layer.paste(block, (pad, pad + spread // 2))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))

    framed = Image.new("RGBA", img.size, (0, 0, 0, 0))
    framed.paste(img, (0, 0))
    ImageDraw.Draw(framed).rectangle(
        [0, 0, img.width - 1, img.height - 1], outline=BORDER + (255,), width=1
    )
    layer.paste(framed, (pad, pad), framed)
    return layer


def compose(src, eyebrow, headline, body):
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    # A wash of accent behind the capture, so the frame isn't a flat rectangle of grey.
    # Blurred hard, and drawn well outside the canvas, so no edge of the shape is visible —
    # a clipped ellipse reads as a rendering mistake rather than as lighting.
    glow = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(glow).ellipse([620, -260, 1700, 1060], fill=(40, 50, 66))
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    canvas = Image.blend(canvas, glow, 0.85)
    draw = ImageDraw.Draw(canvas)

    shot = Image.open(src).convert("RGBA")
    box_w, box_h = 560, 660
    scale = min(box_w / shot.width, box_h / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)

    with_shadow = shadowed(shot)
    x = 700 + (box_w - shot.width) // 2
    y = (H - shot.height) // 2
    canvas.paste(with_shadow, (x - 42, y - 42), with_shadow)

    left = 84
    draw.text((left, 214), eyebrow, font=TAG, fill=ACCENT)
    draw.text((left, 248), headline, font=H1, fill=TEXT, spacing=10)

    hl_h = draw.multiline_textbbox((0, 0), headline, font=H1, spacing=10)[3]
    draw.line([left, 248 + hl_h + 34, left + 54, 248 + hl_h + 34], fill=ACCENT, width=3)
    draw.text((left, 248 + hl_h + 60), body, font=BODY, fill=MUTED, spacing=9)
    return canvas


def main():
    root = Path(__file__).resolve().parent.parent
    raw, out = root / "store" / "raw", root / "store" / "screenshots"
    out.mkdir(parents=True, exist_ok=True)

    for i, (src, slug, eyebrow, headline, body) in enumerate(SHOTS, 1):
        path = raw / src
        if not path.exists():
            print(f"  skip {src} — not found in store/raw/")
            continue
        img = compose(path, eyebrow, headline, body)
        dest = out / f"{i:02d}-{slug}.png"
        img.save(dest)
        print(f"  {dest.relative_to(root)}  {img.width}x{img.height}")


if __name__ == "__main__":
    main()
