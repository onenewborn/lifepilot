---
name: douyin-video-dissector
description: Use this skill when the user provides a Douyin link or share text and wants to resolve, analyze, and convert a reference food video into a reusable LifePilot content-pipeline pattern. Phase 1 extracts local media and audit fields. Phase 2 analyzes local media with Ark when available and writes Markdown plus structured JSON, with a fallback skeleton when Ark is unavailable. Phase 3 extracts a compact food-video pattern for food-video-prompt-generator without copying the original transcript. It must not be used to claim real merchant popularity, ratings, queues, orders, payment, or platform authorization.
category: content-pipeline
summary: 解析抖音参考视频，生成本地素材和审计 JSON。
---

# Douyin Video Dissector

This skill covers Phase 1 to Phase 3 of the LifePilot viral-food-video pipeline:

```text
Douyin reference link
→ local video / audio / cover / optional transcript
→ resolver JSON with audit fields
→ Phase 2 filming analysis Markdown + JSON
→ Phase 3 reusable food-video pattern
→ food-video-prompt-generator
→ dreamina-video-generator
→ merchant-media-updater
```

## Scope

Use this skill to create local research artifacts under:

```text
outputs/douyin_dissections/<video_id>/
```

It is a content-pipeline tool, not a runtime recommendation provider. Extracted platform metadata must not be treated as real LifePilot merchant facts, real popularity, real rating, real queue, order, payment, booking, or transaction status.

Only use third-party videos as references when the user has rights, permission, or a legitimate review/research basis. For replication work, extract reusable filming methods instead of copying copyrighted expression.

## Environment

Required system tools:

```bash
ffmpeg
ffprobe
```

Recommended optional tools:

```bash
playwright
yt-dlp
```

Optional ASR environment variables:

```bash
SILICONFLOW_API_KEY=<key>
ARK_API_KEY=<key>
```

Compatibility aliases:

```bash
DOUYIN_API_KEY=<key>
API_KEY=<key>
```

`ARK_API_KEY` is only required for real video understanding. Without it, Phase 2 can still produce a fallback analysis skeleton for audit and workflow testing.

Do not commit real `.env` files. Use `.env.example` as the template.

## Commands

### Phase 1: Resolve Media

From the workspace root:

```bash
node skills/douyin-video-dissector/scripts/douyin_resolver.js resolve "<douyin share link>" --no-progress
```

Default output:

```text
outputs/douyin_dissections/<video_id>/
├── <video_id>.mp4
├── <video_id>.mp3
├── <video_id>.jpg
└── <video_id>.md
```

Use `-o` to override the output root:

```bash
node skills/douyin-video-dissector/scripts/douyin_resolver.js resolve "<link>" \
  -o outputs/douyin_dissections \
  --json-output outputs/douyin_dissections/<video_id>/resolver.json \
  --no-progress
```

Use `info` for a quick Level 1 probe:

```bash
node skills/douyin-video-dissector/scripts/douyin_resolver.js info "<link>" --no-progress
```

Use `download` when transcript is not needed:

```bash
node skills/douyin-video-dissector/scripts/douyin_resolver.js download "<link>" --no-progress
```

Save the JSON to a file when you want Phase 2 to consume it:

```bash
node skills/douyin-video-dissector/scripts/douyin_resolver.js resolve "<link>" \
  --json-output outputs/douyin_dissections/resolver.json \
  --no-progress
```

### Phase 2: Analyze Local Media

Preferred input is the Phase 1 resolver JSON:

```bash
python3 skills/douyin-video-dissector/scripts/douyin_script_analyzer.py \
  --from-resolver-json outputs/douyin_dissections/<video_id>/resolver.json \
  --no-progress
```

### Phase 3: Extract Reusable Pattern

Preview a pattern from Phase 2 output:

```bash
python3 skills/douyin-video-dissector/scripts/extract_food_video_pattern.py \
  --analysis-json outputs/douyin_dissections/<video_id>/filming_analysis.json \
  --pattern-name spicy-hotpot-hook-18s
```

Write a pattern draft without touching the library:

```bash
python3 skills/douyin-video-dissector/scripts/extract_food_video_pattern.py \
  --analysis-json outputs/douyin_dissections/<video_id>/filming_analysis.json \
  --pattern-name spicy-hotpot-hook-18s \
  --output outputs/douyin_dissections/<video_id>/pattern.md \
  --json-output outputs/douyin_dissections/<video_id>/pattern_extraction.json
```

Append to the food-video-prompt-generator pattern library only after the pattern has real analysis behind it:

```bash
python3 skills/douyin-video-dissector/scripts/extract_food_video_pattern.py \
  --analysis-json outputs/douyin_dissections/<video_id>/filming_analysis.json \
  --pattern-name spicy-hotpot-hook-18s \
  --append
```

Fallback analyses are refused by default when `--append` is used. Use `--allow-fallback` only for a clearly marked draft in a temporary library, not for the production `pattern-library.md`.

You can also analyze a local video directly:

```bash
python3 skills/douyin-video-dissector/scripts/douyin_script_analyzer.py \
  --video-path /abs/path/reference.mp4 \
  --transcript-path /abs/path/transcript.md \
  -o outputs/douyin_dissections/local_reference \
  --no-progress
```

Dry-run without Ark:

```bash
python3 skills/douyin-video-dissector/scripts/douyin_script_analyzer.py \
  --video-path /abs/path/reference.mp4 \
  -o outputs/douyin_dissections/local_reference \
  --fallback-only \
  --no-progress
```

## Phase 1 Output Contract

The `resolve` command prints JSON:

```json
{
  "video_info": {
    "video_id": "...",
    "title": "...",
    "url": "...",
    "author": "..."
  },
  "video_path": "/abs/path/video.mp4",
  "audio_path": "/abs/path/audio.mp3",
  "cover_path": "/abs/path/cover.jpg",
  "transcript_path": "/abs/path/transcript.md",
  "text_content": "...",
  "media_info": {
    "duration": 60.5,
    "size": 15728640
  },
  "resolve_method": "api | browser | ytdlp",
  "output_folder": "/abs/path/outputs/douyin_dissections/<video_id>",
  "audit": {
    "skill": "douyin-video-dissector",
    "phase": "phase1_resolve",
    "source_platform": "douyin",
    "resolver_method": "api | browser | ytdlp",
    "asr_provider": "siliconflow | null",
    "asr_status": "ok | skipped | failed",
    "generated_at": "ISO-8601"
  }
}
```

## Fallback Strategy

The resolver attempts:

```text
Level 1: Douyin Web API / HTML router data
Level 2: Playwright browser stream capture
Level 3: yt-dlp fallback
```

ASR is optional. If `SILICONFLOW_API_KEY` is not configured, the video, audio, cover, media metadata, and audit JSON are still produced when video resolution succeeds.

## Phase 2 Output Contract

The analyzer writes:

```text
<output_folder>/<title>_拍摄脚本分析.md
<output_folder>/filming_analysis.json
<output_folder>/shots/*.mp4  # only when Ark returns reliable timestamps
```

The structured JSON contains:

```json
{
  "video_info": {},
  "media_info": {},
  "paths": {
    "video": "...",
    "cover": "...",
    "report": "...",
    "analysis_json": "...",
    "output_folder": "...",
    "shot_files": []
  },
  "transcript": {
    "text": "...",
    "source": "resolver_json | transcript_path | none",
    "length": 0
  },
  "filming_analysis": {
    "status": "ok | fallback",
    "provider": "volcengine_ark | null",
    "model": "doubao...",
    "fps": 1,
    "text": "...",
    "shot_list": []
  },
  "audit": {
    "phase": "phase2_analyze",
    "fallback_used": false
  }
}
```

## Phase 3 Pattern Contract

The pattern extractor writes Markdown using the existing food video schema:

```markdown
## Pattern: <pattern-name>
- 适用场景:
- 核心亮点:
- 分镜节奏:
- 音效:
- 口播:
- 字幕:
- 菜品与环境搭配:
- 可复用prompt手法:
- 注意事项:
```

Rules:

- Extract reusable method, not the original video's exact wording.
- Do not store long transcript lines or platform claims in `pattern-library.md`.
- Default to preview/output files; require explicit `--append` for library writes.
- Refuse fallback analysis append unless `--allow-fallback` is provided.

## Phase Boundary

This skill stops after media extraction, optional ASR, filming-analysis artifacts, and optional reusable pattern extraction. It does not:

- generate Dreamina prompts,
- consume Dreamina credits,
- mount assets to Offer cards,
- edit synthetic food data.

Those belong to later phases.
