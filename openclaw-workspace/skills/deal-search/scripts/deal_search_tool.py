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


def money_text(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if number.is_integer():
        return f"¥{int(number)}"
    return f"¥{round(number, 1)}"


def deal_party_text(deal):
    min_size = deal.get("party_size_min")
    max_size = deal.get("party_size_max")
    if min_size and max_size and min_size == max_size:
        return f"{min_size} 人"
    if min_size and max_size:
        return f"{min_size}-{max_size} 人"
    if min_size:
        return f"{min_size} 人起"
    if max_size:
        return f"最多 {max_size} 人"
    return ""


def discount_text(deal):
    title = str(deal.get("title") or "")
    import re
    matched = re.search(r"满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)", title)
    if matched:
        return f"满 {matched.group(1)} 减 {matched.group(2)}"
    try:
        original = float(deal.get("original_price"))
        price = float(deal.get("deal_price"))
    except (TypeError, ValueError):
        original = price = 0
    if original and price and original > price:
        return f"省 {money_text(original - price)}"
    return "套餐优惠" if deal.get("deal_type") == "set_meal" else "优惠线索"


def deal_recommendation(deal):
    best_for = next((item for item in (deal.get("best_for") or []) if item), "")
    per_person = money_text(deal.get("deal_price_per_person")) or money_text(deal.get("deal_price"))
    if best_for and per_person:
        return f"{best_for}，券后约 {per_person} / 人，去之前再确认可用状态。"
    if best_for:
        return f"{best_for}，去之前再确认可用状态。"
    return "适合想先把预算压住的一顿，去之前再确认可用状态。"


def deal_card(context):
    merchants = context.get("merchants") or []
    all_deals = []
    for item in merchants:
        merchant = item.get("merchant") or {}
        for deal in item.get("deals") or []:
            row = dict(deal)
            row["merchant_name"] = merchant.get("name") or ""
            all_deals.append(row)
    all_deals = all_deals[:5]
    top = all_deals[0] if all_deals else None
    no_deal_notes = [item.get("no_deal_note") for item in merchants if item.get("no_deal_note")]
    return {
        "type": "deal_card",
        "skill": "deal_search",
        "title": top.get("merchant_name") if top else "暂无可用优惠",
        "merchant_name": (top or {}).get("merchant_name") or "需要先选定商家",
        "poster_url": (top or {}).get("poster_url") or (top or {}).get("image_url") or "",
        "image_url": (top or {}).get("image_url") or (top or {}).get("poster_url") or "",
        "discount_text": discount_text(top) if top else "",
        "deal_price_text": (money_text(top.get("deal_price_per_person")) or money_text(top.get("deal_price"))) if top else "",
        "menu_text": "、".join(((top or {}).get("included_items") or [])[:4]),
        "recommendation": deal_recommendation(top) if top else (no_deal_notes[0] if no_deal_notes else "当前没有查到可展示的优惠线索。"),
        "subtitle": "",
        "summary": f"{discount_text(top)} · 券后约 {money_text(top.get('deal_price_per_person')) or money_text(top.get('deal_price'))} / 人" if top else (no_deal_notes[0] if no_deal_notes else "当前种子证据库里没有查到匹配优惠。"),
        "primary_points": [],
        "evidence_chips": [],
        "deals": [{
            "deal_id": deal.get("deal_id"),
            "merchant_id": deal.get("merchant_id"),
            "merchant_name": deal.get("merchant_name"),
            "title": deal.get("title"),
            "deal_type": deal.get("deal_type"),
            "poster_url": deal.get("poster_url") or deal.get("image_url") or "",
            "image_url": deal.get("image_url") or deal.get("poster_url") or "",
            "discount_text": discount_text(deal),
            "menu_text": "、".join((deal.get("included_items") or [])[:4]),
            "recommendation": deal_recommendation(deal),
            "deal_price": money_text(deal.get("deal_price")),
            "original_price": money_text(deal.get("original_price")),
            "deal_price_per_person": money_text(deal.get("deal_price_per_person")),
            "estimated_savings_per_person": money_text(deal.get("estimated_savings_per_person")),
            "party_text": deal_party_text(deal),
            "included_items": (deal.get("included_items") or [])[:4],
            "best_for": (deal.get("best_for") or [])[:3],
            "restrictions": (deal.get("restrictions") or [])[:3],
            "source_label": deal.get("source_label") or deal.get("source_type") or "",
            "data_checked_at": deal.get("data_checked_at") or "",
            "confidence_text": f"{round((deal.get('confidence') or 0) * 100)}%" if deal.get("confidence") else "",
            "caveats": (deal.get("caveats") or [])[:2],
        } for deal in all_deals],
        "no_deal_notes": no_deal_notes,
        "source_type": (top or {}).get("source_type") or "",
        "note": "这是 LifePilot 可控优惠线索，不代表真实平台实时库存、可领取或可核销；下单前仍需二次确认。",
    }


def main():
    parser = argparse.ArgumentParser(description="调用 LifePilot 优惠和团购证据工具。")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://110.42.208.125")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--question", default="")
    parser.add_argument("--query", default="")
    parser.add_argument("--merchant-id", action="append", default=[])
    parser.add_argument("--merchant-name", action="append", default=[])
    parser.add_argument("--party-size", type=int, default=0)
    parser.add_argument("--budget", type=float, default=0)
    parser.add_argument("--meal-time", default="")
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    question = args.question or args.query
    context = post_json(f"{api_base}/api/tools/deal-search-context", {
        "user_id": args.user_id,
        "merchant_ids": args.merchant_id,
        "merchant_names": args.merchant_name,
        "session_id": args.session_id,
        "question": question,
        "party_size": args.party_size or None,
        "budget": args.budget or None,
        "meal_time": args.meal_time,
    })

    print(json.dumps({
        "ok": True,
        "tool": "deal_search_context",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/tools/deal-search-context",
            "merchant_ids": args.merchant_id,
            "merchant_names": args.merchant_name,
        },
        "context": context,
        "skill_result_card": deal_card(context),
        "final_judgment_owner": "openclaw",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
