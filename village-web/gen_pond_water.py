#!/usr/bin/env python3
# 生池塘水面動畫 spritesheet（背景鎖死鐵律：不重繪底圖，只取水域局部做波紋 warp + 羽化疊上去）
# 來源：campus_ground_v2.webp 左下池塘。輸出 pond_water.webp（8 幀 4x2）+ 對位預覽。
from PIL import Image, ImageFilter
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent          # 不依賴工作目錄，從哪跑都對
BG = HERE / "campus_ground_v2.webp"
N = 8            # 幀數
COLS, ROWS = 4, 2
PAD = 14        # 水域外擴（給波紋位移 + 羽化留邊）
AMP = 0.45      # 水波幅度倍率（越小波越微；1.0=原始較大，派派覺得太大改 0.45）

im = Image.open(BG).convert("RGB")
W, H = im.size
a = np.asarray(im).astype(int)
R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
water = (B > 120) & (B > R + 30) & (B > G + 10)
ys, xs = np.where(water)
x0, x1, y0, y1 = xs.min() - PAD, xs.max() + PAD, ys.min() - PAD, ys.max() + PAD
x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(W, x1), min(H, y1)
# 對齊偶數，方便切格
fw = (x1 - x0); fh = (y1 - y0)
cx_px, cy_px = (x0 + x1) / 2, (y0 + y1) / 2

crop = im.crop((x0, y0, x1, y1)).convert("RGBA")
base = np.asarray(crop).astype(np.float32)
# 水域 alpha 遮罩（只動水、羽化邊融進岸）
mask_full = water[y0:y1, x0:x1].astype(np.float32) * 255
mask_img = Image.fromarray(mask_full.astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))
alpha = np.asarray(mask_img).astype(np.float32) / 255.0   # 0..1 羽化

yy, xx = np.mgrid[0:fh, 0:fw].astype(np.float32)
rgb = base[:, :, :3]

frames = []
for t in range(N):
    ph = 2 * np.pi * t / N
    # 波紋位移：水平 + 垂直雙向小幅 sine（振幅小，池塘靜水感，非河流流向）
    dx = AMP * (2.2 * np.sin(yy * 0.085 + xx * 0.02 + ph) + 1.1 * np.cos(yy * 0.05 - ph))
    dy = AMP * (1.6 * np.sin(xx * 0.075 - yy * 0.02 + ph * 1.0))
    sx = np.clip(xx + dx, 0, fw - 1).astype(np.int32)
    sy = np.clip(yy + dy, 0, fh - 1).astype(np.int32)
    warped = rgb[sy, sx]
    # 光斑閃爍（假水面反光 caustics）：亮度微調，相位流動
    # 相位倍率都用整數，保證 N 幀走完整數個週期 → frame 末→首無縫
    shimmer = 1.0 + 0.07 * np.sin(xx * 0.16 + yy * 0.13 + ph * 1.0) \
                  + 0.04 * np.sin(xx * 0.31 - yy * 0.07 - ph * 2.0)
    warped = np.clip(warped * shimmer[:, :, None], 0, 255)
    out = np.zeros((fh, fw, 4), np.float32)
    out[:, :, :3] = warped
    out[:, :, 3] = alpha * 255
    frames.append(Image.fromarray(out.astype(np.uint8), "RGBA"))

# 拼 4x2 spritesheet
sheet = Image.new("RGBA", (fw * COLS, fh * ROWS), (0, 0, 0, 0))
for i, f in enumerate(frames):
    sheet.paste(f, ((i % COLS) * fw, (i // COLS) * fh))
sheet.save(HERE / "pond_water.webp", "WEBP", quality=92, method=6)

# 對位預覽：frame0 疊回底圖
prev = im.convert("RGBA").copy()
prev.alpha_composite(frames[0], (x0, y0))
prev.convert("RGB").save(HERE / "pond_water_align_preview.png")

print(f"frame_width={fw} frame_height={fh} frames={N} grid={COLS}x{ROWS}")
print(f"anchor_norm_center=({cx_px / W:.5f},{cy_px / H:.5f})")
print(f"sheet size={sheet.size}  saved pond_water.webp + pond_water_align_preview.png")
