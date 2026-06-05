#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def post_json(url, payload, timeout=20):
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


def parse_evidence(value):
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return parsed
        return [parsed]
    except json.JSONDecodeError:
        return [value]


def main():
    parser = argparse.ArgumentParser(description="Create a LifePilot pending memory candidate.")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://110.42.208.125")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--day-id", default="")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--statement", default="")
    parser.add_argument("--confirmation-text", required=True)
    parser.add_argument("--category", default="general")
    parser.add_argument("--polarity", default="neutral")
    parser.add_argument("--scope", default="food")
    parser.add_argument("--strength", type=float, default=0)
    parser.add_argument("--confidence", type=float, default=0.76)
    parser.add_argument("--evidence", default="")
    parser.add_argument("--source", default="openclaw_memory_capture")
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    payload = {
        "user_id": args.user_id,
        "day_id": args.day_id,
        "session_id": args.session_id,
        "source": args.source,
        "statement": args.statement or f"主人可能想让小汪记住：{args.confirmation_text}",
        "confirmation_text": args.confirmation_text,
        "category": args.category,
        "polarity": args.polarity,
        "scope": args.scope,
        "strength": args.strength,
        "confidence": args.confidence,
        "evidence": parse_evidence(args.evidence),
        "source_event": {
            "source": args.source,
            "day_id": args.day_id,
            "session_id": args.session_id,
        },
    }
    result = post_json(f"{api_base}/api/memory/candidates", payload)
    candidate = result.get("candidate") or {}
    print(json.dumps({
        "ok": bool(result.get("ok")),
        "tool": "memory_candidate_create",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/memory/candidates",
            "user_id": args.user_id,
            "day_id": args.day_id,
        },
        "candidate": candidate,
        "memory_prompt": {
            "text": f"主人，要不要让我记住：{candidate.get('confirmation_text') or args.confirmation_text}",
            "confirmation_text": candidate.get("confirmation_text") or args.confirmation_text,
            "candidate_id": candidate.get("candidate_id") or "",
        },
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
