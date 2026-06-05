#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


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


def main():
    parser = argparse.ArgumentParser(description="Search LifePilot compact memory objects.")
    parser.add_argument("--api-base", default=os.environ.get("LIFEPILOT_API_BASE") or os.environ.get("LIFEPILOT_OPENCLAW_API_BASE") or "http://110.42.208.125")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--query", "--q", default="")
    parser.add_argument("--type", default="all")
    parser.add_argument("--day-id", default="")
    parser.add_argument("--status", default="")
    parser.add_argument("--limit", type=int, default=12)
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    query = {
        "user_id": args.user_id,
        "query": args.query,
        "type": args.type,
        "limit": str(args.limit),
    }
    if args.day_id:
        query["day_id"] = args.day_id
    if args.status:
        query["status"] = args.status
    payload = get_json(f"{api_base}/api/memory/search?{urllib.parse.urlencode(query)}")
    print(json.dumps({
        "ok": bool(payload.get("ok")),
        "tool": "memory_search",
        "trace": {
            "api_base": api_base,
            "endpoint": "/api/memory/search",
            "user_id": args.user_id,
            "query": args.query,
            "type": args.type,
        },
        "count": payload.get("count", 0),
        "results": payload.get("results") or [],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
