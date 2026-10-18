# weixin-agent-sdk (Vendored)

This directory contains a vendored, heavily adapted copy of the official WeChat
channel SDK (`@tencent-weixin/openclaw-weixin`, local clone of the upstream
repo used for syncing).

- Purpose here: provide the Weixin transport/login/media base for Molibot
- Ownership: third-party derived code, not Molibot product logic
- Divergence: the OpenClaw host coupling (plugin SDK, channel config, hooks)
  was removed; a standalone `Agent` interface (`src/agent/`, `src/bot.ts`)
  replaces the host runtime

When updating the Weixin transport layer, port applicable upstream fixes
manually — the trees have diverged too far for a file copy.

## Sync history

### 2026-10-17 — upstream 2.4.4 → 2.4.10 (applicable subset), fork 0.3.1 → 0.4.0

Ported:

- **Lossless uint64 message IDs (2.4.9-beta):** `parseWeixinApiJson` quotes
  `message_id` / `msg_id` / `svr_id` before `JSON.parse`, so IDs beyond
  `Number.MAX_SAFE_INTEGER` (e.g. `8421831295061105778`) survive parsing
  instead of silently rounding. `WeixinMessage.message_id` and
  `SendMessageResp.message_id` are now `string`. Used by `getUpdates` and
  `sendMessage`.
- **`classifyFetchError` (2.4.6):** fetch-level errors classified as
  `dns` / `tcp` / `tls` / `timeout` / `unknown`; structured failure logs in
  all API fetch wrappers, `monitor` getUpdates errors, CDN upload retries,
  and `downloadRemoteImageToTemp`.
- **`sendMessage` contract (2.4.6):** returns `SendMessageResp` (including the
  server-assigned `message_id`) instead of `void`; non-zero `ret`/`errcode`
  still throws (the fork already validated this before the sync).
- **`SESSION_EXPIRED_ERRCODE` → `STALE_TOKEN_ERRCODE` (2.4.6):** rename in
  `session-guard` + `monitor` to describe the actual -14 semantics (stale
  bot token, not session expiry).
- **Pairing cleanup (2.4.10):** removed the allowFrom file writer
  (`registerUserInAllowFromStore`) — it had no production callers; read-side
  behavior unchanged.
- **Types:** `RefMessage.svr_id` / `RefMessage.partial_text` +
  `PartialText` interface added (wire protocol alignment; quoted-message
  restoration itself is not implemented yet).

Not ported (with reasons):

- **Quoted-message restoration (2.4.9-beta: `quote-store`, `partial-quote`,
  `ReplyTo*` context, outbound caching, media subdir):** a new feature, not a
  fix. It depends on `node:sqlite` (Node >= 22.13), the OpenClaw message
  context model, and downstream channel adaptation. Decision pending.
- **OpenClaw host compatibility fixes (2.4.7 typing import path, 2.4.9
  gateway model runtime binding, 2.4.10 plugin SDK interfaces, `mutateConfigFile`
  migration):** the fork has no OpenClaw host.
- **Formatting-only churn:** skipped to keep the local diff reviewable.

Earlier local notes:

- Requests include sanitized `base_info.bot_agent` metadata for backend observability.
- `notifyStart` / `notifyStop` expose the Weixin lifecycle notification endpoints.
- QR login supports local token hints, pairing-code verification, locked-code refresh, already-bound responses, and IDC redirect polling.
