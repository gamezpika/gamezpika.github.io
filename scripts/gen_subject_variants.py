"""生 15 張學科專屬職業圖（消除 teacher/student 重複 + 換掉違和執業人員）。
A 5 科老師(i2i teacher.png 換學科道具) / B 5 院生(i2i student_v2.png 換制服色+課本) /
C 5 執業人員(i2i reporter.png 改畢業帽+證照+學科,去記者道具)。
輸出 assets/images/jobs/{name}.png 512 RGBA 透明底。
"""
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "assets/images/jobs"

# (檔名, 錨點圖, prompt 主體)
SPECS = [
    # ── A. 5 科老師（錨 teacher.png，保留眼鏡+教鞭+小黑板，換學科板書與配件）──
    ("teacher_chinese", "teacher.png",
     "保留 ref 的『老師造型』(戴眼鏡、手持教鞭與課本、旁邊一塊小黑板)，但改成【國文老師】："
     "小黑板上寫毛筆書法「國」字與注音ㄅㄆㄇ，旁邊環繞一支毛筆、一卷古典線裝書、硯台；制服帶朱紅色點綴。"),
    ("teacher_math", "teacher.png",
     "保留 ref 的『老師造型』，但改成【數學老師】：小黑板上寫「1+2=3」與一個三角形幾何圖，"
     "旁邊環繞一把三角板、一支圓規、一把直尺；制服帶藍色點綴。"),
    ("teacher_english", "teacher.png",
     "保留 ref 的『老師造型』，但改成【英文老師】：小黑板上寫大大的「ABC」與「Hello」，"
     "旁邊環繞英文字母卡片 A B C、一本英文書；制服帶靛藍色點綴。"),
    ("teacher_science", "teacher.png",
     "保留 ref 的『老師造型』，但改成【自然老師】：小黑板上畫一個分子結構與「H₂O」，"
     "旁邊環繞一個冒泡的燒杯、一支試管、一片綠葉；制服帶草綠色點綴。"),
    ("teacher_social", "teacher.png",
     "保留 ref 的『老師造型』，但改成【社會老師】：小黑板上畫一張世界地圖輪廓，"
     "旁邊環繞一個地球儀、一卷歷史卷軸、一個指南針；制服帶赭褐色點綴。"),
    # ── B. 5 院生（錨 student_v2.png，同一個學生男孩、手持課本，換制服顏色與課本封面）──
    ("student_chinese", "student_v2.png",
     "保留 ref 的『同一個學生男孩、同樣手捧一本翻開的書站姿』，但這是【國語學院院生】："
     "把制服/吊帶短褲換成『朱紅色』學院制服，手上的書是國語課本(封面有毛筆字)。完全透明背景。"),
    ("student_math", "student_v2.png",
     "保留 ref 的『同一個學生男孩、手捧書站姿』，但這是【數學學院院生】："
     "制服換成『天藍色』學院制服，手上的書是數學課本(封面有 123 與幾何圖)。完全透明背景。"),
    ("student_english", "student_v2.png",
     "保留 ref 的『同一個學生男孩、手捧書站姿』，但這是【英語學院院生】："
     "制服換成『靛藍色』學院制服，手上的書是英文課本(封面有 ABC)。完全透明背景。"),
    ("student_science", "student_v2.png",
     "保留 ref 的『同一個學生男孩、手捧書站姿』，但這是【自然學院院生】："
     "制服換成『草綠色』學院制服，手上的書是自然課本(封面有綠葉與放大鏡)。完全透明背景。"),
    ("student_social", "student_v2.png",
     "保留 ref 的『同一個學生男孩、手捧書站姿』，但這是【社會學院院生】："
     "制服換成『赭褐色』學院制服，手上的書是社會課本(封面有地球與地圖)。完全透明背景。"),
    # ── C. 5 執業人員（錨 reporter.png 畫風，改畢業帽+手持證照卷軸+學科道具，去記者道具）──
    ("pro_chinese", "reporter.png",
     "保留 ref 的『同一個男孩、完全一樣的 chibi 像素彩繪畫風』，但改成【國語執業人員】："
     "戴黑色學士畢業帽、穿正式學院袍(朱紅點綴)、手持一卷捲起的證書(上有印章)；旁邊環繞一支毛筆、一卷書法。"
     "把 ref 原本的記者道具(攝影機/電視/麥克風/採訪本)全部移除。完全透明背景。"),
    ("pro_math", "reporter.png",
     "保留 ref 的『同一個男孩、一樣 chibi 像素彩繪畫風』，但改成【數學執業人員】："
     "戴黑色學士畢業帽、穿正式學院袍(藍色點綴)、手持一卷捲起的證書；旁邊環繞一把三角板、一支圓規、幾何圖。"
     "移除 ref 的記者道具。完全透明背景。"),
    ("pro_english", "reporter.png",
     "保留 ref 的『同一個男孩、一樣 chibi 像素彩繪畫風』，但改成【英語執業人員】："
     "戴黑色學士畢業帽、穿俐落商務西裝(靛藍領帶)、手持一卷捲起的證書；旁邊環繞英文字母 ABC、一本英文書。"
     "移除 ref 的記者道具(別做成空服員)。完全透明背景。"),
    ("pro_science", "reporter.png",
     "保留 ref 的『同一個男孩、一樣 chibi 像素彩繪畫風』，但改成【自然執業人員】："
     "戴黑色學士畢業帽、穿白色實驗袍(草綠點綴)、手持一卷捲起的證書；旁邊環繞一個燒杯、一支試管、一片綠葉。"
     "移除 ref 的記者道具。完全透明背景。"),
    ("pro_social", "reporter.png",
     "保留 ref 的『同一個男孩、一樣 chibi 像素彩繪畫風』，但改成【社會執業人員】："
     "戴黑色學士畢業帽、穿正式學院袍(赭褐點綴)、手持一卷捲起的證書；旁邊環繞一個地球儀、一卷歷史卷軸、一張地圖。"
     "移除 ref 的記者道具。完全透明背景。"),
]


def build_prompt(body, out):
    return (
        "請用 image_generation 工具生一張 512x512 PNG 角色 sprite，要求：\n"
        "1. 跟 ref 圖『完全一樣的畫風』(chibi 像素彩繪風、粗黑描邊、飽和色)、"
        "『完全同一個男孩』(咖啡色蓬鬆短髮、可愛圓臉、約 2.5 頭身)、正面站姿全身。\n"
        f"2. {body}\n"
        "3. 完全透明背景（NO 平台 NO 陰影 NO 地板 NO 外框）。\n"
        f"4. 輸出絕對路徑：{out}"
    )


def run_one(spec):
    name, anchor, body = spec
    ref = JOBS / anchor
    out = JOBS / f"{name}.png"
    prompt = build_prompt(body, out)
    cmd = ["codex", "exec", "--sandbox", "workspace-write", "-i", str(ref)]
    try:
        r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, timeout=480)
        if out.exists():
            im = Image.open(out).convert("RGBA")
            if max(im.size) > 520:
                im.thumbnail((512, 512), Image.LANCZOS)
            im.save(out, "PNG", optimize=True)
            return (name, True, f"OK {out.stat().st_size//1024}KB")
        return (name, False, "no output: " + (r.stderr or "")[-160:])
    except subprocess.TimeoutExpired:
        return (name, False, "timeout 480s")


def main():
    print(f"=== 生 {len(SPECS)} 張學科職業圖, 3 parallel ===", flush=True)
    ok, fail = [], []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(run_one, s): s[0] for s in SPECS}
        for f in as_completed(futs):
            n, s, msg = f.result()
            print(f"  [{'✓' if s else '✗'}] {n}  {msg}", flush=True)
            (ok if s else fail).append(n)
    print(f"\n=== Done OK {len(ok)} / Fail {len(fail)} ===", flush=True)
    if fail:
        print("Failed:", fail)


if __name__ == "__main__":
    main()
