#!/usr/bin/env python3
import argparse
import json
from common import read_json, request_json, write_json


def main():
    parser = argparse.ArgumentParser(description="Submit LifePilot dream result to backend.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    payload = read_json(args.input)
    response = request_json("POST", "/api/openclaw/dream-result", payload)
    if args.output:
        write_json(args.output, response)
    else:
        print(json.dumps(response, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
