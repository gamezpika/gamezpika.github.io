"""Phase A 素材：① 校園生活區地板底圖（純地面，無物件）② 宿舍 base（靜態，之後 i2i 分幀做動畫）。
都 Codex image_generation 生，輸出 village-web/.imagegen/。
"""
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "village-web/.imagegen"

TASKS = {
    "campus_ground_raw": (
        "請用 image_generation 工具生一張 1536x1024 PNG，存到 " + str(OUT / "campus_ground_raw.png") + "。\n"
        "內容：一張『校園生活區』地板底圖，top-down 2.5D iso 手繪 chibi 村莊風，**只有地面、沒有任何建築或物件**。\n"
        "- 溫暖的綠色草地鋪滿，米色石板路。\n"
        "- 一條石板主路從左邊緣進入（連接村莊），通到地圖中央後分岔。\n"
        "- 右上區留一塊平整乾淨草地空地（之後放宿舍，現在就是草地）。\n"
        "- 下方中央圍出一塊長方形褐色翻土農田區（畫成一畦一畦的泥土田壟紋理，但**不放柵欄、不放作物**）。\n"
        "- 左下角一個小池塘（藍色水面）。\n"
        "嚴格要求：畫面**只有 草地 / 石板路 / 泥土田壟 / 池塘水面**。"
        "NO 房屋 NO 樹 NO 柵欄 NO 風車 NO 人物 NO 動物 NO 招牌 NO 文字。暖色調，跟村莊草地同畫風。"
    ),
    "dorm_base": (
        "請用 image_generation 工具生一張 1024x1024 PNG（透明背景），存到 " + str(OUT / "dorm_base.png") + "。\n"
        "內容：一棟 chibi 村莊風『學生宿舍小木屋』，iso 2.5D 斜俯視角度（跟大富翁/村莊房子同視角），溫馨個人小屋風。\n"
        "- 暖木色 + 鵝黃色牆面，斜的紅褐色屋頂。\n"
        "- 一根磚砌煙囪在屋頂（之後要從這裡冒煙，所以煙囪口要清楚朝上）。\n"
        "- 正面一扇**關著的**木門。\n"
        "- 門兩側各一扇**關著的**木百葉窗。\n"
        "- 屋前掛一塊木招牌，寫中文『學生宿舍』四個字。\n"
        "- 屋子右側地上放一個小小的寵物狗屋。\n"
        "- 門口一塊踏墊、一個小盆栽。\n"
        "嚴格要求：**完全透明背景（四角 alpha=0）、無地面、無陰影、無平台、無外框**。"
        "單棟建築置中、底部對齊畫布底。粗黑描邊、飽和暖色、村莊手繪 chibi 畫風。"
    ),
}


def run_one(key):
    prompt = TASKS[key]
    out = OUT / f"{key}.png"
    cmd = ["codex", "exec", "--sandbox", "workspace-write"]
    try:
        r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, timeout=420)
        if out.exists():
            return (key, True, f"OK {out.stat().st_size//1024}KB")
        return (key, False, "no output: " + (r.stderr or "")[-200:])
    except subprocess.TimeoutExpired:
        return (key, False, "timeout 420s")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"=== 生 {len(TASKS)} 張 Phase A 素材 ===", flush=True)
    with ThreadPoolExecutor(max_workers=2) as ex:
        futs = {ex.submit(run_one, k): k for k in TASKS}
        for f in as_completed(futs):
            k, s, msg = f.result()
            print(f"  [{'✓' if s else '✗'}] {k}  {msg}", flush=True)


if __name__ == "__main__":
    main()
