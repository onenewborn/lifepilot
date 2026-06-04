#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def post_json(url, payload, timeout=60):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            body = {"error": f"http_{exc.code}"}
        raise RuntimeError(json.dumps(body, ensure_ascii=False))


def split_csv(value):
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def parse_json_object(value, label):
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid_{label}_json: {exc}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(f"invalid_{label}_json: expected object")
    return parsed


def resolve_names(api_base, names):
    merchant_ids = []
    for name in names:
        resolved = post_json(f"{api_base}/api/tools/merchant-resolve", {"query": name, "limit": 1}, timeout=20)
        merchant_id = ((resolved.get("merchants") or [{}])[0]).get("merchant_id")
        if merchant_id and merchant_id not in merchant_ids:
            merchant_ids.append(merchant_id)
    return merchant_ids


def skill_card(session, entry_mode):
    session_id = session.get("session_id") or ""
    compare = entry_mode == "merchant_compare"
    return {
        "skill": "meal_swipe",
        "action": "open_meal_session",
        "title": "滑卡比较这几家" if compare else "直接看相关商户",
        "description": "小汪已把这几家店放进商户卡。" if compare else "小汪已按你的需求准备好商户卡。",
        "cta": "开始滑卡",
        "payload": {
            "session_id": session_id,
            "entry_mode": entry_mode,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="创建 LifePilot 第二阶段商户滑卡 session。")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://110.42.208.125")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--source-message", default="")
    parser.add_argument("--entry-mode", default="offer_only", choices=["offer_only", "merchant_compare"])
    parser.add_argument("--merchant-ids", default="")
    parser.add_argument("--merchant-names", default="")
    parser.add_argument("--entry-form-json", default="")
    parser.add_argument("--understanding-json", default="")
    parser.add_argument("--openclaw-json", default="")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    merchant_ids = split_csv(args.merchant_ids)
    merchant_ids.extend(resolve_names(api_base, split_csv(args.merchant_names)))
    deduped_ids = []
    for merchant_id in merchant_ids:
        if merchant_id not in deduped_ids:
            deduped_ids.append(merchant_id)

    payload = {
        "user_id": args.user_id,
        "source_message": args.source_message,
        "entry_mode": args.entry_mode,
        "entry_form": parse_json_object(args.entry_form_json, "entry_form"),
        "understanding": parse_json_object(args.understanding_json, "understanding"),
        "candidate_merchant_ids": deduped_ids,
        "openclaw": parse_json_object(args.openclaw_json, "openclaw"),
        "primitive_chain": ["meal-swipe:start_offer_flow"],
        "limit": args.limit,
        "ai_explanations": False,
    }
    result = post_json(f"{api_base}/api/meal/primitive/start-offers", payload)
    session = result.get("session") or {}
    entry_mode = session.get("entry_mode") or args.entry_mode
    print(json.dumps({
        "ok": True,
        "tool": "meal_swipe_start_offer_flow",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/meal/primitive/start-offers",
            "entry_mode": entry_mode,
            "candidate_merchant_ids": deduped_ids,
            "session_id": session.get("session_id") or "",
        },
        "session": {
            "session_id": session.get("session_id") or "",
            "stage": session.get("stage") or "",
            "entry_mode": entry_mode,
            "current_card_count": len(session.get("current_cards") or []),
        },
        "skill_card": result.get("skill_card") or skill_card(session, entry_mode),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
