# LifePilot 饭点定了

LifePilot 是一个把“今天吃什么”做成可协作 AI 体验的小程序产品。它不是简单的商家列表或优惠券聚合，而是让一个有记忆、有复盘能力的 AI 伙伴“小汪”陪用户完成饭点决策：理解当下场景，生成可滑动的吃饭方向，推荐真实商家与优惠，并把用户的选择过程沉淀成长期偏好。

我们的核心想法是：**吃饭推荐不应该只回答“附近有什么”，而应该逐渐理解“这个人为什么会这样选”。**

## 产品新意

**1. 从搜索推荐变成陪伴式决策**

传统点餐推荐通常从关键词、距离、评分开始。LifePilot 从人的状态开始：一个人吃还是多人聚餐、预算、距离、口味、想省事还是想奖励自己。小汪会先把模糊需求整理成几个“饭点方向”，用户像刷卡一样保留或划掉，系统再进入具体商家和套餐。

**2. 推荐过程本身会成为记忆**

用户不一定每次都明确说“我喜欢什么”。LifePilot 会观察用户在挑饭时的犹豫、保留、跳过、确认和餐后反馈，把这些行为转化为短期观察和可确认的长期偏好。小汪日记本会把当天的选择过程写成复盘，用户可以决定哪些偏好值得被记住。

**3. AI 不是一个接口，而是一个协作 workspace**

项目把前端、后端和 OpenClaw agent workspace 放在同一个交付仓库中。OpenClaw 不是外置脚本，而是产品体验的一部分：它负责小汪的人设、技能、记忆智能、饭点复盘和后台任务。产品后端提供稳定 API，agent workspace 通过这些 API 读写上下文，形成“产品 runtime + agent runtime”的双运行时架构。

**4. 饭点滑卡让 AI 推荐可控**

LifePilot 没有把大模型的一次性回答当作终点，而是把 AI 输出拆成可交互卡片。用户可以在方向卡、商家卡、套餐卡之间逐步选择，系统保留每一步证据，让推荐更可解释，也让记忆更可信。

**5. 小汪日记本把个性化做成透明体验**

日记本不是后台日志，而是面向用户的记忆界面。它会展示今日观察、吃饭记录、待确认记忆和已经记住的偏好。用户能看到 AI 为什么越来越懂自己，也能决定哪些内容进入长期记忆。

## 当前能力

- 小程序端“饭点定了”：问小汪、挑饭、滑卡、日记本三段主流程。
- 后端 API：饭点 session、商家/套餐推荐、记忆候选、长期偏好、日记本和 OpenClaw job。
- 商家数据：云端当前数据包含 20+ 商家与多类套餐/优惠，支持按场景进入推荐。
- 记忆系统：本地记忆仓库 + Evermind 同步状态 + memory intelligence 分析链路。
- OpenClaw workspace：包含小汪规则、skills、梦境复盘、记忆智能和饭点 offer flow 脚本。

## 技术架构

```text
apps/lifepilot-miniprogram/     微信小程序前端
server/                         Node.js 后端 API
data/                           产品数据、商家、套餐、规则与 schema
docs/                           产品合同、架构说明和交付文档
openclaw-workspace/             云端 OpenClaw agent workspace 干净快照
```

运行时边界：

- 产品 runtime 负责小程序、后端 API、饭点 session、推荐数据、记忆 CRUD 和资产合同。
- Agent runtime 负责小汪人格、OpenClaw skills、记忆复盘、后台任务和自然语言协作。
- OpenClaw 通过后端 API 读取和提交产品上下文，不直接修改产品数据库运行态。

## 云端部署状态

当前比赛调试为了绕过域名公网拦截，前端临时使用：

```text
http://110.42.208.125
```

域名 `api.lifepilot-xiaowang.cn` 已配置到服务器并由 Caddy 管理 HTTPS，但公网访问目前会被腾讯云/DNSPod 侧拦截。等备案或域名拦截解除后，可以切回：

```text
https://api.lifepilot-xiaowang.cn
```

## 本地检查

```bash
npm run check
npm run smoke:session
npm run smoke:deals
npm run smoke:memory
npm run smoke:memory-intelligence
```

小程序入口：

```text
apps/lifepilot-miniprogram/
```

开发者工具调试临时 IP 入口时，需要勾选“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。

## 交付重点

LifePilot 的创新点不在于“又做了一个美食推荐”，而在于把 AI 推荐拆成了一个能被用户参与、被系统记住、被 agent 复盘的完整闭环：

```text
模糊需求 -> 饭点方向 -> 商家/优惠滑卡 -> 选择证据 -> 小汪日记 -> 长期偏好 -> 下一次更懂你
```

这让每一次吃饭选择都成为下一次个性化的燃料，也让 AI 从一次性问答变成持续协作的生活伙伴。
