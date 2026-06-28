# Generates native/app.ico — a blue rounded tile with a white whale (DeepSeek brand mark).
# Drawn at high supersample then downsampled into a multi-size .ico so it stays crisp at 16px.
from PIL import Image, ImageDraw
import os

SS = 1024  # supersample canvas


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))

# vertical blue gradient clipped to a Win11-style squircle tile
grad = Image.new("RGB", (SS, SS))
px = grad.load()
top, bot = (96, 158, 255), (56, 116, 234)
for y in range(SS):
    c = lerp(top, bot, y / SS)
    for x in range(SS):
        px[x, y] = c
mask = Image.new("L", (SS, SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([56, 56, SS - 56, SS - 56], radius=int(SS * 0.235), fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
W = (255, 255, 255, 255)
EYE = (50, 104, 224, 255)  # accent blue for the eye

# ── White whale, facing left ──────────────────────────────────────────────
# Tail flukes (drawn first, behind the body) at the right.
d.polygon([(690, 560), (892, 452), (812, 580)], fill=W)   # upper fluke
d.polygon([(690, 588), (892, 700), (812, 568)], fill=W)   # lower fluke

# Main body: a fat rounded blob, head rounder on the left.
d.ellipse([196, 404, 770, 716], fill=W)

# Pectoral fin under the front of the body.
d.polygon([(372, 678), (300, 792), (470, 706)], fill=W)

# Eye on the head (upper-left).
d.ellipse([330, 506, 388, 564], fill=EYE)

# Blowhole spout above the head — three dabs fanning up.
d.ellipse([300, 356, 340, 396], fill=W)
d.ellipse([262, 312, 296, 346], fill=W)
d.ellipse([322, 300, 356, 334], fill=W)

here = os.path.dirname(os.path.abspath(__file__))
ico = os.path.join(here, "..", "native", "app.ico")
png = os.path.join(here, "..", "native", "icon_preview.png")
img.save(ico, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((256, 256), Image.LANCZOS).save(png)
print("icon written to native/app.ico")
