"""Sukuria programos piktogramą (icon.ico): penklinė su nata."""

from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=220, fill=(43, 68, 196, 255))
white = (255, 255, 255, 255)
for i in range(5):
    y = 288 + i * 128
    d.rectangle([150, y - 14, S - 150, y + 14], fill=white)
# Natos galvutė (pasvirusi elipsė) ir kotelis
head = Image.new("RGBA", (300, 210), (0, 0, 0, 0))
ImageDraw.Draw(head).ellipse([0, 0, 299, 209], fill=white)
head = head.rotate(22, expand=True, resample=Image.BICUBIC)
img.alpha_composite(head, (300, 560))
d.rectangle([586, 190, 622, 700], fill=white)

out = Path(__file__).with_name("icon.ico")
img.resize((256, 256), Image.LANCZOS).save(
    out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Piktograma:", out)
