/* 打地鼠 — 九九挑戰
 *
 * 60 秒：9 格洞，地鼠隨機冒出頭上是答案數字
 * 點對答案的地鼠 +分 + combo / 點錯 -5 + combo 歸零
 * 答對立刻換下一題（清光現有地鼠）
 * 漏掉地鼠不扣分（2.5 秒自己鑽回）
 */
(function () {
    const $ = (id) => document.getElementById(id);

    const HOLE_COUNT = 9;
    const DURATION = 60;
    const SPAWN_INTERVAL_MS = 1000;    // 每 1.0 秒嘗試 spawn
    const MOLE_LIFETIME_MS = 3500;     // 地鼠停留 3.5 秒（之前 2.5 秒太快）
    const POP_UP_TRANSITION_MS = 320;
    const HIT_FEEDBACK_MS = 600;       // 打中後看見暈訊的時間（700→600：剛好蓋住 hammer 600ms 動畫，比原來俐落）

    let timer = null;
    let spawnTimer = null;
    let timeLeft = 60;
    let score = 0;
    let hits = 0;
    let misses = 0;
    let combo = 0;
    let maxCombo = 0;
    let currentQuestion = null;
    let startupToken = 0;     // 每次 startGame 遞增；中途 stopGame 會 invalidate 進行中的 startup
    const activeMoles = {}; // slot -> { element, isCorrect, removeTimer }

    // ── 出題 (1-9 × 1-9) ────────────────────────
    function genQuestion() {
        const a = 1 + Math.floor(Math.random() * 9);
        const b = 1 + Math.floor(Math.random() * 9);
        const correct = a * b;
        const choices = new Set([correct]);
        // 干擾項：與正解相差 1-9
        let guard = 0;
        while (choices.size < 4 && guard++ < 50) {
            const off = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 9));
            const v = correct + off;
            if (v > 0 && v !== correct) choices.add(v);
        }
        // 萬一干擾沒湊到 4 個，補 random
        while (choices.size < 4) {
            const v = 1 + Math.floor(Math.random() * 81);
            if (v !== correct) choices.add(v);
        }
        return {
            prompt: `${a} × ${b} = ?`,
            correct: String(correct),
            choices: Array.from(choices).map(String).sort(() => Math.random() - 0.5),
        };
    }

    // ── grid + 地鼠 ──────────────────────────────
    function buildGrid() {
        const grid = $("whack-grid");
        grid.innerHTML = "";
        for (let i = 0; i < HOLE_COUNT; i++) {
            const hole = document.createElement("div");
            hole.className = "whack-hole";
            hole.dataset.slot = String(i);
            grid.appendChild(hole);
        }
    }

    function spawnMole() {
        if (!currentQuestion) return;
        const empty = [];
        for (let i = 0; i < HOLE_COUNT; i++) {
            if (!activeMoles[i]) empty.push(i);
        }
        if (empty.length === 0) return;
        const slot = empty[Math.floor(Math.random() * empty.length)];
        const ans = currentQuestion.choices[Math.floor(Math.random() * currentQuestion.choices.length)];
        const isCorrect = ans === currentQuestion.correct;

        const grid = $("whack-grid");
        const hole = grid.querySelector(`[data-slot="${slot}"]`);
        if (!hole) return;

        const mole = document.createElement("div");
        mole.className = "whack-mole";
        mole.innerHTML = `
            <div class="whack-mole-answer">${ans}</div>
            <img class="whack-mole-img" src="arcade/img/whack/mole_idle.png?v=4" alt="">
        `;
        hole.appendChild(mole);

        // 觸發冒出 transition
        requestAnimationFrame(() => mole.classList.add("up"));

        const data = { element: mole, isCorrect, removeTimer: null };
        activeMoles[slot] = data;

        mole.addEventListener("click", (e) => {
            e.stopPropagation();
            handleHit(slot);
        });

        data.removeTimer = setTimeout(() => removeMole(slot), MOLE_LIFETIME_MS);
    }

    function removeMole(slot, immediate = false) {
        const m = activeMoles[slot];
        if (!m) return;
        clearTimeout(m.removeTimer);
        delete activeMoles[slot];
        if (immediate) {
            m.element.remove();
        } else {
            // 不再用 translateY 鑽回（會位移）— 改原地淡出
            m.element.classList.add("fading");
            setTimeout(() => m.element.remove(), 400);
        }
    }

    function clearAllMoles(immediate = false) {
        Object.keys(activeMoles).forEach((s) => removeMole(parseInt(s, 10), immediate));
    }

    // ── 玩家動作 ─────────────────────────────────
    function handleHit(slot) {
        const m = activeMoles[slot];
        if (!m) return;
        const grid = $("whack-grid");
        const hole = grid.querySelector(`[data-slot="${slot}"]`);

        if (m.isCorrect) {
            const baseScore = 10;
            const comboBonus = Math.min(combo, 5);
            const gain = baseScore + comboBonus;
            score += gain;
            hits += 1;
            combo += 1;
            if (combo > maxCombo) maxCombo = combo;
            // 槌子飛入敲擊動畫
            spawnHammer(hole);
            // 地鼠變成被打的圖
            const img = m.element.querySelector(".whack-mole-img");
            if (img) img.src = "arcade/img/whack/mole_hit.png?v=4";
            const ansBadge = m.element.querySelector(".whack-mole-answer");
            if (ansBadge) ansBadge.style.background = "#fff59d";
            showFloating(hole, `+${gain}`, "plus");
            // 打中的地鼠原地淡出（不震動、不旋轉、不位移）
            const hitElement = m.element;
            clearTimeout(m.removeTimer);
            delete activeMoles[slot];
            hitElement.classList.add("hit-stunned");
            // 該題目通關 — 等玩家看到槌子+暈訊再換下一題（清光其他地鼠）
            setTimeout(() => {
                if (hitElement.parentNode) hitElement.remove();
                clearAllMoles();
                nextQuestion();
            }, HIT_FEEDBACK_MS);
        } else {
            // 錯的地鼠也有槌子敲擊（但分數扣）
            spawnHammer(hole);
            score = Math.max(0, score - 5);
            misses += 1;
            combo = 0;
            showFloating(hole, "-5", "minus");
            removeMole(slot);
        }
        updateStats();
    }

    function showFloating(parent, text, kind) {
        const el = document.createElement("div");
        el.className = `whack-floating-score ${kind}`;
        el.textContent = text;
        parent.appendChild(el);
        setTimeout(() => el.remove(), 800);
    }

    function spawnHammer(parent) {
        const h = document.createElement("img");
        h.className = "whack-hammer";
        h.src = "arcade/img/whack/hammer.png?v=3";
        h.alt = "";
        parent.appendChild(h);
        setTimeout(() => h.remove(), 600);
    }

    function nextQuestion() {
        currentQuestion = genQuestion();
        $("whack-question").textContent = currentQuestion.prompt;
    }

    function updateStats() {
        $("whack-score").innerHTML = `<img class="emo" src="arcade/img/icons/hundred.png?s=6" alt=""> ${score}`;
        $("whack-combo").innerHTML = `<img class="emo" src="arcade/img/icons/fire.png?s=6" alt=""> ${combo}`;
        $("whack-time").innerHTML = `<img class="emo" src="arcade/img/icons/ui_timer.png?v=1" alt=""> ${timeLeft}`;
    }

    // ── 流程 ─────────────────────────────────────
    function tick() {
        timeLeft -= 1;
        updateStats();
        if (timeLeft <= 0) {
            endGame();
        }
    }

    function preloadImages(urls) {
        // 救命 fallback：WebView 偶爾 onload/onerror 都不觸發 → 3 秒後一律放行，
        // 不讓「準備中…」整局卡死（圖未到也只是首格地鼠晚一兩幀補上）。
        // onload/onerror 觸發後要 clearTimeout，免 closure 多留 3 秒。
        return Promise.all(urls.map((u) => new Promise((resolve) => {
            const im = new Image();
            let done = false;
            let timer = null;
            const finish = () => {
                if (done) return;
                done = true;
                if (timer) clearTimeout(timer);
                resolve(true);
            };
            im.onload = finish;
            im.onerror = finish;
            timer = setTimeout(finish, 3000);
            im.src = u;
        })));
    }

    function showCountdown(text, isGo, ms = 700) {
        return new Promise((resolve) => {
            const overlay = $("whack-countdown");
            overlay.innerHTML = `<div class="whack-countdown-num${isGo ? " go" : ""}">${text}</div>`;
            overlay.style.display = "flex";
            setTimeout(() => resolve(), ms);
        });
    }

    async function startGame() {
        score = 0; hits = 0; misses = 0; combo = 0; maxCombo = 0;
        timeLeft = DURATION;
        Object.keys(activeMoles).forEach((k) => delete activeMoles[k]);
        buildGrid();
        nextQuestion();
        updateStats();
        clearInterval(timer); clearInterval(spawnTimer);

        // token：startGame 是 async，期間使用者按 ← 會呼 stopGame 把 token bump
        // 之後每個 await 點檢查 token 是否仍是當前 startup，否則放棄
        const myToken = ++startupToken;
        const stillCurrent = () => myToken === startupToken;

        // 進畫面 + 顯示載入提示
        if (window.eduApp?.showScreen) window.eduApp.showScreen("whack-game");
        const overlay = $("whack-countdown");
        const myTokenStr = String(myToken);
        // 標記 overlay ownership：若被後續 startGame 接管，dataset.token 會被改寫，
        // 我就不能把 overlay 收掉（否則會把後手的「3-2-1-GO」UI 蓋掉）
        overlay.dataset.token = myTokenStr;
        overlay.innerHTML = '<div class="whack-loading"><img class="emo" src="arcade/img/icons/box.png?s=6" alt=""> 準備中…</div>';
        overlay.style.display = "flex";
        // 只有「現在的 overlay 還是我」才允許收 overlay
        const safeHide = () => {
            if (overlay.dataset.token === myTokenStr) overlay.style.display = "none";
        };

        // 預載 sprite
        await preloadImages([
            "arcade/img/whack/stage_bg.png?v=8",
            "arcade/img/whack/mole_idle.png?v=4",
            "arcade/img/whack/mole_hit.png?v=4",
        ]);
        // 任何 await 後若 startup 已被 stop / 後續 startGame 取代，
        // 必須把 overlay 收掉再 return，否則畫面永遠卡在「準備中…」
        if (!stillCurrent()) { safeHide(); return; }

        // 倒數 3-2-1-GO（「GO!」短字串避免在窄螢幕折行）
        await showCountdown("3", false); if (!stillCurrent()) { safeHide(); return; }
        await showCountdown("2", false); if (!stillCurrent()) { safeHide(); return; }
        await showCountdown("1", false); if (!stillCurrent()) { safeHide(); return; }
        await showCountdown("GO!", true); if (!stillCurrent()) { safeHide(); return; }
        safeHide();

        // 開始
        timer = setInterval(tick, 1000);
        spawnTimer = setInterval(spawnMole, SPAWN_INTERVAL_MS);
    }

    function stopGame() {
        // bump token：進行中的 startGame() await chain 在每個 await 後會發現 token 變了並 return
        startupToken++;
        clearInterval(timer); timer = null;
        clearInterval(spawnTimer); spawnTimer = null;
        clearAllMoles(true);
        const overlay = $("whack-countdown");
        if (overlay) overlay.style.display = "none";
    }

    function ratingForScore(s, h) {
        // 結算評等：依分數 + 命中數
        if (s >= 200 && h >= 12) return { stars: 3, title: "完美！" };
        if (s >= 100 && h >= 6) return { stars: 2, title: "不錯！" };
        if (s >= 30 || h >= 2) return { stars: 1, title: "再接再厲" };
        return { stars: 0, title: "繼續練習！" };
    }

    async function endGame() {
        stopGame();

        // 視覺先 render（共用勝利頁；金幣等後端回覆再補進格子）
        const rating = ratingForScore(score, hits);
        const vid = window.arcadeUI.victory({
            win: rating.stars >= 1,
            sub: `${rating.title}　打中 ${hits} 隻 · 漏打 ${misses} 隻 · 最高 ${maxCombo} 連擊`,
            rewards: [
                { key: "coins", icon: "arcade/img/icons/coin.png?s=6", label: "計算中…" },
                { key: "score", icon: "arcade/img/icons/hundred.png?s=6", label: `${score} 分` },
                { key: "stars", icon: "arcade/img/icons/star_filled.png?s=6", label: `${rating.stars} 星` },
            ],
            onReplay: startGame,
            onExit: () => { if (window.eduApp?.showScreen) window.eduApp.showScreen("math-hub"); },
        });

        try {
            const r = await window.eduApi("/api/whack/end", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    score, hits, misses,
                    max_combo: maxCombo, duration: DURATION,
                }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.detail || JSON.stringify(d));
            window.arcadeUI.updateReward(vid, "coins", `+${d.coins_awarded}`);
            if (window.eduApp?.syncUserStats) {
                window.eduApp.syncUserStats({ coins: d.user_coins });
            }
        } catch (e) {
            console.error("[whack] end_game error:", e);
            window.arcadeUI.updateReward(vid, "coins", "同步失敗");
        }
    }

    // ── Wire up ──────────────────────────────────
    function init() {
        $("whack-entry-btn")?.addEventListener("click", startGame);

        $("whack-game-back")?.addEventListener("click", () => {
            stopGame();
            if (window.eduApp?.showScreen) window.eduApp.showScreen("math-hub");
        });
        // 結算頁按鈕（再玩一次/回遊樂場）由 arcadeUI.victory 自帶
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
