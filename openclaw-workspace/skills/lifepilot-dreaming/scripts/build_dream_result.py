#!/usr/bin/env python3
import argparse
import json
from collections import Counter
from common import clamp, compact_text, contains_any, load_rule, read_json, write_json


NEGATIVE_TAG_TO_CATEGORY = {
    "偏油": "food_oiliness",
    "不好吃": "taste_quality",
    "偏辣": "spice",
    "排队久": "queue",
    "性价比一般": "budget",
    "环境一般": "ambience",
}


POSITIVE_TAG_TO_CATEGORY = {
    "好吃": "taste_quality",
    "环境舒服": "ambience",
    "性价比不错": "budget",
}


def unwrap_dream_input(payload):
    if payload.get("dream_input"):
        return payload["dream_input"]
    return payload


def evidence_weights():
    rules = load_rule("evidence_weights.json")
    weights = dict(rules["weights"])
    weights["base_confidence"] = rules.get("base_confidence", 0.45)
    return weights


def summarize_session(session):
    final = session.get("final_decision") or {}
    primary = final.get("primary") or {}
    return {
        "session_id": session.get("session_id", ""),
        "meal_slot": session.get("meal_slot", ""),
        "goal": session.get("goal", ""),
        "kept_count": len([e for e in session.get("direction_events", []) if e.get("action") == "keep"]),
        "disliked_count": len([e for e in session.get("direction_events", []) if e.get("action") == "dislike"]),
        "final_merchant_name": primary.get("merchant_name", ""),
        "final_offer_title": primary.get("title", ""),
    }


def direction_signal_counts(sessions):
    kept = Counter()
    disliked = Counter()
    for session in sessions:
        for event in session.get("direction_events", []):
            title = compact_text(event.get("title"))
            if not title:
                continue
            if event.get("action") == "keep":
                kept[title] += 1
            elif event.get("action") == "dislike":
                disliked[title] += 1
    return kept, disliked


def candidate_from_merchant_tag(dream, merchant, tag, polarity, score):
    weights = evidence_weights()
    is_negative = polarity == "negative"
    category = (NEGATIVE_TAG_TO_CATEGORY if is_negative else POSITIVE_TAG_TO_CATEGORY).get(tag, "merchant_experience")
    confidence = weights["base_confidence"]
    confidence += weights["negative_merchant_feedback"] if is_negative else weights["positive_merchant_feedback"]
    confidence += min(0.12, max(0, abs(float(merchant.get("score", 0))) / 100))
    confidence += min(0.10, max(0, int(merchant.get("feedback_count", 0)) * 0.04))
    feedback_text = compact_text(merchant.get("last_feedback_text"))
    if contains_any(feedback_text, ["下次别", "以后别", "别给我推", "不要再推", "还会来", "下次还来"]):
        confidence += weights.get("explicit_long_term_intent", 0.0)
    confidence = clamp(confidence)
    if is_negative:
        statement = f"主人对商户 {merchant.get('merchant_id', '')} 的体验里出现「{tag}」负反馈，后续推荐这家店时需要谨慎。"
    else:
        statement = f"主人对商户 {merchant.get('merchant_id', '')} 的体验里出现「{tag}」正反馈，后续可以作为商户解释依据。"
    return {
        "type": "merchant_experience",
        "category": category,
        "polarity": polarity,
        "scope": "merchant",
        "strength": clamp(abs(score) / 20),
        "confidence": round(confidence, 2),
        "statement": statement,
        "evidence": [
            {
                "source": "merchant_feedback_summary",
                "merchant_id": merchant.get("merchant_id", ""),
                "session_id": merchant.get("last_session_id", ""),
                "reason": feedback_text[:180],
            }
        ],
        "needs_confirmation": True,
    }


def build_memory_candidates(dream):
    candidates = []
    merchant_summary = dream.get("merchant_feedback_summary") or {}
    merchants = merchant_summary.get("merchants") or []
    for merchant in merchants:
        score = float(merchant.get("score", 0) or 0)
        for tag in merchant.get("negative_tags", [])[:2]:
            candidate = candidate_from_merchant_tag(dream, merchant, tag, "negative", score)
            if candidate["confidence"] >= 0.75:
                candidates.append(candidate)
        for tag in merchant.get("positive_tags", [])[:2]:
            candidate = candidate_from_merchant_tag(dream, merchant, tag, "positive", score)
            if candidate["confidence"] >= 0.75:
                candidates.append(candidate)
    return candidates[:8]


def build_interaction_ideas(dream):
    rules = load_rule("interaction_idea_rules.json")["rules"]
    merchants = (dream.get("merchant_feedback_summary") or {}).get("merchants") or []
    ideas = []
    all_tags = []
    for merchant in merchants:
        all_tags.extend(merchant.get("negative_tags", []))
        all_tags.extend(merchant.get("positive_tags", []))
    for rule in rules:
        trigger_tags = rule.get("trigger_tags", [])
        if trigger_tags and not any(tag in all_tags for tag in trigger_tags):
            continue
        if rule["name"] == "negative_feedback_repair":
            ideas.append({
                "type": rule["idea_type"],
                "timing_hint": rule["timing_hint"],
                "draft": "下次主人再让我选饭，小汪会记得避开这次踩到的体验点，先把更稳妥的放前面。",
            })
    return ideas[:4]


def build_result(payload):
    dream = unwrap_dream_input(payload)
    sessions = dream.get("meal_sessions") or []
    session_summaries = [summarize_session(session) for session in sessions]
    kept, disliked = direction_signal_counts(sessions)
    merchant_count = len((dream.get("merchant_feedback_summary") or {}).get("merchants") or [])
    daily_summary = {
        "meal_session_count": len(sessions),
        "sessions": session_summaries,
        "top_kept_directions": kept.most_common(5),
        "top_disliked_directions": disliked.most_common(5),
        "merchant_feedback_count": merchant_count,
    }
    situational_signals = []
    for session in sessions:
        goal = compact_text(session.get("goal") or session.get("understanding", {}).get("raw_entry_text"))
        if contains_any(goal, ["下班", "累", "疲惫", "省心"]):
            situational_signals.append({
                "signal": "下班疲惫场景下需要省心、低决策成本的饭点选择",
                "session_id": session.get("session_id", ""),
                "evidence": goal,
            })
    result = {
        "dream_id": dream.get("dream_id", ""),
        "user_id": dream.get("user_id", "demo_weiyingru"),
        "day_id": dream.get("day_id", ""),
        "status": "completed",
        "summary": build_summary_text(daily_summary, situational_signals),
        "daily_summary": daily_summary,
        "stable_signals": [],
        "situational_signals": situational_signals,
        "memory_candidates": build_memory_candidates(dream),
        "preference_update_suggestions": [],
        "merchant_feedback_insights": build_merchant_insights(dream),
        "xiaowang_next_interaction_ideas": build_interaction_ideas(dream),
    }
    return result


def build_merchant_insights(dream):
    insights = []
    merchants = (dream.get("merchant_feedback_summary") or {}).get("merchants") or []
    for merchant in merchants[:8]:
        tags = merchant.get("negative_tags", []) or merchant.get("positive_tags", [])
        if not tags:
            continue
        insights.append({
            "merchant_id": merchant.get("merchant_id", ""),
            "score": merchant.get("score", 0),
            "tags": tags,
            "summary": f"这家店最近反馈标签：{'、'.join(tags)}。",
        })
    return insights


def build_summary_text(daily_summary, situational_signals):
    count = daily_summary["meal_session_count"]
    parts = [f"今天共有 {count} 次饭点决策记录。"]
    if daily_summary["top_kept_directions"]:
        parts.append(f"保留较多的方向包括 {daily_summary['top_kept_directions'][0][0]}。")
    if daily_summary["merchant_feedback_count"]:
        parts.append("今天存在商户体验反馈，适合沉淀为待确认候选。")
    if situational_signals:
        parts.append("出现了下班疲惫等场景信号，应先作为场景偏好处理。")
    return "".join(parts)


def main():
    parser = argparse.ArgumentParser(description="Build LifePilot dream result from dream input.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    result = build_result(read_json(args.input))
    if args.output:
        write_json(args.output, result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
