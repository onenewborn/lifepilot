# 新会话交接

更新时间：2026-06-01 15:30

## 请先理解

这是 LifePilot 的新独立仓库：

```text
/Users/mona/Documents/lifepilot
```

旧 OpenClaw workspace 在：

```text
/Users/mona/.openclaw/workspace
```

旧 workspace 只作为参考和 OpenClaw runtime 所在地，不要把新前端/后端继续塞回旧 workspace。

最新的问题和部署小结在：

```text
docs/CURRENT_ISSUES_SUMMARY.md
```

## 当前任务主线

我们正在做微信小程序前端迁移和体验打磨。后端饭点闭环、记忆基础和 OpenClaw bridge 都已经有最小链路；当前刚开始把“问小汪 / 汪记本 / skill 调度”迁回新小程序。

当前小程序入口：

```text
apps/lifepilot-miniprogram
```

当前主页面：

```text
apps/lifepilot-miniprogram/pages/meal/meal.js
apps/lifepilot-miniprogram/pages/meal/meal.wxml
apps/lifepilot-miniprogram/pages/meal/meal.wxss
```

## 最近刚做完

最近几次修复集中在手机预览、商家卡、最终确认和问小汪骨架：

```text
API_MODE 开关已实现，当前可切 local / tunnel / custom
手机预览通过 cloudflared tunnel 连接后端已跑通
商家卡媒体区负责左右滑，文字区独立纵向滚动
商家卡媒体高度已加高
最终确认页已有可用前端
新增后端 POST /api/xiaowang/chat
新增后端 GET /api/xiaowang/diary
新增前端底部三段导航：挑饭 / 问小汪 / 汪记本
产品入口已调整为问小汪优先：默认进入问小汪，底部顺序为问小汪 / 挑饭 / 汪记本
问小汪最小版支持返回 meal_swipe skill 卡，点击后直接调起滑卡流程
汪记本最小版展示今日饭点记录、待确认长期记忆、已确认偏好，并支持“记住 / 先不记”
```

阶段表也已同步：`docs/MIGRATION_PHASES.json` 里的 P6 是 `in_progress`，不是空白待办。OpenClaw memory bridge 和 dreaming skill 设计已经有最小实现，后续主要补原生消息渠道、trace 展示和问小汪入口。

最新关键提交：

```text
8b40f64 feat: add final confirmation flow
b49555a fix: separate merchant scroll and swipe zones
f88c3df chore: add miniprogram api mode switch
106099a fix: improve merchant card presentation
4c73e7f docs: sync openclaw bridge phase
```

## 用户明确偏好

用户希望：

```text
1. Markdown 和注释尽量用中文。
2. 每次完成一个明确改动就提交 git。
3. 不要保守地只写外围文档，必要时要敢拆旧的 index/server 巨型文件。
4. 新前端不要直接复制旧 pages/index，要拆成模块。
5. 旧版视觉和小汪狗头很重要，新版不能太工程化、太丑。
6. 方向卡第一阶段选的是方向；第二阶段选的是商家，不要再叫 offer。
7. 实时滑卡链路可以走 Doubao/Ark API；OpenClaw 用在后台、问小汪、skills、dreaming。
8. 记忆权威在产品后端，OpenClaw 可以辅助理解和生成候选。
```

## 当前应优先做什么

建议下一轮从这里开始：

```text
1. 优先把后端迁到稳定 HTTPS API：域名 + 轻量服务器 + Nginx + PM2 + HTTPS。
2. 把 https://api.lifepilot-xiaowang.cn 配到小程序合法域名和 OpenClaw LIFEPILOT_API_BASE。
3. 继续把 merchant-intel / merchant-compare 接成真正的 OpenClaw 工具调用，而不是后端兜底。
4. 在微信开发者工具/手机预览里测试默认进入问小汪，以及“直接帮我选 / 帮我走滑卡 → 开始滑卡”。
5. 设计汪记本日级 UI：每一天的小汪总结、吃饭行为、偏好变化、待确认记忆。
6. 接着做 session 启动时一次性读取长期记忆并缓存，避免每张商家卡重复读取完整记忆上下文。
```

## 当前已知坑

```text
1. 微信 video 是原生组件，覆盖在 video 上的普通 view/button 很容易点不到。
   所以静音按钮已经移到视频外面；不要轻易再放回 video 内部。

2. 根目录有未跟踪 project.config.json，这是之前临时探测小程序定位用的。
   暂时不要提交，除非用户明确要求。

3. 新小程序使用 COS：
   config/assets.js 里是 COS base URL。
   方向视频 manifest 在 apps/lifepilot-miniprogram/data/video-manifest.js。

4. 后端默认端口是 4331。
   小程序 API 由 apps/lifepilot-miniprogram/config/api.js 的 API_MODE 控制。
   手机预览通常用 tunnel，开发者工具本地调试通常用 local。
   但 OpenClaw sandbox 当前访问不到本地 4331；这也是为什么固定 HTTPS API 现在变重要。

5. 商家卡 AI 解释已改为单卡预取，不要再默认一次请求 10 张。

6. 商家卡刚改成专门结构，涉及：
   apps/lifepilot-miniprogram/pages/meal/meal.wxml
   apps/lifepilot-miniprogram/pages/meal/meal.wxss
   apps/lifepilot-miniprogram/utils/card-normalizer.js
   继续改视觉时优先在这三个文件里小步调整。

7. 问小汪 / 汪记本第一版涉及：
   server/src/xiaowang-store.mjs
   server/src/app.mjs
   apps/lifepilot-miniprogram/services/xiaowang-api.js
   apps/lifepilot-miniprogram/services/memory-api.js
   apps/lifepilot-miniprogram/pages/meal/meal.*
```

## 开始前命令

```bash
cd /Users/mona/Documents/lifepilot
git status --short
npm run check
```

如果要看最近改动：

```bash
git log --oneline -12
```

如果要启动后端：

```bash
npm run dev
```

## 验收习惯

每次改动后至少跑：

```bash
npm run check
git diff --check
```

如果改了小程序 JS：

```bash
find apps/lifepilot-miniprogram -name '*.js' -print -exec node --check {} \;
```

完成后提交，例如：

```bash
git add <changed-files>
git commit -m "fix: ..."
```
