"""Build a FALLBACK Open Graph banner from the existing brand assets.

⚠️ The live file is `public/og-devora.png`, which is now the designer's artwork — this script
writes `public/og-devora-fallback.png` instead, so running it can never overwrite that. Use it
only if the artwork is lost and something has to serve at that URL again.

1200x630 is the size every unfurler crops to; the page used to point at a 512x512 favicon,
which is why link previews looked like a stripped-down icon rather than a card.

Run: python3 scripts/build-og-image.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OUT = PUBLIC / "og-devora-fallback.png"

W, H = 1200, 630

# Brand tokens, taken from :root in src/app/globals.css.
CREAM = (245, 239, 226)
PAPER = (255, 253, 248)
INK = (23, 20, 13)
MUTED = (119, 114, 103)
MINT = (18, 179, 164)
CORAL = (255, 91, 87)
LINE = (222, 216, 204)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
FONT_REGULAR = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def load_font(candidates, size):
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main() -> None:
    canvas = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(canvas)

    # Faint dot grid: enough texture that the card does not read as a flat swatch, quiet enough
    # not to fight the wordmark.
    for y in range(0, H, 28):
        for x in range(0, W, 28):
            draw.ellipse((x, y, x + 2, y + 2), fill=(232, 225, 211))

    # Panel with the house border + hard offset shadow (2px line, 6px shadow).
    pad = 56
    panel = (pad, pad, W - pad, H - pad)
    draw.rectangle((panel[0] + 8, panel[1] + 8, panel[2] + 8, panel[3] + 8), fill=INK)
    draw.rectangle(panel, fill=PAPER, outline=INK, width=4)

    # Icon, drawn from the existing asset rather than redrawn.
    icon = Image.open(PUBLIC / "devora-icon-red-nobg.png").convert("RGBA")
    icon_h = 268
    icon_w = round(icon.width * icon_h / icon.height)
    icon = icon.resize((icon_w, icon_h), Image.Resampling.LANCZOS)
    icon_x = panel[0] + 64
    icon_y = (H - icon_h) // 2
    canvas.paste(icon, (icon_x, icon_y), icon)

    text_x = icon_x + icon_w + 60
    f_word = load_font(FONT_CANDIDATES, 86)
    f_tag = load_font(FONT_REGULAR, 34)
    f_small = load_font(FONT_CANDIDATES, 25)

    # Wordmark + tagline, vertically centred against the icon.
    block_top = 196
    draw.text((text_x, block_top), "DEVORA", font=f_word, fill=INK)

    # Mint underline sized to the wordmark, not the panel.
    word_w = draw.textlength("DEVORA", font=f_word)
    draw.rectangle((text_x, block_top + 104, text_x + word_w, block_top + 112), fill=MINT)

    draw.text((text_x, block_top + 136), "One workspace for AI infrastructure,", font=f_tag, fill=MUTED)
    draw.text((text_x, block_top + 180), "credits, and billing.", font=f_tag, fill=MUTED)

    # Footer line: the domain, so a screenshot of the card still names the site.
    draw.rectangle((pad + 4, H - pad - 78, W - pad - 4, H - pad - 76), fill=LINE)
    draw.text((text_x, H - pad - 62), "devora.my.id", font=f_small, fill=INK)
    draw.rectangle((text_x - 14, H - pad - 56, text_x - 6, H - pad - 48), fill=CORAL)

    canvas.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, {W}x{H})")


if __name__ == "__main__":
    main()
