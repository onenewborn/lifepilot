#!/usr/bin/env python3
import argparse
import json
import re
from common import fail, load_rule, read_json


def validation_errors(payload):
    errors = []
    if not payload.get("dream_id"):
        errors.append("missing dream_id")
    if not payload.get("user_id"):
        errors.append("missing user_id")
    if not payload.get("day_id"):
        errors.append("missing day_id")
    if payload.get("status") not in ("completed", "partial", "failed"):
        errors.append("status must be completed, partial, or failed")
    if not isinstance(payload.get("summary", ""), str):
        errors.append("summary must be string")
    rules = load_rule("memory_candidate_rules.json")
    sensitive_patterns = [re.compile(pattern) for pattern in rules.get("sensitive_reject_patterns", [])]
    for index, candidate in enumerate(payload.get("memory_candidates", [])):
        prefix = f"memory_candidates[{index}]"
        statement = str(candidate.get("statement", "")).strip()
        evidence = candidate.get("evidence", [])
        confidence = float(candidate.get("confidence", 0) or 0)
        if not statement:
            errors.append(f"{prefix}.statement is required")
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"{prefix}.evidence is required")
        if confidence < 0.75:
            errors.append(f"{prefix}.confidence must be >= 0.75")
        for pattern in sensitive_patterns:
            if pattern.search(statement) or pattern.search(json.dumps(evidence, ensure_ascii=False)):
                errors.append(f"{prefix} contains sensitive text")
    return errors


def main():
    parser = argparse.ArgumentParser(description="Validate LifePilot dream result JSON.")
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    payload = read_json(args.input)
    errors = validation_errors(payload)
    if errors:
        fail("Dream result validation failed:\n- " + "\n- ".join(errors))
    print(json.dumps({"ok": True, "candidate_count": len(payload.get("memory_candidates", []))}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
