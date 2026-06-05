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


def parse_target(value, candidate_id, preference_id, match_text):
    target = {}
    if value:
        parsed = json.loads(value)
        if not isinstance(parsed, dict):
            raise RuntimeError("--target-json must be an object")
        target.update(parsed)
    if candidate_id:
        target["candidate_id"] = candidate_id
    if preference_id:
        target["preference_id"] = preference_id
    if match_text:
        target["match_text"] = match_text
    return target


def main():
    parser = argparse.ArgumentParser(description="Execute a structured LifePilot memory_manage operation.")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://110.42.208.125")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--operation", required=True, choices=[
        "list_memory",
        "create_confirmed_preference",
        "confirm_pending",
        "confirm_latest_pending",
        "reject_pending",
        "update_preference",
        "delete_preference",
        "pause_preference",
    ])
    parser.add_argument("--candidate-id", default="")
    parser.add_argument("--preference-id", default="")
    parser.add_argument("--match-text", default="")
    parser.add_argument("--target-json", default="")
    parser.add_argument("--confirmation-text", default="")
    parser.add_argument("--statement", default="")
    parser.add_argument("--category", default="")
    parser.add_argument("--polarity", default="")
    parser.add_argument("--reason", default="")
    parser.add_argument("--actor", default="openclaw_memory_manager")
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    payload = {
        "user_id": args.user_id,
        "operation": args.operation,
        "target": parse_target(args.target_json, args.candidate_id, args.preference_id, args.match_text),
        "actor": args.actor,
    }
    if args.confirmation_text:
        payload["confirmation_text"] = args.confirmation_text
    if args.statement:
        payload["statement"] = args.statement
    if args.category:
        payload["category"] = args.category
    if args.polarity:
        payload["polarity"] = args.polarity
    if args.reason:
        payload["reason"] = args.reason
    result = post_json(f"{api_base}/api/memory/manage", payload)
    print(json.dumps({
        "ok": bool(result.get("ok")),
        "tool": "memory_manage",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/memory/manage",
            "user_id": args.user_id,
            "operation": args.operation,
        },
        "result": result,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
