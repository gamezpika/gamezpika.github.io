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
    const APPROACH_STEP = 110;      // 每答對一題加快（派派 6/12：加速要更有感）
    const APPROACH_MIN = 1900;      // 最快不低於這個（要留得住讀題時間）
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

    // 奔跑感：路面捲動 + 路邊道具流 + 鏡頭律動
    // 貼圖循環高(px)由 measure() 依平面寬等比算進 geom.tileH（背景 size 與 modulo 必須同值）
    let floorOff = 0;                    // 路面捲動累積量
    let pulseAt = -1e9;                  // 答對衝刺脈動時間戳
    let props = [], lastPropAt = 0, propSide = 0;
    const PROP_IMGS = ["prop_grass.webp", "prop_stone.webp"];
    function curDur() { return row ? row.dur : Math.max(APPROACH_MIN, APPROACH_BASE - score * APPROACH_STEP); }
    function clearProps() { props.forEach((p) => p.el.remove()); props = []; }

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
    // iPhone Safari 網址列吃高度：頁高用 visualViewport/innerHeight 釘死＋鎖回頂（搭配 CSS 100dvh/overflow:hidden）
    function fitViewport() {
        const h = (window.visualViewport && window.visualViewport.height)
            ? Math.round(window.visualViewport.height) : window.innerHeight;
        const sc = $("screen-poem-game");
        if (sc) sc.style.height = h + "px";
        window.scrollTo(0, 0);
    }
    function measure() {
        fitViewport();
        const st = $("poem-stage");
        const W = st.clientWidth, H = st.clientHeight;
        geom.W = W; geom.H = H;
        geom.laneX = [W * 0.26, W * 0.74];
        geom.minX = W * 0.13; geom.maxX = W * 0.87;
        geom.gateW = Math.min(W * 0.5, 230);
        // 路的消失點＝涼亭底（派派 6/12 紅線）：背景方圖 cover + 底部對齊，涼亭底在圖高約 41%
        const dispH = Math.max(W, H);
        geom.horizonY = Math.max(H * 0.14, Math.min(H * 0.55, H - dispH * 0.59));
        // 路面捲動平面：全寬（含柵欄/草邊一起流）＋貼圖高度按平面寬等比
        const fl = $("poem-floor"); if (fl) fl.style.top = geom.horizonY + "px";
        const pl = document.querySelector(".poem-floor-plane");
        const planeW = Math.round(dispH * 1.57);   // 貼圖路面佔比 0.819，對齊畫面底部的路寬
        if (pl) pl.style.width = planeW + "px";
        geom.tileH = Math.max(70, Math.round(planeW * 70 / 1024 * 1.5));
        const tex = $("poem-floor-tex");
        if (tex) tex.style.backgroundSize = "100% " + geom.tileH + "px";
        const fg = $("poem-fog"); if (fg) fg.style.top = (geom.horizonY - H * 0.045) + "px";
        // 遠景無限拉近層：跟 .poem-world 的 cover 背景對齊同一塊像素（高度只到地平線）
        const far = $("poem-far");
        if (far) {
            far.style.height = Math.round(geom.horizonY) + "px";
            far.querySelectorAll(".poem-far-l").forEach((l) => {
                l.style.backgroundSize = dispH + "px " + dispH + "px";
                l.style.backgroundPosition = Math.round((W - dispH) / 2) + "px " + Math.round(H - dispH) + "px";
                // inline style 的相對路徑是對 HTML 解析（不是對 CSS 檔），必須帶 arcade/ 前綴（Codex P2）
                l.style.backgroundImage = "url('arcade/img/poem/bg.webp?v=1')";
            });
        }
        // 兩側竹牆：rotateY 立面，近端在畫面外側、遠端收向消失點
        const walls = $("poem-walls");
        if (walls) { walls.style.perspective = "430px"; walls.style.perspectiveOrigin = "50% " + Math.round(geom.horizonY) + "px"; }
        const wallH = H * 1.5, wallTop = geom.horizonY - wallH * 0.62, depthW = dispH * 2;
        const wl = $("poem-wall-l"), wr = $("poem-wall-r");
        if (wl) {
            wl.style.top = wallTop + "px"; wl.style.height = wallH + "px";
            wl.style.left = (W * -0.02 - depthW) + "px"; wl.style.width = depthW + "px";
            wl.style.transformOrigin = "100% 50%";
            wl.style.transform = "rotateY(-72deg)";
        }
        if (wr) {
            wr.style.top = wallTop + "px"; wr.style.height = wallH + "px";
            wr.style.left = (W * 1.02) + "px"; wr.style.width = depthW + "px";
            wr.style.transformOrigin = "0% 50%";
            wr.style.transform = "rotateY(72deg)";
        }
        geom.wallTileW = Math.max(120, Math.round(220 * wallH / 330));   // 貼圖 auto 100% 等比後的單塊寬
        // 貼圖層外擴必須 ≥ 一塊貼圖寬，否則 translateX 捲到大位移時牆緣露空白（Codex P3）
        [$("poem-wall-tex-l"), $("poem-wall-tex-r")].forEach((t) => {
            if (t) { t.style.left = -geom.wallTileW + "px"; t.style.right = -geom.wallTileW + "px"; }
        });
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

        const st = $("poem-world");   // 門掛在世界容器裡，跟著鏡頭律動
        const gates = [];
        // 出生金光：告訴眼睛「門從路的盡頭來」
        const fx = document.createElement("div");
        fx.className = "poem-spawnflash";
        fx.style.left = geom.W / 2 + "px"; fx.style.top = geom.horizonY + "px";
        st.appendChild(fx);
        setTimeout(() => fx.remove(), 520);
        // 匾額文字字級跟門寬連動：匾額實際內寬約 0.52×門寬，塞 5 個字留邊（不爆框）
        const labelFs = Math.max(13, Math.floor(geom.gateW * 0.52 / 5.15));
        labels.forEach((ans, lane) => {
            const el = document.createElement("div");
            el.className = "poem-gate";
            el.style.width = geom.gateW + "px";
            const img = document.createElement("img");
            img.className = "poem-gate-img";
            img.src = "arcade/img/poem/gate.webp?v=1";
            img.alt = ""; img.draggable = false;
            const lb = document.createElement("span");
            lb.className = "poem-gate-label";
            lb.style.fontSize = labelFs + "px";
            lb.textContent = ans;                 // textContent：順手把 innerHTML 換掉（防禦縱深）
            el.appendChild(img); el.appendChild(lb);
            st.appendChild(el);
            gates.push({ el, lane, ans });
        });
        const dur = Math.max(APPROACH_MIN, APPROACH_BASE - score * APPROACH_STEP);
        row = { gates, correctLane, q, t0: performance.now(), dur };
        placeGates(0);
        phase = "approach";
    }
    // t: 0(路的盡頭)→1(到跑者面前)；1.8 次方緩入＝透視逼近感（前段稍快，別讓門小到看不見）
    function placeGates(t) {
        if (!row) return;
        const e = Math.pow(t, 1.8);
        const { W, H, laneX, horizonY } = geom;
        const y = horizonY + (H * 0.86 - horizonY) * e;     // 從消失點沿路面下來（不從天上掉）
        const sc = 0.10 + 0.90 * e;                          // 出生就看得見的小門
        const op = Math.min(1, t / 0.08);                    // 淡入縮短：迅速「從路盡頭冒出」
        row.gates.forEach((g) => {
            const farX = W * (g.lane === 0 ? 0.46 : 0.54);   // 遠處貼著路中央、近處沿路展開
            const x = farX + (laneX[g.lane] - farX) * e;
            g.el.style.opacity = op;
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
            pulseAt = performance.now();   // 鏡頭衝刺脈動
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
            // 路面捲動：速度跟逼近時長綁定，1.4 次方放大加速差（答越多路流越快、要有感）
            const dur = curDur();
            const spd = Math.pow(APPROACH_BASE / dur, 1.4);
            floorOff += dt * 150 * spd;
            const tex = $("poem-floor-tex");
            if (tex) tex.style.transform = "translateY(" + (floorOff % (geom.tileH || 110)) + "px)";
            // 兩側竹牆同步捲動（方向：貼圖流向近端＝向鏡頭）
            const wOff = (floorOff * 1.15) % (geom.wallTileW || 300);
            const wtl = $("poem-wall-tex-l"), wtr = $("poem-wall-tex-r");
            if (wtl) wtl.style.transform = "translateX(" + wOff + "px)";
            if (wtr) wtr.style.transform = "translateX(" + (-wOff) + "px)";
            // 鏡頭律動：跑步上下小晃（越快晃越有勁）+ 答對瞬間輕微拉近彈回
            const pulse = 1 + 0.032 * Math.max(0, 1 - (ts - pulseAt) / 360);
            const bobAmp = 2.2 + 1.6 * Math.max(0, spd - 1);
            const world = $("poem-world");
            if (world) world.style.transform = "translateY(" + (Math.sin(ts / 92) * bobAmp) + "px) scale(" + pulse + ")";
            // 高速衝刺：兩側速度線
            if (spd > 1.25 && Math.random() < dt * (spd - 1.1) * 6) {
                const sl = document.createElement("div");
                sl.className = "poem-speedline";
                const sideL = Math.random() < 0.5;
                sl.style.left = geom.W * (sideL ? 0.03 + Math.random() * 0.09 : 0.88 + Math.random() * 0.09) + "px";
                if (world) world.appendChild(sl);
                props.push({ el: sl, line: true, t0: ts, dur: 460 });
            }
            // 路邊道具流：持續從消失點冒出流過去（左右交替），世界一直在動
            if (ts - lastPropAt > 760 * (dur / APPROACH_BASE)) {
                lastPropAt = ts;
                propSide = 1 - propSide;
                const p = document.createElement("div");
                p.className = "poem-prop";
                const im = document.createElement("img");
                im.src = "arcade/img/poem/" + PROP_IMGS[Math.floor(Math.random() * PROP_IMGS.length)] + "?v=1";
                im.alt = ""; im.draggable = false;
                p.appendChild(im);
                p.style.width = Math.round(geom.gateW * (0.34 + Math.random() * 0.16)) + "px";
                if (world) world.appendChild(p);
                props.push({ el: p, side: propSide, t0: ts, dur: dur * 0.92 });
            }
            for (let i = props.length - 1; i >= 0; i--) {
                const p = props[i];
                const pt = (ts - p.t0) / p.dur;
                if (pt >= 1.12) { p.el.remove(); props.splice(i, 1); continue; }
                if (p.line) {   // 速度線：從地平線直線加速掠過
                    const le = pt * pt;
                    p.el.style.opacity = Math.min(1, pt / 0.2) * (1 - Math.max(0, pt - 0.7) / 0.3);
                    p.el.style.transform = "translateY(" + (geom.horizonY + (geom.H * 1.05 - geom.horizonY) * le) + "px) scaleY(" + (0.5 + le * 1.3) + ")";
                    continue;
                }
                const pe = Math.pow(Math.min(1, pt), 1.8);
                const px = geom.W * ((p.side === 0 ? 0.435 : 0.565) + ((p.side === 0 ? 0.05 : 0.95) - (p.side === 0 ? 0.435 : 0.565)) * pe);
                const py = geom.horizonY + (geom.H * 0.98 - geom.horizonY) * pe;
                const psc = 0.10 + 1.05 * pe;
                p.el.style.opacity = Math.min(1, pt / 0.10) * (pt > 1 ? Math.max(0, 1 - (pt - 1) / 0.12) : 1);
                p.el.style.transform = "translate(" + px + "px," + py + "px) translate(-50%,-90%) scale(" + psc + ")";
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
        clearProps();
        floorOff = 0; lastPropAt = 0; pulseAt = -1e9;

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
            "arcade/img/poem/floor_tile.webp?v=1",
            "arcade/img/poem/prop_grass.webp?v=1",
            "arcade/img/poem/prop_stone.webp?v=1",
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
        clearProps();
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
        const onViewport = () => {
            fitViewport();
            if (!(running || phase === "over")) return;
            measure();
            // 進行中轉向：當題的門也要跟新尺寸（Codex P3，不然這題會用舊寬擠新版面）
            if (row) {
                const fs = Math.max(13, Math.floor(geom.gateW * 0.52 / 5.15));
                row.gates.forEach((g) => {
                    g.el.style.width = geom.gateW + "px";
                    const lb = g.el.querySelector(".poem-gate-label");
                    if (lb) lb.style.fontSize = fs + "px";
                });
            }
        };
        window.addEventListener("resize", onViewport);
        if (window.visualViewport) window.visualViewport.addEventListener("resize", onViewport);
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
        fitViewport();   // 進頁先釘住可視高度（封面/教學卡階段就要對）
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
