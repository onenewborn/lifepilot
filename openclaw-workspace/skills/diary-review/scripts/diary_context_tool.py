#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def get_json(url, timeout=30):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            body = {"error": f"http_{exc.code}"}
        raise RuntimeError(json.dumps(body, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Read LifePilot Xiaowang diary context.")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://110.42.208.125")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--date", default="")
    parser.add_argument("--include-day-context", action="store_true")
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    query = {
        "user_id": args.user_id,
        "compact": "1",
    }
    if args.date:
        query["date"] = args.date
    if args.include_day_context:
        query["include_day_context"] = "1"
    payload = get_json(f"{api_base}/api/xiaowang/diary?{urllib.parse.urlencode(query)}")
    print(json.dumps({
        "ok": bool(payload.get("ok")),
        "tool": "diary_context",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/xiaowang/diary",
            "user_id": args.user_id,
            "date": args.date,
        },
        "diary": payload,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
