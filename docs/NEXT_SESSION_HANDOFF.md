# 新会话交接

更新时间：2026-05-30 23:55

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

## 当前任务主线

我们正在做微信小程序前端迁移和体验打磨。后端饭点闭环、记忆基础、OpenClaw bridge、Evermind 接入都已经有最小链路，现在重点是让小程序体验接近旧版，同时保持新代码模块化。

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

最近几次修复集中在视频、方向小结和商家卡视觉：

```text
方向卡视频改为 COS manifest，恢复旧版有声视频源
点击视频可以暂停/继续
暂停态显示白色 ⏸
静音按钮移到视频外，避免微信 video 原生层吃点击
方向小结页展示用户保留/排除的方向
方向小结页增加“差不多 / 补充一句”
用户补充会传给下一阶段商户解释 prompt
商家卡参考旧 workspace 第二阶段重做了一轮展示
商家卡现在是上半媒体、下半商家信息、标签、推荐吃法、小汪判断、留意事项分层展示
补齐了商家卡 normalizer 字段：displayTags、coverThumbUrl、storeFacts、issueLines
```

阶段表也已同步：`docs/MIGRATION_PHASES.json` 里的 P6 是 `in_progress`，不是空白待办。OpenClaw memory bridge、dreaming skill 设计和 Evermind 读写已经有最小实现，后续主要补原生消息渠道、trace 展示和问小汪入口。

最新关键提交：

```text
106099a fix: improve merchant card presentation
4c73e7f docs: sync openclaw bridge phase
b3c2adb feat: enrich direction summary feedback
23a24eb fix: move mute control outside video
01567f0 fix: restore direction video sound controls
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
8. 记忆权威在产品后端，Evermind/OpenClaw 可以辅助理解和生成候选。
```

## 当前应优先做什么

建议下一轮从这里开始：

```text
1. 让用户在微信开发者工具里测试刚刚的小结页、静音按钮和新版商家卡。
2. 重点看商家卡：媒体高度、信息区滚动、标签密度、小汪判断块、底部“就这家”按钮是否顺眼。
3. 如果商家卡还有工程感，继续对齐旧小程序第二阶段样式，但保持新代码模块化。
4. 接着做 session 启动时一次性读取长期记忆并缓存，避免每张商家卡请求 Evermind。
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
   小程序默认请求 http://127.0.0.1:4331。

5. 商家卡 AI 解释已改为单卡预取，不要再默认一次请求 10 张。

6. 商家卡刚改成专门结构，涉及：
   apps/lifepilot-miniprogram/pages/meal/meal.wxml
   apps/lifepilot-miniprogram/pages/meal/meal.wxss
   apps/lifepilot-miniprogram/utils/card-normalizer.js
   继续改视觉时优先在这三个文件里小步调整。
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
