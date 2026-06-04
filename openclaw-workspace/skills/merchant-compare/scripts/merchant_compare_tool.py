#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request


def post_json(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            body = {"error": f"http_{exc.code}"}
        raise RuntimeError(json.dumps(body, ensure_ascii=False))


def split_csv(value):
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def rating_text(reputation):
    rating = (reputation.get("rating") or {}).get("value")
    count = (reputation.get("review_stats") or {}).get("review_count") or 0
    if not rating:
        return "暂无评分证据"
    scale = (reputation.get("rating") or {}).get("scale") or 5
    return f"{rating}/{scale} · {count} 条评价量级"


def top_evidence_tags(reputation, limit=2):
    result = []
    for tag in (reputation.get("reputation_tags") or [])[:limit]:
        ratio = int(round((tag.get("mention_ratio") or 0) * 100))
        label = tag.get("tag") or ""
        count = tag.get("mention_count") or 0
        result.append({
            "label": label,
            "value": f"{ratio}%",
            "text": tag.get("evidence_text") or f"{count} 条提到 {label}",
            "sentiment": tag.get("sentiment"),
        })
    return result


def merchant_compare_card(context):
    merchants = context.get("merchants") or []
    return {
        "type": "merchant_compare_card",
        "skill": "merchant_compare",
        "title": "商家对比证据",
        "subtitle": " vs ".join([((item.get("merchant") or {}).get("name") or "") for item in merchants if (item.get("merchant") or {}).get("name")]),
        "merchants": [{
            "merchant_id": (item.get("merchant") or {}).get("merchant_id"),
            "name": (item.get("merchant") or {}).get("name"),
            "rating": rating_text(item.get("merchant_reputation") or {}),
            "scene": (item.get("merchant") or {}).get("scene") or "",
            "tags": top_evidence_tags(item.get("merchant_reputation") or {}, 2),
            "specialties": ((item.get("merchant") or {}).get("specialties") or [])[:4],
            "risks": [signal.get("signal") for signal in ((item.get("merchant_reputation") or {}).get("negative_signals") or [])[:2] if signal.get("signal")],
        } for item in merchants],
        "note": "后端没有选择 winner；小汪会基于这些证据和你的偏好说明取舍。",
    }


def resolve_names(api_base, names):
    merchant_ids = []
    for name in names:
        resolved = post_json(f"{api_base}/api/tools/merchant-resolve", {"query": name, "limit": 1})
        merchant_id = ((resolved.get("merchants") or [{}])[0]).get("merchant_id")
        if merchant_id:
            merchant_ids.append(merchant_id)
    return merchant_ids


def valid_internal_merchant_id(value):
    return re.match(r"^m_futian_\d{3}$", str(value or "")) is not None


def parse_preferences(value):
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid_preference_json: {exc}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("invalid_preference_json: expected object")
    return parsed


def search_candidates(api_base, query, preferences, user_id, limit=4):
    payload = {
        "user_id": user_id,
        "query": query,
        "preferences": preferences,
        "limit": limit,
    }
    result = post_json(f"{api_base}/api/tools/merchant-candidate-search", payload)
    candidates = result.get("candidates") or []
    merchant_ids = []
    for candidate in candidates:
        merchant_id = ((candidate.get("merchant") or {}).get("merchant_id"))
        if merchant_id and merchant_id not in merchant_ids:
            merchant_ids.append(merchant_id)
    return result, merchant_ids


def main():
    parser = argparse.ArgumentParser(description="调用 LifePilot 多店商户对比工具。")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://127.0.0.1:4331")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--question", default="")
    parser.add_argument("--query", default="")
    parser.add_argument("--merchant-ids", default="")
    parser.add_argument("--merchant-names", default="")
    parser.add_argument("--preference-json", default="", help="OpenClaw 从用户自然语言抽取出的结构化偏好 JSON。")
    parser.add_argument("--candidate-limit", type=int, default=4)
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    merchant_ids = []
    raw_merchant_ids = split_csv(args.merchant_ids)
    invalid_ids = [merchant_id for merchant_id in raw_merchant_ids if not valid_internal_merchant_id(merchant_id)]
    if invalid_ids:
        print(json.dumps({
            "ok": False,
            "error": "invalid_merchant_id_format",
            "hint": "用户不会提供内部 merchant_id。中文店名请用 --merchant-names；模糊需求请用 --preference-json 和 --query。",
            "invalid_merchant_ids": invalid_ids,
            "expected_format": "m_futian_025",
        }, ensure_ascii=False, indent=2))
        return 0

    preferences = parse_preferences(args.preference_json)
    candidate_search = None
    candidate_ids = []
    if preferences or (args.query and not raw_merchant_ids and not args.merchant_names):
        candidate_search, candidate_ids = search_candidates(
            api_base,
            args.query or args.question,
            preferences,
            args.user_id,
            args.candidate_limit,
        )

    for merchant_id in raw_merchant_ids + resolve_names(api_base, split_csv(args.merchant_names)) + candidate_ids:
        if merchant_id not in merchant_ids:
            merchant_ids.append(merchant_id)
    merchant_ids = merchant_ids[:4]

    if len(merchant_ids) < 2:
        print(json.dumps({
            "ok": False,
            "error": "need_two_merchants",
            "hint": "请提供至少两个可解析店名，或让 OpenClaw 用 --preference-json 抽取偏好后搜索候选。",
            "resolved_merchant_ids": merchant_ids,
            "candidate_search": candidate_search,
        }, ensure_ascii=False, indent=2))
        return 0

    context = post_json(f"{api_base}/api/tools/merchant-compare-context", {
        "user_id": args.user_id,
        "merchant_ids": merchant_ids,
        "session_id": args.session_id,
        "question": args.question or args.query,
    })

    print(json.dumps({
        "ok": True,
        "tool": "merchant_compare_context",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/tools/merchant-compare-context",
            "merchant_ids": merchant_ids,
            "candidate_search_endpoint": "/api/tools/merchant-candidate-search" if candidate_search else None,
        },
        "candidate_search": candidate_search,
        "context": context,
        "skill_result_card": merchant_compare_card(context),
        "final_judgment_owner": "openclaw",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
