# Asset Contract

Updated: 2026-05-30

## Current Runtime Fact

Mini program assets are served from Tencent Cloud COS:

```text
https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com
```

The source data should continue storing asset paths as stable relative paths:

```text
/assets/food-directions/hot_soup_noodles.jpg
/assets/food-direction-videos/hot_soup_noodles.mobile.mp4
/assets/offer-media/menya-inoichi/visit_final.mp4
```

The mini program resolves those paths to COS at runtime.

## Owner

The product repo owns asset metadata and path contracts.

COS owns production delivery bytes.

OpenClaw content skills may generate draft assets, but promotion to runtime assets must be explicit.

## Asset Classes

```text
direction_cover
direction_video
offer_cover
offer_poster
offer_video
mascot
generated_draft
```

## Rules

- Data files store relative `/assets/...` paths where possible.
- Mini program resolves relative paths against COS.
- Local H5/dev may resolve relative paths against local backend static server.
- Generated drafts do not become runtime assets until promoted.
- Runtime asset names should be stable and cache-aware.

## Migration Requirement

Do not break existing `/assets/...` paths during rebuild.

