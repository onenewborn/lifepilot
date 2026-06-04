---
name: dreamina-video-generator
description: Use this skill when the user wants to generate videos with the local Dreamina/即梦 CLI, especially text2video, image2video, frames2video, or multimodal2video/all-around reference workflows; includes login checks, model selection, VIP queue guidance, polling, downloading, and result reporting.
---

# Dreamina Video Generator

## Purpose

Submit and manage video generation tasks through the local official 即梦 CLI command `dreamina`.

Use this skill after a video prompt is ready, often after `food-video-prompt-generator` has produced the prompt. This skill handles CLI execution, model choice, queue behavior, download paths, and status reporting.

## Preconditions

- CLI command: `dreamina`
- Cloud workspace expects `dreamina` to be available on `PATH` before this skill is used.
- Confirm availability with:

```bash
dreamina -h
dreamina user_credit
```

If `dreamina` is not found, install it on the cloud host and make sure the binary is available on `PATH`. The install command from the official tutorial is:

```bash
curl -fsSL https://jimeng.jianying.com/cli | bash
```

Login check:

```bash
dreamina user_credit
```

If not logged in:

```bash
dreamina login
```

For headless login:

```bash
dreamina login --headless
dreamina login checklogin --device_code=<device_code> --poll=30
```

## Model Choice

Default to VIP for user-facing generation unless the user explicitly asks to save credits:

- `seedance2.0fast_vip`: preferred default for fast 720p generation.
- `seedance2.0fast`: cheaper but may sit in a long queue.
- `seedance2.0_vip`: use when quality matters more than speed/credits; supports 720p or 1080p.

Known behavior from this workspace:

- Non-VIP `seedance2.0fast` may remain in `Queueing` for a long time.
- `seedance2.0fast_vip` can cost more credits but usually enters `Generating` immediately.
- The CLI exposes no task-cancel command in `-h`; do not promise cancellation or refunds. If a non-VIP task was submitted by mistake, report the old `submit_id`, submit a VIP task if the user wants speed, and explain that refund/cancel is not available through the CLI.

## Command Selection

Use `multimodal2video` when the user provides reference images, reference videos, or audio. This is the strongest all-around reference mode.

```bash
dreamina multimodal2video \
  --image ./store.jpg \
  --image ./dish.jpg \
  --video ./reference.mp4 \
  --prompt "$(cat prompt.txt)" \
  --duration=15 \
  --ratio=9:16 \
  --model_version=seedance2.0fast_vip \
  --poll=120
```

Use `text2video` for prompt-only generation:

```bash
dreamina text2video \
  --prompt "$(cat prompt.txt)" \
  --duration=12 \
  --ratio=9:16 \
  --model_version=seedance2.0fast_vip \
  --poll=120
```

Use `image2video` for one first-frame image:

```bash
dreamina image2video \
  --image ./first.png \
  --prompt "$(cat prompt.txt)" \
  --duration=8 \
  --model_version=seedance2.0fast_vip \
  --poll=120
```

Use `frames2video` for first and last frames:

```bash
dreamina frames2video \
  --first ./start.png \
  --last ./end.png \
  --prompt "$(cat prompt.txt)" \
  --duration=8 \
  --model_version=seedance2.0fast_vip \
  --poll=120
```

## Supported Parameters

Common video settings:

- Ratio: `1:1`, `3:4`, `16:9`, `4:3`, `9:16`, `21:9`
- Duration for Seedance 2.0 family: `4-15` seconds
- Resolution: most models use `720p`; `seedance2.0_vip` can support `720p` or `1080p`

For local-life/short-video work, prefer:

- `--ratio=9:16`
- `--duration=12` or `--duration=15`
- `--model_version=seedance2.0fast_vip`

## Workflow

1. Save the final prompt to `outputs/dreamina_prompts/<slug>.txt`.
2. Confirm `dreamina user_credit` if credits matter.
3. Submit with the appropriate command, usually `multimodal2video`.
4. Capture and report:
   - `submit_id`
   - `model_version`
   - `credit_count`
   - `gen_status`
   - `queue_status`
5. If still running, query with:

```bash
dreamina query_result --submit_id=<submit_id>
```

6. Download finished results with:

```bash
dreamina query_result --submit_id=<submit_id> --download_dir outputs/dreamina_videos
```

7. Return the local video path as a clickable Markdown link and, in Codex desktop, include a Markdown video/image preview link if useful.

## Helper Script

For the common all-around reference workflow, prefer the bundled script:

```bash
skills/dreamina-video-generator/scripts/submit_dreamina_video.sh \
  --prompt-file outputs/dreamina_prompts/example.txt \
  --image /abs/path/store.png \
  --image /abs/path/dish.png \
  --duration 15 \
  --ratio 9:16 \
  --model seedance2.0fast_vip \
  --poll 120
```

The script prints the Dreamina JSON result. Use `query_result` afterward if the task is still `querying`.

## Safety And Output Rules

- Do not submit tasks without user intent because all generation operations consume credits.
- Before submitting, mention the model and whether VIP credits will be used if the user has not already approved generation.
- Do not claim cancellation/refund is possible unless `dreamina -h` exposes it or a command succeeds.
- If generation fails with `AigcComplianceConfirmationRequired`, tell the user to complete the Dreamina Web authorization confirmation, then retry.
- Keep prompts in files when they are long; shell interpolation with long prompts is easier to audit from a saved file.
