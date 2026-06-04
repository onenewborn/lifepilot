#!/usr/bin/env python3
"""Extract a reusable food-video pattern from Phase 2 analysis JSON.

The output is intentionally compact and method-focused. It should describe
filming structure, rhythm, and reusable prompt techniques without copying
the original video's transcript verbatim.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
WORKSPACE_ROOT = SKILL_DIR.parent.parent
DEFAULT_LIBRARY = WORKSPACE_ROOT / "skills" / "food-video-prompt-generator" / "references" / "pattern-library.md"


FOOD_SCENE_KEYWORDS = [
    ("火锅", "火锅/热锅/汤底沸腾类门店"),
    ("烧烤", "烧烤/烤串/炉火现烤类门店"),
    ("烧鸟", "日料烧鸟/烤物/居酒屋类门店"),
    ("寿司", "寿司/日料/小份多品类探店"),
    ("甜品", "甜品/糖水/小吃单品测评"),
    ("糖水", "甜品/糖水/小吃单品测评"),
    ("米线", "米线/粉面/一碗主食深度测评"),
    ("面", "面食/粉面/主食嗦入口感测评"),
    ("小吃", "街边小吃/窗口小食/制作过程短视频"),
    ("炸", "油炸小吃/锅气制作过程短视频"),
    ("茶餐厅", "茶餐厅/快餐/多品类到店测评"),
    ("湘菜", "重口味下饭菜/小炒/锅气类门店"),
    ("川菜", "重口味下饭菜/红油香气类门店"),
]

TECHNIQUE_KEYWORDS = [
    ("特写", "macro food close-up"),
    ("大特写", "extreme macro texture shot"),
    ("近景", "close tasting shot"),
    ("中景", "storefront or table context shot"),
    ("推镜头", "slow push-in"),
    ("拉镜头", "pull-back reveal"),
    ("跟镜头", "handheld follow"),
    ("固定", "stable locked-off food shot"),
    ("快切", "quick cut hook montage"),
    ("硬切", "clean hard cuts"),
    ("暖", "warm practical lighting"),
    ("油光", "sauce gloss and oil shimmer"),
    ("热气", "visible steam"),
    ("咀嚼", "restrained tasting reaction"),
    ("嗦", "slurp texture close-up"),
    ("拌", "mixing and sauce coating action"),
]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower())
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or "food-video-pattern"


def compact_text(value: str, limit: int = 180) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def analysis_text(payload: dict[str, Any]) -> str:
    return str(payload.get("filming_analysis", {}).get("text") or "")


def transcript_text(payload: dict[str, Any]) -> str:
    return str(payload.get("transcript", {}).get("text") or "")


def title_text(payload: dict[str, Any]) -> str:
    return str(payload.get("video_info", {}).get("title") or "")


def status(payload: dict[str, Any]) -> str:
    return str(payload.get("filming_analysis", {}).get("status") or "unknown")


def shot_list(payload: dict[str, Any]) -> list[dict[str, Any]]:
    shots = payload.get("filming_analysis", {}).get("shot_list") or []
    return shots if isinstance(shots, list) else []


def choose_scene(payload: dict[str, Any]) -> str:
    haystack = f"{title_text(payload)}\n{analysis_text(payload)}\n{transcript_text(payload)}"
    matches = []
    for keyword, scene in FOOD_SCENE_KEYWORDS:
        if keyword in haystack and scene not in matches:
            matches.append(scene)
    if matches:
        return "、".join(matches[:3]) + "。"
    return "餐饮探店、单店推荐、菜品质感展示或本地生活 Offer 卡视频。"


def section_body(text: str, headings: list[str]) -> str:
    for heading in headings:
        match = re.search(rf"{re.escape(heading)}[^\n]*\n(?P<body>.*?)(?:\n##|\n#|\Z)", text, re.S)
        if match:
            return match.group("body")
    return ""


def clean_markdown_line(line: str) -> str:
    cleaned = re.sub(r"^[\s\-*>\d.、）)]+", "", line).strip()
    cleaned = re.sub(r"\*\*", "", cleaned)
    cleaned = re.sub(r"^#+\s*", "", cleaned).strip()
    return cleaned


def useful_line(line: str) -> bool:
    if len(line) < 8:
        return False
    if line.startswith("```") or line.startswith("|") or set(line) <= {"-", "|", " "}:
        return False
    low_signal = {"通用框架模板", "软件选择", "BGM选择", "字幕样式", "节奏把控"}
    if line in low_signal:
        return False
    return True


def extract_section_line(text: str, headings: list[str]) -> str:
    body = section_body(text, headings)
    if not body:
        return ""
    for line in body.splitlines():
        cleaned = clean_markdown_line(line)
        if useful_line(cleaned):
            return compact_text(cleaned, 170)
    return ""


def extract_line_matching(text: str, headings: list[str], patterns: list[str]) -> str:
    body = section_body(text, headings)
    if not body:
        return ""
    compiled = [re.compile(pattern) for pattern in patterns]
    for line in body.splitlines():
        cleaned = clean_markdown_line(line)
        if useful_line(cleaned) and any(pattern.search(cleaned) for pattern in compiled):
            return compact_text(cleaned, 170)
    return ""


def rhythm_from_shots(shots: list[dict[str, Any]], fallback: bool) -> str:
    if not shots or fallback:
        return "待真实视频理解补全；草稿阶段只保留“开场钩子 → 食物/环境证明 → 最佳一口 → 收尾记忆点”的通用结构。"
    parts = []
    for shot in shots[:8]:
        start = shot.get("start", "?")
        end = shot.get("end", "?")
        shot_type = shot.get("shot_type", "镜头")
        subject = shot.get("subject", "画面重点")
        parts.append(f"{start}-{end} {shot_type}{subject}")
    suffix = "；后续镜头按同一信息密度推进。" if len(shots) > 8 else "。"
    return "；".join(parts) + suffix


def core_highlight(payload: dict[str, Any], fallback: bool) -> str:
    if fallback:
        return "当前是 fallback 草稿，只能保留参考视频的基础时长和待分析占位；正式入库前必须用 Ark 或人工分析补全核心亮点。"
    text = analysis_text(payload)
    extracted = extract_section_line(text, ["拍摄手法亮点", "核心亮点", "亮点"])
    if extracted:
        return extracted
    shots = shot_list(payload)
    if shots:
        first = shots[0]
        return f"用 {first.get('shot_type', '开场镜头')} 的 {first.get('subject', '画面重点')} 先建立观看理由，再用食物细节和试吃反应证明。"
    return "用明确的开场理由、连续食物动作和最后一口反应完成短视频转化。"


def sound_design(payload: dict[str, Any], fallback: bool) -> str:
    if fallback:
        return "待补全；默认保留店内环境声、食物制作声和轻量背景音乐，不压过口播。"
    text = analysis_text(payload)
    extracted = extract_line_matching(text, ["音效", "BGM", "背景音乐", "剪辑建议"], [r"BGM|背景音乐|人声|原声|音量|咀嚼|环境声"])
    if extracted and len(extracted) <= 190:
        return extracted
    return "原声口播优先，保留筷勺碰撞、油脂滋啦、汤汁沸腾、咀嚼/嗦粉等真实食物声；背景音乐低音量垫底。"


def narration_style(payload: dict[str, Any], fallback: bool) -> str:
    if fallback:
        return "待补全；不要照抄原视频口播，只保留“开场理由-菜品动作-口感判断-适用场景”的句式骨架。"
    text = analysis_text(payload)
    extracted = extract_line_matching(text, ["内容策划", "口播", "脚本结构拆解"], [r"开头|钩子|中间|主体|结尾|口播|文案"])
    if extracted:
        return f"复用结构而非原句：{compact_text(extracted, 180)}"
    return "复用结构而非原句：先点出到店理由或单品卖点，再用具体质地词解释好吃在哪里，最后给适用人群或场景。"


def subtitle_style(payload: dict[str, Any], fallback: bool) -> str:
    if fallback:
        return "待补全；默认用短字幕贴合动作节奏，避免把原视频文案直接搬进新视频。"
    text = analysis_text(payload)
    extracted = extract_line_matching(text, ["字幕", "剪辑建议"], [r"字幕|重点描述|字号|颜色|放大"])
    if extracted:
        return compact_text(extracted, 170)
    return "3-5 条后期字幕，跟随动作和评价维度切换；每条尽量短，突出菜名、质地动作和适用场景。"


def environment_pairing(payload: dict[str, Any], fallback: bool) -> str:
    if fallback:
        return "待补全；默认用门头/桌面/厨房动作建立可信度，食物特写负责食欲。"
    text = analysis_text(payload)
    extracted = extract_section_line(text, ["场景转换", "菜品与环境搭配", "脚本结构拆解"])
    if extracted:
        return compact_text(extracted, 180)
    return "环境镜头只承担到店可信度和烟火气，食物动作承担主要食欲，试吃反应承担信任。"


def reusable_techniques(payload: dict[str, Any]) -> str:
    haystack = f"{analysis_text(payload)}\n{transcript_text(payload)}"
    techniques = []
    for keyword, technique in TECHNIQUE_KEYWORDS:
        if keyword in haystack and technique not in techniques:
            techniques.append(technique)
    if not techniques:
        techniques = [
            "handheld vertical video",
            "macro food insert",
            "warm practical lighting",
            "clean hard cuts",
            "final bite hero frame",
        ]
    return ", ".join(techniques[:10]) + "。"


def notes(payload: dict[str, Any], fallback: bool) -> str:
    base = [
        "只复用拍法、节奏和结构，不照抄原视频口播、字幕或具体表达",
        "不要把参考视频的平台信息写成真实热度、评分、排队、授权或交易状态",
        "迁移到 LifePilot 合成 Offer 时，所有菜品、价格、门店信息必须来自用户素材或合成数据",
    ]
    if fallback:
        base.insert(0, "这是 fallback 草稿，默认不能写入正式 pattern-library")
    return "; ".join(base) + "。"


def default_pattern_name(payload: dict[str, Any]) -> str:
    title = title_text(payload)
    duration = payload.get("media_info", {}).get("duration")
    if duration:
        title = f"{title}-{int(float(duration))}s"
    return slugify(title or "douyin-reference-pattern")


def build_pattern(payload: dict[str, Any], pattern_name: str) -> str:
    fallback = status(payload) != "ok"
    shots = shot_list(payload)
    lines = [
        f"## Pattern: {pattern_name}",
        f"- 适用场景: {choose_scene(payload)}",
        f"- 核心亮点: {core_highlight(payload, fallback)}",
        f"- 分镜节奏: {rhythm_from_shots(shots, fallback)}",
        f"- 音效: {sound_design(payload, fallback)}",
        f"- 口播: {narration_style(payload, fallback)}",
        f"- 字幕: {subtitle_style(payload, fallback)}",
        f"- 菜品与环境搭配: {environment_pairing(payload, fallback)}",
        f"- 可复用prompt手法: {reusable_techniques(payload)}",
        f"- 注意事项: {notes(payload, fallback)}",
    ]
    return "\n".join(lines) + "\n"


def append_pattern(library: Path, pattern_name: str, pattern_markdown: str, replace: bool = False) -> None:
    content = library.read_text(encoding="utf-8") if library.exists() else "# Food Short Video Pattern Library\n"
    header = f"## Pattern: {pattern_name}"
    if header in content:
        if not replace:
            raise ValueError(f"Pattern already exists: {pattern_name}. Use --replace to overwrite.")
        pattern_re = re.compile(rf"\n## Pattern: {re.escape(pattern_name)}\n.*?(?=\n## Pattern: |\Z)", re.S)
        next_content, count = pattern_re.subn("\n" + pattern_markdown.rstrip() + "\n", content)
        if count == 0:
            raise ValueError(f"Could not replace existing pattern: {pattern_name}")
        save_text(library, next_content.rstrip() + "\n")
        return
    save_text(library, content.rstrip() + "\n\n" + pattern_markdown.rstrip() + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract reusable food-video pattern markdown from Phase 2 analysis JSON.")
    parser.add_argument("--analysis-json", required=True, help="Path to Phase 2 filming_analysis.json")
    parser.add_argument("--pattern-name", help="Pattern id to write, e.g. spicy-hotpot-hook-18s")
    parser.add_argument("--output", help="Write pattern markdown to this file")
    parser.add_argument("--json-output", help="Write extraction metadata JSON to this file")
    parser.add_argument("--library", default=str(DEFAULT_LIBRARY), help="Pattern library path")
    parser.add_argument("--append", action="store_true", help="Append to pattern library")
    parser.add_argument("--replace", action="store_true", help="Replace an existing pattern with the same name")
    parser.add_argument("--allow-fallback", action="store_true", help="Allow fallback analysis to be appended")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    analysis_path = Path(args.analysis_json).expanduser().resolve()
    payload = load_json(analysis_path)
    pattern_name = slugify(args.pattern_name) if args.pattern_name else default_pattern_name(payload)
    pattern = build_pattern(payload, pattern_name)
    is_fallback = status(payload) != "ok"

    if args.output:
        save_text(Path(args.output).expanduser().resolve(), pattern)

    metadata = {
        "pattern_name": pattern_name,
        "analysis_json": str(analysis_path),
        "analysis_status": status(payload),
        "fallback": is_fallback,
        "library": str(Path(args.library).expanduser().resolve()),
        "appended": False,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    if args.append:
        if is_fallback and not args.allow_fallback:
            raise SystemExit("Refusing to append fallback analysis. Re-run with real Ark analysis or pass --allow-fallback for a draft.")
        append_pattern(Path(args.library).expanduser().resolve(), pattern_name, pattern, replace=args.replace)
        metadata["appended"] = True

    if args.json_output:
        save_text(Path(args.json_output).expanduser().resolve(), json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")

    print(pattern)
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
