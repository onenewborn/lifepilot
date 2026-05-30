# API 错误合同

更新时间：2026-05-30

## 响应 Envelope

所有 JSON API 响应使用以下两类结构。

成功：

```json
{
  "ok": true,
  "data": {},
  "meta": {}
}
```

迁移期为了兼容旧小程序，部分 legacy route 可以继续返回顶层字段：

```json
{
  "ok": true,
  "session": {},
  "cards": [],
  "timing": {}
}
```

P1 可以保留旧的顶层字段。新的内部路由优先使用 `data`。

失败：

```json
{
  "ok": false,
  "error": {
    "code": "session_not_found",
    "message": "Session not found.",
    "details": {}
  },
  "meta": {
    "request_id": "req_...",
    "fallback_used": false
  }
}
```

## HTTP 状态码

```text
400 invalid_request
404 session_not_found / route_not_found
409 invalid_session_transition
422 invalid_payload
429 rate_limited
500 internal_error
502 provider_error
504 provider_timeout
```

## 必备错误码

```text
invalid_json
invalid_request
invalid_payload
session_not_found
invalid_session_transition
card_not_found
provider_error
provider_timeout
invalid_ai_json
fallback_unavailable
route_not_found
internal_error
```

## Fallback 响应

当 AI 失败但确定性 fallback 成功时，响应仍然是 `ok: true`。

Fallback 响应必须设置 `meta.fallback_used=true`。兼容旧接口时可以额外暴露顶层 `mode`、`warning`、`timing`，但 `meta.fallback_used` 是硬要求。

```json
{
  "ok": true,
  "meta": {
    "fallback_used": true,
    "fallback_reason": "provider_timeout"
  },
  "mode": "local_fallback",
  "warning": {
    "code": "provider_timeout",
    "message": "AI provider timed out; local fallback was used."
  },
  "timing": {
    "total_ms": 1200,
    "ai": {
      "ok": false,
      "provider": "ark_doubao",
      "error_code": "provider_timeout"
    }
  }
}
```

实时卡流不能仅因为 AI 失败而中断。
