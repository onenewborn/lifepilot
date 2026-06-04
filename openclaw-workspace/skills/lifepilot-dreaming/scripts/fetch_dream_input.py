#!/usr/bin/env python3
import argparse
import urllib.parse
from common import request_json, write_json


def main():
    parser = argparse.ArgumentParser(description="Fetch LifePilot OpenClaw dream input.")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--day-id", default="")
    parser.add_argument("--date", default="")
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    query = {"user_id": args.user_id}
    if args.day_id:
        query["day_id"] = args.day_id
    if args.date:
        query["date"] = args.date
    payload = request_json("GET", f"/api/openclaw/dream-input?{urllib.parse.urlencode(query)}")
    if args.output:
        write_json(args.output, payload)
    else:
        import json
        print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
