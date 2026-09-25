#!/usr/bin/env python3
"""Generate the extension's icons. Re-run after tweaking the design."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (255, 106, 0, 255)        # brand orange
FG = (255, 255, 255, 255)
RING = (30, 30, 30, 255)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # rounded square background
    r = int(size * 0.22)
    pad = max(1, size // 16)
    d.rounded_rectangle(
        (pad, pad, size - 1 - pad, size - 1 - pad),
        radius=r,
        fill=BG,
    )
    # White "M" mark
    try:
        font = ImageFont.truetype(
            "/System/Library/Fonts/Helvetica.ttc",
            int(size * 0.62),
        )
    except Exception:
        try:
            font = ImageFont.truetype(
                "/System/Library/Fonts/SFNS.ttf",
                int(size * 0.62),
            )
        except Exception:
            font = ImageFont.load_default()
    text = "M"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1] - size * 0.02
    d.text((x, y), text, fill=FG, font=font)
    return img


def main() -> None:
    for s in (16, 32, 48, 96, 128):
        img = draw_icon(s)
        path = OUT / f"icon-{s}.png"
        img.save(path, "PNG")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
