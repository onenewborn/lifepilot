# 资产合同

更新时间：2026-05-30

## 当前运行事实

小程序生产资产走腾讯云 COS：

```text
https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com
```

源数据继续存稳定的相对路径：

```text
/assets/food-directions/hot_soup_noodles.jpg
/assets/food-direction-videos/hot_soup_noodles.mobile.mp4
/assets/offer-media/menya-inoichi/visit_final.mp4
```

小程序运行时把这些路径解析到 COS。

## 归属

产品仓库负责资产元数据和路径合同。

COS 负责生产环境字节分发。

OpenClaw 内容 skills 可以生成草稿资产，但草稿进入 runtime assets 必须经过显式 promotion。

## 资产类型

```text
direction_cover
direction_video
offer_cover
offer_poster
offer_video
mascot
generated_draft
```

## 规则

- 数据文件优先存 `/assets/...` 相对路径。
- 小程序把相对路径解析到 COS。
- 本地 H5/dev 可以把相对路径解析到本地后端静态服务。
- 生成草稿不会自动变成运行时资产。
- 运行时资产命名要稳定，并考虑缓存刷新。

## 迁移要求

重建过程中不能破坏现有 `/assets/...` 路径。
