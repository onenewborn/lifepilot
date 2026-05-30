# 餐饮卡片合同

更新时间：2026-05-30

## 方向卡

方向卡是第一层滑卡。

```json
{
  "card_id": "dir_hot_soup_noodles",
  "direction_id": "dir_hot_soup_noodles",
  "service_id": "dir_hot_soup_noodles",
  "title": "热汤粉面",
  "subtitle": "热乎、快、低负担",
  "hook": "适合下班后想吃点热汤的晚上",
  "tags": ["热汤", "快吃", "低负担"],
  "budget_band": "30-50",
  "fit": ["想吃热乎", "不想太油"],
  "avoid_for": ["想重口聚餐"],
  "image_url": "/assets/food-directions/hot_soup_noodles.jpg",
  "video_url": "/assets/food-direction-videos/hot_soup_noodles.mobile.mp4",
  "poster_url": "/assets/food-directions/hot_soup_noodles.jpg",
  "video_version": "2026-05-21-a",
  "has_sound": true,
  "media_type": "video",
  "score": 78,
  "synthetic_only": true
}
```

P1 必填字段：

```text
card_id
direction_id
service_id
title
tags
image_url
video_url
poster_url
media_type
synthetic_only
```

兼容别名：

```text
service_id 必须等于 direction_id，用于兼容旧 UI。
card_id 必须等于 direction_id，用于方向卡兼容。
```

P1 smoke 必须断言：

```text
card.service_id === card.direction_id
card.card_id === card.direction_id
```

## Offer 卡

Offer 卡是第二层滑卡。

```json
{
  "card_id": "off_futian_001_jituifan",
  "offer_id": "off_futian_001_jituifan",
  "merchant_id": "merchant_shaxian_snacks",
  "merchant_name": "沙县小吃",
  "title": "鸡腿饭",
  "display_title": "沙县小吃 · 鸡腿饭",
  "tags": ["快吃", "预算友好"],
  "score": 82,
  "image_url": "/assets/offer-media/shaxian-snacks/cover.jpg",
  "video_url": "/assets/offer-media/shaxian-snacks/visit_voiceover.mp4",
  "poster_url": "/assets/offer-media/shaxian-snacks/cover.jpg",
  "media_type": "video",
  "facts": {
    "price_per_person": 28,
    "neighborhood": "福田",
    "queue_risk": "low",
    "oil_level": "medium",
    "spice_level": "none",
    "subway_walk_min": 6,
    "signature_items": ["鸡腿饭"]
  },
  "explanation": {
    "matched": [],
    "watchouts": [],
    "conflicts": [],
    "unknown": []
  },
  "synthetic_only": true
}
```

## 资产 URL 规则

数据里存以 `/assets/` 开头的相对路径。

小程序把这些路径解析到 COS。

本地 web/backend 可以把这些路径解析到本地静态文件。

## 兼容提醒

迁移时不要随意重命名这些字段，除非同步更新小程序兼容层：

```text
image_url
video_url
poster_url
video_version
has_sound
media_type
merchant_name
offer_id
direction_id
service_id
```
