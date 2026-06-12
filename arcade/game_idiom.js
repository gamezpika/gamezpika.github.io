/* 拼字小狀元（成語＆唐詩雙模式）— 字格全滿、點字拼詞型（參考派派 6/12 截圖方向）
 *
 * 每關一個填字交叉棋盤（離線生成 idiom_levels.json）：
 * 點棋盤上的字依序填入下方答案槽，拼出藏在棋盤裡的成語（4字）/詩句（5字）
 *  - 拼對 → 該詞棋盤格亮金鎖定、收進「已找到」列表（點擊看解釋/出處）
 *  - 拼錯 → 答案槽抖動清空
 *  - 提示：每關 3 次，亮一條還沒找到的詞 1.2 秒
 * 全部找齊 → 過關結算（下一關）。進度存 localStorage（兩模式各自）。
 * 純前端、無後端。
 */
(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);

    const MODES = {
        idiom: { label: "成語", slotN: 4, lvKey: "arcade_idiom_lv_idiom" },
        poem: { label: "唐詩", slotN: 5, lvKey: "arcade_idiom_lv_poem" },
    };
    let DATA = null;
    let mode = "idiom";
    let lvIdx = 0, level = null;
    let found = [], sel = [];        // found: 已找到詞索引；sel: [{r,c,ch,el}]
    let hintsLeft = 3, busy = false;

    async function loadData() {
        if (DATA) return;
        const r = await fetch("arcade/idiom_levels.json?v=2");
        DATA = await r.json();
    }
    function levels() { return DATA[mode] || []; }
    function readLv() {
        try { return Math.max(0, parseInt(localStorage.getItem(MODES[mode].lvKey) || "0", 10) || 0); } catch (e) { return 0; }
    }
    function saveLv(n) { try { localStorage.setItem(MODES[mode].lvKey, String(n)); } catch (e) {} }

    /* ── 渲染 ─────────────────────────────────── */
    function renderLevel() {
        level = levels()[lvIdx % levels().length];
        found = []; sel = []; hintsLeft = 3; busy = false;
        $("id-stage-title").textContent = MODES[mode].label + "拼字 · 第 " + (lvIdx + 1) + " 關";
        $("id-hint").textContent = "💡 提示 ×" + hintsLeft;
        const board = $("id-board");
        board.innerHTML = "";
        board.style.gridTemplateColumns = "repeat(" + level.cols + ", 1fr)";
        // 棋盤格子（空格不渲染磚）
        const map = {};   // "r,c" → {ch, el}
        level.words.forEach((w) => w.cells.forEach(([r, c], i) => { map[r + "," + c] = { ch: w.w[i] }; }));
        (level.deco || []).forEach(([r, c, ch]) => { const k = r + "," + c; if (!map[k]) map[k] = { ch }; });   // 干擾字（凌亂感，派派 6/12）
        const cellW = Math.min(46, Math.floor((Math.min(window.innerWidth, 520) - 36) / level.cols));
        board.style.setProperty("--cell", cellW + "px");
        for (let r = 0; r < level.rows; r++) {
            for (let c = 0; c < level.cols; c++) {
                const k = r + "," + c;
                const d = document.createElement("div");
                if (map[k]) {
                    d.className = "id-cell";
                    d.textContent = map[k].ch;
                    d.dataset.r = r; d.dataset.c = c;
                    d.addEventListener("click", () => tapCell(d));
                    map[k].el = d;
                } else {
                    d.className = "id-empty";
                }
                board.appendChild(d);
            }
        }
        level._map = map;
        renderSlots(); renderFound();
    }
    function renderSlots() {
        const n = MODES[mode].slotN;
        const box = $("id-slots");
        box.innerHTML = "";
        for (let i = 0; i < n; i++) {
            const s = document.createElement("div");
            s.className = "id-slot" + (sel[i] ? " filled" : "");
            s.textContent = sel[i] ? sel[i].ch : "";
            box.appendChild(s);
        }
    }
    function renderFound() {
        const box = $("id-found");
        box.innerHTML = found.length
            ? found.map((i) => `<button class="id-chip" data-i="${i}">${level.words[i].w}</button>`).join("")
            : '<span class="id-found-empty">找到的詞會出現在這裡，點一下看解釋</span>';
        box.querySelectorAll(".id-chip").forEach((b) => b.addEventListener("click", () => {
            const w = level.words[+b.dataset.i];
            showExp(w.w, w.exp);
        }));
        $("id-progress").textContent = found.length + " / " + level.words.length;
    }
    function showExp(word, exp) {
        $("id-exp-word").textContent = word;
        $("id-exp-text").textContent = exp;
        $("id-exp").style.display = "flex";
    }

    /* ── 互動 ─────────────────────────────────── */
    function tapCell(el) {
        if (busy) return;   // 金色(已找到)格仍可點：交叉字是共用的，別的詞還要用它
        const idx = sel.findIndex((s) => s.el === el);
        if (idx >= 0) {   // 點已選的字 → 取消（連同其後）
            sel.slice(idx).forEach((s) => s.el.classList.remove("sel"));
            sel = sel.slice(0, idx);
            renderSlots();
            return;
        }
        if (sel.length >= MODES[mode].slotN) return;
        el.classList.add("sel");
        sel.push({ ch: el.textContent, el });
        renderSlots();
        if (sel.length === MODES[mode].slotN) checkAnswer();
    }
    function checkAnswer() {
        const guess = sel.map((s) => s.ch).join("");
        const hitIdx = level.words.findIndex((w, i) => !found.includes(i) && w.w === guess);
        busy = true;
        if (hitIdx >= 0) {
            const w = level.words[hitIdx];
            found.push(hitIdx);
            sel.forEach((s) => s.el.classList.remove("sel"));
            sel = [];
            w.cells.forEach(([r, c]) => {
                const cell = level._map[r + "," + c];
                if (cell && cell.el) cell.el.classList.add("locked");
            });
            renderSlots(); renderFound();
            busy = false;
            if (found.length === level.words.length) return win();
            showExp(w.w, w.exp);   // 答對順便看解釋（教育點）
        } else {
            const box = $("id-slots");
            box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake");
            setTimeout(() => {
                sel.forEach((s) => s.el.classList.remove("sel"));
                sel = [];
                renderSlots();
                busy = false;
            }, 450);
        }
    }
    function useHint() {
        if (busy || hintsLeft <= 0) return;
        const rest = level.words.map((w, i) => i).filter((i) => !found.includes(i));
        if (!rest.length) return;
        hintsLeft -= 1;
        $("id-hint").textContent = "💡 提示 ×" + hintsLeft;
        const w = level.words[rest[0]];
        w.cells.forEach(([r, c]) => {
            const cell = level._map[r + "," + c];
            if (cell && cell.el) {
                cell.el.classList.add("hinted");
                setTimeout(() => cell.el.classList.remove("hinted"), 1300);
            }
        });
    }
    function clearSel() {
        sel.forEach((s) => s.el.classList.remove("sel"));
        sel = [];
        renderSlots();
    }
    function win() {
        const total = levels().length;
        saveLv(Math.max(readLv(), lvIdx + 1));
        window.arcadeUI.victory({
            win: true,
            title: "過關",
            sub: MODES[mode].label + "拼字 第 " + (lvIdx + 1) + " 關完成！",
            rewards: [
                { key: "lv", icon: "🏮", label: "已通過 " + Math.max(readLv(), lvIdx + 1) + " / " + total + " 關" },
                { key: "next", icon: "✨", label: "再接再厲" },
            ],
            onReplay: () => { window.arcadeUI.hideVictory(); lvIdx = (lvIdx + 1) % total; renderLevel(); },
            onExit: () => { if (window.eduApp) window.eduApp.showScreen("chinese-hub"); },
        });
        const rb = document.querySelector("#agv-replay");
        if (rb) rb.textContent = "▶ 下一關";
    }

    /* ── 模式選擇 ─────────────────────────────── */
    function showModePick() {
        $("id-modepick").style.display = "flex";
    }
    async function startMode(m) {
        mode = m;
        $("id-modepick").style.display = "none";
        await loadData();
        lvIdx = readLv() % (levels().length || 1);
        renderLevel();
    }

    function init() {
        $("idiom-game-back").addEventListener("click", () => {
            if (window.eduApp) window.eduApp.showScreen("chinese-hub");
        });
        $("id-btn-hint").addEventListener("click", useHint);
        $("id-btn-clear").addEventListener("click", clearSel);
        $("id-btn-mode").addEventListener("click", showModePick);
        $("id-pick-idiom").addEventListener("click", () => startMode("idiom"));
        $("id-pick-poem").addEventListener("click", () => startMode("poem"));
        $("id-exp-close").addEventListener("click", () => { $("id-exp").style.display = "none"; });
        $("id-exp").addEventListener("click", (e) => { if (e.target === $("id-exp")) $("id-exp").style.display = "none"; });
        $("idiom-entry-btn").addEventListener("click", showModePick);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
