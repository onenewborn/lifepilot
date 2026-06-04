# 技术说明

## 降级策略

```
Level 1: 抖音 Web API + HTML DOM    →  最快，无额外依赖
         ↓ 失败 (URL 过期/反爬)
Level 2: Playwright 无头浏览器       →  拦截 douyinvod.com 视频流
         ↓ 失败 (流未加载)
Level 3: yt-dlp 兜底下载             →  最后手段
```

| Level | 速度 | 依赖 | 成功率 |
|-------|------|------|--------|
| 1 API | 快（3-10s） | 无 | 日常可用 |
| 2 Playwright | 中（15-30s） | playwright | Level 1 失败时 |
| 3 yt-dlp | 慢（10-60s） | yt-dlp | 最后兜底 |

## 工作原理

```
抖音链接 → Level 1: API 直接解析 → 下载无水印视频
         → Level 2: Playwright 打开页面 → 拦截 douyinvod.com 流 → ffmpeg 下载
         → Level 3: yt-dlp 下载 → ffmpeg 提取
         → 统一后处理: 音频提取 + 封面 + 可选硅基流动 ASR + 文案 MD
         → 带 audit 字段的 JSON 输出
```

## Level 2 Playwright 详解

```
Playwright 启动 Chromium → 打开抖音页面 → 等待视频加载
→ 拦截 douyinvod.com/video/tos/ 请求 → 获取视频流 URL
→ 从 <video> 元素获取 currentSrc 作为备选
→ ffmpeg 下载视频流（含音视频合并流）
→ 后续统一提取音频 + 封面 + ASR
```

## 环境变量

| 变量 | 必须？ | 说明 |
|------|--------|------|
| `SILICONFLOW_API_KEY` | 可选 | 硅基流动 API Key；缺失时跳过 ASR |
| `DOUYIN_API_KEY` | 可选 | `SILICONFLOW_API_KEY` 的兼容别名 |
| `DOUYIN_DISSECTION_OUTPUT_DIR` | 可选 | 覆盖默认输出目录 |

以下变量由 agent 或 Level 2 自动设置，无需手动配置：

| 变量 | 说明 |
|------|------|
| `DOUYIN_AUDIO_URL` | 音频流 URL |
| `DOUYIN_VIDEO_URL` | 视频流 URL |
| `DOUYIN_TITLE` | 视频标题 |
| `DOUYIN_AUTHOR` | 作者名 |

## 文件结构

```
douyin-video-dissector/
├── SKILL.md              ← 操作指南（入口）
├── .env.example          ← 配置模板
├── .env                  ← 用户本地配置，不提交
├── package.json          ← Node.js 依赖（playwright）
├── .claude/
│   └── settings.local.json
├── scripts/
│   └── douyin_resolver.js  ← 核心脚本（三层降级 + ASR）
├── references/
│   ├── technical.md      ← 技术说明（本文件）
│   └── troubleshooting.md ← 故障排查
└── references/
```

## 资源索引

- **核心脚本**: [scripts/douyin_resolver.js](../scripts/douyin_resolver.js)
  - 用途: 统一入口，三层降级解析 + 语音识别
  - 命令: `resolve`（完整流程）/ `info`（仅解析）/ `download`（仅下载）
  - 可选参数: `--json-output <path>` 保存机器可读结果，供 Phase 2 使用

## LifePilot 输出约定

默认输出根目录：

```text
outputs/douyin_dissections/
```

`resolve` 命令会返回 `audit` 字段，标记解析方式、ASR 状态、输出根目录和安全说明。该结果只能进入内容生产线，不能作为真实商户热度、评分、排队、订单、支付或授权状态的证据。
