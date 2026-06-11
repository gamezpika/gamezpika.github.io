/**
 * 名人九宮格：5 階段狀態機翻牌猜偉人
 * 階段：intro → preview → cover → shuffle → guess → result
 */
(function () {
    "use strict";

    // ─── 偉人資料 ─────────────────────────────────
    const FIGURES = [
        {
            key: "libai", name: "李白", title: "詩仙",
            era: "唐朝（701–762）", field: "詩人 · 中國",
            hints: ["詩仙", "唐朝", "舉杯邀明月", "斗酒詩百篇"],
            intro: "中國唐代浪漫主義詩人，被譽為「詩仙」。詩作豪放飄逸、想像奇特，是中國文學史上最偉大的詩人之一。",
            quote: "「天生我材必有用，千金散盡還復來。」",
        },
        {
            key: "kongzi", name: "孔子", title: "至聖先師",
            era: "春秋（前 551–前 479）", field: "思想家 · 中國",
            hints: ["儒家", "春秋時代", "至聖先師", "論語"],
            intro: "中國春秋時期思想家、教育家，儒家學派創始人。其思想影響中華文化兩千多年。",
            quote: "「己所不欲，勿施於人。」",
        },
        {
            key: "dufu", name: "杜甫", title: "詩聖",
            era: "唐朝（712–770）", field: "詩人 · 中國",
            hints: ["詩聖", "唐朝", "憂國憂民", "三吏三別"],
            intro: "中國唐代偉大的現實主義詩人，與李白齊名，世稱「詩聖」。詩作反映民間疾苦。",
            quote: "「安得廣廈千萬間，大庇天下寒士俱歡顏。」",
        },
        {
            key: "davinci", name: "達文西", title: "全才大師",
            era: "1452–1519", field: "藝術家 · 義大利",
            hints: ["蒙娜麗莎", "文藝復興", "全才", "解剖學手稿"],
            intro: "義大利文藝復興時期最完美的代表，畫家、科學家、發明家、工程師——史上最全能的天才。",
            quote: "「簡單是終極的精緻。」",
        },
        {
            key: "shakespeare", name: "莎士比亞", title: "戲劇之王",
            era: "1564–1616", field: "劇作家 · 英國",
            hints: ["哈姆雷特", "羅密歐與茱麗葉", "英國", "戲劇之王"],
            intro: "英國伊麗莎白時代劇作家、詩人，被譽為「英國戲劇之王」。作品流傳全球，影響深遠。",
            quote: "「To be, or not to be, that is the question.」",
        },
        {
            key: "einstein", name: "愛因斯坦", title: "相對論之父",
            era: "1879–1955", field: "物理學家 · 德國",
            hints: ["相對論", "E=mc²", "諾貝爾獎", "蓬鬆白髮"],
            intro: "德裔猶太理論物理學家，相對論的創立者，20 世紀最重要的科學家之一。",
            quote: "「想像力比知識更重要。」",
        },
        {
            key: "curie", name: "居里夫人", title: "鐳的發現者",
            era: "1867–1934", field: "化學家 · 波蘭",
            hints: ["鐳元素", "兩次諾貝爾獎", "放射性", "波蘭/法國"],
            intro: "波蘭裔法國籍物理學家、化學家。發現鐳元素，是史上第一位、且唯一兩度獲得諾貝爾獎的女性。",
            quote: "「人生沒有什麼好害怕的，只有需要了解的。」",
        },
        {
            key: "darwin", name: "達爾文", title: "演化論之父",
            era: "1809–1882", field: "博物學家 · 英國",
            hints: ["物種起源", "演化論", "加拉巴哥群島", "白色長鬍"],
            intro: "英國博物學家，《物種起源》作者，創立「自然選擇」演化理論，徹底改變人類對生命的理解。",
            quote: "「適者生存。」",
        },
        {
            key: "mozart", name: "莫札特", title: "音樂神童",
            era: "1756–1791", field: "音樂家 · 奧地利",
            hints: ["音樂神童", "古典樂", "魔笛", "奧地利"],
            intro: "奧地利古典樂派代表作曲家，5 歲開始作曲的音樂神童，35 歲早逝。一生留下 600 多部作品。",
            quote: "「音樂不在音符裡，而在音符之間的靜默中。」",
        },
    ];

    // ─── 狀態 ────────────────────────────────────
    const STATE = { IDLE: 0, INTRO: 1, PREVIEW: 2, COVER: 3, SHUFFLE: 4, GUESS: 5, RESULT: 6 };
    const TOTAL_ROUNDS = 5;
    // 第 1-5 題的卡片移動秒數（漸漸變快）
    const MOVE_DURATIONS_S = [1.8, 1.5, 1.2, 0.9, 0.6];

    let state = STATE.IDLE;
    let currentTargetIdx = 0;   // 當前是第幾題 (0-4)
    let questionOrder = [];      // 從 9 偉人中隨機選 5 個的 index 陣列
    let positions = [];          // [{row, col}] x 9，記每張卡的位置
    let cardEls = [];            // 9 個卡片 DOM
    let answered = [];           // [boolean] x TOTAL_ROUNDS，紀錄哪些題已答對
    let pendingVictory = false;  // 最後一題知識卡關閉後 → 進共用勝利結算頁

    // 從遊樂場機台進來：勝利頁「回遊樂場」要帶回機台前位置
    const FROM_PLAYGROUND = new URLSearchParams(location.search).get("from") === "playground";
    function playgroundUrl() {
        const bs = new URLSearchParams(location.search).get("back_spawn") || "";
        return "village-web/index.html?map=playground" + (/^0\.\d+,0\.\d+$/.test(bs) ? "&spawn=" + bs : "");
    }

    // ─── DOM ─────────────────────────────────────
    function $(id) { return document.getElementById(id); }

    // ─── Fisher-Yates shuffle helper ─────────────
    function shuffleArr(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ─── 初始化 ──────────────────────────────────
    function init() {
        const grid = $("fg-grid");
        grid.innerHTML = "";
        cardEls = [];
        positions = [];
        answered = new Array(TOTAL_ROUNDS).fill(false);
        // 從 9 偉人中隨機選 5 個出題（卡片本身 9 張全部在 grid）
        questionOrder = shuffleArr([...Array(FIGURES.length).keys()]).slice(0, TOTAL_ROUNDS);

        FIGURES.forEach((fig, idx) => {
            const card = document.createElement("button");
            card.className = "fg-card";
            card.dataset.fig = fig.key;
            card.innerHTML = `
                <div class="fg-card-inner">
                    <div class="fg-card-face fg-card-back">
                        <span class="fg-card-back-deco">？</span>
                    </div>
                    <div class="fg-card-face fg-card-front">
                        <img src="assets/images/figures/${fig.key}.png" alt="${fig.name}">
                        <span class="fg-card-name">${fig.name}</span>
                    </div>
                </div>
            `;
            card.addEventListener("click", () => onCardClick(idx));
            grid.appendChild(card);
            cardEls.push(card);
            positions.push({ row: Math.floor(idx / 3), col: idx % 3 });
        });

        layoutCards();

        $("fg-next").addEventListener("click", nextTarget);
        $("fg-back").addEventListener("click", showAbout);
        $("fg-modal-close").addEventListener("click", closeModal);
        $("fg-modal").addEventListener("click", e => { if (e.target.id === "fg-modal") closeModal(); });
        window.addEventListener("resize", layoutCards);

        // 封面＋教學：按「開始遊戲」才開局（教學自動彈出、可略過）
        window.arcadeUI.intro({
            icon: "arcade/img/icons/ui_temple.png?v=1",
            title: "名人九宮格",
            sub: "翻牌記憶 · 認識 9 位中外偉人",
            steps: [
                { ico: "arcade/img/icons/ui_magnifier.png?v=1", text: "先看 7 秒，記住 9 位偉人各在哪個位置" },
                { ico: "arcade/img/icons/ui_swirl.png?v=1", text: "卡片蓋起來開始洗牌——眼睛跟好，別跟丟！" },
                { ico: "arcade/img/icons/ui_tap.png?v=1", text: "找出題目指定的偉人，答對看知識卡；共 5 題，洗牌會越來越快" },
            ],
            onStart: startRound,
        });
    }

    // ─── 再玩一輪（共用勝利頁的「再玩一次」） ─────
    function replayAll() {
        currentTargetIdx = 0;
        questionOrder = shuffleArr([...Array(FIGURES.length).keys()]).slice(0, TOTAL_ROUNDS);
        answered = new Array(TOTAL_ROUNDS).fill(false);
        startRound();
    }

    // ─── 共用勝利結算頁 ─────────────────────────
    function showVictory() {
        window.arcadeUI.victory({
            win: true,
            sub: "五關全部破關！你是名人達人！",
            rewards: [
                { key: "cards", icon: "arcade/img/icons/scroll.png?v=1", label: "知識卡 ×5" },
                { key: "correct", icon: "arcade/img/icons/check_circle.png?s=6", label: "答對 5/5" },
            ],
            onReplay: replayAll,
            onExit: FROM_PLAYGROUND ? () => { location.href = playgroundUrl(); } : null,
        });
    }

    // ─── 排版：依 positions 設定每張卡 absolute 位置 ──
    function layoutCards() {
        const grid = $("fg-grid");
        const w = grid.clientWidth, h = grid.clientHeight;
        const cellW = w / 3, cellH = h / 3;
        cardEls.forEach((card, i) => {
            const p = positions[i];
            card.style.width = (cellW - 6) + "px";
            card.style.height = (cellH - 6) + "px";
            card.style.left = (p.col * cellW + 3) + "px";
            card.style.top = (p.row * cellH + 3) + "px";
        });
    }

    // ─── 開新一題 ────────────────────────────────
    function startRound() {
        const target = FIGURES[questionOrder[currentTargetIdx]];
        // 設定這一題的卡片移動速度（漸漸變快）
        const speedS = MOVE_DURATIONS_S[currentTargetIdx] ?? 0.6;
        document.documentElement.style.setProperty("--card-move-duration", speedS + "s");

        // 重置：全部翻回正面（預覽階段）
        cardEls.forEach(c => {
            c.classList.remove("flipped");
            c.classList.remove("correct");
            c.classList.remove("wrong");
            c.classList.remove("disabled");
        });
        // 顯示題目
        $("fg-target-name").textContent = target.name;
        $("fg-hints").innerHTML = target.hints.map(h => `<span class="fg-hint">${h}</span>`).join("");
        const speedHint = currentTargetIdx === 0 ? "" : (currentTargetIdx < 3 ? "（速度漸快）" : "（速度加快！）");
        $("fg-status").innerHTML = '記住每位偉人的位置 <img src="arcade/img/icons/ui_magnifier.png?v=1" alt="">' + speedHint;
        $("fg-status").className = "fg-status preview";
        $("fg-progress").textContent = `第 ${currentTargetIdx + 1} / ${TOTAL_ROUNDS} 題`;
        $("fg-controls").style.display = "none";

        state = STATE.PREVIEW;
        // 階段 2：7 秒預覽（小朋友看 9 個偉人位置）
        setTimeout(coverCards, 7000);
    }

    // ─── 階段 3：全部蓋起來 ──────────────────────
    function coverCards() {
        state = STATE.COVER;
        $("fg-status").textContent = "卡片蓋上了…";
        cardEls.forEach(c => c.classList.add("flipped"));
        setTimeout(shuffleCards, 1500);   // 等翻牌動畫 0.9s + 0.6s 留時間給玩家準備
    }

    // ─── 階段 4：洗牌（9 張全部同時滑動到新位置，2 次大洗） ──
    function shuffleCards() {
        state = STATE.SHUFFLE;
        $("fg-status").innerHTML = '洗牌中… 別跟丟！<img src="arcade/img/icons/ui_swirl.png?v=1" alt="">';
        $("fg-status").className = "fg-status shuffle";

        let round = 0;
        const totalRounds = 2;
        function doShuffleRound() {
            if (round >= totalRounds) {
                setTimeout(guessPhase, 800);   // 洗完停 0.8 秒再開放點選
                return;
            }
            // Fisher-Yates：一次把 9 個位置全部打散
            do {
                for (let i = positions.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [positions[i], positions[j]] = [positions[j], positions[i]];
                }
            } while (cardEls.every((_, i) => positions[i].row === Math.floor(i / 3) && positions[i].col === i % 3));
            layoutCards();
            round++;
            // 間隔 = 移動時間 + 0.7s 停留看清楚（速度遞增時間隔也跟著縮）
            const moveMs = (MOVE_DURATIONS_S[currentTargetIdx] ?? 0.6) * 1000;
            setTimeout(doShuffleRound, moveMs + 700);
        }
        setTimeout(doShuffleRound, 800);
    }

    // ─── 階段 5：玩家可猜 ───────────────────────
    function guessPhase() {
        state = STATE.GUESS;
        $("fg-status").innerHTML = '你的回合！點一張卡 <img src="arcade/img/icons/ui_tap.png?v=1" alt="">';
        $("fg-status").className = "fg-status guess";
    }

    // ─── 點卡片 ───────────────────────────────
    function onCardClick(idx) {
        if (state !== STATE.GUESS) return;
        const card = cardEls[idx];
        if (card.classList.contains("disabled")) return;
        const fig = FIGURES[idx];
        const target = FIGURES[questionOrder[currentTargetIdx]];

        // 翻開
        card.classList.remove("flipped");

        if (fig.key === target.key) {
            // 對！停 1.5 秒讓玩家看清楚翻對的偉人圖再跳知識卡
            card.classList.add("correct");
            answered[currentTargetIdx] = true;
            state = STATE.RESULT;
            setTimeout(() => showKnowledgeCard(fig), 1500);
        } else {
            // 錯！停 3 秒讓玩家看清楚錯翻的是誰再翻回去
            card.classList.add("wrong");
            $("fg-status").textContent = `這位是「${fig.name}」，不是 ${target.name}…再試一次！`;
            $("fg-status").className = "fg-status wrong-msg";
            setTimeout(() => {
                card.classList.add("flipped");
                card.classList.remove("wrong");
                $("fg-status").innerHTML = '你的回合！點一張卡 <img src="arcade/img/icons/ui_tap.png?v=1" alt="">';
                $("fg-status").className = "fg-status guess";
            }, 3000);
        }
    }

    // ─── 知識卡 modal ──────────────────────────
    function showKnowledgeCard(fig) {
        $("fg-modal-icon").innerHTML = `<img src="assets/images/figures/${fig.key}.png" alt="">`;
        $("fg-modal-name").textContent = fig.name;
        $("fg-modal-title").textContent = fig.title;
        $("fg-modal-era").textContent = fig.era;
        $("fg-modal-field").textContent = fig.field;
        $("fg-modal-intro").textContent = fig.intro;
        $("fg-modal-quote").textContent = fig.quote;
        $("fg-modal").classList.add("show");
        const isLast = currentTargetIdx >= TOTAL_ROUNDS - 1;
        if (isLast) {
            // 最後一題：關掉知識卡後進共用勝利結算頁
            pendingVictory = true;
            $("fg-controls").style.display = "none";
            $("fg-status").innerHTML = '<img src="arcade/img/icons/celebrate.png?s=6" alt=""> 五關全部破關！你是名人達人！';
            $("fg-status").className = "fg-status guess";
        } else {
            $("fg-controls").style.display = "flex";
            $("fg-next").style.display = "";
        }
    }

    function closeModal() {
        $("fg-modal").classList.remove("show");
        if (pendingVictory) {
            pendingVictory = false;
            showVictory();
        }
    }

    function nextTarget() {
        if (currentTargetIdx < TOTAL_ROUNDS - 1) {
            currentTargetIdx++;
            closeModal();
            startRound();
        }
    }

    function showAbout() {
        $("fg-modal-icon").innerHTML = '<img src="arcade/img/icons/ui_temple.png?v=1" alt="" style="object-fit:contain;padding:10px;box-sizing:border-box">';
        $("fg-modal-name").textContent = "名人九宮格";
        $("fg-modal-title").textContent = "EduArena 社會科技術 Demo";
        $("fg-modal-era").textContent = "翻牌記憶遊戲";
        $("fg-modal-field").textContent = "9 位中外偉人";
        $("fg-modal-intro").textContent = "看提示、記位置、翻對卡——9 位影響世界的偉人在等你發現！";
        $("fg-modal-quote").textContent = "「歷史告訴我們：偉大來自於知識與堅持。」";
        $("fg-modal").classList.add("show");
        $("fg-controls").style.display = "none";
    }

    document.addEventListener("DOMContentLoaded", init);
})();
