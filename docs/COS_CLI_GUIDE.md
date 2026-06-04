# LifePilot 腾讯 COS CLI 使用手册

这份文档讲清楚 LifePilot 里图片/视频素材和腾讯云 COS 的关系，以及怎么用命令行做查询、上传、下载、覆盖、删除。

## 现在的环境关系

LifePilot 现在有三层环境：

- 本地项目：`/Users/mona/Documents/lifepilot`，后台上传会先写到本机或当前后端服务器的 `assets/` 目录。
- 云端后端：`https://api.lifepilot-xiaowang.cn`，后台数据 JSON 部署到这里后，小程序请求云端接口才会看到。
- 腾讯 COS：生产图片/视频实际放这里，小程序看到 `/assets/...` 路径时，会按项目里的 COS 域名规则去读 COS 上同路径的文件。

所以，数据库里填：

```text
/assets/offer-media/wangji_douhua/cover.jpg
```

实际要求是 COS 里也存在这个对象：

```text
assets/offer-media/wangji_douhua/cover.jpg
```

注意：JSON 里保存的是 `/assets/...`，COS 对象 key 不带最前面的 `/`。

当前项目使用的 COS 配置在本机 `.env.local` 里：

```dotenv
TENCENT_COS_BUCKET=lifepilot-assets-1331466052
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_ASSET_PREFIX=assets/offer-media
```

密钥不要写进 Git。`.env.local` 只留在本机。

## SecretId 和 SecretKey 怎么获取

腾讯云的 API 密钥由 `SecretId` 和 `SecretKey` 组成：

- `SecretId` 类似用户名，用来标识调用者。
- `SecretKey` 类似密码，用来签名请求。

获取路径：

1. 登录腾讯云控制台。
2. 进入 `访问管理 CAM`。
3. 打开 `访问密钥`。
4. 进入 `API 密钥管理`。
5. 新建密钥，复制并保存 `SecretId` 和 `SecretKey`。

重要：腾讯云现在的新密钥只在创建时展示 `SecretKey`，之后不能再查询。如果忘了，只能禁用/删除旧密钥，再创建新密钥。

推荐做法：

- 不要用主账号密钥做日常操作。
- 建一个 CAM 子用户或临时密钥，只授权访问 `lifepilot-assets-1331466052` 这个 bucket。
- 权限按最小化原则给，例如上传/覆盖/删除素材时才给写权限。

官方参考：

- 主账号访问密钥管理：https://cloud.tencent.com/document/product/598/40488
- COS 临时密钥指引：https://cloud.tencent.com/document/product/436/14048

## 安装 COSCLI

腾讯云现在推荐的命令行工具是 `COSCLI`。它可以上传、下载、删除、列目录、同步目录。

macOS 示例：

```bash
cd /usr/local/bin
sudo curl -L -o coscli https://cosbrowser.cloud.tencent.com/software/coscli/coscli-darwin-amd64
sudo chmod 755 coscli
coscli --version
```

如果是 Apple Silicon，腾讯云下载页可能有 arm64 包；也可以先用 amd64 包，遇到兼容问题再换。

如果 macOS 提示无法验证开发者，到 `系统设置 -> 隐私与安全性` 里允许打开一次。

官方参考：

- COSCLI 下载与安装配置：https://cloud.tencent.com/document/product/436/63144
- COSCLI 简介：https://intl.cloud.tencent.com/zh/document/product/436/43249

## 配置 COSCLI

首次配置：

```bash
coscli config init
```

按提示填写：

```text
SecretId: 你的 SecretId
SecretKey: 你的 SecretKey
SessionToken: 如果是临时密钥就填 Token；永久密钥直接回车
Bucket: lifepilot-assets-1331466052
Region: ap-guangzhou
Alias: lifepilot
Endpoint: cos.ap-guangzhou.myqcloud.com
```

配置完检查：

```bash
coscli config show
```

如果你已经有配置，只想追加 LifePilot bucket：

```bash
coscli config add \
  -b lifepilot-assets-1331466052 \
  -r ap-guangzhou \
  -e cos.ap-guangzhou.myqcloud.com \
  -a lifepilot
```

后续命令里就可以用：

```text
cos://lifepilot/assets/offer-media/...
```

官方参考：

- COSCLI config：https://intl.cloud.tencent.com/zh/document/product/436/43251

## CRUD 怎么做

COS 里没有“修改文件内容”的概念。实际 CRUD 是：

- Create：上传新对象。
- Read：列目录、下载、查看对象。
- Update：用同一个 key 重新上传，覆盖旧对象。
- Delete：删除对象。

### 查询：列出素材

列出 `offer-media` 下一级：

```bash
coscli ls cos://lifepilot/assets/offer-media/
```

递归列出全部：

```bash
coscli ls cos://lifepilot/assets/offer-media/ -r
```

只看 mp4：

```bash
coscli ls cos://lifepilot/assets/offer-media/ -r --include ".*\.mp4$"
```

官方参考：

- COSCLI ls：https://intl.cloud.tencent.com/zh/document/product/436/43254

### 新增：上传一个文件

例子：把本地图片传到 COS。

```bash
coscli cp \
  "/Users/mona/Documents/COS/某商家/cover.jpg" \
  "cos://lifepilot/assets/offer-media/some-merchant/cover.jpg"
```

上传后，数据库里填：

```text
/assets/offer-media/some-merchant/cover.jpg
```

上传视频：

```bash
coscli cp \
  "/Users/mona/Documents/COS/某商家/visit.mp4" \
  "cos://lifepilot/assets/offer-media/some-merchant/visit.mp4"
```

数据库里填：

```text
/assets/offer-media/some-merchant/visit.mp4
```

### 新增：上传整个文件夹

把一个商家的所有图片传上去：

```bash
coscli cp \
  "/Users/mona/Documents/COS/某商家/" \
  "cos://lifepilot/assets/offer-media/some-merchant/" \
  -r
```

只上传图片：

```bash
coscli cp \
  "/Users/mona/Documents/COS/某商家/" \
  "cos://lifepilot/assets/offer-media/some-merchant/" \
  -r \
  --include ".*\.(jpg|jpeg|png|webp)$"
```

官方参考：

- COSCLI cp：https://intl.cloud.tencent.com/zh/document/product/436/43256

### 读取：下载文件

下载单个对象：

```bash
coscli cp \
  "cos://lifepilot/assets/offer-media/some-merchant/cover.jpg" \
  "/Users/mona/Downloads/cover.jpg"
```

下载整个商家目录：

```bash
coscli cp \
  "cos://lifepilot/assets/offer-media/some-merchant/" \
  "/Users/mona/Downloads/some-merchant/" \
  -r
```

### 更新：覆盖已有文件

如果 COS 上已经有：

```text
assets/offer-media/some-merchant/cover.jpg
```

重新上传同一个目标 key 就是覆盖：

```bash
coscli cp \
  "/Users/mona/Documents/COS/某商家/new-cover.jpg" \
  "cos://lifepilot/assets/offer-media/some-merchant/cover.jpg"
```

如果小程序还是看到旧图，通常是缓存问题。可以：

- 换一个新文件名，例如 `cover_20260603.jpg`。
- 数据库路径也改成新路径。
- 或等 CDN/COS 缓存刷新。

### 同步：让本地目录和 COS 目录一致

上传同步：

```bash
coscli sync \
  "/Users/mona/Documents/COS/某商家/" \
  "cos://lifepilot/assets/offer-media/some-merchant/"
```

下载同步：

```bash
coscli sync \
  "cos://lifepilot/assets/offer-media/some-merchant/" \
  "/Users/mona/Downloads/some-merchant/"
```

官方参考：

- COSCLI sync：https://intl.cloud.tencent.com/zh/document/product/436/43257

### 删除：删除文件或目录

删除一个文件：

```bash
coscli rm "cos://lifepilot/assets/offer-media/some-merchant/cover.jpg"
```

删除一个商家目录下所有对象：

```bash
coscli rm "cos://lifepilot/assets/offer-media/some-merchant/" -r
```

危险：删除不可随便跑。删除前先列出来：

```bash
coscli ls "cos://lifepilot/assets/offer-media/some-merchant/" -r
```

官方参考：

- COSCLI rm：https://intl.cloud.tencent.com/document/product/436/43258

## 和后台数据库怎么配合

上传 COS 后，还要把路径写回数据库。路径规则：

| COS 对象 key | 数据库里填写 |
| --- | --- |
| `assets/offer-media/wangji_douhua/cover.jpg` | `/assets/offer-media/wangji_douhua/cover.jpg` |
| `assets/offer-media/wangji_douhua/visit.mp4` | `/assets/offer-media/wangji_douhua/visit.mp4` |

商家多图填在：

```text
商家 -> 商家/菜品多图 (media.image_urls)
```

一行一个：

```text
/assets/offer-media/some-merchant/cover.jpg
/assets/offer-media/some-merchant/dish_1.jpg
/assets/offer-media/some-merchant/dish_2.jpg
```

商家视频填在：

```text
商家 -> 商家视频列表 (media.video_sources)
```

常见字段：

```text
视频 ID: official
类型: 官方视频
展示名: 官方视频
视频路径: /assets/offer-media/some-merchant/official.mp4
封面路径: /assets/offer-media/some-merchant/poster.jpg
有声音: 是
```

小程序读取逻辑：

- 有 `media.video_sources`：优先展示视频。
- 没有视频但有 `media.image_urls`：显示相册按钮，用微信预览图片。
- 都没有：走方向默认图或旧兜底图。

## 推荐目录命名

商家目录建议用英文小写、短横线：

```text
assets/offer-media/sushi-gin/
assets/offer-media/runyuan-coconut-chicken/
assets/offer-media/dayouli-cha-chaan-teng/
assets/offer-media/blue-vegan-salad/
```

文件名建议：

```text
cover.jpg
poster.jpg
official.mp4
user_visit_1.mp4
dish_1.jpg
dish_2.jpg
```

避免：

- 中文文件名
- 空格
- 特殊符号
- 超长文件名
- 同名文件反复覆盖但数据库路径不变

## 常用完整流程

### 给新商家上传多张图

1. 本地整理文件：

```text
/Users/mona/Documents/COS/鮨吟/
  cover.jpg
  dish_1.jpg
  dish_2.jpg
```

2. 上传：

```bash
coscli cp \
  "/Users/mona/Documents/COS/鮨吟/" \
  "cos://lifepilot/assets/offer-media/sushi-gin/" \
  -r
```

3. 检查：

```bash
coscli ls "cos://lifepilot/assets/offer-media/sushi-gin/" -r
```

4. 后台回填：

```text
/assets/offer-media/sushi-gin/cover.jpg
/assets/offer-media/sushi-gin/dish_1.jpg
/assets/offer-media/sushi-gin/dish_2.jpg
```

5. 保存后台数据。

6. 云端后台保存后，小程序重新请求云端接口即可看到。

### 给商家上传视频

1. 上传视频和封面：

```bash
coscli cp "/Users/mona/Documents/COS/某商家/official.mp4" "cos://lifepilot/assets/offer-media/some-merchant/official.mp4"
coscli cp "/Users/mona/Documents/COS/某商家/poster.jpg" "cos://lifepilot/assets/offer-media/some-merchant/poster.jpg"
```

2. 后台商家视频列表填：

```text
视频 ID: official
类型: 官方视频
展示名: 官方视频
视频路径: /assets/offer-media/some-merchant/official.mp4
封面路径: /assets/offer-media/some-merchant/poster.jpg
有声音: 是
```

## 排错

### 403 Forbidden

常见原因：

- SecretId/SecretKey 填错。
- 子账号没有 bucket 权限。
- bucket region 填错。
- 系统时间偏差太大，签名失效。

检查：

```bash
coscli config show
coscli ls cos://lifepilot/assets/offer-media/
```

### 上传成功但小程序看不到

检查顺序：

1. COS 上是否真的有对象：

```bash
coscli ls cos://lifepilot/assets/offer-media/some-merchant/ -r
```

2. 数据库路径是否以 `/assets/...` 开头。
3. COS 对象 key 是否和数据库路径去掉开头 `/` 后完全一致。
4. 后台保存的是云端后台，不是本地后台。
5. 小程序是否重新请求了云端接口。
6. 如果覆盖同名文件，可能是缓存，换新文件名最稳。

### 文件名乱码或上传失败

尽量使用英文目录和文件名。本地中文目录可以用，但 COS key 建议保持英文。

## 安全提醒

- 不要把 `.env.local`、SecretId、SecretKey 提交到 Git。
- 不要把密钥发到聊天记录、截图、文档里。
- 做删除前先 `ls`。
- 大范围 `rm -r` 前，把命令复制出来肉眼检查路径。
- 如果怀疑密钥泄露，立刻去腾讯云访问管理里禁用并删除旧密钥，再创建新密钥。
