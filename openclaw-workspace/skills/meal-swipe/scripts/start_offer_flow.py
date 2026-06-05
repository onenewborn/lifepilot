#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
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


def get_json(url, timeout=20):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
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


HISTORY_CUES = [
    "之前",
    "上次",
    "以前",
    "记得",
    "按我的偏好",
    "按我偏好",
    "按我说过",
    "按我之前",
    "像上次",
    "别再",
]


MEMORY_QUERY_TERMS = [
    "川菜",
    "面",
    "粉",
    "米线",
    "冒菜",
    "火锅",
    "粤菜",
    "日料",
    "烧烤",
    "轻食",
    "少油",
    "不油",
    "油腻",
    "重油",
    "少排队",
    "排队",
    "等位",
    "不要辣",
    "不吃辣",
    "不能吃辣",
    "少辣",
    "附近",
    "少走路",
    "热乎",
    "清爽",
    "低负担",
]


def should_memory_preflight(message):
    text = str(message or "")
    return any(cue in text for cue in HISTORY_CUES)


def build_memory_query(message):
    text = str(message or "")
    terms = []
    for term in MEMORY_QUERY_TERMS:
        if term in text and term not in terms:
            terms.append(term)
    if terms:
        return " ".join(terms[:6])
    cleaned = text
    for cue in HISTORY_CUES:
        cleaned = cleaned.replace(cue, " ")
    return " ".join(cleaned.split()) or text


def memory_search(api_base, user_id, query, limit=6):
    params = {
        "user_id": user_id,
        "query": query,
        "type": "all",
        "limit": str(limit),
    }
    return get_json(f"{api_base}/api/memory/search?{urllib.parse.urlencode(params)}")


def result_text(result):
    return " ".join([
        str(result.get("title") or ""),
        str(result.get("text") or ""),
        str(result.get("summary") or ""),
    ]).strip()


def signal_from_memory_text(text, result_id):
    evidence = [f"memory-search:{result_id} {text[:80]}".strip()]
    signals = []
    if any(word in text for word in ["少油", "不油", "油腻", "重油", "低负担", "清爽"]):
        signals.append({
            "facet": "health_load",
            "value": "清爽低负担少油",
            "weight": "medium",
            "confidence": 0.72,
            "evidence": evidence,
        })
    if any(word in text for word in ["少排队", "排队少", "别排队", "排队久", "等位", "不用等"]):
        signals.append({
            "facet": "queue",
            "value": "少排队",
            "weight": "high",
            "confidence": 0.76,
            "evidence": evidence,
        })
    if any(word in text for word in ["附近", "近一点", "少走路", "离得近"]):
        signals.append({
            "facet": "distance",
            "value": "附近少走路",
            "weight": "medium",
            "confidence": 0.7,
            "evidence": evidence,
        })
    if any(word in text for word in ["不要辣", "不吃辣", "不能吃辣", "少辣"]):
        signals.append({
            "facet": "flavor.spice",
            "value": "不要辣",
            "weight": "high",
            "confidence": 0.78,
            "evidence": evidence,
        })
    if any(word in text for word in ["热乎", "热的", "暖一点"]):
        signals.append({
            "facet": "temperature",
            "value": "热乎",
            "weight": "medium",
            "confidence": 0.68,
            "evidence": evidence,
        })
    return signals


def merge_soft_preferences(understanding, preferences):
    existing = list(understanding.get("soft_preferences") or [])
    seen = {f"{item.get('facet')}::{item.get('value')}" for item in existing if isinstance(item, dict)}
    for item in preferences:
        key = f"{item.get('facet')}::{item.get('value')}"
        if key in seen:
            continue
        existing.append(item)
        seen.add(key)
    if existing:
        understanding["soft_preferences"] = existing
    return understanding


def maybe_apply_memory_preflight(api_base, args, understanding, openclaw):
    query = args.memory_query or build_memory_query(args.source_message)
    if args.skip_memory_preflight or not query or not should_memory_preflight(args.source_message):
        return understanding, openclaw

    payload = memory_search(api_base, args.user_id, query, limit=args.memory_limit)
    results = payload.get("results") or []
    usable = [
        item for item in results
        if item.get("type") in ["confirmed_preference", "memory_candidate", "candidate"]
    ][:args.memory_limit]
    soft_preferences = []
    for item in usable:
        text = result_text(item)
        if text:
            soft_preferences.extend(signal_from_memory_text(text, item.get("id") or item.get("preference_id") or item.get("candidate_id") or ""))

    if soft_preferences:
        understanding = merge_soft_preferences(understanding, soft_preferences)

    openclaw["memory_search"] = {
        "used": True,
        "query": query,
        "result_count": len(results),
        "hits": [
            {
                "type": item.get("type") or "",
                "id": item.get("id") or "",
                "title": item.get("title") or "",
                "text": (item.get("text") or "")[:160],
            }
            for item in usable
        ],
        "injected_soft_preferences": soft_preferences,
    }
    return understanding, openclaw


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
    parser.add_argument("--user-id", default=os.environ.get("LIFEPILOT_USER_ID") or "")
    parser.add_argument("--source-message", default="")
    parser.add_argument("--entry-mode", default="offer_only", choices=["offer_only", "merchant_compare"])
    parser.add_argument("--merchant-ids", default="")
    parser.add_argument("--merchant-names", default="")
    parser.add_argument("--entry-form-json", default="")
    parser.add_argument("--understanding-json", default="")
    parser.add_argument("--openclaw-json", default="")
    parser.add_argument("--memory-query", default="")
    parser.add_argument("--memory-limit", type=int, default=6)
    parser.add_argument("--skip-memory-preflight", action="store_true")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    if not args.user_id:
        raise RuntimeError("missing_user_id: pass --user-id with the current LifePilot user_id")
    merchant_ids = split_csv(args.merchant_ids)
    merchant_ids.extend(resolve_names(api_base, split_csv(args.merchant_names)))
    deduped_ids = []
    for merchant_id in merchant_ids:
        if merchant_id not in deduped_ids:
            deduped_ids.append(merchant_id)

    understanding = parse_json_object(args.understanding_json, "understanding")
    openclaw = parse_json_object(args.openclaw_json, "openclaw")
    understanding, openclaw = maybe_apply_memory_preflight(api_base, args, understanding, openclaw)

    payload = {
        "user_id": args.user_id,
        "source_message": args.source_message,
        "entry_mode": args.entry_mode,
        "entry_form": parse_json_object(args.entry_form_json, "entry_form"),
        "understanding": understanding,
        "candidate_merchant_ids": deduped_ids,
        "openclaw": openclaw,
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
            "memory_preflight": (openclaw.get("memory_search") or {}).get("used") is True,
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
