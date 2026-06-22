/* 題目回報元件（自包含）：題卡右上角 🚩 → 迷你彈窗（原因快選＋選填一行）→ POST /api/bug-report 帶 question_id。
   各答題畫面只要 include 本檔，呼叫 window.QReport.open(questionId, {page}) 即可。
   後端沿用既有 BugReport（admin /admin/bug-reports 收）。不依賴 shop.js 的內部變數，故 API 網域自帶 fallback。*/
(function () {
  "use strict";
  if (window.QReport) return;   // 防重複載入

  var API = (typeof window.DEMO_API === "string" && window.DEMO_API) ||
            "https://eduarena-tutoring-production.up.railway.app";
  var REASONS = ["題目錯誤", "答案怪怪的", "圖片看不到", "選項重複", "看不懂題目", "其他"];
  var sending = false;
  var lastSent = {};            // qid -> 時間戳，防同題短時間重複洗

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var _delegated = false;
  function injectStyle() {
    // 事件委派只綁一次：題卡的 🚩 用 data-qid/data-page，不走 inline onclick（避免 page 字串塞進 JS 的 XSS footgun，Codex P1）
    if (!_delegated) {
      _delegated = true;
      document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest(".qreport-btn") : null;
        if (!b) return;
        e.preventDefault(); e.stopPropagation();
        open(b.getAttribute("data-qid"), { page: b.getAttribute("data-page") || "" });
      });
    }
    if (document.getElementById("qreport-style")) return;
    var st = document.createElement("style");
    st.id = "qreport-style";
    st.textContent =
      ".qreport-btn{position:absolute;top:6px;right:6px;z-index:5;width:30px;height:30px;border:none;border-radius:50%;" +
      "background:rgba(0,0,0,0.18);color:#fff;font-size:15px;line-height:30px;cursor:pointer;padding:0;opacity:.65;transition:opacity .15s;}" +
      ".qreport-btn:hover{opacity:1;}" +
      "#qreport-mask{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99998;display:none;align-items:center;justify-content:center;}" +
      "#qreport-mask.show{display:flex;}" +
      "#qreport-box{background:#fff;border-radius:16px;padding:18px 18px 14px;width:min(92vw,360px);box-shadow:0 8px 30px rgba(0,0,0,.3);font-family:-apple-system,'PingFang TC',sans-serif;}" +
      "#qreport-box h3{margin:0 0 4px;font-size:17px;color:#2f2415;}" +
      "#qreport-box .qr-sub{font-size:12px;color:#8a7a60;margin-bottom:12px;}" +
      "#qreport-box .qr-reasons{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}" +
      "#qreport-box .qr-reason{border:1px solid #d8cdb6;background:#faf6ec;color:#5a4630;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer;}" +
      "#qreport-box .qr-reason.sel{background:#e8852c;border-color:#e8852c;color:#fff;}" +
      "#qreport-box textarea{width:100%;box-sizing:border-box;border:1px solid #d8cdb6;border-radius:10px;padding:8px;font-size:14px;resize:none;height:60px;}" +
      "#qreport-box .qr-hint{font-size:12px;min-height:16px;margin:6px 2px;color:#c0392b;}" +
      "#qreport-box .qr-acts{display:flex;gap:10px;justify-content:flex-end;margin-top:4px;}" +
      "#qreport-box button.qr-act{border:none;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:700;cursor:pointer;}" +
      "#qreport-box .qr-cancel{background:#eee;color:#555;}" +
      "#qreport-box .qr-send{background:#e8852c;color:#fff;}" +
      "#qreport-box .qr-send:disabled{opacity:.5;cursor:default;}";
    document.head.appendChild(st);
  }

  function buildBox() {
    if (document.getElementById("qreport-mask")) return;
    var mask = document.createElement("div");
    mask.id = "qreport-mask";
    mask.innerHTML =
      '<div id="qreport-box" role="dialog" aria-modal="true">' +
      '<h3>🚩 回報這一題</h3>' +
      '<div class="qr-sub">這題哪裡怪怪的？選一個原因，或補一句話告訴我們～</div>' +
      '<div class="qr-reasons">' +
      REASONS.map(function (r) { return '<button type="button" class="qr-reason" data-r="' + esc(r) + '">' + esc(r) + "</button>"; }).join("") +
      "</div>" +
      '<textarea id="qreport-note" maxlength="200" placeholder="（選填）多描述一點，例如：答案應該是 B 不是 C"></textarea>' +
      '<div class="qr-hint" id="qreport-hint"></div>' +
      '<div class="qr-acts">' +
      '<button type="button" class="qr-act qr-cancel">取消</button>' +
      '<button type="button" class="qr-act qr-send">送出回報</button>' +
      "</div></div>";
    document.body.appendChild(mask);
    // 點遮罩空白處關閉
    mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
  }

  var curQid = null, curPage = "", curReason = "";

  function close() {
    var mask = document.getElementById("qreport-mask");
    if (mask) mask.classList.remove("show");
  }

  function open(questionId, opts) {
    opts = opts || {};
    var qid = parseInt(questionId, 10);
    if (!(qid > 0)) { return; }   // 沒題號就不開（純記憶遊戲等）
    injectStyle(); buildBox();
    curQid = qid; curPage = String(opts.page || "").slice(0, 40); curReason = "";
    var box = document.getElementById("qreport-box");
    box.querySelectorAll(".qr-reason").forEach(function (b) { b.classList.remove("sel"); });
    var note = document.getElementById("qreport-note"); note.value = "";
    var hint = document.getElementById("qreport-hint"); hint.textContent = ""; hint.style.color = "#c0392b";
    var sendBtn = box.querySelector(".qr-send"); sendBtn.disabled = false; sendBtn.textContent = "送出回報";

    box.querySelectorAll(".qr-reason").forEach(function (b) {
      b.onclick = function () {
        box.querySelectorAll(".qr-reason").forEach(function (x) { x.classList.remove("sel"); });
        b.classList.add("sel"); curReason = b.dataset.r;
      };
    });
    box.querySelector(".qr-cancel").onclick = close;
    sendBtn.onclick = submit;
    document.getElementById("qreport-mask").classList.add("show");
  }

  async function submit() {
    if (sending) return;
    var hint = document.getElementById("qreport-hint");
    var note = (document.getElementById("qreport-note").value || "").trim();
    if (!curReason && !note) { hint.textContent = "選一個原因，或寫一句話再送出唷～"; return; }
    // 開頭快照當下這題的 qid/page/reason，await 後只認快照值（避免送出途中換題把結果記錯題，Codex P2）
    var qid = curQid, page = curPage, reason = curReason || "其他";
    // 同一題 8 秒內已回報過 → 不重複送
    var now = Date.now();
    if (lastSent[qid] && now - lastSent[qid] < 8000) { hint.style.color = "#1a7f37"; hint.textContent = "這題剛剛回報過囉，謝謝你！"; setTimeout(close, 900); return; }

    var sendBtn = document.querySelector("#qreport-box .qr-send");
    sending = true; sendBtn.disabled = true; sendBtn.textContent = "送出中…"; hint.style.color = "#8a7a60"; hint.textContent = "送出中…";
    var desc = note ? (reason + "：" + note) : reason;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 10000);
    var ok = false;
    try {
      var r = await fetch(API + "/api/bug-report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: reason, description: desc, page: page,
          question_id: qid, user_agent: navigator.userAgent,
        }),
        signal: ctrl.signal,
      });
      ok = r.ok;
    } catch (e) { ok = false; }
    finally { clearTimeout(timer); sending = false; }

    if (ok) lastSent[qid] = Date.now();
    // 彈窗可能已被切走/重開到別題：只有「還停在同一題的彈窗」才動 UI
    var mask = document.getElementById("qreport-mask");
    var stillSame = mask && mask.classList.contains("show") && curQid === qid && hint && hint.isConnected;
    if (ok) {
      if (stillSame) { hint.style.color = "#1a7f37"; hint.textContent = "✓ 已收到，謝謝你的回報！"; setTimeout(close, 1000); }
    } else if (stillSame) {
      sendBtn.disabled = false; sendBtn.textContent = "送出回報";
      hint.style.color = "#c0392b"; hint.textContent = "送出失敗了，請稍後再試一次";
    }
  }

  // 產生一顆可直接塞進題卡的 🚩 按鈕 HTML（呼叫端把它放進 position:relative 容器右上角）
  // 用 data-* 屬性帶 qid/page（HTML attribute escape 安全），點擊由委派處理，不用 inline onclick。
  function btnHTML(questionId, page) {
    var qid = parseInt(questionId, 10);
    if (!(qid > 0)) return "";
    return '<button type="button" class="qreport-btn" title="回報這題" ' +
      'data-qid="' + qid + '" data-page="' + esc(page || "") + '">🚩</button>';
  }

  injectStyle();   // 載入即注入 CSS + 綁委派，確保題卡第一次 render 的 🚩 就有樣式（Codex P2）
  window.QReport = { open: open, close: close, btnHTML: btnHTML };
})();
