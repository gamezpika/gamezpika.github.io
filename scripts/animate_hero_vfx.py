"""把 24 個職業 hero_vfx 靜態 PNG → 帶電 animated webp（覆蓋同名 .webp）。

電流弧光（藍白閃電竄動 + 放電輝光 + 脈衝）做在圖層，透明 additive 發光；
出場的放大/旋轉/淡出交給 boss-arena.css 的 .motion-* CSS，不在這裡做（避免疊兩次）。

純 Python，零 Codex/Layer/Ludo 花費。沿用 sprite-anim 方法論。
用法：python3 scripts/animate_hero_vfx.py            # 全 24 張
      python3 scripts/animate_hero_vfx.py math_detective  # 單張
"""
import sys, math, random
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
VFX_DIR = ROOT / "assets/images/hero_vfx"
NFRAMES = 20
DUR = 45  # ms/frame → 20*45 = 900ms 一輪，剛好對齊特效顯示時間


def bolt(draw, x0, y0, x1, y1, segs, jit, color, width, rnd, branch=True):
    pts = [(x0, y0)]
    for s in range(1, segs):
        t = s / segs
        pts.append((x0 + (x1 - x0) * t + rnd.uniform(-jit, jit),
                    y0 + (y1 - y0) * t + rnd.uniform(-jit, jit)))
    pts.append((x1, y1))
    draw.line(pts, fill=color, width=width, joint="curve")
    if branch:
        for _ in range(rnd.randint(1, 2)):
            bi = rnd.randint(1, len(pts) - 2)
            bx, by = pts[bi]
            ex = bx + rnd.uniform(-70, 70); ey = by + rnd.uniform(-70, 70)
            bolt(draw, bx, by, ex, ey, 3, 14, color, max(1, width - 2), rnd, branch=False)


def spark_layer(W, intensity, rnd):
    """回傳 (RGB additive int32)：藍白電弧 glow + 銳利 core。中心在圖正中。"""
    cen = W // 2
    glow = Image.new("RGB", (W, W), (0, 0, 0))
    core = Image.new("RGB", (W, W), (0, 0, 0))
    dg = ImageDraw.Draw(glow); dc = ImageDraw.Draw(core)
    # 放射主電弧（多 + 延伸到邊緣外）
    for _ in range(rnd.randint(7, 10)):
        ang = rnd.uniform(0, 2 * math.pi); rad = rnd.uniform(0.33 * W, 0.54 * W)
        x1 = cen + math.cos(ang) * rad; y1 = cen + math.sin(ang) * rad
        x0 = cen + rnd.uniform(-25, 25); y0 = cen + rnd.uniform(-25, 25)
        bolt(dg, x0, y0, x1, y1, 7, 22, (160, 225, 255), 7, rnd)
        bolt(dc, x0, y0, x1, y1, 7, 22, (230, 248, 255), 3, rnd)
    # 沿外圈竄動的弧
    for _ in range(rnd.randint(2, 4)):
        a0 = rnd.uniform(0, 2 * math.pi); a1 = a0 + rnd.uniform(0.5, 1.3)
        rr = rnd.uniform(0.33 * W, 0.43 * W)
        x0 = cen + math.cos(a0) * rr; y0 = cen + math.sin(a0) * rr
        x1 = cen + math.cos(a1) * rr; y1 = cen + math.sin(a1) * rr
        bolt(dg, x0, y0, x1, y1, 5, 20, (160, 225, 255), 6, rnd, branch=False)
        bolt(dc, x0, y0, x1, y1, 5, 20, (230, 248, 255), 2, rnd, branch=False)
    g = np.array(glow.filter(ImageFilter.GaussianBlur(6))).astype(np.int32)
    c = np.array(core).astype(np.int32)
    return g * intensity * 1.6 + c * 1.3


def process(job):
    png = VFX_DIR / f"{job}.png"
    if not png.exists():
        print(f"  ✗ 找不到 {png.name}"); return False
    base = Image.open(png).convert("RGBA")
    W = base.width
    base_arr = np.array(base).astype(np.int32)
    base_rgb = base_arr[..., :3]
    base_a = base_arr[..., 3]
    rnd = random.Random(hash(job) & 0xffff)

    frames = []
    for k in range(NFRAMES):
        t = k / NFRAMES
        pulse = 0.9 + 0.7 * abs(math.sin(t * 2 * math.pi * 3))  # 高頻放電脈衝
        spark = spark_layer(W, pulse, rnd)
        # 偶爾整體爆閃（疊在電光，仍只在 alpha>0 處顯示）
        flash = np.array([55, 80, 120]) if rnd.random() < 0.33 else 0
        spark = spark + flash
        spark_bright = np.clip(spark.max(axis=2), 0, 255)
        # additive：圖被電打亮；圖外的電弧靠 spark 自己的 alpha 顯示（透明）
        out_rgb = np.clip(base_rgb + spark, 0, 255)
        out_a = np.maximum(base_a, spark_bright)
        rgba = np.dstack([out_rgb, out_a]).astype(np.uint8)
        frames.append(Image.fromarray(rgba, "RGBA"))

    out = VFX_DIR / f"{job}.webp"
    frames[0].save(out, format="webp", save_all=True, append_images=frames[1:],
                   duration=DUR, loop=0, quality=88, method=4)
    kb = out.stat().st_size // 1024
    return f"  ✓ {job}.webp  {NFRAMES}幀  {kb}KB"


def main():
    if len(sys.argv) > 1:
        jobs = sys.argv[1:]
    else:
        jobs = sorted(p.stem for p in VFX_DIR.glob("*.png")
                      if p.stem != "president_chroma" and not p.stem.startswith("_"))
    print(f"處理 {len(jobs)} 張：")
    with ThreadPoolExecutor(max_workers=6) as ex:
        for r in ex.map(process, jobs):
            if r: print(r)


if __name__ == "__main__":
    main()
