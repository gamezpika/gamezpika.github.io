// 注音輔助（5/2 鵝董會議要求；5/5 派派決定拿掉手動 toggle 改純年級自動；
// 5/20 派派改：移除「依玩家年級」門檻，改成「題目有 bopomofo dict 就顯示」
// → G3 玩家做 G1 章節也有注音，符合需求方「看到 G1 題目都要有注音」）
// 規則：題目 bopomofoMap 存在 → 套 ruby；不存在 → 純文字
// 資料來源：questions.content_json.bopomofo dict {字: 注音}

(function() {
  function getUserGrade() {
    try {
      return (window.currentUser && window.currentUser.grade) || 0;
    } catch { return 0; }
  }

  // 5/20 派派：注音顯示改成「題目有 bopomofo dict 就顯示」（不再看玩家年級）。
  // shouldShowBopomofo() 函式保留為向後相容（萬一未來職業 buff 系統重啟），
  // 但 applyBopomofo() 不再 gate 它 — 純依 bopomofoMap 是否存在決定。
  window.shouldShowBopomofo = function() {
    const grade = getUserGrade();
    if (grade >= 1 && grade <= 2) return true;
    try {
      const buffs = (window.eduApp && window.eduApp.jobBuffs) || {};
      if (buffs.bopomofo_extend_g6 && grade >= 3 && grade <= 6) return true;
      if (buffs.bopomofo_extend_g4 && grade >= 3 && grade <= 4) return true;
    } catch (e) {}
    return false;
  };

  // 套 ruby tag：對每個有 bopomofo 的中文字加 <ruby>字<rt>注音</rt></ruby>
  // 沒 bopomofo dict → 回傳純文字
  // 5/20 派派：移除 shouldShowBopomofo() grade gate — 有 dict 就一律 ruby
  window.applyBopomofo = function(text, bopomofoMap) {
    if (!text) return "";
    if (!bopomofoMap || typeof bopomofoMap !== "object") return _escape(text);
    let result = "";
    for (const ch of text) {
      const py = bopomofoMap[ch];
      if (py) {
        result += `<ruby>${_escape(ch)}<rt>${_escape(py)}</rt></ruby>`;
      } else {
        result += _escape(ch);
      }
    }
    return result;
  };

  // 5/21 派派 v6：智慧斷行 + 末尾防孤兒 — 抽出共用 helper
  // 給魔王、五島、PK、模擬考/檢定考共用。規則：
  // - 標點 ，。？！ 後插 U+E000 marker → replace 成 <wbr>（soft break opportunity，瀏覽器只在內容超出時才用）
  // - 結尾標點 + 內容 ≥6 字 → 末 3 字（或 2 字若內含 wbr）包 nowrap atom 防孤兒
  // 配合 CSS overflow-wrap: anywhere 才能順利 fallback；word-break 用瀏覽器預設
  const _BR_MARK = "\uE000";
  const _NOW_OPEN = "\uE001";
  const _NOW_CLOSE = "\uE002";
  const _SMART_PUNCTS = "\uff0c\u3002\uff1f\uff01\u2014\u2026\u300d\u300f\uff09\u3011";  // ，。？！—…」』）】 (v6.18: 閉合括號也算斷點)
  const _TAIL_PUNCTS = "\uff0c\u3002\uff1f\uff01\uff1b\uff1a\u3001\u300d\u300f\uff09\u3011\u3009\u300b\u2026";  // ，。？！；：、」』）】〉》… (v6.9 擴大)

  function _smartBreak(text) {
    if (!text) return text || "";
    const chars = [...text];
    let result = "";
    // v6.10：追蹤是否在 nowrap atom 內，atom 內絕對不插 wbr
    // 之前 bug：bracket wrap 後 atom 內的 ，。？！ 被 smart break 加 wbr，
    // iOS Safari 不會忽略 atom 內的 wbr → 切斷 atom 「」 跟內容分開。
    let depth = 0;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      result += c;
      if (c === _NOW_OPEN) { depth++; continue; }
      if (c === _NOW_CLOSE) {
        depth--;
        // v6.19：atom 關閉時插 wbr，讓 browser 能在 atom 邊界斷
        // 解「📕「開」的反義詞是什麼？」整串 atom 無斷點 → 橫向溢出
        if (depth === 0 && i < chars.length - 1) result += _BR_MARK;
        continue;
      }
      if (depth > 0) continue;  // atom 內不插 wbr
      if (_SMART_PUNCTS.indexOf(c) !== -1 && i < chars.length - 1) {
        // —— 視為一個單位，只在最後一個 — 後插 wbr
        if (c === "\u2014" && chars[i + 1] === "\u2014") continue;
        result += _BR_MARK;
      }
    }
    return result;
  }

  window.applyBopomofoSmart = function(text, bopomofoMap) {
    if (!text) return "";
    // v6.6+v6.11 fast-path: 無中文標點/破折/「『/emoji + 無 bopo map → 直接 escape
    if (!bopomofoMap && !/[\uff0c\u3002\uff1f\uff01\u2014\u300c\u300e\u2026\uff08\u3010]|[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u.test(text)) {
      return _escape(text);
    }
    let marked = text;
    // v6.14：開頭 emoji block + 後續 5 字（含空格）一律綁 atom
    // 涵蓋 emoji+space+text / emoji+text+space+text / 多 emoji 連續 / emoji+1字+space 等
    marked = marked.replace(
      /^([\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\uFE0F\u200D]+[\s\S]{0,5})/u,
      _NOW_OPEN + "$1" + _NOW_CLOSE
    );
    // v6.7+v6.11 (2)：「X」/『X』/（X）/【X】 內容 ≤12 字才綁 atom
    // 長 quote (>12 字) 不綁 → 內部允許 wbr 在 ，。 處斷，避免長 atom 橫向溢出
    // v6.12 (a)：「X」 前 1-2 字綁進 atom（防 「跋」 前 「主角」 落單）
    marked = marked
      .replace(/([^\s\uE000-\uE004]{1,2})\u300c([^\u300d]{1,8})\u300d([\uff0c\u3002\uff1f\uff01\uff1b\uff1a\u3001\u2026]?)/g, _NOW_OPEN + "$1\u300c$2\u300d$3" + _NOW_CLOSE)
      .replace(/([^\s\uE000-\uE004]{1,2})\u300e([^\u300f]{1,8})\u300f([\uff0c\u3002\uff1f\uff01\uff1b\uff1a\u3001\u2026]?)/g, _NOW_OPEN + "$1\u300e$2\u300f$3" + _NOW_CLOSE);
    marked = marked
      .replace(/\u300c([^\u300d]{1,8})\u300d([\uff0c\u3002\uff1f\uff01\uff1b\uff1a\u3001\u2026]?)/g, _NOW_OPEN + "\u300c$1\u300d$2" + _NOW_CLOSE)
      .replace(/\u300e([^\u300f]{1,8})\u300f([\uff0c\u3002\uff1f\uff01\uff1b\uff1a\u3001\u2026]?)/g, _NOW_OPEN + "\u300e$1\u300f$2" + _NOW_CLOSE)
      .replace(/(\uff08[^\uff09]{1,8}\uff09)/g, _NOW_OPEN + "$1" + _NOW_CLOSE)
      .replace(/(\u3010[^\u3011]{1,8}\u3011)/g, _NOW_OPEN + "$1" + _NOW_CLOSE);
    // v6.11 (3)：字+標點+」 (3 字 atom) — 防長 quote 末「」」 落到下行頭
    marked = marked.replace(
      /([^\s\uE000-\uE004])([\uff0c\u3002\uff1f\uff01\uff1b\uff1a])([\u300d\u300f\uff09\u3011])/g,
      _NOW_OPEN + "$1$2$3" + _NOW_CLOSE
    );
    marked = _smartBreak(marked);
    // v6.8+v6.9：字+標點 atom（marker 排除避免重綁；nested 無害）
    // v6.20 派派：atom 前強制插 wbr — tail atom 在空間不夠時可整包換行
    // 解派派截圖「「父親」的同義詞是什麼？」整段右側溢出（codex 診斷：tail atom 前無斷點）
    marked = marked.replace(
      new RegExp("([^\\s\\uE000-\\uE004]{1,4})([\\uff0c\\u3002\\uff1f\\uff01\\uff1b\\uff1a\\u3001\\u2026\\uff09\\u3011\\u3009\\u300b])", "g"),
      _BR_MARK + _NOW_OPEN + "$1$2" + _NOW_CLOSE
    );
    // v6.11 (4) anti-orphan: 找末 5 個「文字字元」(跳 marker) 綁外層 atom
    // 之前 bug: last5 含 marker 就 skip → 末 2 字 atom 落單
    if ([...text].length >= 8) {
      const lastChar = text[text.length - 1];
      if (_TAIL_PUNCTS.indexOf(lastChar) !== -1) {
        let textCount = 0;
        let pos = marked.length;
        while (pos > 0 && textCount < 5) {
          pos--;
          const c = marked[pos];
          if (c !== _NOW_OPEN && c !== _NOW_CLOSE && c !== _BR_MARK) textCount++;
        }
        // 內層已有 atom 也沒關係 — nested nowrap 對瀏覽器無害
        marked = marked.slice(0, pos) + _NOW_OPEN + marked.slice(pos) + _NOW_CLOSE;
      }
    }
    const html = window.applyBopomofo(marked, bopomofoMap);
    return html
      .replace(new RegExp(_BR_MARK, "g"), "<wbr>")
      .replace(new RegExp(_NOW_OPEN, "g"), '<span style="white-space:nowrap">')
      .replace(new RegExp(_NOW_CLOSE, "g"), '</span>');
  };

  // 5/21 派派 v6.4：純插 <wbr> 不 escape — 給 mathFrac 等已輸出 HTML 用
  // 跟 applyBopomofoSmart 差異：(1) 不跑 applyBopomofo 不 escape <tag>  (2) 不做 anti-orphan（HTML slice 太脆弱）
  window.applySmartBreaksOnly = function(text) {
    if (!text) return "";
    const PUNCTS = "\uff0c\u3002\uff1f\uff01\u2014";  // ，。？！— (v6.5: 破折號)
    const chars = [...text];
    let result = "";
    for (let i = 0; i < chars.length; i++) {
      result += chars[i];
      if (PUNCTS.indexOf(chars[i]) !== -1 && i < chars.length - 1) {
        if (chars[i] === "\u2014" && chars[i + 1] === "\u2014") continue;
        result += "<wbr>";
      }
    }
    return result;
  };

  function _escape(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }
})();
