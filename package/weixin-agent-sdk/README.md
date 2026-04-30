# weixin-agent-sdk (Vendored)

This directory contains a vendored copy of the third-party `weixin-agent-sdk`.

- Upstream source: `wong2/weixin-agent-sdk`
- Purpose here: provide the Weixin transport/login/media base for Molibot
- Ownership: this is third-party code, not Molibot product logic

When updating the Weixin transport layer, prefer syncing from upstream first and keep local divergence minimal.

Current sync notes:
- Requests include sanitized `base_info.bot_agent` metadata for backend observability.
- `notifyStart` / `notifyStop` expose the Weixin lifecycle notification endpoints.
- QR login supports local token hints, pairing-code verification, locked-code refresh, already-bound responses, and IDC redirect polling.
