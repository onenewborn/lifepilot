# 项目驾驶舱

更新时间：2026-06-01 15:30

## 一句话

LifePilot 已经从 `~/.openclaw/workspace` 中拆出，形成独立产品仓库 `/Users/mona/Documents/lifepilot`。当前主线是：用低延迟 API 承接饭点滑卡实时链路，用 OpenClaw 承接后台 dreaming、skills、小汪互动和更重的 agent 工作。

## 当前架构边界

```text
小程序 / 产品后端
  负责 meal session、推荐卡流、入口解析、商户排序、天气/路线/排队上下文、
  权威 memory CRUD、饭后反馈、低延迟 Ark/Doubao 调用、COS 资产解析。

OpenClaw Runtime
  负责 AGENTS/SOUL/skills、dreaming、后台任务、小汪互动内容、
  候选记忆复盘、需要工具调用和更长思考的 agent 能力。

Evermind
  作为长期记忆增强服务接入。当前用于写入/读取部分长期记忆，
  但产品后端仍是推荐链路读取记忆的权威入口。
```

硬边界：OpenClaw 不直接读写产品 runtime 文件；它通过产品后端 API 读 session、day context、memory，并提交候选结果。

## 旧 Workspace 安全状态

旧 workspace 保持原路径不动：

```text
/Users/mona/.openclaw/workspace
```

完整备份：

```text
/Users/mona/.openclaw/backups/lifepilot-workspace-20260530-120256
```

旧 workspace git checkpoint：

```text
commit: d741a9e chore: checkpoint before lifepilot rebuild
tag: lifepilot-rebuild-base-20260530
```

## 当前产品状态

新小程序目录：

```text
/Users/mona/Documents/lifepilot/apps/lifepilot-miniprogram
```

当前小程序已经开放三段主入口：

```text
问小汪：默认第一入口，轻量聊天入口，OpenClaw 应直接按需调用独立 skills/tools，例如 meal-swipe、merchant-intel、merchant-compare
挑饭：作为小汪可调用的饭点路线，入口表单 → 方向卡 → 方向小结 → 商家卡 → 最终确认 → 饭后反馈 / 候选记忆
汪记本：今日吃饭记录、待确认长期偏好、已确认偏好
```

暂时隐藏：

```text
OpenClaw 过程展示
完整 IM / tool trace 展示
```

## 已完成进展

### 后端

已完成的核心能力：

```text
GET  /api/health
GET  /api/food-directions
POST /api/session/start
POST /api/session/swipe
POST /api/session/entry
POST /api/session/advance
POST /api/session/finalize
POST /api/session/offer-explanation
GET  /api/session/:id
GET  /api/day-context/:id
POST /api/xiaowang/chat
GET  /api/xiaowang/diary
GET/POST /api/weather/forecast
GET/POST /api/queue/status
POST /api/map/route
POST /api/memory/post-meal-feedback
memory candidates / confirmed preferences CRUD
OpenClaw memory bridge / dreaming skill 测试链路
Evermind 读写接入
```

后端饭点主链路已经不是纯内存：meal session 会写入 `data/runtime/meal_sessions`，day context 会写入 `data/runtime/day_contexts`。

### AI 链路

实时链路使用 Ark/Doubao API：

```text
入口需求解析
方向小结
商户卡解释
最终确认解释
```

OpenClaw 用在后台 agent 能力：

```text
memory dreaming
候选记忆整理
未来小汪互动 skills
```

Evermind 当前已经接入测试过：

```text
可以写入长期记忆
可以读取长期记忆
通用长期记忆更适合在 session 启动时读取一次并缓存
```

### 前端

新小程序已经从旧 `pages/index` 巨型页面拆出，当前主要文件：

```text
apps/lifepilot-miniprogram/pages/meal/
apps/lifepilot-miniprogram/services/
apps/lifepilot-miniprogram/utils/
apps/lifepilot-miniprogram/config/
apps/lifepilot-miniprogram/data/video-manifest.js
```

近期前端已完成：

```text
入口页改成接近旧版视觉
小汪狗头/形象接入
预算改为 0 到不限的 slider
自动获取定位，并显示大概区域，例如“福田区 · 景田地铁站附近”
方向卡接入 COS 视频 manifest
视频有声音
点击视频可暂停/继续
静音按钮移到视频外，避免微信 video 原生层吃点击
方向卡顶部可以修改需求，确认后重新解析并更新卡流
方向小结展示用户保留/排除的方向、AI 总结、用户反馈入口
用户在方向小结补充的一句话会带到下一阶段商户解释
第二阶段明确为“商家卡”，不是 offer 卡
商户解释改为一张一张预取，避免一次批量请求慢和 429
第二阶段商家卡已参考旧 workspace 重做展示结构：上半媒体、下半商家信息、小汪判断和留意事项分层展示
商家卡 normalizer 已补 displayTags、coverThumbUrl、storeFacts、issueLines 等旧版展示字段
商家卡文字区与滑动手势分离，手机端可以纵向滚动文本，媒体区负责左右滑
增加 api mode 开关，手机预览可切 tunnel，开发者工具可切 local
最终确认页已补成可用前端
底部增加“挑饭 / 问小汪 / 汪记本”三段导航
问小汪保留过渡 JSON 兼容层：用户说“帮我走滑卡/今天吃什么”时可返回 meal_swipe action 卡；目标架构是不再依赖二级 router skill
汪记本新增最小 UI：展示今日 meal session、待确认 memory candidates、confirmed preferences
产品入口调整为问小汪优先：默认进入问小汪，底部顺序为“问小汪 / 挑饭 / 汪记本”，滑卡作为小汪可调用 skill
```

最近提交：

```text
8b40f64 feat: add final confirmation flow
b49555a fix: separate merchant scroll and swipe zones
b268578 fix: reduce merchant gesture conflicts
e4b2827 fix: allow merchant info scrolling on mobile
f88c3df chore: add miniprogram api mode switch
106099a fix: improve merchant card presentation
4c73e7f docs: sync openclaw bridge phase
b3c2adb feat: enrich direction summary feedback
23a24eb fix: move mute control outside video
62933a6 fix: make video overlay controls tappable
01567f0 fix: restore direction video sound controls
ccd8b90 fix: lighten video overlay and controls
ccace26 fix: summarize full entry demand
40dadc7 fix: show approximate entry location
3e81fd3 fix: declare miniprogram location permission
91baa0f feat: allow editing direction demand
```

## 重要产品决策

### Swipe action

饭点滑卡只有两个 canonical action：

```text
keep     右滑保留
dislike  左滑放弃
```

不要再引入 `skip`、`like`、`super_like` 作为滑卡事件。

### Session 定义

产品后端的核心 session 是 meal session：

```text
一次饭点决策 = 一个 meal session
```

OpenClaw dreaming 更适合以 day context 为输入：

```text
一天内的 meal session / 小汪聊天 / 推送互动 / 反馈
→ 日级复盘
→ 候选长期记忆
```

### Memory 边界

权威记忆由产品后端管理：

```text
confirmed preferences
pending candidates
paused / rejected memory
merchant feedback weight
```

Doubao/Ark 不直接做工具型 memory CRUD。OpenClaw/Evermind 可以生成候选或增强理解，但最终推荐链路应通过后端统一读取。

### 前端选择

当前继续优先做微信小程序，而不是独立 app：

```text
比赛/demo 环境更容易展示
滑卡、视频流、定位、后端接口都已经跑通
OpenClaw trace / 长连接 / 流式过程展示后续可以用 web 控制台或独立调试页补
```

## 当前已知问题

```text
1. 问小汪和汪记本仍需要继续做更完整的聊天 UI、日级记录结构和 OpenClaw skill 调度。
2. 汪记本当前读取产品后端 day context 和 memory ledger，还没有真正的“小汪每日主动总结”生成流程。
3. merchant-intel / merchant-compare 的脚本和后端证据工具已经具备雏形，但 OpenClaw sandbox 当前访问不到本地 4331 后端。
4. 本地端口、手机真机、开发者工具、OpenClaw sandbox 对 127.0.0.1 的理解不同，临时 tunnel 也不稳定；固定 HTTPS API 的优先级升高。
5. 商户卡解释仍依赖 Ark/Doubao 单卡预取，首张卡可能有等待。
6. Evermind 通用长期记忆不应该每张卡都请求，后续要在 session 启动时读一次并缓存。
7. 根目录有一个未跟踪的临时 project.config.json，暂时不要提交。
```

最新问题小结见：

```text
docs/CURRENT_ISSUES_SUMMARY.md
```

## 下一步建议

优先级从高到低：

```text
1. 在微信开发者工具里完整跑一轮饭点流程，重点检查方向小结反馈、新静音按钮、商家卡新版布局和商家卡预取。
2. 根据实机截图继续微调商家卡：信息区高度、长文滚动、标签密度、底部按钮间距。
3. 把 session 启动时的长期记忆读取做成一次性缓存，避免 Evermind 每轮请求拖慢。
4. 给商户饭后反馈接入 merchant weight：好吃加权，难吃降权，环境差等字段进入商户历史标签。
5. 继续迁移/设计“问小汪”入口，但第一版仍可隐藏。
6. 设计 OpenClaw trace 展示方案：小程序内简化展示，web 控制台展示完整工具调用过程。
```

## 新会话启动提示

新会话建议先读：

```text
docs/PROJECT_STATE.md
docs/NEXT_SESSION_HANDOFF.md
docs/CURRENT_ISSUES_SUMMARY.md
apps/lifepilot-miniprogram/README.md
docs/MIGRATION_PHASES.json
```

然后执行：

```bash
cd /Users/mona/Documents/lifepilot
git status --short
npm run check
```

如果要继续前端，重点打开：

```text
apps/lifepilot-miniprogram/pages/meal/meal.wxml
apps/lifepilot-miniprogram/pages/meal/meal.wxss
apps/lifepilot-miniprogram/pages/meal/meal.js
```

如果要继续后端/记忆，重点打开：

```text
server/src/app.mjs
server/src/session-store.mjs
server/src/offer-cards.mjs
server/src/memory-store.mjs
server/src/evermind-memory.mjs
server/src/openclaw-store.mjs
```
