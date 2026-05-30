# Food Cards Contract

Updated: 2026-05-30

## Direction Card

Direction cards are the first swipe layer.

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

Required fields for P1:

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

Compatibility aliases:

```text
service_id should equal direction_id for old UI compatibility.
card_id should equal direction_id for direction cards.
```

P1 smoke must assert:

```text
card.service_id === card.direction_id
card.card_id === card.direction_id
```

## Offer Card

Offer cards are the second swipe layer.

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

## Asset URL Rule

Data stores relative paths beginning with `/assets/`.

Mini program resolves these against COS.

Local web/backend may resolve these against local static files.

## Compatibility Warning

Do not rename these fields during migration without updating the mini program compatibility layer:

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
