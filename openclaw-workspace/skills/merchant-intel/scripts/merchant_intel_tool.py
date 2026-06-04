#!/usr/bin/env python3
import argparse
import json
import os
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


def rating_text(reputation):
    rating = (reputation.get("rating") or {}).get("value")
    count = (reputation.get("review_stats") or {}).get("review_count") or 0
    if not rating:
        return "暂无评分证据"
    scale = (reputation.get("rating") or {}).get("scale") or 5
    return f"{rating}/{scale} · {count} 条评价量级"


def top_evidence_tags(reputation, limit=3):
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


def merchant_intel_card(context):
    reputation = context.get("merchant_reputation") or {}
    merchant = context.get("merchant") or {}
    dishes = (merchant.get("specialties") or [])[:5]
    if not dishes:
        dishes = [item.get("name") for item in (reputation.get("signature_dishes") or []) if item.get("name")][:5]
    risks = [item.get("signal") for item in (reputation.get("negative_signals") or [])[:3] if item.get("signal")]
    return {
        "type": "merchant_intel_card",
        "skill": "merchant_intel",
        "title": merchant.get("name") or "商家理解",
        "subtitle": rating_text(reputation),
        "summary": ((context.get("reputation_summary") or {}).get("text")) or "",
        "primary_points": [
            *([f"特色菜：{'、'.join(dishes)}"] if dishes else []),
            *([f"适合场景：{merchant.get('scene')}"] if merchant.get("scene") else []),
            *([f"需要留意：{'、'.join(risks)}"] if risks else []),
        ],
        "evidence_chips": top_evidence_tags(reputation),
        "source_type": reputation.get("source_type") or "",
        "note": "评分和评论分布若标记为 demo_constructed，仅用于产品原型和 OpenClaw skill 评测。",
    }


def main():
    parser = argparse.ArgumentParser(description="调用 LifePilot 单店商户理解工具。")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://127.0.0.1:4331")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--question", default="")
    parser.add_argument("--query", default="")
    parser.add_argument("--merchant-id", default="")
    parser.add_argument("--merchant-name", default="")
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    question = args.question or args.query
    merchant_id = args.merchant_id

    if not merchant_id and args.merchant_name:
        resolved = post_json(f"{api_base}/api/tools/merchant-resolve", {"query": args.merchant_name, "limit": 1})
        merchant_id = ((resolved.get("merchants") or [{}])[0]).get("merchant_id") or ""

    if not merchant_id:
        print(json.dumps({
            "ok": False,
            "error": "missing_merchant_id",
            "hint": "请提供 --merchant-id，或提供可解析的 --merchant-name。",
        }, ensure_ascii=False, indent=2))
        return 0

    context = post_json(f"{api_base}/api/tools/merchant-intel-context", {
        "user_id": args.user_id,
        "merchant_id": merchant_id,
        "session_id": args.session_id,
        "question": question,
    })

    print(json.dumps({
        "ok": True,
        "tool": "merchant_intel_context",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/tools/merchant-intel-context",
            "merchant_id": merchant_id,
        },
        "context": context,
        "skill_result_card": merchant_intel_card(context),
        "final_judgment_owner": "openclaw",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
