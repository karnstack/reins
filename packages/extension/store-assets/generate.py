#!/usr/bin/env python3
"""Generate reins Chrome Web Store graphic assets (exact sizes, 24-bit, no alpha).

Run: python3 generate.py   (needs Pillow; macOS system fonts)
Outputs PNGs next to this file. Regenerate whenever the branding changes.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
C0 = (124, 131, 255)  # #7C83FF
C1 = (109, 40, 217)   # #6D28D9
WHITE = (255, 255, 255)
INK = (14, 16, 32)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]
MONO_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Courier.ttc",
]


def font(size, bold=False, mono=False):
    cands = MONO_CANDIDATES if mono else FONT_CANDIDATES
    for path in cands:
        if os.path.exists(path):
            try:
                # .ttc index 1 is often the bold/variant face; fall back to 0.
                return ImageFont.truetype(path, size, index=1 if bold and path.endswith(".ttc") else 0)
            except Exception:
                try:
                    return ImageFont.truetype(path, size)
                except Exception:
                    continue
    return ImageFont.load_default()


def gradient(w, h):
    """Diagonal gradient C0 (top-left) → C1 (bottom-right)."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    denom = float(w + h - 2) or 1.0
    # Precompute per-diagonal color for speed.
    row = [None] * (w + h)
    for s in range(w + h):
        t = s / denom
        row[s] = (
            int(C0[0] + (C1[0] - C0[0]) * t),
            int(C0[1] + (C1[1] - C0[1]) * t),
            int(C0[2] + (C1[2] - C0[2]) * t),
        )
    for y in range(h):
        for x in range(w):
            px[x, y] = row[x + y]
    return img


def cubic(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
        y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        pts.append((x, y))
    return pts


def draw_mark(img, x, y, size):
    """The reins logo mark: white rounded tile + two grips + connecting spline."""
    d = ImageDraw.Draw(img)
    s = size
    d.rounded_rectangle([x, y, x + s, y + s], radius=int(s * 0.24), fill=WHITE)

    def P(fx, fy):
        return (x + fx * s, y + fy * s)

    curve = cubic(P(0.33, 0.33), P(0.33, 0.62), P(0.67, 0.40), P(0.67, 0.67))
    d.line(curve, fill=C1, width=max(3, int(s * 0.095)), joint="curve")
    r = s * 0.11
    for cx, cy in (P(0.33, 0.33), P(0.67, 0.67)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=C1)


def text(d, xy, s, fnt, fill=WHITE, anchor="la"):
    d.text(xy, s, font=fnt, fill=fill, anchor=anchor)


def marquee():
    w, h = 1400, 560
    img = gradient(w, h)
    draw_mark(img, 150, 170, 220)
    d = ImageDraw.Draw(img)
    text(d, (440, 130), "reins", font(150, bold=True))
    text(d, (446, 300), "Drive your real browser from your coding agent.", font(40, bold=True))
    text(d, (446, 362), "npm i -g @karnstack/reins", font(30, mono=True), fill=(235, 236, 247))
    img.save(os.path.join(HERE, "marquee-1400x560.png"))


def small_tile():
    w, h = 440, 280
    img = gradient(w, h)
    draw_mark(img, 40, 42, 96)
    d = ImageDraw.Draw(img)
    text(d, (158, 52), "reins", font(58, bold=True))
    text(d, (40, 176), "Drive your real browser", font(27, bold=True))
    text(d, (40, 212), "from your coding agent.", font(27, bold=True))
    img.save(os.path.join(HERE, "small-tile-440x280.png"))


def screenshot():
    w, h = 1280, 800
    img = gradient(w, h)
    draw_mark(img, 120, 96, 132)
    d = ImageDraw.Draw(img)
    text(d, (284, 92), "reins", font(96, bold=True))
    text(d, (290, 190), "Drive your real, logged-in browser from your coding agent.", font(33, bold=True))

    # terminal card
    d.rounded_rectangle([120, 300, 1160, 704], radius=20, fill=INK)
    for i, cx in enumerate((150, 178, 206)):
        col = [(255, 95, 87), (254, 188, 46), (40, 200, 64)][i]
        d.ellipse([cx - 8, 26 + 300, cx + 8, 42 + 300], fill=col)
    mono = font(25, mono=True)
    green = (155, 231, 166)
    fg = (237, 238, 247)
    muted = (138, 143, 176)
    lines = [
        (green, "$ ", fg, "reins tabs"),
        (muted, "  b1  tab 12 *  Docs — https://example.com", None, None),
        (green, "$ ", fg, "reins snapshot --tab 12"),
        (muted, '  e5: button "Submit"', None, None),
        (green, "$ ", fg, "reins click --ref e5"),
        (muted, "  ok", None, None),
    ]
    y = 380
    for c0, t0, c1, t1 in lines:
        d.text((150, y), t0, font=mono, fill=c0)
        if t1:
            w0 = d.textlength(t0, font=mono)
            d.text((150 + w0, y), t1, font=mono, fill=c1)
        y += 50
    text(d, (120, 748), "Local-only · tabs · click · type · screenshot · console & network · raw CDP",
         font(24, bold=True), fill=(235, 236, 247))
    img.save(os.path.join(HERE, "screenshot-1280x800.png"))


if __name__ == "__main__":
    marquee()
    small_tile()
    screenshot()
    print("generated marquee / small-tile / screenshot PNGs")
