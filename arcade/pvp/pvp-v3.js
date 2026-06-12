/**
 * PK 對戰前端
 * 命名前綴 pvp- 避免污染既有 JS 全域。
 * 不修改 app.js 等既有 .js — 只透過 window.eduApi / window.eduApp 介面。
 */
(function () {
    "use strict";

    const POLL_INTERVAL_MS = 1500;
    const POLL_MAX_ERRORS = 5;  // 連續失敗 5 次 → 自動退出避免無限輪詢
    let pollTimer = null;
    let pollErrors = 0;
    let currentSessionId = null;

    // ── Step 5: 首頁卡片 → mode picker ──
    function bindHomeCard() {
        const card = document.getElementById("pvp-home-card");
        if (!card) return;
        card.addEventListener("click", () => {
            if (window.eduApp && window.eduApp.showScreen) {
                window.eduApp.showScreen("pvp-mode-picker");
            }
        });
    }

    // ── 5/11 三模式：mode picker → 同年級 / 大亂鬥 / 房間 ──
    let currentMode = "ranked";  // ranked / freeforall / room
    let selectedChallengeLevel = 3;  // 大亂鬥用

    function bindModePicker() {
        document.getElementById("pvp-mode-picker-back")?.addEventListener("click", () => {
            window.eduApp.showScreen("home");
        });
        document.getElementById("pvp-leaderboard-from-picker")?.addEventListener("click", () => {
            if (window.openPvpLeaderboard) window.openPvpLeaderboard();
        });
        document.querySelectorAll(".pvp-mode-card").forEach(card => {
            card.addEventListener("click", () => {
                const m = card.dataset.mode;
                if (m === "ranked") {
                    currentMode = "ranked";
                    window.eduApp.showScreen("pvp-subject");
                } else if (m === "freeforall") {
                    currentMode = "freeforall";
                    window.eduApp.showScreen("pvp-freeforall");
                } else if (m === "room") {
                    currentMode = "room";
                    window.eduApp.showScreen("pvp-room-home");
                }
            });
        });
    }

    // ── 5/11 三模式：朋友房間 ──────────────────────────────
    let _currentRoomCode = null;
    let _roomPollTimer = null;
    let _selectedRoomGrade = null;

    function bindRoomScreens() {
        // room-home：建立 / 加入入口
        document.getElementById("pvp-room-home-back")?.addEventListener("click", () => {
            window.eduApp.showScreen("pvp-mode-picker");
        });
        document.getElementById("pvp-room-go-create")?.addEventListener("click", () => {
            // reset 建房畫面到 stage1
            document.getElementById("pvp-room-create-stage1").style.display = "";
            document.getElementById("pvp-room-create-stage2").style.display = "none";
            window.eduApp.showScreen("pvp-room-create");
            initRoomCreateGrade();
        });
        document.getElementById("pvp-room-go-join")?.addEventListener("click", () => {
            document.getElementById("pvp-room-code-input").value = "";
            document.getElementById("pvp-room-join-error").textContent = "";
            window.eduApp.showScreen("pvp-room-join");
        });

        // 建房 stage1：選年級 + 點科目建房
        // 5/22 自訂密碼：態 A 確認鈕 + input enter
        document.getElementById("pvp-room-create-confirm")?.addEventListener("click", createRoomConfirm);
        document.getElementById("pvp-room-host-code-input")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") createRoomConfirm();
        });

        document.getElementById("pvp-room-create-back")?.addEventListener("click", () => {
            stopRoomPolling();
            window.eduApp.showScreen("pvp-room-home");
        });
        document.querySelectorAll("#pvp-room-grade-tabs .pvp-grade-tab").forEach(btn => {
            const g = parseInt(btn.dataset.grade, 10);
            btn.addEventListener("click", () => {
                if (PVP_LOCKED_GRADES.includes(g)) {
                    showPvpToast(`G${g} 題庫尚未準備，開發中`);
                    return;
                }
                document.querySelectorAll("#pvp-room-grade-tabs .pvp-grade-tab")
                    .forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                _selectedRoomGrade = g;
            });
        });
        document.querySelectorAll(".pvp-room-subject").forEach(btn => {
            btn.addEventListener("click", () => createRoom(btn.dataset.subject));
        });

        // 建房 stage2 態 B：3 按鈕 + 取消（5/22 改）
        // 複製密碼
        document.getElementById("pvp-room-copy-code")?.addEventListener("click", () => {
            if (_currentRoomCode) copyToClipboard(_currentRoomCode, "密碼已複製！");
        });
        // 複製連結
        document.getElementById("pvp-room-copy-link")?.addEventListener("click", () => {
            if (_currentRoomCode) {
                const link = `${location.origin}/arcade-pvp.html?invite=${_currentRoomCode}`;  // demo 適配：邀請連結直開 PK 頁（正式版開 LIFF 首頁）
                copyToClipboard(link, "連結已複製！");
            }
        });
        // 分享連結（LIFF shareTargetPicker → Web Share API → fallback 複製）
        document.getElementById("pvp-room-share-link")?.addEventListener("click", shareRoomLink);
        document.getElementById("pvp-room-cancel-btn")?.addEventListener("click", cancelCurrentRoom);

        // 加入房：返回 + 確認
        document.getElementById("pvp-room-join-back")?.addEventListener("click", () => {
            window.eduApp.showScreen("pvp-room-home");
        });
        document.getElementById("pvp-room-join-confirm")?.addEventListener("click", joinRoomBtnClick);
        // input enter 也送
        document.getElementById("pvp-room-code-input")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") joinRoomBtnClick();
        });
    }

    function initRoomCreateGrade() {
        let g = (window.currentUser && window.currentUser.grade) || 3;
        if (PVP_LOCKED_GRADES.includes(g)) g = 5;
        _selectedRoomGrade = g;
        document.querySelectorAll("#pvp-room-grade-tabs .pvp-grade-tab").forEach(btn => {
            const tg = parseInt(btn.dataset.grade, 10);
            btn.classList.toggle("active", tg === g);
            if (PVP_LOCKED_GRADES.includes(tg)) {
                btn.classList.add("pvp-grade-locked");
                btn.title = "題庫尚未準備，開發中";
            }
        });
    }

    // 5/22 改自訂密碼：選科目只切到 stage2 input 態，不馬上 POST
    let _pendingSubjectKey = null;
    let _pendingGrade = null;

    function createRoom(subjectKey) {
        if (!subjectKey) return;
        const grade = _selectedRoomGrade || ((window.currentUser && window.currentUser.grade) || 3);
        if (PVP_LOCKED_GRADES.includes(grade)) {
            showPvpToast(`G${grade} 題庫尚未準備，開發中`);
            return;
        }
        _pendingSubjectKey = subjectKey;
        _pendingGrade = grade;
        // 切到 stage2 態 A：input + 確認鈕
        const inputEl = document.getElementById("pvp-room-host-code-input");
        if (inputEl) inputEl.value = "";
        const errEl = document.getElementById("pvp-room-host-code-error");
        if (errEl) errEl.textContent = "";
        document.getElementById("pvp-room-stage2-input").style.display = "";
        document.getElementById("pvp-room-stage2-waiting").style.display = "none";
        document.getElementById("pvp-room-create-stage1").style.display = "none";
        document.getElementById("pvp-room-create-stage2").style.display = "";
        setTimeout(() => inputEl?.focus(), 50);
    }

    async function createRoomConfirm() {
        if (!window.eduApi || !_pendingSubjectKey || !_pendingGrade) return;
        const inputEl = document.getElementById("pvp-room-host-code-input");
        const errEl = document.getElementById("pvp-room-host-code-error");
        const code = (inputEl?.value || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{1,12}$/.test(code)) {
            if (errEl) errEl.textContent = "密碼只能用英文或數字，1~12 個字";
            return;
        }
        if (errEl) errEl.textContent = "";
        const btn = document.getElementById("pvp-room-create-confirm");
        if (btn) btn.disabled = true;
        try {
            const r = await window.eduApi("/api/pvp/room/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject_key: _pendingSubjectKey,
                    grade: _pendingGrade,
                    code,
                }),
            });
            const d = await r.json();
            if (r.status === 409 && (d.detail === "room_code_taken")) {
                if (errEl) errEl.textContent = "這個密碼有人在用，換一個";
                return;
            }
            if (d.detail || !r.ok) {
                if (errEl) errEl.textContent = "建房失敗：" + (d.detail || r.status);
                return;
            }
            _currentRoomCode = d.code;
            document.getElementById("pvp-room-code-display").textContent = d.code;
            // 切到 stage2 態 B：等待加入
            document.getElementById("pvp-room-stage2-input").style.display = "none";
            document.getElementById("pvp-room-stage2-waiting").style.display = "";
            startRoomPolling(d.code);
        } catch (e) {
            if (errEl) errEl.textContent = "建房失敗：" + e.message;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 分享連結：LIFF shareTargetPicker → Web Share API → fallback 複製連結
    async function shareRoomLink() {
        if (!_currentRoomCode) return;
        const link = `${location.origin}/arcade-pvp.html?invite=${_currentRoomCode}`;  // demo 適配：邀請連結直開 PK 頁（正式版開 LIFF 首頁）
        const text = `來跟我 PK！密碼：${_currentRoomCode}\n${link}`;
        // 1) LIFF shareTargetPicker（彈 LINE 好友選擇）
        try {
            if (window.liff && typeof liff.shareTargetPicker === "function") {
                const res = await liff.shareTargetPicker([{ type: "text", text }]);
                // 部分 LIFF SDK 版本：成功回 {status:'success'}，未開 scope 會 throw
                if (res && res.status === "success") {
                    showPvpToast("已分享！");
                } else if (res === undefined) {
                    // 舊 SDK 沒回傳 = 用戶取消，靜默
                }
                return;
            }
        } catch (e) {
            console.warn("[pvp-room] LIFF share failed, fallback", e);
            // scope 未開或用戶拒絕 → fallback Web Share
        }
        // 2) Web Share API（非 LIFF 環境 / LIFF 拒絕時）
        try {
            if (navigator.share) {
                await navigator.share({ title: "小智學園 PK", text });
                return;
            }
        } catch (e) {
            // 用戶取消分享 → 靜默
            if (e && e.name === "AbortError") return;
        }
        // 3) Fallback：複製連結
        copyToClipboard(link, "已複製連結（無法直接分享）");
    }

    function startRoomPolling(code) {
        stopRoomPolling();
        _roomPollTimer = setInterval(async () => {
            if (!code) return;
            try {
                const r = await window.eduApi(`/api/pvp/room/${encodeURIComponent(code)}`);
                if (!r.ok) return;
                const d = await r.json();
                const statusLine = document.getElementById("pvp-room-status-line");
                const expireText = document.getElementById("pvp-room-expire-text");
                if (expireText) {
                    const mins = Math.ceil(d.expire_remaining_seconds / 60);
                    expireText.textContent = `剩餘 ${mins} 分鐘`;
                }
                if (d.state === "session_created" && d.session_id) {
                    // 朋友來了 → 跳對戰
                    stopRoomPolling();
                    currentSessionId = d.session_id;
                    lastActiveCheck = 0;
                    await checkActiveSession();
                } else if (d.state === "expired" || d.state === "cancelled") {
                    stopRoomPolling();
                    if (statusLine) statusLine.textContent = `❌ 房間已 ${d.state === "expired" ? "過期" : "取消"}`;
                } else if (d.state === "waiting") {
                    if (statusLine) statusLine.textContent = "等待朋友加入…";
                }
            } catch (e) {
                console.error("[pvp-room] poll error", e);
            }
        }, 2000);
    }

    function stopRoomPolling() {
        if (_roomPollTimer) { clearInterval(_roomPollTimer); _roomPollTimer = null; }
    }

    async function cancelCurrentRoom() {
        if (!_currentRoomCode) return;
        try {
            await window.eduApi("/api/pvp/room/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: _currentRoomCode }),
            });
        } catch (e) {}
        stopRoomPolling();
        _currentRoomCode = null;
        window.eduApp.showScreen("pvp-room-home");
    }

    async function joinRoomBtnClick() {
        const input = document.getElementById("pvp-room-code-input");
        const errEl = document.getElementById("pvp-room-join-error");
        const code = (input?.value || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{1,12}$/.test(code)) {
            if (errEl) errEl.textContent = "密碼只能用英文或數字，1~12 個字";
            return;
        }
        if (errEl) errEl.textContent = "";
        document.getElementById("pvp-room-join-confirm").disabled = true;
        try {
            const r = await window.eduApi("/api/pvp/room/join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            const d = await r.json();
            if (d.detail || !r.ok) {
                if (errEl) errEl.textContent = "加入失敗：" + (d.detail || r.status);
                return;
            }
            currentSessionId = d.session_id;
            lastActiveCheck = 0;
            await checkActiveSession();
        } catch (e) {
            if (errEl) errEl.textContent = "加入失敗：" + e.message;
        } finally {
            document.getElementById("pvp-room-join-confirm").disabled = false;
        }
    }

    function copyToClipboard(text, toastMsg) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showPvpToast(toastMsg || "已複製")).catch(() => {
                showPvpToast("複製失敗，請手動長按");
            });
        } else {
            showPvpToast("瀏覽器不支援複製，請長按選取");
        }
    }

    // LIFF deep link: ?invite=XXXXXX → 自動跳加入頁
    // codex P2 修：原本進場立刻 showScreen 會被 boot 流程 (child-select / home) 蓋掉
    // 改成：把 invite 存 sessionStorage，等 boot 結束 home 顯示後再用 watchScreenActivate 觸發
    function handleInviteParam() {
        try {
            const params = new URLSearchParams(location.search);
            let inv = params.get("invite");
            // codex P2 修：liff.state 可能是 path-shaped (e.g. "/?invite=X" 或 "/join?invite=X")，
            // 不能單純 URLSearchParams 解。改用 new URL() 處理 path+query 兩種形式。
            if (!inv) {
                const liffState = params.get("liff.state");
                if (liffState) {
                    try {
                        const decoded = decodeURIComponent(liffState);
                        const u = new URL(decoded, location.origin);
                        inv = u.searchParams.get("invite");
                    } catch (e) {
                        // fallback：純 query string ?invite=X 沒 path 也試一下
                        try {
                            const inner = new URLSearchParams(
                                decodeURIComponent(liffState).replace(/^\?/, "")
                            );
                            inv = inner.get("invite");
                        } catch (ee) {}
                    }
                }
            }
            if (!inv) return;
            const code = inv.trim().toUpperCase().slice(0, 12);
            if (!/^[A-Z0-9]{1,12}$/.test(code)) return;
            sessionStorage.setItem("pvp_invite_code", code);
        } catch (e) {}
    }

    function consumeInviteIfAny() {
        const code = sessionStorage.getItem("pvp_invite_code");
        if (!code) return;
        sessionStorage.removeItem("pvp_invite_code");  // 用過就清
        if (!window.eduApp || !window.eduApp.showScreen) return;
        // 等 user 登入完到 home 才觸發（這函式由 watchScreenActivate("screen-home") 呼叫）
        const input = document.getElementById("pvp-room-code-input");
        if (input) input.value = code;
        const errEl = document.getElementById("pvp-room-join-error");
        if (errEl) errEl.textContent = "";
        window.eduApp.showScreen("pvp-room-join");
    }

    function bindFreeforallScreen() {
        document.getElementById("pvp-freeforall-back")?.addEventListener("click", () => {
            window.eduApp.showScreen("pvp-mode-picker");
        });
        // 預設 challenge level 跟玩家 grade 同（G6 → 改 G5）
        function syncFfLevel() {
            let lv = (window.currentUser && window.currentUser.grade) || 3;
            if (PVP_LOCKED_GRADES.includes(lv)) lv = 5;
            selectedChallengeLevel = lv;
            document.querySelectorAll("#pvp-ff-level-tabs .pvp-grade-tab").forEach(btn => {
                const g = parseInt(btn.dataset.level, 10);
                btn.classList.toggle("active", g === lv);
                if (PVP_LOCKED_GRADES.includes(g)) {
                    btn.classList.add("pvp-grade-locked");
                    btn.title = "題庫尚未準備，開發中";
                }
            });
        }
        syncFfLevel();
        watchScreenActivate("screen-pvp-freeforall", syncFfLevel);

        document.querySelectorAll("#pvp-ff-level-tabs .pvp-grade-tab").forEach(btn => {
            const g = parseInt(btn.dataset.level, 10);
            btn.addEventListener("click", () => {
                if (PVP_LOCKED_GRADES.includes(g)) {
                    showPvpToast(`G${g} 題庫尚未準備，開發中`);
                    return;
                }
                document.querySelectorAll("#pvp-ff-level-tabs .pvp-grade-tab").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                selectedChallengeLevel = g;
            });
        });

        document.querySelectorAll(".pvp-ff-subject").forEach(btn => {
            btn.addEventListener("click", () => startFreeforall(btn.dataset.subject));
        });
    }

    async function startFreeforall(subjectKey) {
        if (!subjectKey || !window.eduApi) return;
        const lv = selectedChallengeLevel || 3;
        if (PVP_LOCKED_GRADES.includes(lv)) {
            showPvpToast(`G${lv} 題庫尚未準備，開發中`);
            return;
        }
        document.querySelectorAll(".pvp-ff-subject").forEach(b => (b.disabled = true));
        try {
            const resp = await window.eduApi("/api/pvp/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject_key: subjectKey,
                    mode: "freeforall",
                    challenge_level: lv,
                }),
            });
            const data = await resp.json();
            if (data.detail || resp.status >= 400) {
                alert("無法開始大亂鬥：" + (data.detail || resp.status));
                return;
            }
            if (data.status === "in_session") {
                currentSessionId = data.session_id;
                lastActiveCheck = 0;
                await checkActiveSession();
                return;
            }
            showWaiting();
        } catch (e) {
            console.error("[pvp] startFreeforall:", e);
            alert("開始大亂鬥失敗，請再試一次");
        } finally {
            document.querySelectorAll(".pvp-ff-subject").forEach(b => (b.disabled = false));
        }
    }

    // ── Step 6: 科目選擇 → 進 queue ──
    let selectedGrade = null;  // 5/8 派派要：進 PK 前自選年級（不再強用 user.grade）

    // 5/11 派派：G6 題庫尚未準備，PK 一律擋
    const PVP_LOCKED_GRADES = [6];

    function showPvpToast(msg) {
        let t = document.getElementById("pvp-toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "pvp-toast";
            t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:rgba(30,30,30,.92);color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:9999;opacity:0;transition:opacity .25s;pointer-events:none";
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = "1";
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = "0"; }, 2400);
    }

    // 派派 5/10：切換 child 後 currentUser.grade 變了，但 bindSubjectScreen 已跑過、
    // grade tab default 仍是初始 grade。每次進 PVP subject 時用 syncGradeDefault sync。
    function syncGradeDefault() {
        let userGrade = (window.currentUser && window.currentUser.grade) || 3;
        // G6 題庫尚未準備：小孩設 G6 時 PK 預設改 G5（玩家可手動切其他）
        if (PVP_LOCKED_GRADES.includes(userGrade)) userGrade = 5;
        selectedGrade = userGrade;
        // codex P1 修：限定到 #screen-pvp-subject 內（freeforall 也有 .pvp-grade-tab 但 data-level 不是 data-grade）
        const gradeTabs = document.querySelectorAll("#screen-pvp-subject .pvp-grade-tab");
        gradeTabs.forEach((btn) => {
            const g = parseInt(btn.dataset.grade, 10);
            btn.classList.toggle("active", g === userGrade);
            // 鎖定的年級加視覺標示
            if (PVP_LOCKED_GRADES.includes(g)) {
                btn.classList.add("pvp-grade-locked");
                btn.title = "題庫尚未準備，開發中";
            }
        });
    }

    function bindSubjectScreen() {
        const backBtn = document.getElementById("pvp-subject-back");
        if (backBtn) {
            backBtn.addEventListener("click", () => {
                if (window.eduApp && window.eduApp.showScreen) {
                    // 5/11 三模式：subject 屬同年級分支，返回回 mode picker
                    window.eduApp.showScreen("pvp-mode-picker");
                }
            });
        }
        // 年級 tab：預設用 currentUser.grade（每次進畫面時 syncGradeDefault 重 sync）
        syncGradeDefault();
        // codex P1 修：限定到 #screen-pvp-subject 內，避免綁到 freeforall 共用同 class 的 tab
        const gradeTabs = document.querySelectorAll("#screen-pvp-subject .pvp-grade-tab");
        gradeTabs.forEach((btn) => {
            const g = parseInt(btn.dataset.grade, 10);
            btn.addEventListener("click", () => {
                if (PVP_LOCKED_GRADES.includes(g)) {
                    showPvpToast(`G${g} 題庫尚未準備，開發中`);
                    return;  // 不切 active、不更新 selectedGrade
                }
                gradeTabs.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                selectedGrade = g;
            });
        });

        // codex P1 致命修：原本 .pvp-subject-btn 選到大亂鬥按鈕（也含此 class），導致雙綁 ranked + freeforall
        // 限定到 #screen-pvp-subject 內 + 同時要排除 freeforall 子畫面內的按鈕
        document.querySelectorAll("#screen-pvp-subject .pvp-subject-btn").forEach((btn) => {
            btn.addEventListener("click", () => startPvp(btn.dataset.subject));
        });
    }

    async function startPvp(subjectKey) {
        if (!subjectKey) return;
        if (!window.eduApi) {
            alert("系統初始化中，請稍後再試");
            return;
        }
        const grade = selectedGrade || (window.currentUser && window.currentUser.grade) || 3;
        if (PVP_LOCKED_GRADES.includes(grade)) {
            showPvpToast(`G${grade} 題庫尚未準備，開發中`);
            return;
        }
        document.querySelectorAll("#screen-pvp-subject .pvp-subject-btn").forEach((b) => (b.disabled = true));

        try {
            const resp = await window.eduApi("/api/pvp/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subject_key: subjectKey, grade: grade }),
            });
            const data = await resp.json();

            if (data.detail || resp.status >= 400) {
                alert("無法開始 PK：" + (data.detail || resp.status));
                return;
            }

            // 已在 session 中（之前沒結束）→ 直接重連到對戰畫面（不再開新 queue）
            if (data.status === "in_session") {
                currentSessionId = data.session_id;
                lastActiveCheck = 0;  // 重置 throttle 強制立刻檢查
                await checkActiveSession();
                return;
            }

            // queued / requeued → 切等待畫面 + 開始輪詢
            showWaiting();
        } catch (e) {
            console.error("[pvp] startPvp error:", e);
            alert("開始 PK 失敗，請再試一次");
        } finally {
            document.querySelectorAll("#screen-pvp-subject .pvp-subject-btn").forEach((b) => (b.disabled = false));
        }
    }

    // ── Step 7: 等待畫面 + 輪詢 ──
    function bindWaitingScreen() {
        const cancelBtn = document.getElementById("pvp-waiting-cancel");
        if (cancelBtn) cancelBtn.addEventListener("click", cancelWaiting);
    }

    function showWaiting() {
        if (window.eduApp && window.eduApp.showScreen) {
            window.eduApp.showScreen("pvp-waiting");
        }
        startPolling();
    }

    function startPolling() {
        stopPolling();
        pollErrors = 0;
        pollState(); // 立即跑一次
        pollTimer = setInterval(pollState, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function pollState() {
        if (!window.eduApi) return;
        try {
            const resp = await window.eduApi("/api/pvp/state");
            if (!resp.ok) throw new Error("state http " + resp.status);
            const data = await resp.json();
            pollErrors = 0;
            handleState(data);
        } catch (e) {
            pollErrors++;
            console.error("[pvp] poll error " + pollErrors + ":", e);
            if (pollErrors >= POLL_MAX_ERRORS) {
                stopPolling();
                alert("連線不穩定，已退出配對");
                if (window.eduApp && window.eduApp.showScreen) {
                    window.eduApp.showScreen("home");
                }
            }
        }
    }

    // 觀察 PK screen 從 active 變 inactive → 清 polling / countdown timer
    // （不能 hook app.js 的 showScreen，因為承諾不動既有檔案；用 MutationObserver 達到一致效果）
    function watchScreenCleanup(screenId, cleanup) {
        const screen = document.getElementById(screenId);
        if (!screen || !window.MutationObserver) return;
        const observer = new MutationObserver(() => {
            if (!screen.classList.contains("active")) cleanup();
        });
        observer.observe(screen, { attributes: true, attributeFilter: ["class"] });
    }

    // 觀察 screen 變 active → 觸發 callback（用於重連檢測）
    function watchScreenActivate(screenId, callback) {
        const screen = document.getElementById(screenId);
        if (!screen || !window.MutationObserver) return;
        const observer = new MutationObserver(() => {
            if (screen.classList.contains("active")) callback();
        });
        observer.observe(screen, { attributes: true, attributeFilter: ["class"] });
    }

    function handleState(data) {
        const status = data.status;
        if (status === "waiting") {
            updateWaitingUI(data);
            return;
        }
        if (status === "playing") {
            // 配上！停 polling，進倒數畫面（Step 8）
            currentSessionId = data.session_id;
            stopPolling();
            showCountdown(data);
            return;
        }
        if (status === "finished" || status === "abandoned") {
            stopPolling();
            if (window.eduApp) window.eduApp.showScreen("home");
            return;
        }
        if (status === "idle") {
            // queue 沒了（取消或 heartbeat 超時）
            stopPolling();
            if (window.eduApp) window.eduApp.showScreen("home");
            return;
        }
    }

    function updateWaitingUI(data) {
        const elapsedEl = document.getElementById("pvp-waiting-elapsed");
        const aiInEl = document.getElementById("pvp-waiting-ai-in");
        if (elapsedEl) elapsedEl.textContent = "已等 " + (data.elapsed_seconds || 0) + " 秒";
        if (aiInEl) {
            const aiIn = data.ai_in;
            if (typeof aiIn === "number" && aiIn > 0) {
                aiInEl.textContent = aiIn + " 秒後配電腦陪練";
            } else {
                aiInEl.textContent = "正在配電腦陪練...";
            }
        }
    }

    // ── Step 8: 配對成功 3 秒倒數 → 進入對戰畫面 ──
    let countdownTimer = null;

    function showCountdown(stateData) {
        // 對手資訊
        const opp = stateData && stateData.opponent;
        const oppAvatar = opp && opp.is_ai
            ? '<img class="emo xl" src="/assets/images/icons/robot.png?s=6" alt="">'
            : "🧑";
        const oppName = opp && opp.is_ai ? "電腦陪練" : "玩家";
        const avatarEl = document.getElementById("pvp-countdown-opp-avatar");
        const nameEl = document.getElementById("pvp-countdown-opp-name");
        if (avatarEl) avatarEl.innerHTML = oppAvatar;
        if (nameEl) nameEl.textContent = oppName;

        // 切畫面
        if (window.eduApp && window.eduApp.showScreen) {
            window.eduApp.showScreen("pvp-countdown");
        }

        // 3 → 2 → 1 → GO
        let n = 3;
        const numEl = document.getElementById("pvp-countdown-num");
        if (numEl) numEl.textContent = String(n);
        clearCountdown();
        countdownTimer = setInterval(() => {
            n -= 1;
            if (n > 0) {
                if (numEl) {
                    // 重啟動畫
                    numEl.style.animation = "none";
                    void numEl.offsetWidth;
                    numEl.style.animation = "";
                    numEl.textContent = String(n);
                }
            } else if (n === 0) {
                if (numEl) {
                    numEl.style.animation = "none";
                    void numEl.offsetWidth;
                    numEl.style.animation = "";
                    numEl.textContent = "GO!";
                }
            } else {
                clearCountdown();
                enterGame();
            }
        }, 1000);
    }

    function clearCountdown() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }

    function enterGame() {
        if (window.eduApp && window.eduApp.showScreen) {
            window.eduApp.showScreen("pvp-game");
        }
        startGameLoop();
    }

    // ── Step 9: 對戰畫面 ──
    let gameSession = null;
    let gamePollTimer = null;
    let gameDisplayTimer = null;
    let lastRenderedQid = null;  // 避免重複 render 同一題抹掉 correct/wrong feedback
    let elapsedAtPoll = 0;       // 上次 pollGame 拿到的 server elapsed_seconds
    let elapsedTakenAt = 0;      // 拿到 elapsed_seconds 的本地 timestamp（ms）
    let answerPollTimer = null;  // submitAnswer 後延遲 pollGame 的 timer，stopGameLoop 要取消

    function startGameLoop() {
        stopGameLoop();
        elapsedAtPoll = 0;
        elapsedTakenAt = 0;
        pollGame(); // 立即拿一次 state
        gamePollTimer = setInterval(pollGame, 1500);
        gameDisplayTimer = setInterval(updateGameTimer, 250);
    }

    function stopGameLoop() {
        if (gamePollTimer) { clearInterval(gamePollTimer); gamePollTimer = null; }
        if (gameDisplayTimer) { clearInterval(gameDisplayTimer); gameDisplayTimer = null; }
        if (answerPollTimer) { clearTimeout(answerPollTimer); answerPollTimer = null; }
        // 5/8 魔王題：離開 game 畫面要清 countdown
        clearBossCountdown();
    }

    async function pollGame() {
        if (!window.eduApi) return;
        try {
            // 帶 currentSessionId 讓 server 在 active=False 後（結算 race）仍能回 finished state
            const url = currentSessionId
                ? "/api/pvp/state?session_id=" + encodeURIComponent(currentSessionId)
                : "/api/pvp/state";
            const resp = await window.eduApi(url);
            if (!resp.ok) throw new Error("game state " + resp.status);
            const data = await resp.json();
            // server 給的 elapsed_seconds（PG 算好），記下 + 本地時間，updateGameTimer 自己累加
            if (typeof data.elapsed_seconds === "number") {
                elapsedAtPoll = data.elapsed_seconds;
                elapsedTakenAt = Date.now();
            }
            if (data.status === "playing") {
                gameSession = data;
                renderGame(data);
            } else if (data.status === "finished" || data.status === "abandoned") {
                gameSession = data;
                stopGameLoop();
                showResult(data);
            } else {
                stopGameLoop();
                if (window.eduApp) window.eduApp.showScreen("home");
            }
        } catch (e) {
            console.error("[pvp] pollGame error:", e);
        }
    }

    function renderGame(data) {
        const me = data.me || { score: 0, correct_count: 0, answered_count: 0, finished: false };
        const opp = data.opponent;
        const total = (data.questions || []).length;
        const idx = me.answered_count;

        // 進度
        const progEl = document.getElementById("pvp-game-progress");
        if (progEl) progEl.textContent = "第 " + Math.min(idx + 1, total) + "/" + total + " 題";

        // 我的進度條
        const meFill = document.getElementById("pvp-bar-me-fill");
        if (meFill) meFill.style.width = (total ? (me.answered_count / total) * 100 : 0) + "%";
        const meScore = document.getElementById("pvp-bar-me-score");
        if (meScore) meScore.textContent = me.score;

        // 對手進度條
        if (opp) {
            const oppFill = document.getElementById("pvp-bar-opp-fill");
            if (oppFill) oppFill.style.width = (total ? (opp.answered_count / total) * 100 : 0) + "%";
            const oppLabel = document.getElementById("pvp-bar-opp-label");
            if (oppLabel) {
                const tag = opp.is_ai ? '<img class="emo" src="/assets/images/icons/robot.png?s=6" alt=""> 電腦' : "對手";
                oppLabel.innerHTML = tag + " " + opp.score + " 分";
            }
        }

        // 答完所有題 → 等對手
        if (me.finished || idx >= total) {
            const dispEl = document.getElementById("pvp-q-display");
            const prompt = document.getElementById("pvp-q-prompt");
            const grid = document.getElementById("pvp-game-choices");
            if (dispEl) dispEl.textContent = "已答完，等對手結束...";
            if (prompt) prompt.textContent = "";
            if (grid) grid.innerHTML = "";
            lastRenderedQid = null;
            return;
        }

        // 顯示當前題目（避免重複 render 抹掉 feedback）
        const q = data.questions[idx];
        if (!q || lastRenderedQid === q.question_id) return;
        lastRenderedQid = q.question_id;

        // 5/20 派派：題目 grade<=2 才顯示注音，不論玩家年級
        // （zhuyin/radical/stroke 注音=答案，防洩答仍要擋）
        const bopo = q.bopomofo || (q.content_json && q.content_json.bopomofo);
        const _qg = Number(q.grade || (q.content_json && q.content_json.grade) || 0);
        // 5/21 派派 v6 智慧 gate：answer 含注音字 = 直接查找題（洩答）→ skip
        const _ansHasBopo = /[ㄅ-ㄯㆠ-ㆿ]/.test(String(q.answer || ""));
        const useBopo = !!bopo && !!window.applyBopomofoSmart
            && _qg >= 1 && _qg <= 2 && !_ansHasBopo;

        const dispEl = document.getElementById("pvp-q-display");
        const promptEl = document.getElementById("pvp-q-prompt");
        if (dispEl) {
            dispEl.classList.toggle("bopo", useBopo);
            if (useBopo) dispEl.innerHTML = window.applyBopomofoSmart(q.display || "", bopo);
            else dispEl.innerHTML = window.applyBopomofoSmart(q.display || "", null);
        }
        if (promptEl) {
            promptEl.classList.toggle("bopo", useBopo);
            if (useBopo) promptEl.innerHTML = window.applyBopomofoSmart(q.prompt || "", bopo);
            else promptEl.innerHTML = window.applyBopomofoSmart(q.prompt || "", null);
        }

        const grid = document.getElementById("pvp-game-choices");
        if (!grid) return;
        grid.classList.toggle("bopo", useBopo);  // 注音題:長句選項改單欄ABCD(CSS)避免2欄爆格
        // 5/21 派派：長選項自動切 1 欄（>10 字）— 救無 bopo 但內容超長的閱讀題
        const _maxChoiceLen = Math.max(...(q.choices||[]).map(c => String(c||'').length));
        grid.classList.toggle("long-choices", _maxChoiceLen > 10);
        grid.innerHTML = "";
        (q.choices || []).forEach((c) => {
            const btn = document.createElement("button");
            btn.className = "pvp-choice-btn";
            if (useBopo) btn.innerHTML = window.applyBopomofoSmart(String(c), bopo);
            else btn.textContent = c;
            btn.addEventListener("click", () => submitAnswer(q.question_id, c, btn));
            grid.appendChild(btn);
        });

        // 5/8 派派要：魔王題顯示倒數條 + boss UI 特效
        clearBossCountdown();
        if (q.is_boss) {
            startBossCountdown(q);
        } else {
            // 一般題：移除 boss class
            const gameScreen = document.getElementById("screen-pvp-game");
            if (gameScreen) gameScreen.classList.remove("pvp-boss-active");
        }
    }

    // ── 魔王題倒數 + UI 特效 ──
    let bossCountdownTimer = null;
    let bossCountdownStartedAt = null;
    let bossCountdownQid = null;

    function clearBossCountdown() {
        if (bossCountdownTimer) {
            clearInterval(bossCountdownTimer);
            bossCountdownTimer = null;
        }
        bossCountdownStartedAt = null;
        bossCountdownQid = null;
        const bar = document.getElementById("pvp-boss-countdown");
        if (bar) bar.remove();
        const banner = document.getElementById("pvp-boss-banner");
        if (banner) banner.remove();
    }

    function startBossCountdown(q) {
        const total = (q.countdown_seconds || 30) * 1000;
        bossCountdownStartedAt = Date.now();
        bossCountdownQid = q.question_id;

        const gameScreen = document.getElementById("screen-pvp-game");
        if (gameScreen) gameScreen.classList.add("pvp-boss-active");

        // 進場 banner
        const content = gameScreen?.querySelector(".pvp-game-content");
        if (content && !document.getElementById("pvp-boss-banner")) {
            const banner = document.createElement("div");
            banner.id = "pvp-boss-banner";
            banner.className = "pvp-boss-banner";
            banner.innerHTML = '<img class="emo xl" src="/assets/images/icons/boss.png?s=6" alt=""> 魔王來了！';
            content.insertBefore(banner, content.firstChild);
            setTimeout(() => banner.classList.add("show"), 10);
            setTimeout(() => banner.remove(), 2200);
        }

        // 倒數條
        if (content && !document.getElementById("pvp-boss-countdown")) {
            const bar = document.createElement("div");
            bar.id = "pvp-boss-countdown";
            bar.className = "pvp-boss-countdown";
            bar.innerHTML =
                '<div class="pvp-boss-countdown-label">⏱ <span id="pvp-boss-countdown-num">30</span>s</div>' +
                '<div class="pvp-boss-countdown-track"><div class="pvp-boss-countdown-fill" id="pvp-boss-countdown-fill"></div></div>';
            content.insertBefore(bar, content.firstChild);
        }

        // 動倒數
        const fill = document.getElementById("pvp-boss-countdown-fill");
        const num = document.getElementById("pvp-boss-countdown-num");
        bossCountdownTimer = setInterval(() => {
            const elapsed = Date.now() - bossCountdownStartedAt;
            const left = Math.max(0, total - elapsed);
            const pct = (left / total) * 100;
            if (fill) fill.style.width = pct + "%";
            if (num) num.textContent = Math.ceil(left / 1000);
            if (left <= 5000) {
                fill?.classList.add("danger");
            }
            if (left <= 0) {
                clearInterval(bossCountdownTimer);
                bossCountdownTimer = null;
                // 強制 submit 空答案
                if (bossCountdownQid) {
                    submitAnswer(bossCountdownQid, "", null);
                }
            }
        }, 200);
    }

    async function submitAnswer(qid, ans, btnEl) {
        if (!window.eduApi || !currentSessionId) return;
        // 防連點
        document.querySelectorAll(".pvp-choice-btn").forEach((b) => (b.disabled = true));

        // 派派 5/10：API 卡住 → 倒數跑到 0 玩家以為「卡住」。
        // 加 8s timeout — 卡住自動 abort + re-enable buttons，pollGame 1.5s 輪詢仍會
        // 抓到 backend 真實狀態（answer 冪等，重送無害）。
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 8000);

        try {
            const resp = await window.eduApi("/api/pvp/answer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    question_id: qid,
                    answer: ans,
                }),
                signal: ctrl.signal,
            });
            clearTimeout(timeoutId);
            if (!resp.ok) throw new Error("answer " + resp.status);
            const data = await resp.json();
            if (data.detail) {
                console.error("[pvp] answer error:", data.detail);
                // re-enable
                document.querySelectorAll(".pvp-choice-btn").forEach((b) => (b.disabled = false));
                return;
            }
            // 顯示對/錯 feedback
            const correct = data.result && data.result.correct;
            if (btnEl) btnEl.classList.add(correct ? "pvp-choice-correct" : "pvp-choice-wrong");
            // 5/8 派派要：魔王題答對播 boss-hit 震動 + 閃光
            if (bossCountdownQid === qid) {
                clearBossCountdown();
                if (correct) {
                    const qBox = document.querySelector("#screen-pvp-game .pvp-game-question");
                    if (qBox) {
                        qBox.classList.add("boss-hit");
                        setTimeout(() => qBox.classList.remove("boss-hit"), 500);
                    }
                }
            }
            // 立刻拉新 state 換下一題（避免等 1.5s 輪詢卡住）；500ms 讓玩家看到 feedback
            // 用 answerPollTimer 而非裸 setTimeout，stopGameLoop 才能取消；避免玩家切畫面後 stale 觸發
            if (answerPollTimer) clearTimeout(answerPollTimer);
            answerPollTimer = setTimeout(() => {
                answerPollTimer = null;
                pollGame();
            }, 500);
        } catch (e) {
            clearTimeout(timeoutId);
            const isTimeout = e?.name === "AbortError";
            console.error("[pvp] submit error:", isTimeout ? "TIMEOUT 8s" : e);
            document.querySelectorAll(".pvp-choice-btn").forEach((b) => (b.disabled = false));
            // 立刻 pollGame 抓 backend state — 萬一 backend 已收到答案
            if (answerPollTimer) clearTimeout(answerPollTimer);
            answerPollTimer = setTimeout(() => {
                answerPollTimer = null;
                pollGame();
            }, 200);
        }
    }

    function updateGameTimer() {
        // server 算好的 elapsed_seconds 加上「拿到後」的本地秒數
        // 避免直接 new Date(started_at) 把 server UTC 字串當 local time 漂 8 小時
        if (!elapsedTakenAt) return;
        const sinceLastPoll = Math.max(0, Math.floor((Date.now() - elapsedTakenAt) / 1000));
        const elapsedSec = Math.max(0, elapsedAtPoll + sinceLastPoll);
        const el = document.getElementById("pvp-game-timer");
        if (el) el.textContent = "⏱ " + elapsedSec + "s";
    }

    function showResult(data) {
        if (window.eduApp && window.eduApp.showScreen) {
            window.eduApp.showScreen("pvp-result");
        }
        const me = data.me || {};
        const opp = data.opponent || {};
        const total = (data.questions || []).length || 10;

        // 判贏輸（用 server 給的 me.is_winner，不在 client 重算）
        const outcomeEl = document.getElementById("pvp-result-outcome");
        if (outcomeEl) {
            outcomeEl.classList.remove("win", "lose", "draw");
            if (data.winner_player_id == null) {
                outcomeEl.innerHTML = '<img class="emo lg" src="/assets/images/icons/handshake.png?s=6" alt=""> 平手';
                outcomeEl.classList.add("draw");
            } else if (me.is_winner) {
                outcomeEl.innerHTML = '<img class="emo lg" src="/assets/images/icons/trophy.png?s=6" alt=""> 你贏了！';
                outcomeEl.classList.add("win");
            } else {
                outcomeEl.innerHTML = '<img class="emo lg" src="/assets/images/icons/crying.png?s=6" alt=""> 你輸了';
                outcomeEl.classList.add("lose");
            }
        }

        // 我的分數
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setText("pvp-result-me-score", me.score || 0);
        setText("pvp-result-me-detail", "答對 " + (me.correct_count || 0) + "/" + total + " 題");

        // 對手分數
        setText("pvp-result-opp-score", opp.score || 0);
        setText("pvp-result-opp-detail", "答對 " + (opp.correct_count || 0) + "/" + total + " 題");
        const oppLabel = document.getElementById("pvp-result-opp-label");
        if (oppLabel) {
            if (opp.is_ai) {
                oppLabel.innerHTML = '<img class="emo" src="/assets/images/icons/robot.png?s=6" alt=""> 電腦';
            } else {
                oppLabel.textContent = "對手";
            }
        }

        // 金幣獎勵（server 從 ActivityLog 撈精確值）
        const reward = me.coins_earned || 0;
        setText("pvp-result-reward", "+" + reward + " 金幣");
    }

    // ── Step 10: 結算畫面按鈕 ──
    function bindResultScreen() {
        const homeBtn = document.getElementById("pvp-result-home");
        if (homeBtn) homeBtn.addEventListener("click", () => {
            currentSessionId = null;
            if (window.eduApp && window.eduApp.showScreen) window.eduApp.showScreen("home");
        });
        const replayBtn = document.getElementById("pvp-result-replay");
        if (replayBtn) replayBtn.addEventListener("click", () => {
            currentSessionId = null;
            if (window.eduApp && window.eduApp.showScreen) window.eduApp.showScreen("pvp-subject");
        });
    }

    async function cancelWaiting() {
        stopPolling();
        if (window.eduApi) {
            try {
                await window.eduApi("/api/pvp/cancel", { method: "POST" });
            } catch (e) {
                console.warn("[pvp] cancel api fail:", e);
            }
        }
        if (window.eduApp && window.eduApp.showScreen) {
            window.eduApp.showScreen("home");
        }
    }

    // ── Step 11: 重連 + 同 user 雙開的 graceful 處理 ──

    let lastActiveCheck = 0;
    const ACTIVE_CHECK_THROTTLE_MS = 10000;

    async function checkActiveSession() {
        // 切 home 時主動查 PK 狀態，refresh 後能自動接回對戰
        // 10 秒 throttle 避免每次切 home 都打 API
        const now = Date.now();
        if (now - lastActiveCheck < ACTIVE_CHECK_THROTTLE_MS) return;
        lastActiveCheck = now;

        if (!window.eduApi) return;
        try {
            const resp = await window.eduApi("/api/pvp/state");
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.status === "playing") {
                // 之前在對戰，斷線/refresh 回來 → 直接接回對戰畫面
                currentSessionId = data.session_id;
                gameSession = data;
                if (window.eduApp && window.eduApp.showScreen) {
                    window.eduApp.showScreen("pvp-game");
                }
                startGameLoop();
            } else if (data.status === "finished" || data.status === "abandoned") {
                // 對戰結束（含對手棄賽 server 自動結算），把結果秀出來
                currentSessionId = data.session_id;
                showResult(data);
            }
            // status idle → 沒事，不打擾使用者
        } catch (e) {
            console.warn("[pvp] checkActiveSession:", e);
        }
    }

    // ── Step 12: feature flag — 卡片預設 hidden，查 /api/pvp/enabled=true 才顯示 ──
    async function checkPvpFlag() {
        if (!window.eduApi) return;
        try {
            const resp = await fetch("/api/pvp/enabled");  // 不需 auth
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && data.enabled) {
                const card = document.getElementById("pvp-home-card");
                if (card) card.classList.add("pvp-enabled");
            }
        } catch (e) {
            // 失敗保持隱藏，不影響其他功能
        }
    }

    function init() {
        bindHomeCard();
        bindModePicker();         // 5/11 三模式入口
        bindFreeforallScreen();   // 5/11 大亂鬥
        bindRoomScreens();        // 5/11 朋友房間
        handleInviteParam();      // LIFF ?invite=XXXXXX 自動跳加入
        bindSubjectScreen();
        bindWaitingScreen();
        bindResultScreen();
        bindLeaderboard();
        watchScreenCleanup("screen-pvp-waiting", () => { if (pollTimer) stopPolling(); });
        watchScreenCleanup("screen-pvp-countdown", () => { if (countdownTimer) clearCountdown(); });
        watchScreenCleanup("screen-pvp-game", () => { if (gamePollTimer) stopGameLoop(); });
        watchScreenCleanup("screen-pvp-room-create", () => { stopRoomPolling(); });
        // codex P2 修：?invite= deep link 在 home 顯示後才觸發跳轉，避免被 boot 蓋掉
        watchScreenActivate("screen-home", consumeInviteIfAny);
        // 重連：切到 home 時主動查 PK 狀態（throttle 10s 避免噪音）
        watchScreenActivate("screen-home", checkActiveSession);
        // 切換 child 後 currentUser.grade 會變，每次進 pvp-subject 重 sync
        watchScreenActivate("screen-pvp-subject", syncGradeDefault);
        // feature flag check
        checkPvpFlag();
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    // ── 排行榜 ──
    let _currentLbMode = "ranked";

    function bindLeaderboard() {
        const openBtn = document.getElementById("pvp-leaderboard-btn");
        if (openBtn) {
            openBtn.addEventListener("click", () => {
                if (window.eduApp && window.eduApp.showScreen) {
                    window.eduApp.showScreen("pvp-leaderboard");
                }
                loadLeaderboard(_currentLbMode);
            });
        }
        const backBtn = document.getElementById("pvp-leaderboard-back");
        if (backBtn) {
            backBtn.addEventListener("click", () => {
                if (window.eduApp && window.eduApp.showScreen) {
                    // 從 mode picker 進來 → 回 mode picker；從 subject 進來 → 回 subject
                    window.eduApp.showScreen("pvp-mode-picker");
                }
            });
        }
        // 5/11 三模式 — 排行榜 mode 切換 tab
        document.querySelectorAll(".pvp-lb-tab").forEach(btn => {
            btn.addEventListener("click", () => {
                const m = btn.dataset.lbmode;
                _currentLbMode = m;
                document.querySelectorAll(".pvp-lb-tab").forEach(b => b.classList.toggle("active", b === btn));
                loadLeaderboard(m);
            });
        });
    }

    // 從外部呼叫的入口（mode picker 排行榜按鈕用）
    window.openPvpLeaderboard = function () {
        if (window.eduApp && window.eduApp.showScreen) {
            window.eduApp.showScreen("pvp-leaderboard");
        }
        loadLeaderboard(_currentLbMode);
    };

    async function loadLeaderboard(mode) {
        mode = mode || "ranked";
        const container = document.getElementById("pvp-leaderboard-content");
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:24px;color:#888;">載入中…</div>';
        try {
            const r = await window.eduApi(`/api/pvp/leaderboard?mode=${encodeURIComponent(mode)}`);
            if (!r.ok) {
                container.innerHTML = '<div style="text-align:center;padding:24px;color:#dc3545;">載入失敗（' + r.status + '）</div>';
                return;
            }
            const d = await r.json();
            renderLeaderboard(container, d);
        } catch (e) {
            container.innerHTML = '<div style="text-align:center;padding:24px;color:#dc3545;">載入失敗</div>';
        }
    }

    function renderLeaderboard(container, d) {
        const mode = d.mode || "ranked";
        const grade = d.grade;
        const top = d.top || [];
        const me = d.my_entry;
        const modeLabel = mode === "freeforall" ? "🌀 大亂鬥王榜" : `🥇 PK 王榜 G${grade}`;
        if (!top.length) {
            container.innerHTML = `
                <div style="padding:24px;text-align:center;color:#888;">
                    <div style="font-size:48px;">🎯</div>
                    <div style="margin-top:8px;">${modeLabel} 還沒有紀錄</div>
                    <div style="font-size:12px;margin-top:6px;">快去開第一場！</div>
                </div>`;
            return;
        }
        const rows = top.map(e => {
            const medal = e.rank === 1 ? '<img class="emo lg" src="/assets/images/icons/medal_gold.png?s=6" alt="1">'
                        : e.rank === 2 ? '<img class="emo lg" src="/assets/images/icons/medal_silver.png?s=6" alt="2">'
                        : e.rank === 3 ? '<img class="emo lg" src="/assets/images/icons/medal_bronze.png?s=6" alt="3">'
                        : `#${e.rank}`;
            const meHighlight = e.is_me ? "background:#fff3cd;border-left:3px solid #ffc107;" : "";
            const winRatePct = Math.round(e.win_rate * 100);
            return `
                <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #f0f2f4;${meHighlight}">
                    <div style="width:42px;font-weight:600;font-size:15px;">${medal}</div>
                    <div style="flex:1;">
                        <div style="font-size:14px;font-weight:600;">${escapeHtml(e.name)}${e.is_me ? ' <span style="color:#0969da;font-size:11px;">（你）</span>' : ''}</div>
                        <div style="font-size:11px;color:#888;">勝 ${e.wins} / 總 ${e.total} 場 ・ 勝率 ${winRatePct}%</div>
                    </div>
                </div>`;
        }).join("");
        let footer = "";
        if (me && me.rank > top.length) {
            const winRatePct = Math.round(me.win_rate * 100);
            footer = `
                <div style="margin-top:12px;padding:12px 14px;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;">
                    <div style="font-size:13px;font-weight:600;margin-bottom:4px;">你的排名 #${me.rank}（共 ${d.total_players} 人）</div>
                    <div style="font-size:11px;color:#666;">勝 ${me.wins} / 總 ${me.total} 場 ・ 勝率 ${winRatePct}%</div>
                </div>`;
        } else if (!me) {
            footer = `
                <div style="margin-top:12px;padding:12px 14px;background:#f8f9fa;border-radius:8px;text-align:center;color:#888;font-size:12px;">
                    你還沒參加過 PK，去開第一場！
                </div>`;
        }
        const header = mode === "freeforall"
            ? `🌀 大亂鬥王榜 ・ 共 ${d.total_players} 名玩家`
            : `🥇 G${grade} PK 王榜 ・ 共 ${d.total_players} 名玩家`;
        container.innerHTML = `
            <div style="padding:14px 14px 8px;color:#666;font-size:13px;">${header}</div>
            <div style="background:white;border-radius:8px;border:1px solid #e0e3e7;overflow:hidden;">${rows}</div>
            ${footer}`;
    }

    function escapeHtml(s) {
        return String(s || "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
    }

    window.eduPvp = window.eduPvp || {};
    window.eduPvp.startPvp = startPvp;
    window.eduPvp.cancelWaiting = cancelWaiting;
})();
