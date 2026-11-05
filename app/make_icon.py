"""Sukuria programėlės piktogramą (icon.ico) diegimo metu."""

from pathlib import Path

from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([8, 8, S - 8, S - 8], radius=56, fill=(47, 62, 158, 255))
white = (255, 255, 255, 255)
# Nata: galvutė, kotelis ir vėliavėlė
d.ellipse([62, 156, 132, 206], fill=white)
d.rectangle([118, 52, 134, 184], fill=white)
d.polygon([(134, 52), (196, 76), (196, 110), (134, 86)], fill=white)

out = Path(__file__).with_name("icon.ico")
img.save(out, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Piktograma:", out)
