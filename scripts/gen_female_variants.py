"""生 20 張女版職業圖（i2i 餵對應男版，改女角、其餘全保留）。
輸出 assets/images/jobs/{key}_female.png 512 RGBA 透明底。
缺女版的 20 個 job：5 院生 student_/5 執業 pro_/5 老師 teacher_/5 進階。
(reporter/writer/translator/engineer/biologist 已有女版，不重生)
"""
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "assets/images/jobs"

MALE = [
    "student_chinese", "student_math", "student_english", "student_science", "student_social",
    "pro_chinese", "pro_math", "pro_english", "pro_science", "pro_social",
    "teacher_chinese", "teacher_math", "teacher_english", "teacher_science", "teacher_social",
    "trader", "accountant", "foreign_corp", "social_worker", "congress_aide",
]


def build_prompt(out):
    return (
        "請用 image_generation 工具生一張 512x512 PNG，要求：\n"
        "1. 跟 ref 圖『完全一樣的畫風、職業造型、服裝、配件、道具、姿勢、構圖』，"
        "唯一差別是角色改成『女孩』：女性五官、可愛圓臉、短髮或馬尾(瀏海)，其餘(職業服裝/道具/背景物件/顏色)全部跟 ref 一致。\n"
        "2. 完全透明背景（NO 平台 NO 陰影 NO 地板 NO 外框）。\n"
        f"3. 輸出絕對路徑：{out}"
    )


def run_one(key):
    ref = JOBS / f"{key}.png"
    out = JOBS / f"{key}_female.png"
    if not ref.exists():
        return (key, False, f"male ref missing")
    prompt = build_prompt(out)
    cmd = ["codex", "exec", "--sandbox", "workspace-write", "-i", str(ref)]
    try:
        r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, timeout=480)
        if out.exists():
            im = Image.open(out).convert("RGBA")
            if max(im.size) > 520:
                im.thumbnail((512, 512), Image.LANCZOS)
            im.save(out, "PNG", optimize=True)
            return (key, True, f"OK {out.stat().st_size//1024}KB")
        return (key, False, "no output: " + (r.stderr or "")[-160:])
    except subprocess.TimeoutExpired:
        return (key, False, "timeout 480s")


def main():
    print(f"=== 生 {len(MALE)} 張女版職業圖, 3 parallel ===", flush=True)
    ok, fail = [], []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(run_one, k): k for k in MALE}
        for f in as_completed(futs):
            n, s, msg = f.result()
            print(f"  [{'✓' if s else '✗'}] {n}_female  {msg}", flush=True)
            (ok if s else fail).append(n)
    print(f"\n=== Done OK {len(ok)} / Fail {len(fail)} ===", flush=True)
    if fail:
        print("Failed:", fail)


if __name__ == "__main__":
    main()
