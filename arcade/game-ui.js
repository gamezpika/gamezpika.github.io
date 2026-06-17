/* 遊樂場三遊戲共用 UI（打地鼠/聽力小火車/名人九宮格）
 * window.arcadeUI:
 *   intro({ icon, title, sub, steps:[{ico,text}], onStart })
 *     封面（標題＋開始遊戲＋怎麼玩）；進頁教學卡自動打開、可「略過」，
 *     按「開始遊戲」才呼叫 onStart 開局。
 *   victory({ win, title, sub, rewards:[{key,icon,label}], onReplay, onExit,
 *            replayLabel, replayIcon, exitLabel, exitIcon }) → vid
 *     統一勝利結算：金光放射＋拱形標題＋徽章＋獲得獎勵列。
 *     win=false 走銀灰「再接再厲」版。onExit 不給＝隱藏「回遊樂場」鈕。
 *     replayLabel/exitLabel/Icon 選填：自訂按鈕文字+圖示(預設 再玩一次/回遊樂場)，PVP 用「再戰一次/回競技場」。
 *     回傳本次結算的流水號 vid，給 updateReward 防舊請求寫錯局。
 *   updateReward(vid, key, label)  結算後非同步更新某格獎勵字（金幣入帳）；
 *     vid 對不上現在這張結算頁（玩家已再玩一局）就忽略。
 *   hideVictory()
 * 不依賴 shim.js；icon 含 "/" 或圖檔副檔名＝圖片路徑，否則當 emoji 文字。 */
(function () {
    "use strict";

    const BADGE_SRC = "arcade/img/victory_badge.png?v=1";

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }
    function iconHTML(ic, cls) {
        if (ic == null || ic === "") return "";
        const s = String(ic);
        if (/[\/]|\.(png|webp|jpg|jpeg|gif)(\?|$)/i.test(s)) {
            return `<img class="${cls || ""}" src="${esc(s)}" alt="">`;
        }
        return esc(s);
    }
    function ensureRoot(id, cls) {
        let root = document.getElementById(id);
        if (!root) {
            root = document.createElement("div");
            root.id = id;
            root.className = cls;
            document.body.appendChild(root);
        }
        return root;
    }

    /* ── 封面 + 教學 ── */
    function intro(opts) {
        const o = opts || {};
        const root = ensureRoot("ag-intro", "agi");
        const steps = (o.steps || []).map((s, i) =>
            `<li class="agi-step">
                <span class="agi-step-n">${i + 1}</span>
                ${s.ico ? `<span class="agi-step-ico">${iconHTML(s.ico)}</span>` : ""}
                <span class="agi-step-tx">${esc(s.text)}</span>
            </li>`).join("");
        root.innerHTML = `
            <div class="agi-card">
                <div class="agi-icon">${iconHTML(o.icon, "agi-icon-img")}</div>
                <div class="agi-title">${esc(o.title || "")}</div>
                <div class="agi-sub">${esc(o.sub || "")}</div>
                <button class="agi-btn" id="agi-start"><img class="bico" src="arcade/img/icons/ui_play.png?v=1" alt=""> 開始遊戲</button>
                <button class="agi-btn2" id="agi-how"><img class="bico" src="arcade/img/icons/ui_book.png?v=1" alt=""> 怎麼玩</button>
            </div>
            <div class="agi-tutwrap open" id="agi-tutwrap">
                <div class="agi-tutcard">
                    <button class="agi-skip" id="agi-skip">略過</button>
                    <div class="agi-tuthead"><img class="bico" src="arcade/img/icons/ui_book.png?v=1" alt=""> 怎麼玩</div>
                    <ol class="agi-steps">${steps}</ol>
                    <button class="agi-btn" id="agi-start2"><img class="bico" src="arcade/img/icons/ui_play.png?v=1" alt=""> 開始遊戲</button>
                </div>
            </div>`;
        root.classList.add("open");
        const tut = root.querySelector("#agi-tutwrap");
        root.querySelector("#agi-skip").addEventListener("click", () => tut.classList.remove("open"));
        root.querySelector("#agi-how").addEventListener("click", () => tut.classList.add("open"));
        const start = () => {
            root.classList.remove("open");
            tut.classList.remove("open");
            if (o.onStart) o.onStart();
        };
        root.querySelector("#agi-start").addEventListener("click", start);
        root.querySelector("#agi-start2").addEventListener("click", start);
    }

    /* ── 勝利結算 ── */
    let victorySeq = 0;   // 每開一張結算頁 +1；非同步 updateReward 用它防寫到下一局

    function victory(opts) {
        const o = opts || {};
        const win = o.win !== false;
        const root = ensureRoot("ag-victory", "agv");
        root.className = "agv" + (win ? "" : " fail");
        const vid = ++victorySeq;
        root.dataset.vid = String(vid);

        const title = o.title || (win ? "VICTORY" : "再接再厲");
        const chars = Array.from(title);
        const n = chars.length;
        // 拱形：逐字「往下平移(拋物線)＋微旋轉」。translate 不佔排版寬，
        // 不會像繞遠圓心旋轉那樣把頭尾字推出螢幕外。
        const mid = (n - 1) / 2;
        const step = n > 1 ? Math.min(8, 50 / (n - 1)) : 0;
        const titleHTML = chars.map((c, i) => {
            const rot = ((i - mid) * step).toFixed(2);
            const ty = (Math.pow(i - mid, 2) * 0.055).toFixed(3);
            return `<span style="transform:translateY(${ty}em) rotate(${rot}deg)">${esc(c === " " ? " " : c)}</span>`;
        }).join("");

        const tiles = (o.rewards || []).map((rw, i) =>
            `<div class="agv-tile" style="animation-delay:${(0.25 + i * 0.12).toFixed(2)}s" data-rw="${esc(rw.key || String(i))}">
                <div class="agv-tile-box">${iconHTML(rw.icon, "agv-tile-img")}</div>
                <div class="agv-tile-label">${esc(rw.label || "")}</div>
            </div>`).join("");

        root.innerHTML = `
            <div class="agv-stage">
                <div class="agv-rays"></div>
                <div class="agv-glow"></div>
                <div class="agv-title">${titleHTML}</div>
                <div class="agv-badge"><img src="${BADGE_SRC}" alt=""></div>
                ${o.sub ? `<div class="agv-sub">${esc(o.sub)}</div>` : ""}
            </div>
            <div class="agv-divider">
                <span class="agv-dot d3"></span><span class="agv-dot d2"></span><span class="agv-dot d1"></span>
                <span class="agv-divider-tx">獲得獎勵</span>
                <span class="agv-dot d1"></span><span class="agv-dot d2"></span><span class="agv-dot d3"></span>
            </div>
            <div class="agv-rewards">${tiles}</div>
            <div class="agv-actions">
                <button class="agv-btn agv-btn-replay" id="agv-replay">${iconHTML(o.replayIcon || "arcade/img/icons/refresh.png?s=6", "bico")} ${esc(o.replayLabel || "再玩一次")}</button>
                <button class="agv-btn agv-btn-exit" id="agv-exit">${iconHTML(o.exitIcon || "arcade/img/icons/ui_ferris.png?v=1", "bico")} ${esc(o.exitLabel || "回遊樂場")}</button>
            </div>`;
        root.classList.add("open");

        const rep = root.querySelector("#agv-replay");
        if (o.onReplay) {
            rep.addEventListener("click", () => { hideVictory(); o.onReplay(); });
        } else {
            rep.style.display = "none";
        }
        const ex = root.querySelector("#agv-exit");
        if (o.onExit) {
            // Codex P1：先關結算頁再離開——整頁跳轉看不出差別，
            // 但只切 screen 不換頁的殼（LIFF）不關會被 overlay 卡死。
            ex.addEventListener("click", () => { hideVictory(); o.onExit(); });
        } else {
            ex.style.display = "none";
        }
        return vid;
    }

    function hideVictory() {
        const root = document.getElementById("ag-victory");
        if (root) root.classList.remove("open");
    }

    function updateReward(vid, key, label) {
        const root = document.getElementById("ag-victory");
        if (!root) return;
        // Codex P2：舊局的非同步回覆（金幣入帳）不能寫進新一局的結算頁
        if (root.dataset.vid !== String(vid)) return;
        const t = root.querySelector(`.agv-tile[data-rw="${CSS.escape(String(key))}"] .agv-tile-label`);
        if (t) t.textContent = label;
    }

    window.arcadeUI = { intro, victory, hideVictory, updateReward };
})();
