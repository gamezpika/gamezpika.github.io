/* 詩詞接龍：唐詩三百首 — 二道拖曳跑酷（參考派派 game.mov 包裝）
 *
 * 騎雲小仙女背對鏡頭自動往前跑。每題：上半句固定在頂部橫幅，
 * 兩座牌樓門（匾額帶候選下一句）從遠處慢慢逼近，玩家任意拖曳左右移動，
 * 跑進正確的那座門＝答對。
 *  - 答對 → 大綠勾 + 詩名出處浮出，+1 分，下一題逼近稍微變快
 *  - 答錯 → 紅閃 + 正解門亮綠，−1 顆心
 * 3 顆心用完結算「答對 N 題」，最高紀錄存 localStorage。純前端、無後端。
 * 素材沿用被砍跑酷的中國風三件套（竹林道/騎雲仙女/牌樓門，git b0805f5^ 撈回）。
 */
(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);

    const HEARTS_MAX = 3;
    const APPROACH_BASE = 3800;     // 第一題門逼近時長(ms)，讀題時間
    const APPROACH_STEP = 70;       // 每答對一題加快
    const APPROACH_MIN = 2300;      // 最快不低於這個（要留得住讀題時間）
    const FEEDBACK_MS = 1050;       // 判定後演出時長
    const LANE_K = 230, LANE_D = 24, LEAN_MAX = 14;
    const BEST_KEY = "arcade_poem_best";

    let poems = [], questions = [], qIdx = 0;
    let allLines = [];              // 干擾選項池（全部下半句）
    let score = 0, hearts = HEARTS_MAX, best = 0;
    let phase = "idle";             // idle | approach | feedback | over
    let row = null;                 // { gates:[{el,label}], correctLane, t0, dur }
    let rafId = null, lastTs = 0, nextTimer = null;
    let startupToken = 0, running = false;

    let runner = { x: 0, vx: 0, targetX: 0 };
    let geom = { W: 0, H: 0, laneX: [0, 0], minX: 0, maxX: 0, gateW: 150 };
    let dragging = false;

    // ── 題庫 ─────────────────────────────────────
    async function loadPoems() {
        if (poems.length) return;
        const r = await fetch("arcade/poems.json?v=1");
        const d = await r.json();
        poems = d.poems || [];
        allLines = [];   // {ln, pi}：帶詩的索引，干擾句才能排除「同一首」（Codex P3）
        poems.forEach((p, pi) => p.l.forEach((ln, i) => { if (i % 2 === 1) allLines.push({ ln, pi }); }));
    }
    function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    function buildQuestions() {
        const qs = [];
        poems.forEach((p, pi) => {
            for (let i = 0; i + 1 < p.l.length; i += 2) {
                qs.push({ prompt: p.l[i], correct: p.l[i + 1], from: p.t + "·" + p.a, pi });
            }
        });
        return shuffle(qs);
    }
    // 干擾下半句：真的不同首（同首別句小朋友會混淆）、開頭字不同、不等於題目兩句
    function pickWrong(q) {
        const pool = allLines.filter((o) =>
            o.pi !== q.pi && o.ln !== q.correct && o.ln !== q.prompt && o.ln[0] !== q.correct[0]);
        return pool.length ? pool[Math.floor(Math.random() * pool.length)].ln : "春眠不覺曉";
    }

    // ── 幾何 ─────────────────────────────────────
    function measure() {
        const st = $("poem-stage");
        const W = st.clientWidth, H = st.clientHeight;
        geom.W = W; geom.H = H;
        geom.laneX = [W * 0.27, W * 0.73];
        geom.minX = W * 0.13; geom.maxX = W * 0.87;
        geom.gateW = Math.min(W * 0.42, 200);
        runner.x = Math.max(geom.minX, Math.min(geom.maxX, runner.x || W * 0.5));
        runner.targetX = runner.x;
    }

    // ── 出題：兩座牌樓門由遠到近 ──────────────────
    function loadQuestion() {
        if (qIdx >= questions.length) { questions = buildQuestions(); qIdx = 0; }
        const q = questions[qIdx++];
        const wrong = pickWrong(q);
        const correctLane = Math.random() < 0.5 ? 0 : 1;
        const labels = correctLane === 0 ? [q.correct, wrong] : [wrong, q.correct];
        $("poem-question").textContent = "「" + q.prompt + "」";

        const st = $("poem-stage");
        const gates = [];
        labels.forEach((ans, lane) => {
            const el = document.createElement("div");
            el.className = "poem-gate";
            el.style.width = geom.gateW + "px";
            el.innerHTML =
                '<img class="poem-gate-img" src="arcade/img/poem/gate.webp?v=1" alt="" draggable="false">' +
                '<span class="poem-gate-label">' + ans + "</span>";
            st.appendChild(el);
            gates.push({ el, lane, ans });
        });
        const dur = Math.max(APPROACH_MIN, APPROACH_BASE - score * APPROACH_STEP);
        row = { gates, correctLane, q, t0: performance.now(), dur };
        placeGates(0);
        phase = "approach";
    }
    // t: 0(遠)→1(到跑者面前)；二次方緩入＝透視逼近感
    function placeGates(t) {
        if (!row) return;
        const e = t * t;
        const { W, H, laneX } = geom;
        const y = H * 0.30 + (H * 0.80 - H * 0.30) * e;
        const sc = 0.16 + 0.84 * e;
        // 遠處兩門靠攏在路中央、近處拉開到兩道
        row.gates.forEach((g) => {
            const farX = W * (g.lane === 0 ? 0.42 : 0.58);
            const x = farX + (laneX[g.lane] - farX) * e;
            g.el.style.transform =
                "translate(" + x + "px," + y + "px) translate(-50%,-92%) scale(" + sc + ")";
            g.el.style.zIndex = 5 + Math.round(e * 10);
        });
    }
    function clearRow() {
        if (row) { row.gates.forEach((g) => g.el.remove()); row = null; }
    }

    // ── 判定 ─────────────────────────────────────
    function resolveRow() {
        if (!row) return;
        const lane = runner.x < geom.W / 2 ? 0 : 1;
        const hit = lane === row.correctLane;
        row.gates.forEach((g) => {
            if (g.lane === row.correctLane) g.el.classList.add("is-correct");
            if (g.lane === lane) g.el.classList.add(hit ? "chosen-ok" : "chosen-bad");
        });
        phase = "feedback";
        if (hit) {
            score += 1;
            bigMark("✓", "ok");
            floatText(row.q.from, "from");
            burst(runner.x, geom.H * 0.66, 14);
        } else {
            hearts -= 1;
            bigMark("✗", "bad");
            floatText("正解：" + row.q.correct, "bad");
            hitFlash();
        }
        updateHud();
        clearTimeout(nextTimer);
        nextTimer = setTimeout(() => {
            if (!running) return;
            clearRow();
            if (hearts <= 0) { endGame(); return; }
            loadQuestion();
        }, FEEDBACK_MS);
    }

    // ── 特效 ─────────────────────────────────────
    function bigMark(ch, kind) {
        const st = $("poem-stage");
        const e = document.createElement("div");
        e.className = "poem-mark " + kind;
        e.textContent = ch;
        st.appendChild(e);
        setTimeout(() => e.remove(), FEEDBACK_MS - 80);
    }
    function floatText(t, kind) {
        const st = $("poem-stage");
        const e = document.createElement("div");
        e.className = "poem-float " + kind;
        e.textContent = t;
        e.style.left = Math.max(70, Math.min(geom.W - 70, runner.x)) + "px";
        st.appendChild(e);
        setTimeout(() => e.remove(), FEEDBACK_MS - 60);
    }
    function burst(x, y, n) {
        const st = $("poem-stage");
        for (let i = 0; i < n; i++) {
            const s = document.createElement("div");
            s.className = "poem-spark";
            const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 44;
            s.style.left = x + "px"; s.style.top = y + "px";
            s.style.setProperty("--dx", Math.cos(a) * d + "px");
            s.style.setProperty("--dy", Math.sin(a) * d + "px");
            st.appendChild(s);
            setTimeout(() => s.remove(), 560);
        }
    }
    function hitFlash() {
        const st = $("poem-stage");
        const f = document.createElement("div");
        f.className = "poem-hitflash";
        st.appendChild(f);
        setTimeout(() => f.remove(), 420);
        const rEl = $("poem-runner");
        rEl.classList.remove("stumble"); void rEl.offsetWidth; rEl.classList.add("stumble");
    }

    // ── 主迴圈 ───────────────────────────────────
    function frame(ts) {
        if (!running) return;
        try {
            const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
            lastTs = ts;
            // 跑者彈簧跟手
            const ax = (runner.targetX - runner.x) * LANE_K - runner.vx * LANE_D;
            runner.vx += ax * dt;
            runner.x += runner.vx * dt;
            runner.x = Math.max(geom.minX, Math.min(geom.maxX, runner.x));
            const lean = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, -runner.vx * 0.028));
            const bob = Math.sin(ts / 95) * 4;
            $("poem-runner").style.transform =
                "translateX(" + runner.x + "px) translateX(-50%) translateY(" + bob + "px) rotate(" + lean + "deg)";
            // 門逼近
            if (phase === "approach" && row) {
                const t = Math.min(1, (ts - row.t0) / row.dur);
                placeGates(t);
                if (t >= 1) resolveRow();
            }
        } catch (e) {
            console.error("[poem] frame error:", e);
        }
        if (running) rafId = requestAnimationFrame(frame);
    }

    // ── HUD ──────────────────────────────────────
    function updateHud() {
        $("poem-score").textContent = "答對 " + score + " 題";
        $("poem-best").textContent = "最高 " + Math.max(best, score) + " 題";
        let h = "";
        for (let i = 0; i < HEARTS_MAX; i++) h += i < hearts ? "❤️" : "🤍";
        $("poem-hearts").textContent = h;
    }

    function preloadImages(urls) {
        return Promise.all(urls.map((u) => new Promise((res) => {
            const im = new Image(); im.onload = () => res(1); im.onerror = () => res(0); im.src = u;
        })));
    }

    // ── 開局/結束 ────────────────────────────────
    async function startGame() {
        if (window.arcadeUI && window.arcadeUI.hideVictory) window.arcadeUI.hideVictory();
        score = 0; hearts = HEARTS_MAX;
        phase = "idle";
        try { best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; } catch (e) { best = 0; }
        if (rafId) cancelAnimationFrame(rafId);
        clearTimeout(nextTimer);
        clearRow();

        const myToken = ++startupToken;
        const stillCurrent = () => myToken === startupToken;
        const overlay = $("poem-countdown");
        overlay.innerHTML = '<div class="poem-loading">準備中…</div>';
        overlay.style.display = "flex";

        try { await loadPoems(); } catch (e) { console.error("[poem] 題庫載入失敗", e); }
        if (!stillCurrent()) return;
        if (!poems.length) { overlay.innerHTML = '<div class="poem-loading">題庫載入失敗，請回遊樂場再試</div>'; return; }
        questions = buildQuestions(); qIdx = 0;
        await preloadImages([
            "arcade/img/poem/bg.webp?v=1",
            "arcade/img/poem/runner.webp?v=1",
            "arcade/img/poem/gate.webp?v=1",
        ]);
        if (!stillCurrent()) return;

        measure();
        runner.x = geom.W * 0.5; runner.targetX = runner.x; runner.vx = 0;
        $("poem-question").textContent = "";
        updateHud();
        for (const txt of ["3", "2", "1", "GO!"]) {
            overlay.innerHTML = '<div class="poem-cd-num' + (txt === "GO!" ? " go" : "") + '">' + txt + "</div>";
            await new Promise((r) => setTimeout(r, 620));
            if (!stillCurrent()) return;
        }
        overlay.style.display = "none";

        running = true;
        lastTs = performance.now();
        loadQuestion();
        rafId = requestAnimationFrame(frame);
    }

    function stopGame() {
        startupToken++;
        running = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        clearTimeout(nextTimer);
        clearRow();
        const o = $("poem-countdown");
        if (o) o.style.display = "none";
    }

    function endGame() {
        phase = "over";
        stopGame();
        const isNewBest = score > best;
        if (isNewBest) {
            best = score;
            try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
        }
        updateHud();
        window.arcadeUI.victory({
            win: score > 0,
            title: score > 0 ? "詩詞接龍" : "再接再厲",
            sub: isNewBest ? "新紀錄！答對 " + score + " 題" : "答對 " + score + " 題",
            rewards: [
                { key: "score", icon: "arcade/img/poem/gate.webp?v=1", label: "答對 " + score + " 題" },
                { key: "best", icon: "🏆", label: "最高紀錄 " + best + " 題" },
            ],
            onReplay: startGame,
            onExit: () => { if (window.eduApp) window.eduApp.showScreen("chinese-hub"); },
        });
    }

    // ── 輸入：任意拖曳左右移動（跟手）＋鍵盤 ───────
    function bindInput() {
        const st = $("poem-stage");
        const toX = (clientX) => {
            const rect = st.getBoundingClientRect();
            return Math.max(geom.minX, Math.min(geom.maxX, clientX - rect.left));
        };
        st.addEventListener("pointerdown", (e) => {
            dragging = true;
            runner.targetX = toX(e.clientX);
            try { st.setPointerCapture(e.pointerId); } catch (e2) {}
        });
        st.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            e.preventDefault();                       // 擋頁面捲動（搭配 touch-action:none）
            runner.targetX = toX(e.clientX);
        }, { passive: false });
        const up = () => { dragging = false; };
        st.addEventListener("pointerup", up);
        st.addEventListener("pointercancel", up);
        document.addEventListener("keydown", (e) => {
            if (!running) return;
            if (e.key === "ArrowLeft") runner.targetX = geom.laneX[0];
            else if (e.key === "ArrowRight") runner.targetX = geom.laneX[1];
        });
        window.addEventListener("resize", () => { if (running || phase === "over") measure(); });
        // 切到背景 rAF 停但牆鐘照走 → 回來門會瞬判；把隱藏時段補回 t0（Codex P2）
        let hiddenAt = 0;
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) { hiddenAt = performance.now(); return; }
            if (hiddenAt && row) row.t0 += performance.now() - hiddenAt;
            hiddenAt = 0;
            lastTs = performance.now();   // 跑者物理 dt 也別吃到大跳
        });
    }

    function init() {
        $("poem-entry-btn").addEventListener("click", startGame);
        $("poem-game-back").addEventListener("click", () => {
            stopGame();
            if (window.eduApp) window.eduApp.showScreen("chinese-hub");
        });
        bindInput();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
