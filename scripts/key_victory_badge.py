#!/usr/bin/env python3
"""victory_badge_raw.png 洋紅去背 → arcade/img/victory_badge.png
magenta-ness = min(R,B) - G：>=120 全透明、<=40 全不透明、中間線性 + 反混色(unmix)。
白翅(R=G=B) / 金(B低) / 藍(R低) / 深描邊(全低) 的 magenta-ness 都≈0 → 不誤傷。
完成後疊在結算頁深色底(#0d0a06)上數殘留洋紅像素，必須=0。"""
from PIL import Image

SRC = "/home/gamezpika/eduarena-skill-demo/arcade/img/victory_badge_raw.png"
DST = "/home/gamezpika/eduarena-skill-demo/arcade/img/victory_badge.png"

im = Image.open(SRC).convert("RGBA")
px = im.load()
W, H = im.size
BG = (255, 0, 255)

for y in range(H):
    for x in range(W):
        r, g, b, _ = px[x, y]
        m = min(r, b) - g  # magenta-ness
        if m >= 120:
            px[x, y] = (0, 0, 0, 0)
        elif m > 40:
            a = (120 - m) / 80.0  # 1.0(=40) → 0.0(=120)
            # 反混色：c = a*f + (1-a)*BG → f = (c - (1-a)*BG) / a
            f = []
            for c, bgc in ((r, BG[0]), (g, BG[1]), (b, BG[2])):
                v = (c - (1 - a) * bgc) / a
                f.append(max(0, min(255, round(v))))
            px[x, y] = (f[0], f[1], f[2], round(a * 255))

# trim 到內容 bbox + 8px 邊
bbox = im.getbbox()
pad = 8
bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(W, bbox[2] + pad), min(H, bbox[3] + pad))
im = im.crop(bbox)
im.save(DST)
print(f"saved {DST} {im.size}")

# 驗證：疊深色底，數殘留洋紅(像素 min(R,B)-G > 60)
dark = Image.new("RGBA", im.size, (13, 10, 6, 255))
dark.alpha_composite(im)
dp = dark.load()
residue = sum(
    1
    for y in range(im.size[1])
    for x in range(im.size[0])
    if min(dp[x, y][0], dp[x, y][2]) - dp[x, y][1] > 60
)
print(f"magenta residue on dark bg: {residue}")
dark.convert("RGB").save("/home/gamezpika/eduarena-skill-demo/arcade/img/victory_badge_check.png")
