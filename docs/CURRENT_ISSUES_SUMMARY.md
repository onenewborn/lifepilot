# 当前问题与部署小结

更新时间：2026-06-01

## 一句话

LifePilot 现在已经从“微信小程序连本地后端”推进到“小程序、LifePilot 后端、OpenClaw agent、OpenClaw skills、长期记忆和商户证据工具”多方协作。当前最大问题不是某一个接口写错，而是本地端口、临时 tunnel、OpenClaw sandbox 网络隔离共同导致链路不稳定。

## 当前主线

当前产品仓库是：

```text
/Users/mona/Documents/lifepilot
```

当前产品主线：

```text
问小汪优先
  → 小汪可调起饭点滑卡
  → 挑饭流程承接方向卡、商家卡、最终确认
  → 汪记本沉淀吃饭行为、待确认记忆、长期偏好
  → OpenClaw skills 承接商户理解、商户对比、dreaming、记忆候选
```

后端默认端口：

```text
4331
```

注意：`/Users/mona/Documents/lifepilot-experience-refactor` 上的 `4332` 是另一个项目，不是旧后端，不要关闭。

## 最近遇到的关键问题

### 1. 临时 tunnel 和本地端口已经不够稳定

小程序真机、开发者工具和 OpenClaw 工具环境对 `127.0.0.1` 的理解不同：

```text
微信开发者工具里的 127.0.0.1
  通常指向电脑本机。

手机真机里的 127.0.0.1
  指向手机自己，不能直接访问电脑后端。

OpenClaw sandbox 里的 127.0.0.1
  指向 sandbox 自己，不是 LifePilot 后端。
```

这导致以下问题反复出现：

```text
request fail / connection refused
临时 Cloudflare tunnel 断开或域名变动
手机端能访问一会儿又失败
OpenClaw skill 脚本在宿主机能跑，在 sandbox 里连不到 4331
```

### 2. OpenClaw 真实工具调用已经接近，但还差稳定网络层

已经完成：

```text
POST/GET /api/tools/merchant-resolve
POST /api/tools/merchant-intel-context
POST /api/tools/merchant-compare-context
```

OpenClaw workspace 里也已经新增：

```text
skills/merchant-intel/scripts/merchant_intel_tool.py
skills/merchant-compare/scripts/merchant_compare_tool.py
```

本机直接执行这些 Python 工具脚本可以成功拿到 4331 后端证据，包括：

```text
评分
评论量级
好评 / 中评 / 差评分布
口碑标签
特色菜
风险项
前端可渲染 skill_result_card
```

但是 OpenClaw agent 运行在 sandbox 内时：

```text
http://127.0.0.1:4331
  Connection refused

http://host.docker.internal:4331
  DNS 解析失败

临时 trycloudflare 域名
  DNS 解析失败
```

结论：

```text
skill 脚本和后端工具接口已经具备雏形。
当前阻塞点是 OpenClaw 工具执行环境无法稳定访问 LifePilot 后端。
```

### 3. 后端和 OpenClaw 的分工需要继续保持清晰

当前正确分工：

```text
LifePilot 后端
  提供证据、上下文、memory CRUD、商户口碑数据、session 状态、前端接口。

OpenClaw agent
  判断是否调用 skill，读取工具证据，基于证据生成小汪口吻最终回复。

后端 fallback
  只用于保证产品不崩，不应被当成最终 agentic 架构。
```

特别是 `merchant-intel` 和 `merchant-compare`：

```text
后端不能替 OpenClaw 选择 winner。
后端不能替 OpenClaw 完成“哪家更适合主人”的最终判断。
后端只能返回可审计证据包。
```

## 为什么域名和云服务器现在变重要了

现在的问题已经不只是“手机访问本机后端”。完整链路是：

```text
微信小程序真机
  → LifePilot 后端
  → OpenClaw Gateway / Agent
  → merchant-intel / merchant-compare skill
  → 回调 LifePilot 工具 API
  → OpenClaw 生成最终小汪回复
  → 小程序展示气泡、工具轨迹和卡片
```

这条链路里任何一段使用临时地址都会造成不稳定。

因此近期需要一个固定 HTTPS API：

```text
https://api.lifepilot-xiaowang.cn
```

它应该服务于：

```text
微信小程序合法域名
OpenClaw skill 的 LIFEPILOT_API_BASE
OpenClaw 常驻 Gateway client / tool proxy
未来前端调试页和 trace 控制台
```

## 推荐基础设施方案

建议购买：

```text
域名：lifepilot-xiaowang.cn
服务器：腾讯云轻量应用服务器
```

暂时不必购买：

```text
付费 DNS 解析
付费 DV SSL 证书
```

原因：

```text
DNSPod 免费解析够用。
SSL 可以先用腾讯云免费证书或 Let’s Encrypt。
当前项目是 demo / 比赛阶段，轻量服务器比 CVM 更省心。
```

服务器建议：

```text
Ubuntu 22.04 或 Debian 12
2 核 2G 优先
地域可选广州
部署 Node 后端 + Nginx + PM2
```

需要注意：

```text
.cn 域名 + 中国大陆服务器 + 微信小程序合法域名，通常需要 ICP 备案。
开发期可以继续本地/tunnel 兜底，但正式真机演示应尽快切固定域名。
```

## 当前已完成能力

### 小程序

```text
问小汪作为第一入口
挑饭作为小汪可调用 skill
汪记本最小 UI
商家卡新版展示
商家卡文字区可滚动
最终确认页可用
API_MODE 支持 local / tunnel / custom
```

### 后端

```text
meal session 持久化
day context
memory candidates / confirmed preferences
OpenClaw dreaming 基础桥
merchant reputation seed
merchant-intel / merchant-compare 证据工具
merchant-resolve 店名解析工具
```

### OpenClaw 接入

```text
问小汪走 OpenClaw Gateway client
前端已有“思考中”和开发轨迹展示雏形
商户 skill 文档和 Python 工具脚本已加入 OpenClaw workspace
```

## 当前未解决问题

```text
1. OpenClaw sandbox 无法访问本地 4331 后端。
2. 临时 tunnel 不适合作为长期 LIFEPILOT_API_BASE。
3. 问小汪的工具轨迹还不是真正的流式 token/tool event，只是阶段性状态和结果元信息。
4. merchant-intel / merchant-compare 仍需要切到真正稳定的 OpenClaw 工具调用链。
5. 汪记本还需要更亲切的小汪日总结、按日期时间展示和待确认记忆对话化。
6. 商户口碑数据目前部分为 demo_constructed，后续需要引入更可靠的数据采集/证据来源。
```

## 下一步建议

优先级从高到低：

```text
1. 买域名和轻量服务器，部署 LifePilot 后端，形成固定 HTTPS API。
2. 配置 api.lifepilot-xiaowang.cn，写入小程序合法域名和 OpenClaw LIFEPILOT_API_BASE。
3. 在服务器上跑 Node 后端、Nginx、PM2，确认 /api/health、/api/tools/* 可公网访问。
4. 设计常驻 OpenClaw Gateway client / tool proxy，让 OpenClaw skill 调用 LifePilot 工具不再依赖 sandbox 直接访问本机。
5. 继续完善问小汪的工具轨迹展示：开始、选择 skill、调用工具、拿到证据、生成结论。
6. 扩展 merchant-intel / merchant-compare 的前端卡片和小汪总结语，必须引用长期偏好和商户证据。
7. 继续做汪记本：日总结、日期时间、待确认记忆的“要不要让我以后记住”对话式 UI。
```

## 验证命令

本地验证：

```bash
cd /Users/mona/Documents/lifepilot
npm run check
```

本机工具脚本验证：

```bash
cd /Users/mona/.openclaw/workspace
LIFEPILOT_API_BASE=http://127.0.0.1:4331 \
  python3 skills/merchant-intel/scripts/merchant_intel_tool.py \
  --merchant-name 汪记豆花 \
  --question "汪记豆花有什么特色菜"

LIFEPILOT_API_BASE=http://127.0.0.1:4331 \
  python3 skills/merchant-compare/scripts/merchant_compare_tool.py \
  --merchant-names "汪记豆花,川香楼" \
  --question "汪记豆花和川香楼怎么选"
```

固定域名部署后应改为：

```bash
LIFEPILOT_API_BASE=https://api.lifepilot-xiaowang.cn
```
