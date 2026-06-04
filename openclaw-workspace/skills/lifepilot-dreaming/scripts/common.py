#!/usr/bin/env python3
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API_BASE = "http://127.0.0.1:4331"


def api_base():
    return os.environ.get("LIFEPILOT_API_BASE", DEFAULT_API_BASE).rstrip("/")


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def load_rule(name):
    return read_json(SKILL_ROOT / "rules" / name)


def request_json(method, path, body=None, timeout=20):
    url = f"{api_base()}{path}"
    data = None
    headers = {"accept": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        raise RuntimeError(f"{method} {url} failed with {error.code}: {json.dumps(payload, ensure_ascii=False)}") from error


def compact_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def contains_any(text, terms):
    return any(term in text for term in terms)


def fail(message, code=1):
    print(message, file=sys.stderr)
    raise SystemExit(code)
