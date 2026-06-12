/**
 * 👹 魔王戰 Phaser 版（Step 2 — 完整遊戲）
 * 純第一人稱，Phaser canvas 渲染全部 UI
 * 公開 API: window.bossIsland.{ start, refreshAllHubEntries }
 */
(function () {
    "use strict";
    const VERSION = "phaser-v2-step2-t47-progressbar";
    console.log("[BossPhaser]", VERSION);

    const $ = (id) => document.getElementById(id);
    // Codex P3：API 來源字串塞 innerHTML 前跳脫（boss_name 等目前是後端常數，防衛性處理）
    const escHtml = (t) => String(t == null ? "" : t).replace(/[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    // demo 適配：素材在 demo 後台（同 repo 部署），絕對路徑前掛 API host
    const ABS = (u) => (u && u.startsWith("/") ? (window.ARCADE_API || "") + u : u);

    const HUB_MODULES = {
        math: "mathIsland", chinese: "chineseIsland",
        english: "englishIsland", science: "scienceIsland", social: "socialIsland",
    };
    const TIER_LABEL = { 1: "T1", 2: "T2", 3: "T3" };

    // ── SFX 管理（5/11 派派要 boss 戰點擊/答對錯/魔王音效）────
    const SFX_LIST = ['correct', 'wrong', 'boss-hit', 'boss-attack', 'click'];
    const SFX_DEFAULT_VOLUME = {
        correct: 0.55, wrong: 0.5, 'boss-hit': 0.6, 'boss-attack': 0.55, click: 0.35,
    };
    const _sfxCache = {};   // name → Audio
    let _sfxUnlocked = false;

    function _ensureSfx(name) {
        if (!_sfxCache[name]) {
            const a = new Audio(ABS(`/static/audio/sfx/${name}.mp3?v=t48`));
            a.preload = 'auto';
            a.volume = SFX_DEFAULT_VOLUME[name] ?? 0.5;
            _sfxCache[name] = a;
        }
        return _sfxCache[name];
    }

    // 5/13 派派：魔王戰背景音樂（loop，音量小）
    let _battleBgm = null;
    function _ensureBattleBgm() {
        if (!_battleBgm) {
            _battleBgm = new Audio(ABS('/static/audio/battle_bgm.mp3?v=t1'));
            _battleBgm.loop = true;
            _battleBgm.volume = 0.18;     // 派派要求音量小聲
            _battleBgm.preload = 'auto';
        }
        return _battleBgm;
    }
    function playBattleBgm() {
        const a = _ensureBattleBgm();
        try { a.currentTime = 0; } catch (e) {}
        a.volume = 0.18;
        a.play().catch(() => {});
    }
    function stopBattleBgm() {
        if (_battleBgm) {
            try { _battleBgm.pause(); _battleBgm.currentTime = 0; } catch (e) {}
        }
    }

    // user gesture 解鎖路徑（被 click handler 同步呼叫）
    // Codex P2：每個 audio 獨立追蹤是否 unlock 成功，失敗的下次 playSfx 自動再試
    const _sfxLocked = {};  // name → true 表示還沒成功 unlock
    SFX_LIST.forEach(n => { _sfxLocked[n] = true; });

    function _attemptUnlock(name) {
        const a = _ensureSfx(name);
        const wasMuted = a.muted;
        a.muted = true;
        const p = a.play();
        const _done = (ok) => {
            try { a.pause(); a.currentTime = 0; } catch (e) {}
            a.muted = wasMuted;
            if (ok) _sfxLocked[name] = false;
        };
        if (p && p.then) p.then(() => _done(true)).catch(() => _done(false));
        else _done(true);
    }

    function unlockSfx() {
        if (_sfxUnlocked) return;
        SFX_LIST.forEach(_attemptUnlock);
        _sfxUnlocked = true;  // marker for 「已嘗試 unlock」，但 per-audio 狀態仍在 _sfxLocked
    }

    function playSfx(name) {
        const a = _ensureSfx(name);
        try { a.currentTime = 0; } catch (e) {}
        a.volume = SFX_DEFAULT_VOLUME[name] ?? 0.5;
        const p = a.play();
        if (p && p.then) {
            p.then(() => { _sfxLocked[name] = false; })
             .catch(() => {
                // 該 SFX 仍被鎖（可能 unlock 失敗）— 不噴錯，靜默忽略
             });
        }
    }

    // ── 5/21 派派 D 預先抓題：進魔王 hub 時背景預取 session，按下去 0 等待 ──
    // cache key: subject (per subject 一份)；session 後端 15min 過期，這邊 12min 提早 invalidate
    const _bossPrefetch = new Map();  // subject → {tier, data, fetchedAt}
    const _PREFETCH_TTL_MS = 12 * 60 * 1000;

    function prefetchBossSession(subject, tier) {
        const cached = _bossPrefetch.get(subject);
        if (cached && cached.tier === tier && Date.now() - cached.fetchedAt < _PREFETCH_TTL_MS) {
            return;  // 已預取過同 subject+tier 且還新鮮
        }
        window.eduApi("/api/boss/session/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject, tier }),
        }).then(r => r.json()).then(d => {
            if (!d.error) {
                _bossPrefetch.set(subject, { tier, data: d, fetchedAt: Date.now() });
                console.log("[BossPhaser] prefetched", subject, "t" + tier);
            }
        }).catch(() => { /* silent */ });
    }

    // ── Hub entry ──────────────────────────────────────────────
    async function renderHubEntry(entryEl) {
        const subject = entryEl.dataset.subject;
        entryEl.innerHTML = '<div class="boss-entry-loading">載入魔王資訊...</div>';
        try {
            const r = await window.eduApi(`/api/boss/status?subject=${encodeURIComponent(subject)}`);
            const d = await r.json();
            if (d.error) { entryEl.innerHTML = ""; return; }
            const tier = d.current_tier || 1;
            const idleSrc = d.sprites_v2?.idle || d.sprites?.idle || "";
            const spriteEl = idleSrc
                ? `<img class="boss-entry-sprite" src="${idleSrc}" alt="${d.boss_emoji}"
                       onerror="this.outerHTML='<div class=&quot;boss-entry-emoji&quot;>${d.boss_emoji}</div>'">`
                : `<div class="boss-entry-emoji">${d.boss_emoji}</div>`;
            // Proactive sprite preload — browser caches while user reads hub
            if (d.sprites_v2) {
                const sv2 = d.sprites_v2;
                ["idle", "hit", "attack", "death", "background"].forEach(k => {
                    if (sv2[k]) { const img = new Image(); img.src = sv2[k]; }
                });
            }

            if (d.unlocked) {
                // 派派 5/11 要：3 個 tier 自由選（已通關仍可重玩 T1/T2）
                // current_tier 推導：
                //   1 = 還沒通關任何 tier（可挑 T1）
                //   2 = 通過 T1（可挑 T1, T2）
                //   3 = 通過 T2（可挑 T1, T2, T3）
                const TIER_INFO = [
                    { n: 1, label: "簡單", color: "#22c55e" },
                    { n: 2, label: "中等", color: "#f59e0b" },
                    { n: 3, label: "困難", color: "#cf222e" },
                ];
                const tierBtns = TIER_INFO.map(t => {
                    const unlocked = t.n <= tier;
                    const beaten = t.n < tier;  // 比 current_tier 小表示通關過
                    const current = t.n === tier;
                    const cls = "boss-tier-btn" + (unlocked ? "" : " locked");
                    let badge = "";
                    if (beaten) badge = '<span class="boss-tier-tick">✓</span>';
                    else if (current) badge = '<span class="boss-tier-now">●</span>';
                    else badge = '<span class="boss-tier-lock"><img class="emo" src="/assets/images/icons/lock.png?s=6" alt=""></span>';
                    const sub = beaten ? "已通關" : (current ? (d.defeats > 0 ? "已通關" : "挑戰中") : `先通 T${t.n - 1}`);
                    return `<button class="${cls}" data-tier="${t.n}" ${unlocked ? "" : "disabled"}
                            style="--tier-color:${t.color}">
                            ${badge}
                            <span class="boss-tier-num">T${t.n}</span>
                            <span class="boss-tier-label">${t.label}</span>
                            <span class="boss-tier-sub">${sub}</span>
                        </button>`;
                }).join("");
                entryEl.innerHTML = `
                    <div class="boss-entry-btn unlocked" data-subject="${subject}">
                        ${spriteEl}
                        <div class="boss-entry-text">
                            <div class="boss-entry-title"><img class="emo" src="/assets/images/icons/boss.png?s=6" alt=""> ${d.boss_name}</div>
                            <div class="boss-entry-sub">選擇挑戰等級（已通關可重玩）</div>
                            <div class="boss-tier-group">${tierBtns}</div>
                        </div>
                    </div>`;
                entryEl.querySelectorAll(".boss-tier-btn:not(.locked)").forEach(btn => {
                    btn.addEventListener("click", () => {
                        const t = parseInt(btn.dataset.tier, 10);
                        start(subject, t);
                    });
                });
                // 5/21 派派 D：hub 顯示 500ms 後背景預取 current_tier session
                // 用 setTimeout 不擋 hub render；按下去就直接 reuse cached data
                setTimeout(() => prefetchBossSession(subject, tier), 500);
            } else {
                const remain = Math.max(0, d.topics_total - d.topics_played);
                entryEl.innerHTML = `
                    <div class="boss-entry-btn locked">
                        ${spriteEl.replace("boss-entry-sprite", "boss-entry-sprite locked-sprite")
                                  .replace("boss-entry-emoji", "boss-entry-emoji locked-emoji")}
                        <div class="boss-entry-text">
                            <div class="boss-entry-title"><img class="emo" src="/assets/images/icons/lock.png?s=6" alt=""> ${d.boss_name}</div>
                            <div class="boss-entry-sub">完成所有章節才能挑戰（還差 ${remain} 章）</div>
                        </div>
                    </div>`;
            }
        } catch (e) {
            console.error("[BossPhaser] status fetch failed", e);
            entryEl.innerHTML = "";
        }
    }

    function refreshAllHubEntries() {
        document.querySelectorAll(".boss-entry[data-subject]").forEach(el => renderHubEntry(el));
    }

    // ── HTML loading overlay ───────────────────────────────────
    function setLoadingText(t) {
        const txtEl = $("boss-phaser-loadtext");
        const overlay = $("boss-phaser-loading");
        if (txtEl) txtEl.textContent = t;
        if (overlay) { overlay.style.display = ""; overlay.classList.remove("hide"); }
    }
    function setLoadingProgress(pct) {
        const fill = $("boss-phaser-loadbar");
        const pctEl = $("boss-phaser-loadpct");
        const v = Math.max(0, Math.min(100, pct));
        if (fill) fill.style.width = `${v}%`;
        if (pctEl) pctEl.textContent = `${Math.floor(v)}%`;
    }
    function hideLoading() {
        const el = $("boss-phaser-loading");
        if (el) { el.classList.add("hide"); setTimeout(() => { el.style.display = "none"; }, 350); }
    }

    // P62 愛心素材（紅滿/灰空，Codex 同張圖生切片）
    const HEART_FULL = ABS("/assets/images/boss/v2/heart_full.png?v=1");
    const HEART_EMPTY = ABS("/assets/images/boss/v2/heart_empty.png?v=1");

    // ── HTML HUD overlay（題目/選項/HP/愛心都用 DOM 渲染，避免 Phaser canvas 文字模糊）──
    const HUD = {
        _onChoice: null,   // (idx) => void，由 BossFight 注入
        _onBack:   null,
        show() {
            const el = $("bh-overlay");
            if (el) el.classList.add("is-on");
            // 重置上場殘留的 damage float（不清會看到上場 -20%）
            const dmg = $("bh-damage");
            if (dmg) {
                dmg.classList.remove("show");
                dmg.textContent = "";
            }
        },
        hide() {
            const el = $("bh-overlay");
            if (el) el.classList.remove("is-on");
        },
        setTitle(name, tier) {
            const el = $("bh-title");
            const tStr = TIER_LABEL[tier] || "T1";
            if (el) el.textContent = `${name}・${tStr}`;
        },
        setProgress(cur, total) {
            const el = $("bh-progress");
            if (el) el.textContent = `${cur}/${total}`;
        },
        // P62：血量一律 10 顆愛心顯示，每顆＝總血量 10%，最後一顆按比例填色
        _heartsHTML(hp, maxHp) {
            const per = Math.max(1, maxHp) / 10;
            let html = "";
            for (let i = 0; i < 10; i++) {
                const fill = Math.max(0, Math.min(1, (hp - i * per) / per));
                html += '<span class="bh-heart">'
                    + `<img class="bh-heart-base" src="${HEART_EMPTY}" alt="">`
                    + (fill > 0
                        ? `<span class="bh-heart-clip" style="width:${Math.round(fill * 100)}%"><img class="bh-heart-fill" src="${HEART_FULL}" alt=""></span>`
                        : "")
                    + "</span>";
            }
            return html;
        },
        setEnemyHearts(hp, maxHp) {
            const wrap = $("bh-ehearts");
            if (wrap) wrap.innerHTML = this._heartsHTML(hp, maxHp);
            const label = $("bh-hp-label");
            if (label) label.textContent = `${Math.max(0, hp)}/${maxHp}`;
        },
        setPlayerHearts(hp, maxHp) {
            const wrap = $("bh-hearts");
            if (wrap) wrap.innerHTML = this._heartsHTML(hp, maxHp);
            const label = $("bh-php-label");
            if (label) label.textContent = `${Math.max(0, hp)}/${maxHp}`;
        },
        // 連對倍率（P62）：×1 隱藏、×2/×3 顯示
        setCombo(mult) {
            const el = $("bh-combo");
            if (!el) return;
            if (mult > 1) {
                el.textContent = `連擊 ×${mult}`;
                el.style.display = "";
                el.classList.toggle("x3", mult >= 3);
            } else {
                el.style.display = "none";
            }
        },
        // 5/21 派派 v6：smart-break + anti-orphan 已搬到 bopomofo.js window.applyBopomofoSmart 共用
        // 5/20 派派：G1/G2 注音題 — 加 bopomofoMap 參數，有 dict 就用 applyBopomofo 套 ruby
        setQuestion(display, prompt, bopomofoMap) {
            const dEl = $("bh-display");
            const pEl = $("bh-prompt");
            if (dEl) {
                if (bopomofoMap && window.applyBopomofo) {
                    dEl.innerHTML = window.applyBopomofoSmart(display || "", bopomofoMap);
                } else {
                    // 5/21 派派 v6.4：非 bopo 也走 smart helper（null map → 只插 wbr + nowrap atom 防孤兒）
                    dEl.innerHTML = window.applyBopomofoSmart(display || "", null);
                }
                const len = (display || "").length + (prompt || "").length;
                dEl.classList.remove("fs-sm", "fs-xs");
                // 5/21 派派：bopo 模式禁止自動縮字 — 注音字本來就小，題目主字再縮會看不清
                // 改用 .bh-card.bopo max-height + overflow-y: auto 內捲動處理長題目
                if (!bopomofoMap) {
                    if (len > 55) dEl.classList.add("fs-xs");
                    else if (len > 38) dEl.classList.add("fs-sm");
                }
                dEl.classList.toggle("bopo", !!bopomofoMap);
                // 把 .bopo 也加到 .bh-card 父層 → CSS top-align + 避免 ruby 過長被 center 推到 clip
                if (dEl.parentElement) dEl.parentElement.classList.toggle("bopo", !!bopomofoMap);
            }
            if (pEl) {
                if (bopomofoMap && window.applyBopomofo) {
                    pEl.innerHTML = window.applyBopomofoSmart(prompt || "", bopomofoMap);
                } else {
                    pEl.innerHTML = window.applyBopomofoSmart(prompt || "", null);
                }
                pEl.classList.toggle("bopo", !!bopomofoMap);
            }
        },
        setChoices(choices, bopomofoMap) {
            const btns = document.querySelectorAll("#bh-choices .bh-choice");
            // 5/20 派派：注音題選項 1 欄大按鈕 — toggle .bopo class on parent grid
            const grid = document.getElementById("bh-choices");
            if (grid) grid.classList.toggle("bopo", !!bopomofoMap);
            btns.forEach((b, i) => {
                const raw = String(choices[i] || "");
                // dataset.choice 存純值供 styleChoiceByText 比對（textContent 套 ruby 後會含注音 string）
                b.dataset.choice = raw;
                if (bopomofoMap && window.applyBopomofo) {
                    b.innerHTML = window.applyBopomofoSmart(raw, bopomofoMap);
                } else {
                    b.innerHTML = window.applyBopomofoSmart(raw, null);
                }
                b.disabled = false;
                b.className = "bh-choice";
            });
        },
        styleChoice(idx, style) {
            const btn = document.querySelector(`#bh-choices .bh-choice[data-idx="${idx}"]`);
            if (!btn) return;
            btn.classList.remove("is-correct", "is-wrong");
            if (style === "correct") btn.classList.add("is-correct");
            else if (style === "wrong") btn.classList.add("is-wrong");
        },
        styleChoiceByText(text, style) {
            // 用 dataset.choice 比對純值（避免 textContent 含 ruby 注音）；fallback textContent
            document.querySelectorAll("#bh-choices .bh-choice").forEach(btn => {
                const raw = btn.dataset.choice ?? btn.textContent;
                if (raw === text) {
                    btn.classList.remove("is-wrong");
                    if (style === "correct") btn.classList.add("is-correct");
                }
            });
        },
        lockChoices() {
            document.querySelectorAll("#bh-choices .bh-choice").forEach(b => { b.disabled = true; });
        },
        showDamage(dmg, mult) {
            const el = $("bh-damage");
            if (!el) return;
            el.textContent = `-${dmg}` + (mult > 1 ? ` ×${mult}` : "");
            el.classList.remove("show");
            void el.offsetWidth;  // restart animation
            el.classList.add("show");
        },
        bind(onChoice, onBack) {
            this._onChoice = onChoice;
            this._onBack = onBack;
            // Idempotent — 用 dataset flag 避免 scene 重啟時累積 listener
            document.querySelectorAll("#bh-choices .bh-choice").forEach(btn => {
                if (!btn.dataset.bound) {
                    btn.addEventListener("click", (e) => {
                        const idx = parseInt(e.currentTarget.dataset.idx, 10);
                        if (HUD._onChoice && !e.currentTarget.disabled) {
                            playSfx('click');
                            HUD._onChoice(idx);
                        }
                    });
                    btn.dataset.bound = "1";
                }
            });
            const back = $("bh-back");
            if (back && !back.dataset.bound) {
                back.addEventListener("click", () => { if (HUD._onBack) HUD._onBack(); });
                back.dataset.bound = "1";
            }
        },
    };

    // ── Phaser game ────────────────────────────────────────────
    let game = null;
    let _currentSession = null;
    let _currentSubject = null;
    let _BootScene = null;
    let BossPreloadScene = null;
    let BossFightScene = null;
    let _failedSprites = [];  // {key, url} — debug: 收集失敗 sprite 給派派看具體哪張壞

    function defineScenes() {
        if (BossPreloadScene) return;

        // Dummy first scene so Phaser auto-starts _Boot (no-op) instead of
        // BossPreload. Without this, Phaser boots BossPreload immediately on
        // game creation (before _currentSession exists), causing a corrupt
        // or black-screen on the real start.
        _BootScene = class extends Phaser.Scene {
            constructor() { super("_Boot"); }
        };

        BossPreloadScene = class extends Phaser.Scene {
            constructor() { super("BossPreload"); }
            init(data) {
                this.session = data || null;
                _failedSprites = [];
                // 清掉上一場的 listener，避免累積（progress 用 on，會跨場累積）
                this.load.off("progress");
                this.load.off("loaderror");
                this.load.off("complete");
            }
            preload() {
                // Guard: parallel ensureGame() auto-starts this scene with no data
                if (!this.session?.sprites) return;

                const s = this.session.sprites;
                const sub = this.session.subject;
                const t = this.session.tier || 1;
                // Keys include tier so T2/T3 sprites don't reuse T1 cached textures
                // 開場只 load idle + heart（必需）。
                // bg 不在 preload 載 — 從 _buildBg 動態抓，失敗只走 placeholder rectangle（不擋戰鬥開始）
                // codex P2 修：preload 任何 loaderror 算 fatal，bg 缺失會卡住，所以 bg 不放這
                // hit/attack/death 等第一次需要播動畫時 lazy load（_ensureSprite）。
                if (!this.textures.exists(`${sub}-t${t}-idle`))   this.load.image(`${sub}-t${t}-idle`,   s.idle);
                if (!this.textures.exists("heart-icon"))    this.load.image("heart-icon", ABS("/assets/images/icons/heart.png"));

                // 進度條對應到整體 55-100% 範圍（前 55% 是 API + 引擎初始化）
                // 用 'on' 不是 'once'，progress 事件會多次觸發
                this.load.on("progress", (p) => {
                    setLoadingText("載入魔王...");
                    setLoadingProgress(55 + p * 45);
                });
                // debug: 用 on（不是 once）抓所有失敗 sprite + 連 URL 一起記
                this.load.on("loaderror", (file) => {
                    _failedSprites.push({
                        key: file?.key || "?",
                        url: file?.url || file?.src || "?",
                    });
                });
                this.load.once("complete", () => {
                    if (!this.session?.sprites) return; // extra guard
                    if (_failedSprites.length > 0) {
                        // debug 模式：把每張失敗的 key + URL 都顯示在 loading overlay，不 hideLoading 也不 start BossFight，
                        // 派派截圖才看得到具體哪張壞、是哪個 URL。修完拿掉。
                        const msg = _failedSprites
                            .map(f => `${f.key}\n  ${f.url}`)
                            .join("\n\n");
                        console.error("[BossPhaser] sprite load failed:", _failedSprites);
                        setLoadingText(`⚠ ${_failedSprites.length} 張圖載失敗：\n\n${msg}`);
                        return;
                    }
                    console.log("[BossPhaser] preload complete, starting BossFight", this.session.subject, "t" + (this.session.tier || 1));
                    hideLoading();
                    this.scene.start("BossFight", this.session);
                });
            }
        };

        BossFightScene = class extends Phaser.Scene {
            constructor() { super("BossFight"); }

            init(data) {
                this.sessionId   = data.sessionId;
                this.subject     = data.subject;
                this.bossName    = data.bossName;
                this.bossEmoji   = data.bossEmoji;
                this.tier        = data.tier || 1;
                this.sprites     = data.sprites;
                this.questions   = data.questions;
                this.playerHp     = data.playerHp;
                this.playerMaxHp  = data.playerMaxHp;
                this.enemyHp      = data.enemyHp;
                this.enemyMaxHp   = data.enemyMaxHp;
                this.currentIdx  = 0;
                this.answering   = false;
                this._currentQ   = null;
                this._idleTween  = null;
                this._endCalled  = false;
            }

            create() {
                let _step = "init-layout";
                try {
                    const W = this.scale.width;
                    const H = this.scale.height;
                    this._W = W; this._H = H;

                    // Layout constants（與 HTML overlay 對齊）
                    // 5/21 派派：G1/G2 注音題卡會被撐到 ~480px 蓋住魔王下半身。
                    // 偵測整局年級（boss.py 限定整局同 grade），<=2 切「注音版面」：
                    //   QUIZ_H 拉到 460 → bossArea 縮，但 _fitBoss 乘 0.92（原 0.82）→ 魔王視覺只縮 ~10%，頭+腳完整。
                    const _firstQ = this.questions && this.questions[0];
                    const _sessGrade = Number(_firstQ?.grade || _firstQ?.content_json?.grade || 0);
                    this._BOPO_MODE = _sessGrade >= 1 && _sessGrade <= 2;
                    this._TOPBAR_H  = 52;
                    this._HP_H      = 18;
                    // 5/21 派派回報小螢幕 card 被 flex shrink 壓扁。bopo 加 380 下限 + 500 上限
                    // → 小手機(H≈520)QUIZ_H 至少 380；大手機 cap 500 防 boss 變太小
                    this._QUIZ_H    = this._BOPO_MODE
                        ? Math.max(Math.min(Math.round(H * 0.62), 500), 380)
                        : Math.min(Math.round(H * 0.52), 370);
                    this._BOSS_FIT_MULT = this._BOPO_MODE ? 0.95 : 0.82;
                    this._BOSS_TOP  = this._TOPBAR_H + this._HP_H + 8;
                    this._BOSS_BOT  = H - this._QUIZ_H - 4;
                    // 把 _QUIZ_H 同步到 .bh-quiz max-height — 超長注音題就會在 panel 內 scroll，
                    // 不會視覺上溢出蓋住 boss 下半身（CSS max-height:100% 沒有實質約束）。
                    const _quizEl = document.querySelector("#bh-overlay .bh-quiz");
                    if (_quizEl) _quizEl.style.maxHeight = this._QUIZ_H + "px";

                    _step = "buildBg";       this._buildBg();
                    _step = "buildBoss";     this._buildBoss();
                    _step = "buildMist";     this._buildMist();
                    _step = "buildVignette"; this._buildVignette();
                    _step = "hud-init";
                    HUD.show();
                    HUD.bind(
                        (idx) => {
                            if (!this.answering && this._currentQ) {
                                const txt = this._currentQ.choices?.[idx] || "";
                                this._submitAnswer(this._currentQ.id, txt, idx);
                            }
                        },
                        () => this._confirmBack(),
                    );
                    HUD.setTitle(this.bossName, this.tier);
                    HUD.setEnemyHearts(this.enemyHp, this.enemyMaxHp);
                    HUD.setPlayerHearts(this.playerHp, this.playerMaxHp);
                    HUD.setCombo(1);

                    // 場景關閉時隱藏 overlay
                    this.events.once("shutdown", () => { HUD.hide(); });
                    this.events.once("destroy",  () => { HUD.hide(); });

                    _step = "showQuestion";  this._showQuestion();
                } catch (e) {
                    const msg = `❌ create/${_step}: ${e?.message || e}`;
                    console.error("[BossPhaser]", msg, e);
                    setLoadingText(msg);
                }
            }

            _buildBg() {
                const W = this._W, H = this._H, sub = this.subject;
                const t = this.tier || 1;
                const key = `${sub}-t${t}-bg`;
                this._bgPlaceholder = this.add.rectangle(W / 2, H / 2, W, H, 0x1a0a2e).setDepth(0);
                if (this.textures.exists(key)) {
                    this._mountBg(key);
                    return;
                }
                // 後端 sprites.background 若為空（fs.exists 判斷異常），用 hardcoded path 兜底
                const url = this.sprites?.background || `/assets/images/boss/v2/${sub}/t${t}/bg.png`;
                this.load.image(key, url);
                this.load.once(`filecomplete-image-${key}`, () => this._mountBg(key));
                this.load.start();
            }

            _mountBg(key) {
                if (!this.textures.exists(key) || !this.scene?.isActive()) return;
                const W = this._W, H = this._H;
                if (this._bgPlaceholder) { this._bgPlaceholder.destroy(); this._bgPlaceholder = null; }
                const bg = this.add.image(W / 2, H / 2, key);
                const s = Math.max(W / bg.width, H / bg.height);
                bg.setScale(s).setDepth(0);
            }

            _buildBoss() {
                const W = this._W;
                const bossAreaH = this._BOSS_BOT - this._BOSS_TOP;
                const bossY = this._BOSS_TOP + bossAreaH * 0.55;
                const sub = this.subject;
                const t = this.tier || 1;
                const idleKey = `${sub}-t${t}-idle`;
                const key = this.textures.exists(idleKey) ? idleKey : "__DEFAULT";

                this._boss = this.add.image(W / 2, bossY, key)
                    .setOrigin(0.5).setDepth(10);

                if (key !== "__DEFAULT") {
                    this._fitBoss();
                } else if (this.sprites?.idle) {
                    // BossPreload 沒載到 → BossFight 自救動態抓圖
                    this.load.image(idleKey, this.sprites.idle);
                    this.load.once(`filecomplete-image-${idleKey}`, () => {
                        if (!this.textures.exists(idleKey) || !this._boss || !this.scene?.isActive()) return;
                        this._boss.setTexture(idleKey);
                        this._fitBoss();
                        this._startIdleTween();
                    });
                    this.load.start();
                }

                this._startIdleTween();

                // Periodic roar pulse every 4.6s
                this.time.addEvent({
                    delay: 4600, loop: true,
                    callback: () => {
                        if (!this._boss || this.answering) return;
                        this.tweens.add({
                            targets: this._boss,
                            scaleX: this._boss.scaleX * 1.035,
                            scaleY: this._boss.scaleY * 1.035,
                            duration: 160, yoyo: true, ease: "Quad.easeIn",
                        });
                    },
                });
            }

            _fitBoss() {
                if (!this._boss) return;
                const bossAreaH = this._BOSS_BOT - this._BOSS_TOP;
                const maxH = bossAreaH * (this._BOSS_FIT_MULT || 0.82);
                const maxW = this._W * 0.72;
                const sc = Math.min(maxH / this._boss.height, maxW / this._boss.width);
                this._boss.setScale(sc);
            }

            _startIdleTween() {
                if (this._idleTween) { this._idleTween.stop(); }
                this._idleTween = this.tweens.add({
                    targets: this._boss,
                    scaleY: this._boss.scaleY * 1.025,
                    duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
                });
            }

            _buildVignette() {
                // 紅色 vignette overlay（答錯閃光）— 留 Phaser canvas 因為跟 boss 動畫同層
                const W = this._W, H = this._H;
                this._vignette = this.add.graphics().setDepth(80).setAlpha(0);
                this._vignette.fillStyle(0xff0000, 0.30);
                this._vignette.fillRect(0, 0, W, H);
            }

            _buildMist() {
                // 派派 5/11 要：魔王旁邊白色乾冰/煙霧飄動（參考 boss_fight_ref.mp4 冰魔王）
                // 即時用 Phaser graphics 生成 mist texture（不用外部 PNG，減少 load）
                if (!this.textures.exists('boss-mist')) {
                    const g = this.add.graphics({ x: 0, y: 0 });
                    g.fillStyle(0xffffff, 1);
                    g.fillCircle(48, 48, 48);
                    g.generateTexture('boss-mist', 96, 96);
                    g.destroy();
                }
                if (!this._boss) return;
                const bossX = this._boss.x;
                const bossBottom = this._boss.y + this._boss.displayHeight * 0.42;
                const halfW = this._boss.displayWidth * 0.55;
                this._mist = this.add.particles(bossX, bossBottom, 'boss-mist', {
                    quantity: 1,
                    frequency: 380,
                    lifespan: 4200,
                    x: { min: -halfW, max: halfW },
                    y: { min: 0, max: 18 },
                    speedY: { min: -28, max: -10 },
                    speedX: { min: -16, max: 16 },
                    scale: { start: 0.35, end: 1.4 },
                    alpha: { start: 0.5, end: 0 },
                    rotate: { min: 0, max: 360 },
                    tint: 0xddffff,
                    blendMode: 'NORMAL',
                });
                if (this._mist && this._mist.setDepth) this._mist.setDepth(9);  // boss 是 10，霧在 boss 後
            }

            // ── Show question ──────────────────────────────────
            _showQuestion() {
                if (this.currentIdx >= this.questions.length) { this._endGame(); return; }
                const q = this.questions[this.currentIdx];
                this._currentQ = q;

                const norm = window.normalizeQuestion ? window.normalizeQuestion(q)
                    : { display: q.display || "", prompt: q.prompt || "" };

                // 5/21 派派 v6 智慧 gate：answer 含注音字=直接查找題(洩答)→ skip
                // 概念題（ㄓvsㄗ、部首、筆畫）answer 是文字 → 安全開放
                const bopo = q.bopomofo || (q.content_json && q.content_json.bopomofo);
                const _qg = Number(q.grade || (q.content_json && q.content_json.grade) || 0);
                const _ansHasBopo = /[ㄅ-ㄯㆠ-ㆿ]/.test(String(q.answer || ""));
                const useBopo = !!bopo && !!window.applyBopomofoSmart
                    && _qg >= 1 && _qg <= 2 && !_ansHasBopo;

                HUD.setQuestion(norm.display, norm.prompt, useBopo ? bopo : null);
                HUD.setChoices(q.choices || [], useBopo ? bopo : null);
                HUD.setProgress(this.currentIdx + 1, this.questions.length);

                this.answering = false;
            }

            // P62：取消每題限時 — 計時器整段移除
            // ── Submit answer ──────────────────────────────────
            async _submitAnswer(qid, answer, choiceIdx) {
                if (this.answering) return;
                this.answering = true;
                HUD.lockChoices();

                let d;
                try {
                    const r = await window.eduApi("/api/boss/session/answer", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            session_id: this.sessionId,
                            question_id: qid,
                            answer: String(answer),
                        }),
                    });
                    d = await r.json();
                } catch (e) {
                    console.error("[BossPhaser] answer fetch failed", e);
                    // 還原可點選（P62 無計時）
                    this.answering = false;
                    HUD.setChoices(this._currentQ?.choices || []);
                    return;
                }

                if (d.error) {
                    if (d.error === "invalid_session" || d.error === "session_not_found") {
                        this.sessionId = null;
                        if (window.__bossExit) window.__bossExit();
                        return;
                    }
                    this._endGame();
                    return;
                }

                // 動畫拋例外不能擋下一題流程（lazy sprite load 偶發 race 等都不該卡答題）
                try {
                    if (d.correct) {
                        playSfx('correct'); playSfx('boss-hit');
                        if (choiceIdx >= 0) HUD.styleChoice(choiceIdx, "correct");
                        this._updateEnemyHp(d.enemy_hp);
                        this._showDamageFloat(d.damage, d.combo_mult);
                        this._playBossHit(d.enemy_hp === 0);
                    } else {
                        playSfx('wrong'); playSfx('boss-attack');
                        if (choiceIdx >= 0) HUD.styleChoice(choiceIdx, "wrong");
                        HUD.styleChoiceByText(d.correct_answer, "correct");
                        this._updatePlayerHp(d.player_hp);
                        this._playBossAttack();
                        this._flashVignette();
                    }
                    HUD.setCombo(d.next_combo_mult || 1);
                } catch (e) {
                    console.error("[BossPhaser] anim error", e);
                }

                if (d.energy !== undefined && window.eduApp?.syncUserStats) {
                    window.eduApp.syncUserStats({ energy: d.energy });
                }

                if (d.done) {
                    const delay = d.correct && d.enemy_hp === 0 ? 1400 : 400;
                    this.time.delayedCall(delay, () => this._endGame());
                    // Safety belt
                    this.time.delayedCall(5000, () => { if (!this._endCalled) this._endGame(); });
                    return;
                }

                const nextDelay = d.correct ? 900 : 1500;
                this.time.delayedCall(nextDelay, () => {
                    this.currentIdx++;
                    this._showQuestion();
                });
            }

            // 動態 sprite load — hit/attack/death 第一次用到才下載
            // 已 cached → 立即 callback；否則 load + on complete callback
            // 整段包 try/catch：loader 處於非預期 state 時 throw 不能擾亂答題 flow
            _ensureSprite(key, url, cb) {
                try {
                    if (this.textures.exists(key)) { cb(true); return; }
                    if (!url) { cb(false); return; }
                    this.load.image(key, url);
                    this.load.once(`filecomplete-image-${key}`, () => { try { cb(true); } catch (e) { console.error("[BossPhaser] sprite cb err", e); } });
                    this.load.once(`loaderror`, (file) => {
                        if (file?.key === key) { try { cb(false); } catch (e) { console.error("[BossPhaser] sprite cb err", e); } }
                    });
                    this.load.start();
                } catch (e) {
                    console.error("[BossPhaser] _ensureSprite error", key, e);
                    try { cb(false); } catch (_) {}
                }
            }

            // ── Animations ────────────────────────────────────
            // codex P2 防 race：lazy sprite load 比動畫慢時，late callback 不能把
            // 已切回 idle 的 boss 又蓋成 hit/attack。用 _desiredTex 標記當前期望姿勢，
            // callback 必須比對才 setTexture。
            _setBossTex(key) {
                if (this._boss?.scene && this.textures.exists(key)) {
                    this._boss.setTexture(key);
                }
            }
            _playBossHit(isDead) {
                const sub = this.subject;
                const t = this.tier || 1;
                if (this._idleTween) this._idleTween.stop();
                const hitKey = `${sub}-t${t}-hit`;
                this._desiredTex = hitKey;

                this.cameras.main.shake(200, 0.006);
                this.tweens.add({ targets: this._boss, alpha: 0.5, duration: 80, yoyo: true });

                this._ensureSprite(hitKey, this.sprites?.hit, (ok) => {
                    if (ok && this._desiredTex === hitKey) this._setBossTex(hitKey);
                });

                this.time.delayedCall(440, () => {
                    if (!this._boss || !this._boss.scene) return;
                    if (isDead) {
                        const deathKey = `${sub}-t${t}-death`;
                        this._desiredTex = deathKey;
                        this._ensureSprite(deathKey, this.sprites?.death, (ok) => {
                            if (ok && this._desiredTex === deathKey) this._setBossTex(deathKey);
                        });
                        this.tweens.add({
                            targets: this._boss,
                            y: this._boss.y + 40,
                            alpha: 0.6,
                            duration: 700,
                        });
                    } else {
                        const idleKey = `${sub}-t${t}-idle`;
                        this._desiredTex = idleKey;
                        this._setBossTex(idleKey);
                        this._startIdleTween();
                    }
                });
            }

            _playBossAttack() {
                const sub = this.subject;
                const t = this.tier || 1;
                if (this._idleTween) this._idleTween.stop();
                const atkKey = `${sub}-t${t}-attack`;
                this._desiredTex = atkKey;

                this._ensureSprite(atkKey, this.sprites?.attack, (ok) => {
                    if (ok && this._desiredTex === atkKey) this._setBossTex(atkKey);
                });

                const origSX = this._boss.scaleX;
                const origSY = this._boss.scaleY;
                this.tweens.add({
                    targets: this._boss,
                    scaleX: origSX * 1.07,
                    scaleY: origSY * 1.07,
                    duration: 200, yoyo: true,
                });

                this.time.delayedCall(520, () => {
                    if (!this._boss || !this._boss.scene) return;
                    const idleKey = `${sub}-t${t}-idle`;
                    this._desiredTex = idleKey;
                    this._setBossTex(idleKey);
                    this._startIdleTween();
                });
            }

            _flashVignette() {
                this._vignette.setAlpha(1);
                this.tweens.add({ targets: this._vignette, alpha: 0, duration: 520 });
            }

            _showDamageFloat(dmg, mult) {
                if (dmg == null) return;
                HUD.showDamage(dmg, mult || 1);
            }

            _updateEnemyHp(newHp) {
                if (newHp == null) return;
                this.enemyHp = newHp;
                HUD.setEnemyHearts(newHp, this.enemyMaxHp);
            }

            _updatePlayerHp(newHp) {
                if (newHp == null) return;
                this.playerHp = newHp;
                HUD.setPlayerHearts(newHp, this.playerMaxHp);
            }

            // ── End game ───────────────────────────────────────
            async _endGame() {
                if (this._endCalled) return;
                this._endCalled = true;
                HUD.hide();
                const sid = this.sessionId;
                this.sessionId = null;

                if (!sid) { window.eduApp.showScreen("boss-result"); return; }

                let d, lastErr;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const r = await window.eduApi("/api/boss/session/end", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ session_id: sid }),
                        });
                        d = await r.json();
                        lastErr = null;
                        break;
                    } catch (e) {
                        lastErr = e;
                        await new Promise(rs => setTimeout(rs, 600 + attempt * 400));
                    }
                }

                if (lastErr || !d || d.error) {
                    _populateFallbackResult(this.subject, this.enemyHp, this.playerHp, this.bossName, this.sprites);
                } else {
                    _populateResult(d, this.subject);
                }
                window.eduApp.showScreen("boss-result");
            }

            async _confirmBack() {
                const sid = this.sessionId;
                if (!sid) {
                    HUD.hide();
                    const mod = window[HUB_MODULES[this.subject]];
                    if (mod?.open) mod.open();
                    else window.eduApp.showScreen(`${this.subject}-hub`);
                    return;
                }
                const ok = await window.eduApp.confirm("確定要放棄這場戰鬥嗎？");
                if (ok) {
                    this._endGame();
                }
            }
        };
    }

    // ── Result screen (HTML) ───────────────────────────────────
    function _populateResult(d, subject) {
        const sprite = $("boss-sprite-end");
        if (sprite && sprite.tagName === "IMG") {
            const v2 = d.sprites_v2 || {};
            const v1 = d.sprites   || {};
            sprite.src = ABS(d.victory
                ? (v2.death    || v1.defeated || "")
                : (v2.idle     || v1.idle     || ""));
        }
        const title = $("boss-result-title");
        const sub   = $("boss-result-sub");
        const coins = $("boss-result-coins");
        const bonus = $("boss-result-bonus");
        const _php = d.player_hp_remaining;
        const _pmax = d.player_max_hp;
        const _m = d.mastery;
        const _mTxt = _m ? `　精通 +${_m.gained}` + (_m.leveled ? `（LV ${_m.lv}！）` : "") : "";
        if (d.victory) {
            if (title) title.innerHTML = '<img class=\"emo\" src=\"' + ABS('/assets/images/icons/celebrate.png?s=6') + '\" alt=\"\"> 擊敗' + escHtml(d.boss_name) + '！';
            if (sub)   sub.textContent = (_php != null && _pmax ? `剩餘血量 ${_php}/${_pmax}` : `剩餘 ${d.hearts_remaining} 顆愛心`) + _mTxt;
        } else {
            if (title) title.innerHTML = '<img class=\"emo\" src=\"' + ABS('/assets/images/icons/skull.png?s=6') + '\" alt=\"\"> 挑戰失敗';
            if (sub)   sub.textContent = (_php === 0) ? "血量歸零了～" : "下次加油！";
        }
        if (coins) coins.innerHTML = '<img class=\"emo\" src=\"' + ABS('/assets/images/icons/coin.png?s=6') + '\" alt=\"\"> +' + d.coins_earned;
        if (bonus) {
            if (d.victory && d.first_defeat) {
                bonus.innerHTML = '<img class=\"emo\" src=\"' + ABS('/assets/images/icons/trophy.png?s=6') + '\" alt=\"\"> 首殺額外獎勵 +200';
                bonus.style.display = "";
            } else {
                bonus.style.display = "none";
            }
        }
        if (window.eduApp?.syncUserStats) window.eduApp.syncUserStats({ coins: d.total_coins, energy: d.energy });
    }

    function _populateFallbackResult(subject, enemyHp, playerHp, bossName, sprites) {
        const victory = enemyHp === 0 && playerHp > 0;
        const sprite = $("boss-sprite-end");
        if (sprite && sprite.tagName === "IMG") {
            sprite.src = victory ? (sprites.death || sprites.idle || "") : (sprites.idle || "");
        }
        const title = $("boss-result-title");
        const sub   = $("boss-result-sub");
        const coins = $("boss-result-coins");
        if (title) title.innerHTML = victory
            ? '<img class=\"emo\" src=\"' + ABS('/assets/images/icons/celebrate.png?s=6') + '\" alt=\"\"> 擊敗' + escHtml(bossName) + '！'
            : '<img class=\"emo\" src=\"' + ABS('/assets/images/icons/skull.png?s=6') + '\" alt=\"\"> 挑戰失敗';
        if (sub) sub.textContent = victory ? "下次進入自動補發獎勵" : (playerHp === 0 ? "血量歸零了～" : "下次加油！");
        if (coins) coins.innerHTML = '<img class=\"emo\" src=\"' + ABS('/assets/images/icons/coin.png?s=6') + '\" alt=\"\"> 下次自動補發';
        const bonus = $("boss-result-bonus");
        if (bonus) bonus.style.display = "none";
    }

    // ── Phaser instance ────────────────────────────────────────
    function ensureGame() {
        if (game) return game;
        if (typeof Phaser === "undefined") {
            setLoadingText("❌ Phaser 引擎沒載到，請重新進入");
            return null;
        }
        defineScenes();
        game = new Phaser.Game({
            type: Phaser.AUTO,
            parent: "boss-phaser-root",
            backgroundColor: "#1a0a2e",
            resolution: window.devicePixelRatio || 1,
            scale: {
                mode: Phaser.Scale.RESIZE,
                autoCenter: Phaser.Scale.CENTER_BOTH,
                width: "100%",
                height: "100%",
            },
            fps: { target: 30, forceSetTimeOut: false },
            render: { pixelArt: false, antialias: true, powerPreference: "low-power" },
            dom: { createContainer: false },
            scene: [_BootScene, BossPreloadScene, BossFightScene],
        });
        console.log("[BossPhaser] game created");
        return game;
    }

    // ── Start fight ────────────────────────────────────────────
    async function start(subject, tier) {
        // Codex P1：unlockSfx 必須在 user gesture 同步路徑跑（這函式被 click handler 直接 invoke），
        // 否則 await/raf 後 play() 會被 iOS Safari 擋 NotAllowedError。
        unlockSfx();
        // 5/13 派派：開始魔王戰播 battle BGM（user gesture 同步路徑）
        playBattleBgm();
        // 派派回報「連續做兩次就會這樣（黑屏）」— Phaser game 重用導致 scene/texture state race，
        // 每場 destroy 重建避免污染（destroy 開銷 ~200ms，可接受）
        if (game) {
            try { game.destroy(true); } catch (e) { console.warn("[BossPhaser] destroy err:", e); }
            game = null;
        }
        _currentSubject = subject;
        document.body.classList.add("phaser-mode");
        window.eduApp.showScreen("boss-game");
        setLoadingText("連線中...");
        setLoadingProgress(5);

        // Pre-warm Phaser engine in parallel with the API call (~300ms saved)
        requestAnimationFrame(() => {
            const root = $("boss-phaser-root");
            if (root && root.offsetWidth > 0 && typeof Phaser !== "undefined") ensureGame();
        });

        let d;
        // 5/21 派派 D：先檢查 prefetch cache — 進 hub 時已預取對應 session
        // 命中就跳過 API call，按下去直接到 35% (省 ~300ms~1s)
        const _cached = _bossPrefetch.get(subject);
        if (_cached && _cached.tier === (tier || 1) && Date.now() - _cached.fetchedAt < _PREFETCH_TTL_MS) {
            d = _cached.data;
            _bossPrefetch.delete(subject);  // 用過就丟（每場 session_id 只能用一次）
            console.log("[BossPhaser] using prefetched session");
            setLoadingProgress(35);
        } else {
            try {
                setLoadingText("載入題目中...");
                setLoadingProgress(15);
                const r = await window.eduApi("/api/boss/session/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ subject, tier: tier || 1 }),
                });
                d = await r.json();
                setLoadingProgress(35);
            } catch (e) {
                setLoadingText("❌ 網路異常，請重試");
                stopBattleBgm();   // codex P2：abort 也要停 BGM
                return;
            }
        }

        // demo 加固：身分失效時後端回 {detail} 而非 {error}；缺 session_id 一律當失敗，
        // 否則 sprites 全 undefined 會讓 Phaser 載入器丟 this.src.indexOf 錯
        if (d.error || d.detail || !d.session_id) {
            setLoadingText("❌ " + (d.message || d.error || d.detail || "連線失敗，請重新整理"));
            stopBattleBgm();   // codex P2：abort 也要停 BGM
            return;
        }

        const v2 = d.sprites_v2 || {};
        const leg = d.sprites   || {};
        _currentSession = {
            sessionId:  d.session_id,
            subject,
            bossName:   d.boss_name,
            bossEmoji:  d.boss_emoji,
            tier:       d.tier || tier || 1,
            playerHp:    d.player_hp ?? 100,
            playerMaxHp: d.player_max_hp ?? d.player_hp ?? 100,
            enemyHp:     d.enemy_hp ?? d.boss_hp ?? 100,
            enemyMaxHp:  d.enemy_max_hp ?? d.enemy_hp ?? d.boss_hp ?? 100,
            questions:  d.questions,
            sprites: {
                idle:       ABS(v2.idle       || leg.idle     || ""),
                hit:        ABS(v2.hit        || leg.hurt     || ""),
                attack:     ABS(v2.attack     || leg.hurt     || ""),
                death:      ABS(v2.death      || leg.defeated || ""),
                background: ABS(v2.background || ""),
            },
        };

        setLoadingText("初始化引擎...");
        setLoadingProgress(45);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const root = $("boss-phaser-root");
                if (!root || root.offsetWidth === 0 || root.offsetHeight === 0) {
                    setLoadingText("❌ 畫面尺寸異常，請重試");
                    return;
                }
                const g = ensureGame();
                if (!g) return;
                if (g.scene.getScene("BossFight"))   g.scene.stop("BossFight");
                if (g.scene.getScene("BossPreload")) g.scene.stop("BossPreload");
                setLoadingProgress(55);
                g.scene.start("BossPreload", _currentSession);
            });
        });
    }

    // ── Wire up result back button ─────────────────────────────
    function _initResultBack() {
        const btn = $("boss-result-back");
        if (!btn) return;
        btn.addEventListener("click", () => {
            if (window.__bossExit) window.__bossExit();
        });
    }

    // ── Public API ─────────────────────────────────────────────
    window.bossIsland = { start, refreshAllHubEntries };

    // Hook showScreen to refresh hub entries on hub switch
    if (window.eduApp && window.eduApp.showScreen) {
        const _orig = window.eduApp.showScreen.bind(window.eduApp);
        window.eduApp.showScreen = function (name, ...rest) {
            const result = _orig(name, ...rest);
            if (typeof name === "string" && name.endsWith("-hub")) {
                setTimeout(refreshAllHubEntries, 50);
            }
            // 5/13 派派：離開 boss-game 停 battle BGM
            if (typeof name === "string" && name !== "boss-game") {
                stopBattleBgm();
            }
            return result;
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _initResultBack);
    } else {
        _initResultBack();
    }
})();
