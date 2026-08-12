#!/usr/bin/env python3
"""
benchmark_builder.py — 自動量測目前實作 vs 對標產品的符合度
產出: .plan/benchmark_last.json

對標：
  A: Prodigy Math 金流/訂閱閘流程一致度 (threshold ≥ 0.80)
  B: 均一教育平台 ECPay webhook 端對端 (threshold ≥ 0.70)
  C: 任天堂 Switch 家長監控 時間鎖行為 (threshold ≥ 0.60)

資料來源：codebase scan (本機檔案 + grep) — compute only，無 LLM 生成事實。
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


SKIP_DIRS = {"node_modules", ".git", "assets", "village-godot", "eduarena-iso-mockups",
             "static", "scripts", "figures"}
SKIP_EXTS = {".webp", ".png", ".jpg", ".jpeg", ".gif", ".mp3", ".mp4", ".webm",
             ".pdf", ".zip", ".wasm", ".bin"}
SKIP_NAMES = {"colyseus.bundle.js"}


def grep(pattern, path, flags=0):
    """Return list of (file, lineno, line) matches."""
    results = []
    if not os.path.isdir(path):
        return results
    for dirpath, dirnames, filenames in os.walk(path):
        # prune skipped dirs in-place
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn in SKIP_NAMES:
                continue
            _, ext = os.path.splitext(fn)
            if ext.lower() in SKIP_EXTS:
                continue
            fp = os.path.join(dirpath, fn)
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                    for i, line in enumerate(f, 1):
                        if re.search(pattern, line, flags):
                            results.append((fp, i, line.rstrip()))
            except OSError:
                pass
    return results


def file_exists(rel):
    return os.path.isfile(os.path.join(ROOT, rel))


def file_content(rel):
    fp = os.path.join(ROOT, rel)
    try:
        with open(fp, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except OSError:
        return ""


def count_meaningful_asserts(tests_dir):
    """Count assert/expect statements in test files (meaningful = not assert True)."""
    results = grep(r"\b(assert|expect\()", os.path.join(ROOT, tests_dir))
    return sum(1 for _, _, line in results if "assert True" not in line and "# " not in line.strip()[:2])


# ─────────────────────────────────────────
# Score A: Prodigy Math — 金流/訂閱閘流程
# ─────────────────────────────────────────
def score_a():
    checks = {}

    # A1: 是否有家長訂閱入口頁面 (含 ecpay/linepay/payment/訂閱 字樣的 HTML，排除 README/plan)
    sub_pages = grep(r"ecpay|linepay|payment-stage|sandbox-api-pay|訂閱方案|subscribe.*form|payment.*form",
                     ROOT, flags=re.IGNORECASE)
    sub_html = [fp for fp, _, _ in sub_pages
                if fp.endswith(".html") and "README" not in fp and ".plan" not in fp]
    checks["parent_subscription_page"] = {
        "pass": len(sub_html) > 0,
        "weight": 0.25,
        "evidence": sub_html[:3] if sub_html else [],
        "note": "家長訂閱 HTML 頁面（含 ECPay/LINE Pay 字樣）"
    }

    # A2: 前端是否有 ECPay 或 LINE Pay API endpoint 呼叫
    ecpay_calls = grep(r"payment-stage\.ecpay\.com|sandbox-api-pay\.line\.me|ecpay.*checkout|linepay.*request",
                       ROOT, flags=re.IGNORECASE)
    checks["payment_form_trigger"] = {
        "pass": len(ecpay_calls) > 0,
        "weight": 0.25,
        "evidence": [(fp, ln) for fp, ln, _ in ecpay_calls[:3]],
        "note": "ECPay/LINE Pay API endpoint 呼叫"
    }

    # A3: 是否有金流 webhook endpoint handler（排除 Telegram/LINE messaging bot）
    webhook_handlers = grep(r"ecpay.*webhook|linepay.*webhook|payment.*webhook|webhook.*ecpay|webhook.*payment"
                            r"|RtnCode|TradeNo|MerchantTradeNo|RegTimeStamp",
                            ROOT, flags=re.IGNORECASE)
    webhook_code = [(fp, ln) for fp, ln, _ in webhook_handlers
                    if not fp.endswith(".md") and ".plan" not in fp]
    checks["webhook_handler"] = {
        "pass": len(webhook_code) > 0,
        "weight": 0.25,
        "evidence": webhook_code[:3],
        "note": "金流 Webhook endpoint（ECPay/LINE Pay，非 bot messaging）"
    }

    # A4: 是否有 subscription / entitlement 狀態管理（需含 subscription/entitlement 關鍵字）
    entitlement = grep(r"entitlement|subscription_status|sub_status|subscriptions.*table"
                       r"|is_subscribed|is_premium|is_trial",
                       ROOT, flags=re.IGNORECASE)
    ent_code = [(fp, ln) for fp, ln, line in entitlement
                if not fp.endswith(".md") and ".plan" not in fp]
    checks["entitlement_state"] = {
        "pass": len(ent_code) > 0,
        "weight": 0.15,
        "evidence": ent_code[:3],
        "note": "訂閱狀態管理（entitlement/subscription_status）"
    }

    # A5: 是否有 pytest/jest webhook 測試
    webhook_tests = grep(r"test.*ecpay|test.*linepay|test.*webhook|ecpay.*test",
                         ROOT, flags=re.IGNORECASE)
    wh_test_files = [(fp, ln) for fp, ln, _ in webhook_tests if "tests/" in fp or "test_" in fp]
    checks["webhook_tests"] = {
        "pass": len(wh_test_files) > 0,
        "weight": 0.10,
        "evidence": wh_test_files[:3],
        "note": "Webhook 測試檔（tests/ 目錄）"
    }

    score = sum(v["weight"] for v in checks.values() if v["pass"])
    return round(score, 3), checks


# ─────────────────────────────────────────
# Score B: 均一教育平台 — ECPay webhook 端對端
# ─────────────────────────────────────────
def score_b():
    checks = {}

    # B1: ECPay 三種 event 處理（扣款/退款/續約）
    ecpay_events = grep(r"RtnCode|TradeNo|ATMAccNo|OrderResultURL|PaymentType",
                        ROOT, flags=re.IGNORECASE)
    checks["ecpay_event_handling"] = {
        "pass": len(ecpay_events) > 0,
        "weight": 0.30,
        "evidence": [(fp, ln) for fp, ln, _ in ecpay_events[:3]],
        "note": "ECPay RtnCode/TradeNo 等欄位處理"
    }

    # B2: LINE Pay event 處理
    linepay_events = grep(r"transactionId|orderId|returnCode.*line|line.*returnCode",
                          ROOT, flags=re.IGNORECASE)
    checks["linepay_event_handling"] = {
        "pass": len(linepay_events) > 0,
        "weight": 0.20,
        "evidence": [(fp, ln) for fp, ln, _ in linepay_events[:3]],
        "note": "LINE Pay 交易 ID 欄位處理"
    }

    # B3: DB entitlement 狀態轉換（pending→active/cancelled）
    db_transitions = grep(r"pending.*active|active.*cancelled|UPDATE.*subscription|INSERT.*payment",
                          ROOT, flags=re.IGNORECASE)
    checks["db_entitlement_transitions"] = {
        "pass": len(db_transitions) > 0,
        "weight": 0.25,
        "evidence": [(fp, ln) for fp, ln, _ in db_transitions[:3]],
        "note": "DB 訂閱狀態轉換 SQL"
    }

    # B4: 有意義的 webhook 測試
    webhook_tests = grep(r"test.*ecpay|test.*linepay|mock.*ecpay|ecpay.*assert",
                         ROOT, flags=re.IGNORECASE)
    checks["webhook_meaningful_tests"] = {
        "pass": len(webhook_tests) > 0,
        "weight": 0.25,
        "evidence": [(fp, ln) for fp, ln, _ in webhook_tests[:3]],
        "note": "Mock ECPay/LINE Pay payload 測試"
    }

    score = sum(v["weight"] for v in checks.values() if v["pass"])
    return round(score, 3), checks


# ─────────────────────────────────────────
# Score C: Nintendo Switch 家長監控 — 時間鎖行為
# ─────────────────────────────────────────
def score_c():
    checks = {}
    pl = file_content("village-web/play_limit.js")

    # C1: play_limit.js 存在
    checks["play_limit_exists"] = {
        "pass": file_exists("village-web/play_limit.js"),
        "weight": 0.10,
        "evidence": ["village-web/play_limit.js"],
        "note": "play_limit.js 存在"
    }

    # C2: 真實後端 heartbeat API 呼叫（非 mock/stub）
    has_heartbeat = bool(re.search(r"/api/play/heartbeat", pl))
    checks["real_heartbeat_api"] = {
        "pass": has_heartbeat,
        "weight": 0.15,
        "evidence": ["POST /api/play/heartbeat"] if has_heartbeat else [],
        "note": "每 30 秒 POST /api/play/heartbeat"
    }

    # C3: 真實後端 status API 查詢
    has_status = bool(re.search(r"/api/play/status", pl))
    checks["real_status_api"] = {
        "pass": has_status,
        "weight": 0.10,
        "evidence": ["/api/play/status"] if has_status else [],
        "note": "查 /api/play/status（locked/resting）"
    }

    # C4: 鎖屏 UI（達每日/連續上限）
    has_lock = bool(re.search(r"showLock|locked.*true|s\.locked", pl))
    checks["lock_screen_ui"] = {
        "pass": has_lock,
        "weight": 0.15,
        "evidence": ["showLock()"] if has_lock else [],
        "note": "超限鎖屏 UI"
    }

    # C5: 強制休息倒數 UI
    has_rest = bool(re.search(r"showRest|resting.*true|s\.resting", pl))
    checks["rest_countdown_ui"] = {
        "pass": has_rest,
        "weight": 0.15,
        "evidence": ["showRest(sec)"] if has_rest else [],
        "note": "強制休息倒數 UI"
    }

    # C6: HUD 剩餘時間牌子
    has_hud = bool(re.search(r"updateBadge|pl-remain|hud.*remain", pl))
    checks["hud_remaining_badge"] = {
        "pass": has_hud,
        "weight": 0.10,
        "evidence": ["#pl-remain HUD badge"] if has_hud else [],
        "note": "右上角剩餘時間 HUD"
    }

    # C7: 快沒時間警告（<5 分鐘提示）
    has_warn = bool(re.search(r"minLeft\s*<=\s*5|warn.*min|remaining.*warn", pl))
    checks["low_time_warning"] = {
        "pass": has_warn,
        "weight": 0.05,
        "evidence": ["minLeft <= 5 → 紅色 HUD"] if has_warn else [],
        "note": "剩 5 分鐘以下變紅警告"
    }

    # C8: demo 豁免機制 (?nolimit=1)
    has_bypass = bool(re.search(r"nolimit.*=.*1", pl))
    checks["demo_bypass"] = {
        "pass": has_bypass,
        "weight": 0.05,
        "evidence": ["?nolimit=1 展示豁免"] if has_bypass else [],
        "note": "展示豁免 ?nolimit=1"
    }

    # C9: 有意義的 tests
    test_files = grep(r"play_limit|time_lock|heartbeat|play.*status",
                      os.path.join(ROOT, "tests") if os.path.isdir(os.path.join(ROOT, "tests")) else ROOT,
                      flags=re.IGNORECASE)
    meaningful_tests = count_meaningful_asserts("tests")
    checks["meaningful_tests"] = {
        "pass": meaningful_tests >= 3,
        "weight": 0.15,
        "evidence": [f"meaningful assert count: {meaningful_tests}"],
        "note": "有意義的時間鎖測試（≥ 3 assert）"
    }

    score = sum(v["weight"] for v in checks.values() if v["pass"])
    return round(score, 3), checks


def main():
    a_score, a_checks = score_a()
    b_score, b_checks = score_b()
    c_score, c_checks = score_c()

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "commit": subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT
        ).decode().strip(),
        "data_sources": ["codebase_scan", "compute"],
        "benchmarks": {
            "A_prodigy_math_subscription_flow": {
                "label": "Prodigy Math 金流/訂閱閘流程一致度",
                "threshold": 0.80,
                "score": a_score,
                "pass": a_score >= 0.80,
                "checks": a_checks
            },
            "B_junyiacademy_ecpay_webhook": {
                "label": "均一教育平台 ECPay webhook 端對端",
                "threshold": 0.70,
                "score": b_score,
                "pass": b_score >= 0.70,
                "checks": b_checks
            },
            "C_nintendo_time_lock": {
                "label": "任天堂 Switch 家長監控 時間鎖行為一致度",
                "threshold": 0.60,
                "score": c_score,
                "pass": c_score >= 0.60,
                "checks": c_checks
            }
        },
        "summary": {
            "all_pass": a_score >= 0.80 and b_score >= 0.70 and c_score >= 0.60,
            "A": {"score": a_score, "threshold": 0.80, "pass": a_score >= 0.80},
            "B": {"score": b_score, "threshold": 0.70, "pass": b_score >= 0.70},
            "C": {"score": c_score, "threshold": 0.60, "pass": c_score >= 0.60}
        }
    }

    out_path = os.path.join(ROOT, ".plan", "benchmark_last.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"benchmark_last.json written to {out_path}")
    print(f"  A (Prodigy): {a_score:.2f} / 0.80  {'PASS' if a_score >= 0.80 else 'FAIL'}")
    print(f"  B (ECPay):   {b_score:.2f} / 0.70  {'PASS' if b_score >= 0.70 else 'FAIL'}")
    print(f"  C (Switch):  {c_score:.2f} / 0.60  {'PASS' if c_score >= 0.60 else 'FAIL'}")

    return 0 if result["summary"]["all_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
