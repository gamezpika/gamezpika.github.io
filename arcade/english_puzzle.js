// 英文 Puzzle 共用 SFX helper（派派 5/12 要：答對音效跟魔王一樣）
// 用 correct / wrong / click 三音檔（既有 /static/audio/sfx/{name}.mp3）
(function () {
    "use strict";
    if (window.eduPuzzleSfx) return;
    const SFX_NAMES = ['correct', 'wrong', 'click'];
    const VOLUMES = { correct: 0.55, wrong: 0.5, click: 0.35 };
    const cache = {};
    let unlocked = false;

    function ensure(name) {
        if (!cache[name]) {
            const a = new Audio(`${window.ARCADE_API || ""}/static/audio/sfx/${name}.mp3?v=t48`);
            a.preload = 'auto';
            a.volume = VOLUMES[name] || 0.5;
            cache[name] = a;
        }
        return cache[name];
    }

    function unlock() {
        // iOS Safari user gesture 解鎖：muted play → pause（同 boss-phaser 模式）
        if (unlocked) return;
        SFX_NAMES.forEach(name => {
            const a = ensure(name);
            const wasMuted = a.muted;
            a.muted = true;
            const p = a.play();
            const done = () => { try { a.pause(); a.currentTime = 0; } catch (e) {} a.muted = wasMuted; };
            if (p && p.then) p.then(done).catch(done);
            else done();
        });
        unlocked = true;
    }

    function play(name) {
        const a = ensure(name);
        try { a.currentTime = 0; } catch (e) {}
        a.volume = VOLUMES[name] || 0.5;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});  // 靜默忽略 NotAllowed
    }

    window.eduPuzzleSfx = { unlock, play };
})();


// 英文 Puzzle 句子重組（P1 by 派派 5/12）
// 玩法：給中文意思，玩家點字塊放到答案格 → 組成英文句子 → 送出
(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);

    let state = {
        sessionId: null,
        questions: [],
        currentIdx: 0,
        currentQ: null,
        selectedChips: [],   // [{chipId, text}] 玩家放進答案格的順序
        coins: 0,
        streak: 0,
        correct: 0,
        wrong: 0,
        locked: false,        // 送出後鎖住直到下一題
        mode: "sentence",     // "sentence" 句子重組 / "listen" 聽力重組（P4）
    };

    let starting = false;     // 防連點：開新一輪期間忽略重複點（首次語音較久）

    function showLoading() {
        // 立刻切到遊戲畫面 + 顯示「準備中」，使用者才知道有在跑、不會以為壞掉狂點
        try { window.eduApp.showScreen("en-puzzle"); } catch (e) {}
        const p = $("enp-prompt"), lb = $("enp-listen-btn");
        if (p) { p.style.display = ""; p.textContent = "題目準備中…（第一次比較久，請稍候，不用一直點）"; }
        if (lb) lb.style.display = "none";
        ["enp-answer-slots", "enp-chip-pool", "enp-feedback"].forEach(id => {
            const el = $(id); if (el) el.innerHTML = "";
        });
        const sb = $("enp-submit"), cb = $("enp-clear");
        if (sb) sb.disabled = true;
        if (cb) cb.disabled = true;
    }

    function reset(mode) {
        state = {
            sessionId: null, questions: [], currentIdx: 0, currentQ: null,
            selectedChips: [], coins: 0, streak: 0, correct: 0, wrong: 0,
            locked: false, mode: mode || "sentence",
        };
    }

    async function startRound(mode) {
        if (starting) return;             // 準備中就忽略重複點（不再疊請求/不會以為壞掉）
        starting = true;
        const m = mode || "sentence";
        reset(m);
        showLoading();                    // 立刻給「準備中」回饋（首次語音生成較久）
        const endpoint = m === "listen" ? "/api/english/puzzle/listen/start" : "/api/english/puzzle/start";
        try {
            const r = await window.eduApi(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            const d = await r.json();
            if (d.error) {
                if (window.eduApp?.toast) window.eduApp.toast(d.message || "無法開始：" + d.error);
                if (window.eduApp?.showScreen) window.eduApp.showScreen("english-hub");
                return;
            }
            state.sessionId = d.session_id;
            state.questions = d.questions || [];
            state.currentIdx = 0;
            if (state.questions.length === 0) {
                if (window.eduApp?.toast) window.eduApp.toast("還沒有題目");
                if (window.eduApp?.showScreen) window.eduApp.showScreen("english-hub");
                return;
            }
            const cb = $("enp-clear"); if (cb) cb.disabled = false;
            renderQuestion();             // 取代「準備中」畫面
        } catch (e) {
            console.error("[enp] start error:", e);
            if (window.eduApp?.toast) window.eduApp.toast("無法載入：" + e.message);
            if (window.eduApp?.showScreen) window.eduApp.showScreen("english-hub");
        } finally {
            starting = false;             // 一定解鎖，避免卡死再也進不去
        }
    }

    function playAudio() {
        const audio = $("enp-audio");
        if (!audio) return;
        // codex P2: 音檔 url 缺 → 玩家看不出來「為何沒聲音」。明確 toast。
        if (!state.currentQ?.audio_url) {
            if (window.eduApp?.toast) window.eduApp.toast("這題音檔尚未備好，請點下一題或回到首頁重進");
            return;
        }
        try {
            audio.src = (window.ARCADE_API || "") + state.currentQ.audio_url;
            audio.currentTime = 0;
            const p = audio.play();
            if (p && p.catch) {
                p.catch(e => {
                    // codex P2: reject 之前只 console.warn 被吞 → 玩家沒聲音不知為何。
                    // iOS / WebView autoplay block 時用戶會手動按 play 按鈕，所以這裡
                    // 只在「非 NotAllowedError」才 toast（不然首次播放 autoplay 政策 toast 太吵）
                    const msg = e?.name || "";
                    console.warn("[enp-audio]", msg, e?.message || e);
                    if (msg !== "NotAllowedError" && window.eduApp?.toast) {
                        window.eduApp.toast("音檔載入失敗，請再按一次播放鈕重試");
                    }
                });
            }
        } catch (e) {
            console.warn("[enp-audio]", e);
            if (window.eduApp?.toast) window.eduApp.toast("音檔播放異常");
        }
    }

    // 🚂 整句答對：把「玩家剛拼好的那排車廂」本身從原位往右開走（不是另外
    // 蹦一張火車圖）。複製答案格的字塊到全螢幕 overlay（fixed、pointer-
    // events:none、不被任何容器裁切），對齊原位後整排向右駛離 → 原排隱藏。
    function playTrainDepart() {
        const fx = $("enp-train-fx");
        const slots = $("enp-answer-slots");
        if (!fx || !slots) return;
        const chips = Array.from(slots.querySelectorAll(".enp-chip"));
        if (!chips.length) return;
        const r = slots.getBoundingClientRect();
        const run = fx.querySelector(".enp-train-run");
        if (!run) return;

        run.innerHTML = "";
        // 對齊原本答案格的螢幕位置（fixed overlay inset:0 → 座標同 viewport）：
        // 火車從「你拼字的地方」開走。單行不換行，故不設 width/height（由
        // 內容自然撐出一列火車寬），免去 abs 定位/換行那一整類坑。
        run.style.left = r.left + "px";
        run.style.top = r.top + "px";
        chips.forEach(c => {
            const d = document.createElement("span");
            d.className = "enp-chip enp-depart-car";
            d.textContent = c.textContent;
            run.appendChild(d);
        });
        // Phase C「連對越多火車越長」：連對數加掛 0~4 節獎勵小車廂
        const streak = state.streak || 0;
        const bonus = Math.max(0, Math.min(streak - 1, 4));
        for (let i = 0; i < bonus; i++) {
            const b = document.createElement("span");
            b.className = "enp-chip enp-depart-car enp-depart-bonus";
            run.appendChild(b);
        }
        // 火車頭＝in-flow flex 最後一節，緊接最後一節車廂＝列車前端（往右開），
        // 一定看得到（修派派「我沒看到火車頭」）。
        const loco = document.createElement("img");
        loco.className = "enp-loco";
        loco.src = "arcade/img/puzzle/_enp_loco.png?v=1";
        loco.alt = "";
        run.appendChild(loco);
        slots.style.visibility = "hidden";          // 藏原排，避免看到兩份

        // Phase C「連對越多開越快」+ 送出後不拖：依連對縮短駛離動畫
        const dur = streak >= 8 ? 0.46 : streak >= 5 ? 0.55
            : streak >= 3 ? 0.66 : 0.8;
        run.style.animationDuration = dur + "s";

        fx.classList.remove("show");
        void fx.offsetWidth;                        // 強制 reflow 重觸發動畫
        fx.classList.add("show");
        // 火車是「非阻擋」的 overlay：下一題會在它還在飛時就先 render（送出
        // 不拖）。清理計時器要 guard：快速連續答題時清掉上一班的 timer，
        // 避免舊 timer 把新一班火車中途清掉。
        clearTimeout(fx._t);
        fx._t = setTimeout(() => {                  // 動畫跑完才收（隨速度調整）
            fx.classList.remove("show");
            run.innerHTML = "";
            run.removeAttribute("style");
            slots.style.visibility = "";
        }, Math.round(dur * 1000) + 150);
    }

    // Phase C：每 5 連對「到站慶祝」— 灑彩帶 + 橫幅（獨立 fixed 層，
    // pointer-events:none，1.5s 自動收）。
    function playMilestoneFx(streak) {
        let el = document.getElementById("enp-cele");
        if (!el) {
            el = document.createElement("div");
            el.id = "enp-cele";
            el.setAttribute("aria-hidden", "true");
            document.body.appendChild(el);
        }
        const colors = ["#ff5e5e", "#ffd24a", "#5ec8ff", "#7ee787",
            "#c98bff", "#ff9bd2"];
        let bits = "";
        for (let i = 0; i < 18; i++) {
            const c = colors[i % colors.length];
            const l = Math.round(Math.random() * 100);
            const dl = (Math.random() * 0.35).toFixed(2);
            const sp = (0.9 + Math.random() * 0.5).toFixed(2);
            bits += `<i class="enp-cf" style="left:${l}%;background:${c};`
                + `animation-delay:${dl}s;animation-duration:${sp}s"></i>`;
        }
        el.innerHTML = `<div class="enp-cele-banner"><img class="emo" src="arcade/img/icons/celebrate.png?s=6" alt=""> 連對 ${streak}！到站慶祝</div>${bits}`;
        el.classList.remove("show");
        void el.offsetWidth;
        el.classList.add("show");
        clearTimeout(el._t);
        el._t = setTimeout(() => {
            el.classList.remove("show");
            el.innerHTML = "";
        }, 1500);
    }

    // 🛤️ 鐵軌旅程進度：listen mode 注入 #enp-rail（鐵軌+站點+小火車頭），
    // 每題火車頭沿軌前進一站＝旅程感（配每題換場景）。非 listen 隱藏。
    function renderRail(area) {
        let rail = document.getElementById("enp-rail");
        if (state.mode !== "listen") {
            if (rail) rail.style.display = "none";
            return;
        }
        if (!rail) {
            rail = document.createElement("div");
            rail.id = "enp-rail";
            rail.setAttribute("aria-hidden", "true");
            rail.innerHTML =
                '<div class="enp-rail-line"></div>'
                + '<div class="enp-rail-stations"></div>'
                + '<img class="enp-rail-loco" src="arcade/img/puzzle/_enp_loco.png?v=1" alt="">';
            const actions = area.querySelector(".enp-actions");
            if (actions) area.insertBefore(rail, actions);
            else area.appendChild(rail);
        }
        rail.style.display = "";
        const total = state.questions.length || 1;
        const idx = state.currentIdx;
        const pct = (i) => (total <= 1 ? 50 : (i / (total - 1)) * 100);
        const st = rail.querySelector(".enp-rail-stations");
        if (st.children.length !== total) {
            st.innerHTML = "";
            for (let i = 0; i < total; i++) {
                const d = document.createElement("span");
                d.className = "enp-rail-stop";
                d.style.left = pct(i) + "%";
                st.appendChild(d);
            }
        }
        Array.from(st.children).forEach((c, i) =>
            c.classList.toggle("done", i <= idx));
        rail.querySelector(".enp-rail-loco").style.left = pct(idx) + "%";
    }

    function renderQuestion() {
        state.currentQ = state.questions[state.currentIdx];
        if (!state.currentQ) return;
        state.selectedChips = [];
        state.locked = false;
        // 🚩 把目前題號暴露給回報元件，並只在有題號時才顯示回報鈕（沒題目不亮，Codex P3）
        try {
            window.__qreportQid = state.currentQ.id || 0;
            var _rb = document.getElementById("enp-report");
            if (_rb) _rb.style.display = state.currentQ.id ? "" : "none";
        } catch (e) {}

        // listen mode 顯示喇叭按鈕、隱藏 prompt（無中文意思）；sentence mode 反之
        const promptEl = $("enp-prompt");
        const listenBtn = $("enp-listen-btn");
        if (state.mode === "listen") {
            promptEl.style.display = "none";
            listenBtn.style.display = "";
            // 派派：不要一開始就自動播，玩家自己按 🔊 才播（不自動觸發）
        } else {
            promptEl.style.display = "";
            listenBtn.style.display = "none";
            promptEl.textContent = state.currentQ.prompt || "";
        }
        // 🚂 火車主題 class 只在 listen mode 掛在 .enp-area（sentence 不變）
        const trainArea = document.querySelector("#screen-en-puzzle .enp-area");
        if (trainArea) {
            trainArea.classList.toggle("enp-train", state.mode === "listen");
            // Phase B：聽力模式每題輪一個場景（草原→海邊→城市→星空）＝旅程感
            const SCENES = ["scene-grass", "scene-sea", "scene-city", "scene-night"];
            trainArea.classList.remove(...SCENES);
            if (state.mode === "listen") {
                trainArea.classList.add(SCENES[state.currentIdx % SCENES.length]);
            }
            renderRail(trainArea);   // 🛤️ 鐵軌旅程進度（每題火車頭前進一站）
        }
        $("enp-progress").textContent = `${state.currentIdx + 1}/${state.questions.length}`;
        $("enp-streak").innerHTML = `<img class="emo" src="arcade/img/icons/fire.png?s=6" alt=""> ${state.streak}`;
        $("enp-coins").innerHTML = `<img class="emo" src="arcade/img/icons/coin.png?s=6" alt=""> ${state.coins}`;

        // 渲染字塊池（每字塊一個唯一 chipId 用來追蹤）
        const pool = $("enp-chip-pool");
        pool.innerHTML = "";
        (state.currentQ.chips || []).forEach((text, i) => {
            const btn = document.createElement("button");
            btn.className = "enp-chip";
            btn.dataset.chipId = String(i);
            btn.textContent = text;
            btn.addEventListener("click", () => onChipFromPool(i, text, btn));
            pool.appendChild(btn);
        });

        // 答案格清空（並強制恢復可見：火車駛離是非阻擋 overlay，下一題可能
        // 在它清理前就先 render，這裡確保新題答案格一定看得到、不被前一班
        // 火車的 visibility:hidden 殘留蓋住）
        const slots = $("enp-answer-slots");
        slots.style.visibility = "";
        slots.innerHTML = "";
        slots.classList.add("empty");

        // 回饋區清空
        const fb = $("enp-feedback");
        fb.textContent = "";
        fb.className = "enp-feedback";

        // 送出鈕 disable（沒選字不能送）
        $("enp-submit").disabled = true;
    }

    function onChipFromPool(chipId, text, btn) {
        if (state.locked) return;
        if (btn.classList.contains("used")) return;
        btn.classList.add("used");
        state.selectedChips.push({ chipId, text });
        window.eduPuzzleSfx?.play("click");
        renderSlots();
    }

    function onChipFromSlot(idx) {
        if (state.locked) return;
        const removed = state.selectedChips.splice(idx, 1)[0];
        if (!removed) return;
        // 池子那顆 unused
        const poolBtn = document.querySelector(`#enp-chip-pool .enp-chip[data-chip-id="${removed.chipId}"]`);
        if (poolBtn) poolBtn.classList.remove("used");
        window.eduPuzzleSfx?.play("click");
        renderSlots();
    }

    function renderSlots() {
        const slots = $("enp-answer-slots");
        slots.innerHTML = "";
        if (state.selectedChips.length === 0) {
            slots.classList.add("empty");
        } else {
            slots.classList.remove("empty");
        }
        state.selectedChips.forEach((c, idx) => {
            const btn = document.createElement("button");
            btn.className = "enp-chip";
            btn.textContent = c.text;
            btn.addEventListener("click", () => onChipFromSlot(idx));
            slots.appendChild(btn);
        });
        $("enp-submit").disabled = state.selectedChips.length === 0;
    }

    function clearAll() {
        if (state.locked) return;
        state.selectedChips = [];
        // 還原池子所有 chip
        document.querySelectorAll("#enp-chip-pool .enp-chip.used").forEach(b => b.classList.remove("used"));
        renderSlots();
    }

    async function submitAnswer() {
        if (state.locked || state.selectedChips.length === 0) return;
        state.locked = true;
        $("enp-submit").disabled = true;

        const sentence = state.selectedChips.map(c => c.text).join(" ");
        try {
            const r = await window.eduApi("/api/english/puzzle/answer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: state.sessionId,
                    question_id: state.currentQ.id,
                    sentence: sentence,
                }),
            });
            const d = await r.json();
            if (d.error) {
                if (d.error === "invalid_session" || d.error === "session_not_found") return;  // eduApi 全域 hook
                if (window.eduApp?.toast) window.eduApp.toast("送出失敗：" + d.error);
                state.locked = false;
                $("enp-submit").disabled = false;
                return;
            }

            // 顯示結果 — 格式統一：✓/✗ 標頭 + 正確句子 + 中文意思，
            // 答對/答錯同一版型（清楚不模糊）。DB 文字一律 escape 防 XSS。
            const fb = $("enp-feedback");
            const esc = (t) => String(t == null ? "" : t)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;")
                .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
            const _ans = d.correct_answer || "";
            const _zh = (d.zh_hint || "").trim();
            if (d.correct) {
                state.correct++;
                state.coins += d.coins_earned || 0;
                state.streak = d.streak || 0;
                document.querySelectorAll("#enp-answer-slots .enp-chip").forEach(b => b.classList.add("correct"));
                window.eduPuzzleSfx?.play("correct");
                if (state.mode === "listen") playTrainDepart();  // 🚂 整排駛離
                if (state.mode === "listen" && state.streak > 0
                    && state.streak % 5 === 0) playMilestoneFx(state.streak);
            } else {
                state.wrong++;
                state.streak = 0;
                document.querySelectorAll("#enp-answer-slots .enp-chip").forEach(b => b.classList.add("wrong"));
                window.eduPuzzleSfx?.play("wrong");
            }
            const _head = d.correct
                ? "答對！+" + (d.coins_earned || 0) + " 金"
                : "答錯了";
            const _headIcon = d.correct
                ? '<img class="emo" src="arcade/img/icons/check_circle.png?s=6" alt="">'
                : '<img class="emo" src="arcade/img/icons/ui_cross.png?v=1" alt="">';
            let _html = '<div class="enp-fb-head">' + _headIcon + ' ' + esc(_head) + '</div>'
                + '<div class="enp-fb-row"><span class="enp-fb-k">正確句子</span>'
                + '<span class="enp-fb-v">' + esc(_ans) + '</span></div>';
            if (_zh) {
                _html += '<div class="enp-fb-row"><span class="enp-fb-k">中文意思</span>'
                    + '<span class="enp-fb-v">' + esc(_zh) + '</span></div>';
            }
            fb.className = "enp-feedback " + (d.correct ? "correct" : "wrong") + " show";
            fb.innerHTML = _html;
            // 同步分數顯示
            $("enp-streak").innerHTML = `<img class="emo" src="arcade/img/icons/fire.png?s=6" alt=""> ${state.streak}`;
            $("enp-coins").innerHTML = `<img class="emo" src="arcade/img/icons/coin.png?s=6" alt=""> ${state.coins}`;

            // 送出真的不拖：答對 ~0.4s 就進下一題（火車駛離/到站慶祝都是
            // 非阻擋 overlay，會在新題上面繼續飛/灑彩帶，不擋流程）；答錯
            // 才停 0.9s 讓你看正解＋中文意思。
            const _nextMs = d.correct ? 400 : 900;
            setTimeout(() => {
                state.currentIdx++;
                if (state.currentIdx < state.questions.length) {
                    renderQuestion();
                } else {
                    endRound();
                }
            }, _nextMs);
        } catch (e) {
            console.error("[enp] submit error:", e);
            state.locked = false;
            $("enp-submit").disabled = false;
        }
    }

    async function endRound() {
        try {
            const r = await window.eduApi("/api/english/puzzle/end", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: state.sessionId }),
            });
            const d = await r.json();
            if (d.error && d.error !== "invalid_session" && d.error !== "session_not_found") {
                console.error("[enp] end error:", d.error);
            }
            const s = d.summary || { correct: state.correct, total: state.questions.length, coins: state.coins };

            // 結算：共用勝利頁
            const pct = s.percentage ?? (s.total ? Math.round(s.correct / s.total * 100) : 0);
            let detail;
            if (pct >= 80) detail = "太強了！";
            else if (pct >= 60) detail = "不錯喔！";
            else if (pct >= 40) detail = "再加油～";
            else detail = "下次更好！";
            const replayMode = state.mode;
            window.arcadeUI.victory({
                win: pct >= 60,
                sub: `${detail}　答對 ${s.correct}/${s.total}`,
                rewards: [
                    { key: "coins", icon: "arcade/img/icons/coin.png?s=6", label: `+${s.coins} 金` },
                    { key: "score", icon: "arcade/img/icons/hundred.png?s=6", label: `${pct} 分` },
                    { key: "correct", icon: "arcade/img/icons/check_circle.png?s=6", label: `${s.correct}/${s.total}` },
                ],
                onReplay: () => startRound(replayMode),
                onExit: () => window.eduApp.showScreen("english-hub"),
            });

            // 結算後同步玩家狀態
            if (window.eduApp?.refreshUserStatus) await window.eduApp.refreshUserStatus();
        } catch (e) {
            console.error("[enp] end api error:", e);
        }
    }

    // ── 全域事件：invalid_session 統一清 state（同 5 科 game）
    document.addEventListener("eduarena:invalid-session", () => {
        state.sessionId = null;
        state.locked = false;
    });

    // ── 綁定 UI ──
    // 結算頁的再玩一次由 arcadeUI.victory 的 onReplay 處理（依當局 mode）
    function init() {
        const entry = $("en-puzzle-entry");
        if (entry) entry.addEventListener("click", () => {
            window.eduPuzzleSfx?.unlock();  // user gesture 解鎖音效（iOS Safari）
            startRound("sentence");
        });

        // P4 聽力重組入口
        const listenEntry = $("en-listen-puzzle-entry");
        if (listenEntry) listenEntry.addEventListener("click", () => {
            window.eduPuzzleSfx?.unlock();
            startRound("listen");
        });

        // 喇叭按鈕（重播 TTS）
        const listenBtn = $("enp-listen-btn");
        if (listenBtn) listenBtn.addEventListener("click", playAudio);

        const back = $("enp-back");
        if (back) back.addEventListener("click", async () => {
            if (!state.sessionId || state.currentIdx >= state.questions.length) {
                window.eduApp.showScreen("english-hub");
                return;
            }
            if (!await window.eduApp.confirm("確定要離開？已答的進度會結算")) return;
            await endRound();
        });

        const clearBtn = $("enp-clear");
        if (clearBtn) clearBtn.addEventListener("click", clearAll);

        const submitBtn = $("enp-submit");
        if (submitBtn) submitBtn.addEventListener("click", submitAnswer);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();


// ── 字配圖 puzzle (P3) ──
(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);

    let st = {
        sessionId: null, questions: [], currentIdx: 0, currentQ: null,
        coins: 0, streak: 0, correct: 0, wrong: 0, locked: false,
    };

    function reset() {
        st = { sessionId: null, questions: [], currentIdx: 0, currentQ: null,
               coins: 0, streak: 0, correct: 0, wrong: 0, locked: false };
    }

    async function start() {
        reset();
        try {
            const r = await window.eduApi("/api/english/puzzle/image/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
            const d = await r.json();
            if (d.error) {
                if (window.eduApp?.toast) window.eduApp.toast(d.message || "無法開始：" + d.error);
                window.eduApp.showScreen("english-hub");
                return;
            }
            st.sessionId = d.session_id;
            st.questions = d.questions || [];
            if (!st.questions.length) {
                if (window.eduApp?.toast) window.eduApp.toast("還沒有字配圖題");
                return;
            }
            window.eduApp.showScreen("en-img-puzzle");
            renderQ();
        } catch (e) {
            console.error("[enip] start error:", e);
        }
    }

    function renderQ() {
        st.currentQ = st.questions[st.currentIdx];
        if (!st.currentQ) return;
        st.locked = false;

        $("enip-word").textContent = st.currentQ.word || "";
        $("enip-progress").textContent = `${st.currentIdx + 1}/${st.questions.length}`;
        $("enip-streak").innerHTML = `<img class="emo" src="arcade/img/icons/fire.png?s=6" alt=""> ${st.streak}`;
        $("enip-coins").innerHTML = `<img class="emo" src="arcade/img/icons/coin.png?s=6" alt=""> ${st.coins}`;

        const grid = $("enip-grid");
        grid.innerHTML = "";
        (st.currentQ.choices || []).forEach((c, i) => {
            const btn = document.createElement("button");
            btn.className = "enip-choice";
            btn.dataset.idx = String(i);
            // codex P2: 字配圖選項 <img> 若 src 404 → 變破圖玩家無法判斷選什麼。
            // onerror 動態換成 word 文字 fallback（仍可作答，題目雖醜但不卡）。
            const img = document.createElement("img");
            img.src = c.image || "";
            img.alt = c.word || "?";
            img.onerror = () => {
                const span = document.createElement("span");
                span.className = "enip-choice-fallback";
                span.textContent = c.word || "?";
                img.replaceWith(span);
            };
            btn.appendChild(img);
            btn.addEventListener("click", () => pick(i, btn));
            grid.appendChild(btn);
        });

        const fb = $("enip-feedback");
        fb.textContent = ""; fb.className = "enp-feedback";
    }

    async function pick(choiceIdx, btn) {
        if (st.locked) return;
        st.locked = true;
        document.querySelectorAll("#enip-grid .enip-choice").forEach(b => b.classList.add("disabled"));

        try {
            const r = await window.eduApi("/api/english/puzzle/image/answer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: st.sessionId,
                    q_idx: st.currentQ.q_idx,
                    choice_idx: choiceIdx,
                }),
            });
            const d = await r.json();
            if (d.error) {
                if (d.error === "invalid_session" || d.error === "session_not_found") return;
                if (window.eduApp?.toast) window.eduApp.toast("答題失敗：" + d.error);
                st.locked = false;
                document.querySelectorAll("#enip-grid .enip-choice").forEach(b => b.classList.remove("disabled"));
                return;
            }

            const fb = $("enip-feedback");
            if (d.correct) {
                st.correct++;
                st.coins += d.coins_earned || 0;
                st.streak = d.streak || 0;
                btn.classList.add("correct");
                fb.className = "enp-feedback correct show";
                fb.textContent = "答對！+" + (d.coins_earned || 0) + " 金";
                window.eduPuzzleSfx?.play("correct");
            } else {
                st.wrong++;
                st.streak = 0;
                btn.classList.add("wrong");
                // 標出正解
                const correctBtn = document.querySelector(`#enip-grid .enip-choice[data-idx="${d.correct_idx}"]`);
                if (correctBtn) correctBtn.classList.add("correct");
                fb.className = "enp-feedback wrong show";
                fb.textContent = "正解：" + (d.correct_word || "");
                window.eduPuzzleSfx?.play("wrong");
            }
            $("enip-streak").innerHTML = `<img class="emo" src="arcade/img/icons/fire.png?s=6" alt=""> ${st.streak}`;
            $("enip-coins").innerHTML = `<img class="emo" src="arcade/img/icons/coin.png?s=6" alt=""> ${st.coins}`;

            // 答對縮短到 400ms 不拖；答錯停 900ms 讓玩家看正解
            setTimeout(() => {
                st.currentIdx++;
                if (st.currentIdx < st.questions.length) renderQ();
                else end();
            }, d.correct ? 400 : 900);
        } catch (e) {
            console.error("[enip] answer error:", e);
            st.locked = false;
        }
    }

    async function end() {
        try {
            const r = await window.eduApi("/api/english/puzzle/image/end", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: st.sessionId }),
            });
            const d = await r.json();
            const s = d.summary || { correct: st.correct, total: st.questions.length, coins: st.coins };
            const pct = s.percentage ?? (s.total ? Math.round(s.correct / s.total * 100) : 0);
            let detail;
            if (pct >= 80) detail = "太強了！";
            else if (pct >= 60) detail = "不錯喔！";
            else if (pct >= 40) detail = "再加油～";
            else detail = "下次更好！";
            window.arcadeUI.victory({
                win: pct >= 60,
                sub: `${detail}　答對 ${s.correct}/${s.total}`,
                rewards: [
                    { key: "coins", icon: "arcade/img/icons/coin.png?s=6", label: `+${s.coins} 金` },
                    { key: "score", icon: "arcade/img/icons/hundred.png?s=6", label: `${pct} 分` },
                    { key: "correct", icon: "arcade/img/icons/check_circle.png?s=6", label: `${s.correct}/${s.total}` },
                ],
                onReplay: start,
                onExit: () => window.eduApp.showScreen("english-hub"),
            });
            if (window.eduApp?.refreshUserStatus) await window.eduApp.refreshUserStatus();
        } catch (e) {
            console.error("[enip] end error:", e);
        }
    }

    document.addEventListener("eduarena:invalid-session", () => {
        st.sessionId = null; st.locked = false;
    });

    function init() {
        const entry = $("en-img-puzzle-entry");
        if (entry) entry.addEventListener("click", () => {
            window.eduPuzzleSfx?.unlock();  // user gesture 解鎖音效
            start();
        });

        const back = $("enip-back");
        if (back) back.addEventListener("click", async () => {
            if (!st.sessionId || st.currentIdx >= st.questions.length) {
                window.eduApp.showScreen("english-hub");
                return;
            }
            if (!await window.eduApp.confirm("確定要離開？已答的進度會結算")) return;
            await end();
        });

        // 結算頁的再玩一次由 arcadeUI.victory 的 onReplay 處理
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
