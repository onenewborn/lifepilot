---
name: food-video-prompt-generator
description: Use this skill when the user provides restaurant or dish images plus store features and wants Chinese video-generation prompts for appetizing local-life food videos, including 4s single-dish showcase prompts and 12s restaurant visit/exploration prompts. Also use it to analyze excellent short food videos and append reusable shot, sound, narration, subtitle, dish, and environment patterns to the skill knowledge base.
---

# Food Video Prompt Generator

## Goal

Generate concise, high-appetite Chinese prompts for food video models from user-supplied images and store notes. The output should make the food look craveable and make the restaurant feel worth visiting, without inventing unsupported claims.

Default outputs:

- **4s single-dish showcase**: 1300-1500 Chinese characters, focused on one dish.
- **12s restaurant visit video**: 1800-2000 Chinese characters, focused on the store experience plus 2-4 food moments.
- Hard maximum: **2000 Chinese characters** unless the user explicitly asks otherwise.

If the user provides a different duration, scale detail proportionally while staying under 2000 Chinese characters.

The final prompt should be directly usable by a video generation model. Do not output a long director's memo unless the user asks for it.

## Inputs To Extract

From images and user notes, identify:

- Store type, cuisine, price/occasion if provided.
- One strongest selling point: signature dish, cooking technique, value, atmosphere, queue/popularity, regional flavor, freshness, craft, visual impact, or emotional occasion.
- Main visual appetite cues: steam, sauce gloss, oil shimmer, bubbling soup, char marks, crisp edges, stretchy cheese, knife cuts, wok hei, dipping sauce, hand action.
- Environment cues: facade, sign, table density, kitchen action, lighting, decor, crowd, street feel.
- Constraints and unknowns: mark uncertain visual facts as “不确定/画面未体现”; do not turn them into claims.

## Core Workflow

1. Read the user’s store introduction and image evidence.
2. Choose exactly one headline亮点. Everything in the video should serve this亮点.
3. Select a scenario:
   - Single dish / product close-up / user asks for 4s -> use **4s Dish Prompt Structure**.
   - Store exploration /探店 / multiple images / user asks for 12s -> use **12s Visit Prompt Structure**.
4. If the user references a prior优秀视频 pattern, read `references/pattern-library.md` and imitate the closest matching pattern. If no match exists, use the default structures.
5. Write a very short亮点分析, then one finished prompt, not a strategy memo.
6. Keep claims grounded in supplied images/user notes. Use phrases like “像是”“画面呈现” only in analysis, not in the final video prompt unless uncertainty matters.
7. For multi-image tasks, include a concise shot-source map before the final prompt. Use compressed three-layer identifiers inside each line: stable local label, filename, and short visual content summary. Do not output a separate long material index unless the user asks for one. For each time segment, state which material it extends from, or mark it as AI-generated if it is inferred from the store description rather than directly visible.

## 4s Dish Prompt Structure

Use a tight, sensual product-shot rhythm:

1. **0.0-0.5s hook**: extreme close-up of the most appetizing texture/action.
2. **0.5-1.5s craft/action**: pour, tear, lift, cut, stir, torch, sprinkle, dip, steam.
3. **1.5-2.8s hero reveal**: full dish beauty shot with plate/table context.
4. **2.8-4.0s bite desire**: chopsticks/spoon lifts the best bite; sauce/steam/texture emphasized; end on a memorable freeze-like hero frame.

Prompt must include:

- Lens and motion: macro lens, slow push-in, handheld micro movement, top-down, side close-up, orbit, rack focus.
- Lighting: warm store light, soft side light, glossy highlights, visible steam.
- Food texture and action.
- Subtitle intent: describe desired caption meaning separately, but avoid asking the video model to render Chinese text unless the user explicitly accepts possible text errors.
- Sound design: sizzle, bubbling, knife, spoon, sauce pour, ambient store murmur.
- Avoid: fake logos, exaggerated AI deformation, floating ingredients, unreadable text, over-clean studio look unless intended.

## 12s Visit Prompt Structure

Use a compact探店 story with a clear reason to go:

1. **0-2s arrival hook**: facade/sign/table/kitchen action or the most eye-catching dish lands first.
2. **2-4s environment credibility**: store atmosphere, staff movement, open kitchen, people eating, table texture.
3. **4-8s food sequence**: 2-3 dish/action close-ups tied to the亮点.
4. **8-10s best bite**: chopsticks/spoon lift, dipping, tearing, sauce pull, crunch/steam.
5. **10-12s closing memory point**: table spread or sign + hero dish; end with a short “值得来”的 appetite cue, not a hard guarantee.

Prompt must include:

- Shot list with time stamps.
- Source mapping: each shot should reference the material label + filename + visual content, or state “AI生成/根据店铺描述补足”.
- Camera rhythm: quick cuts for hook, slower macro for appetite, one transition tied to sound or motion.
- Ambient sound and optional口播.
- Subtitle plan: 3-5 short subtitles, each under 14 Chinese characters where possible, but mark them as post-production subtitles unless the user explicitly wants model-burned captions.
- Food/environment pairing: every environment shot should increase trust or desire, not feel like filler.

## Subtitle Handling

By default, do **not** ask the video generation model to directly render Chinese subtitles, store names, prices, or review-like text. Video models often hallucinate or garble text. Instead:

- Include a short `【后期字幕建议】` list outside the generation prompt.
- In the generation prompt, say: `画面中不要生成任何字幕、价格、评分、水印或额外文字；保留真实招牌和菜单上的原有文字即可。`
- If captions are needed, add them later with a deterministic editor/subtitle tool.
- Only request model-burned subtitles when the user explicitly accepts text-rendering risk.

## Tone And Style Rules

- Write in Chinese unless the user asks otherwise.
- Keep the prompt directly usable by a video generation model.
- Prefer sensory verbs and concrete visual evidence over generic praise.
- Make it look delicious, busy, warm, and worth visiting, but do not claim real rankings, real reviews, exact queue time, awards, or freshness guarantees unless supplied by the user.
- Do not mention real platform scraping or imply the video came from Meituan/Dianping/Douyin data.
- If the supplied images contain visible personal faces, avoid identifying them; describe them as blurred diners/staff or background atmosphere.
- If a dish/store feature is unclear from images, either omit it or make it a background possibility instead of a selling point.

## Output Format

For normal generation:

```text
【亮点分析】
抓住一个最值得拍的亮点：...

【分镜素材依据】
0-2s：基于 图A/文件名/内容摘要 延展，拍...
2-4s：AI生成/根据店铺描述补足，拍...

【后期字幕建议】
...

【视频prompt】
...
```

If the user asks for multiple options, provide at most 2 prompt options and label the chosen亮点 for each.

## Excellent Video Analysis Workflow

When the user sends an优秀视频 file, usually under 1 minute:

1. Inspect the video visually and, if possible, sample frames across the timeline.
2. Extract the reusable method rather than copying surface details.
3. Focus on:
   - Opening hook and first-frame appetite cue.
   - Shot duration and cut rhythm.
   - Food close-up technique.
   - Environment shots and how they build trust.
   - Sound design,口播, subtitles, and timing.
   - Why the video makes the restaurant feel worth visiting.
4. If a transcript or audio is available, summarize the口播 style; do not store copyrighted lines verbatim unless the user explicitly requests a brief quote and it is compliant.
5. Append a compact pattern to the knowledge base.

If the优秀视频 came through `douyin-video-dissector`, prefer the structured Phase 3 path:

```bash
python3 skills/douyin-video-dissector/scripts/extract_food_video_pattern.py \
  --analysis-json outputs/douyin_dissections/<video_id>/filming_analysis.json \
  --pattern-name <short-name> \
  --output outputs/douyin_dissections/<video_id>/pattern.md
```

Review the generated `pattern.md` before appending. Only append to `references/pattern-library.md` when the analysis status is real video understanding (`status=ok`) or the user explicitly wants a marked draft. Do not append fallback skeletons as production patterns.

For analyzing an优秀视频 to expand the knowledge base, use this schema:

```markdown
## Pattern: <short-name>
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

Then append or update the entry in `references/pattern-library.md` using `apply_patch`. Keep entries compact and reusable; do not store unrelated commentary.

## Knowledge Base

- Read `references/pattern-library.md` only when the user asks to imitate, compare, or learn from优秀视频, or when generating a prompt would clearly benefit from an existing pattern.
