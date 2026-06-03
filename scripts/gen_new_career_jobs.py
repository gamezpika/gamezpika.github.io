"""生 6 個新進階職業 sprite（職業樹大改）。
i2i 餵 reporter.png 當畫風+角色錨點，強制換掉記者道具成各職業道具。
輸出 assets/images/jobs/{key}.png，512 RGBA 透明底，比照既有進階職業畫風。
"""
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "assets/images/jobs"
REF = JOBS / "reporter.png"

NEW = {
    "teacher": ("教師（老師）",
        "襯衫加針織背心或西裝外套、戴眼鏡、親切笑容",
        "手持一本翻開的教科書與一支教鞭/教學棒；旁邊環繞一塊小黑板（上面寫 ABC、123）、一顆紅蘋果、幾本疊起來的書"),
    "trader": ("交易員",
        "俐落深色西裝、打領帶",
        "手持一台顯示紅綠 K 線股票走勢的平板；旁邊漂浮上升的折線圖箭頭、一疊金幣、智慧型手機"),
    "accountant": ("會計師",
        "白襯衫打領帶加袖套、戴眼鏡",
        "手持一台計算機；旁邊環繞一本帳本、一個算盤、一疊財務報表文件、幾枚金幣"),
    "foreign_corp": ("外商企業職員",
        "俐落的國際商務西裝、脖子掛識別證吊牌",
        "手提一個公事包；旁邊環繞一個地球儀/世界地圖、一台筆電、一個小飛機圖示"),
    "social_worker": ("社工人員",
        "親切的志工背心加識別證、溫暖笑容",
        "手持一塊寫字夾板；旁邊環繞一顆愛心、兩隻互相幫助的手、一個小小的一家人/社區圖示"),
    "congress_aide": ("國會助理",
        "正式深色西裝、脖子掛識別證",
        "手抱一疊文件資料夾；旁邊環繞一棟有圓頂的國會議事堂建築、一面旗幟、一支智慧型手機"),
}


def build_prompt(name, outfit, props, out):
    return (
        "請用 image_generation 工具生一張 512x512 PNG 角色 sprite，要求：\n"
        "1. 跟 ref 圖『完全一樣的畫風』(chibi 像素彩繪風、粗黑描邊、飽和色彩)、"
        "『完全同一個男孩』(咖啡色蓬鬆短髮、紫色大眼睛、可愛圓臉、約 2.5 頭身)、正面站姿全身。\n"
        f"2. 但職業換成【{name}】：穿戴 {outfit}。\n"
        f"3. 職業道具：{props}。\n"
        "4. 把 ref 原本的『記者道具(攝影機、電視機、麥克風、採訪筆記本)』全部移除，"
        f"換成上面 {name} 的服裝與道具。\n"
        "5. 完全透明背景（NO 平台 NO 陰影 NO 地板 NO 外框）。\n"
        f"6. 輸出絕對路徑：{out}"
    )


def run_one(key):
    name, outfit, props = NEW[key]
    out = JOBS / f"{key}.png"
    prompt = build_prompt(name, outfit, props, out)
    cmd = ["codex", "exec", "--sandbox", "workspace-write", "-i", str(REF)]
    try:
        r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, timeout=420)
        if out.exists():
            im = Image.open(out).convert("RGBA")
            if max(im.size) > 600:
                im.thumbnail((512, 512), Image.LANCZOS)
            im.save(out, "PNG", optimize=True)
            return (key, True, f"OK {out.stat().st_size//1024}KB {im.size}")
        return (key, False, "no output: " + (r.stderr or "")[-200:])
    except subprocess.TimeoutExpired:
        return (key, False, "timeout 420s")


def main():
    print(f"=== 生 {len(NEW)} 張新職業 sprite, 3 parallel ===", flush=True)
    ok, fail = [], []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(run_one, k): k for k in NEW}
        for f in as_completed(futs):
            k, s, msg = f.result()
            print(f"  [{'✓' if s else '✗'}] {k}  {msg}", flush=True)
            (ok if s else fail).append(k)
    print(f"\n=== Done OK {len(ok)} / Fail {len(fail)} ===", flush=True)
    if fail:
        print("Failed:", fail)


if __name__ == "__main__":
    main()
