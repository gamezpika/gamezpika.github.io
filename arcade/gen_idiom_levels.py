#!/usr/bin/env python3
"""成語/唐詩 拼字關卡生成器（填字交叉排佈）
讀 idiom_pool.json + poems.json → 生 idiom_levels.json
規則：詞橫放或直放；交叉格字相同；非交叉不得重疊；不得側貼（除交叉點外相鄰格必空）。
每關 4~5 詞、棋盤裁切後 ≤ 9x9。生成用固定亂數種子（可重現）。
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).parent
GRID = 17          # 工作棋盤（夠大，最後裁切）
MAX_SIDE = 9       # 裁切後最大邊長
WORDS_PER_LEVEL = (4, 5)
LEVELS_PER_MODE = 24


def can_place(board, word, r, c, dr, dc):
    """檢查 word 從 (r,c) 沿 (dr,dc) 放置是否合法；回傳交叉數，不合法回 -1。"""
    n = len(word)
    er, ec = r + dr * (n - 1), c + dc * (n - 1)
    if not (0 <= r < GRID and 0 <= c < GRID and 0 <= er < GRID and 0 <= ec < GRID):
        return -1
    # 頭尾外一格必須空（不能跟別的詞頭尾相連）
    br, bc = r - dr, c - dc
    ar, ac = er + dr, ec + dc
    for (y, x) in [(br, bc), (ar, ac)]:
        if 0 <= y < GRID and 0 <= x < GRID and board[y][x]:
            return -1
    cross = 0
    for i, ch in enumerate(word):
        y, x = r + dr * i, c + dc * i
        cell = board[y][x]
        if cell:
            if cell != ch:
                return -1
            cross += 1
        else:
            # 非交叉格：垂直於走向的兩側必須空（防止側貼黏字）
            for (py, px) in [(y + dc, x + dr), (y - dc, x - dr)]:
                if 0 <= py < GRID and 0 <= px < GRID and board[py][px]:
                    return -1
    return cross


def place(board, word, r, c, dr, dc):
    cells = []
    for i, ch in enumerate(word):
        y, x = r + dr * i, c + dc * i
        board[y][x] = ch
        cells.append((y, x))
    return cells


def gen_level(pool, rng, used_counter):
    """從 pool 生一關。回傳 None 表示這次嘗試失敗。"""
    n_words = rng.randint(*WORDS_PER_LEVEL)
    board = [["" for _ in range(GRID)] for _ in range(GRID)]
    placed = []
    # 偏好使用次數少的詞當種子（讓 48 條輪著上場）
    candidates = sorted(pool, key=lambda it: (used_counter[it["w"]], rng.random()))
    seed = candidates[0]
    mid = GRID // 2
    cells = place(board, seed["w"], mid, mid - len(seed["w"]) // 2, 0, 1)
    placed.append({"item": seed, "cells": cells, "dir": "h"})
    tried = set([seed["w"]])
    attempts = 0
    while len(placed) < n_words and attempts < 400:
        attempts += 1
        cand = candidates[rng.randrange(min(len(candidates), 30))]
        if cand["w"] in tried and len(tried) < len(pool):
            continue
        # 找跟已放詞的共字交叉點
        spots = []
        for p in placed:
            for idx, (y, x) in enumerate(p["cells"]):
                ch = p["item"]["w"][idx]
                for j, c2 in enumerate(cand["w"]):
                    if c2 != ch:
                        continue
                    if p["dir"] == "h":   # 已放橫 → 新詞直放
                        spots.append((y - j, x, 1, 0))
                    else:                  # 已放直 → 新詞橫放
                        spots.append((y, x - j, 0, 1))
        rng.shuffle(spots)
        ok = False
        for (r, c, dr, dc) in spots:
            if can_place(board, cand["w"], r, c, dr, dc) >= 1:
                cells = place(board, cand["w"], r, c, dr, dc)
                placed.append({"item": cand, "cells": cells, "dir": "v" if dr else "h"})
                tried.add(cand["w"])
                ok = True
                break
        if not ok:
            tried.add(cand["w"])
    if len(placed) < WORDS_PER_LEVEL[0]:
        return None
    # 裁切
    ys = [y for p in placed for (y, x) in p["cells"]]
    xs = [x for p in placed for (y, x) in p["cells"]]
    y0, y1, x0, x1 = min(ys), max(ys), min(xs), max(xs)
    if (y1 - y0 + 1) > MAX_SIDE or (x1 - x0 + 1) > MAX_SIDE:
        return None
    grid_cells = []
    for p in placed:
        used_counter[p["item"]["w"]] += 1
        grid_cells.append({
            "w": p["item"]["w"],
            "exp": p["item"]["exp"],
            "cells": [[y - y0, x - x0] for (y, x) in p["cells"]],
        })
    return {"rows": y1 - y0 + 1, "cols": x1 - x0 + 1, "words": grid_cells}


def gen_mode(pool, rng):
    used = {it["w"]: 0 for it in pool}
    levels = []
    guard = 0
    while len(levels) < LEVELS_PER_MODE and guard < 4000:
        guard += 1
        lv = gen_level(pool, rng, used)
        if lv:
            levels.append(lv)
    return levels


def main():
    rng = random.Random(20260612)
    idioms = json.loads((HERE / "idiom_pool.json").read_text(encoding="utf-8"))["idioms"]
    poems = json.loads((HERE / "poems.json").read_text(encoding="utf-8"))["poems"]
    poem_pool = []
    for p in poems:
        for ln in p["l"]:
            poem_pool.append({"w": ln, "exp": f"出自〈{p['t']}〉·{p['a']}"})
    out = {
        "idiom": gen_mode(idioms, rng),
        "poem": gen_mode(poem_pool, rng),
    }
    for mode, lvls in out.items():
        sizes = [f"{l['rows']}x{l['cols']}" for l in lvls]
        words = [len(l["words"]) for l in lvls]
        print(f"{mode}: {len(lvls)} 關, 詞數 {min(words)}~{max(words)}, 棋盤 {sizes[:6]}...")
    (HERE / "idiom_levels.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("saved idiom_levels.json", (HERE / "idiom_levels.json").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
