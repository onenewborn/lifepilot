#!/usr/bin/env python3
import argparse
import json
import os
import tempfile
from pathlib import Path

from build_dream_result import build_result
from common import request_json, write_json
from validate_dream_result import validation_errors


def main():
    parser = argparse.ArgumentParser(description="Run LifePilot dreaming end to end.")
    parser.add_argument("--user-id", default="demo_weiyingru")
    parser.add_argument("--day-id", default="")
    parser.add_argument("--date", default="")
    parser.add_argument("--api-base", default="")
    parser.add_argument("--output", default="")
    parser.add_argument("--submit", action="store_true")
    args = parser.parse_args()
    if args.api_base:
        os.environ["LIFEPILOT_API_BASE"] = args.api_base

    import urllib.parse
    query = {"user_id": args.user_id}
    if args.day_id:
        query["day_id"] = args.day_id
    if args.date:
        query["date"] = args.date

    dream_input_response = request_json("GET", f"/api/openclaw/dream-input?{urllib.parse.urlencode(query)}")
    result = build_result(dream_input_response)
    errors = validation_errors(result)
    if errors:
        raise SystemExit("Dream result validation failed:\n- " + "\n- ".join(errors))

    output_path = args.output
    if not output_path:
        output_path = str(Path(tempfile.gettempdir()) / f"{result['dream_id']}-result.json")
    write_json(output_path, result)

    submit_response = None
    if args.submit:
        submit_response = request_json("POST", "/api/openclaw/dream-result", result)

    print(json.dumps({
        "ok": True,
        "dream_id": result["dream_id"],
        "day_id": result["day_id"],
        "result_path": output_path,
        "candidate_count": len(result.get("memory_candidates", [])),
        "submitted": bool(args.submit),
        "job_id": submit_response.get("job", {}).get("job_id") if submit_response else None,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
