#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  submit_dreamina_video.sh --prompt-file FILE [--image PATH ...] [--video PATH ...] [--audio PATH ...]
                           [--duration N] [--ratio 9:16] [--model seedance2.0fast_vip]
                           [--poll N] [--text-only]

Defaults:
  --duration 15
  --ratio 9:16
  --model seedance2.0fast_vip
  --poll 120

Behavior:
  With any --image/--video/--audio, uses dreamina multimodal2video.
  With --text-only, uses dreamina text2video and ignores media inputs.
USAGE
}

prompt_file=""
duration="15"
ratio="9:16"
model="seedance2.0fast_vip"
poll="120"
text_only="0"
images=()
videos=()
audios=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file)
      prompt_file="${2:-}"; shift 2 ;;
    --image)
      images+=("${2:-}"); shift 2 ;;
    --video)
      videos+=("${2:-}"); shift 2 ;;
    --audio)
      audios+=("${2:-}"); shift 2 ;;
    --duration)
      duration="${2:-}"; shift 2 ;;
    --ratio)
      ratio="${2:-}"; shift 2 ;;
    --model|--model_version)
      model="${2:-}"; shift 2 ;;
    --poll)
      poll="${2:-}"; shift 2 ;;
    --text-only)
      text_only="1"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

if [[ -z "$prompt_file" || ! -f "$prompt_file" ]]; then
  echo "--prompt-file is required and must exist" >&2
  exit 2
fi

if ! command -v dreamina >/dev/null 2>&1; then
  if [[ -x "$HOME/.local/bin/dreamina" ]]; then
    PATH="$HOME/.local/bin:$PATH"
  else
    echo "dreamina CLI not found. Install with: curl -fsSL https://jimeng.jianying.com/cli | bash" >&2
    exit 127
  fi
fi

prompt="$(cat "$prompt_file")"

if [[ "$text_only" == "1" || ( ${#images[@]} -eq 0 && ${#videos[@]} -eq 0 && ${#audios[@]} -eq 0 ) ]]; then
  dreamina text2video \
    --prompt "$prompt" \
    --duration "$duration" \
    --ratio "$ratio" \
    --model_version "$model" \
    --poll "$poll"
  exit $?
fi

cmd=(dreamina multimodal2video)
for image in "${images[@]}"; do
  cmd+=(--image "$image")
done
for video in "${videos[@]}"; do
  cmd+=(--video "$video")
done
for audio in "${audios[@]}"; do
  cmd+=(--audio "$audio")
done
cmd+=(--prompt "$prompt" --duration "$duration" --ratio "$ratio" --model_version "$model" --poll "$poll")

"${cmd[@]}"
