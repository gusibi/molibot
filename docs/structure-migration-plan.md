# Structure Migration Plan

## Goal
- Reorganize `src/lib/server` around clear product modules instead of mixed technical/history-based buckets.
- Keep runtime behavior unchanged during the first migration stages.
- Execute moves in small batches with import-only follow-up fixes.

## Target Structure

```text
src/
  lib/
    shared/
    server/
      app/
      agent/
      channels/
      memory/
      sessions/
      settings/
      providers/
      infra/
```

## Migration Principles
- Prefer rename/move before logic changes.
- Keep public route/API behavior stable.
- Move high-confidence modules first.
- Defer deeper splitting of oversized runtime files until after directory ownership is clear.

## Migration Table

| Phase | Current Path | Target Path | Reason | Status |
| --- | --- | --- | --- | --- |
| 1 | `src/lib/server/mom/*` | `src/lib/server/agent/*` | Replace upstream-only naming with product-readable runtime naming | Done |
| 1 | `src/lib/server/plugins/channels/telegram/*` | `src/lib/server/channels/telegram/*` | Keep all channel integrations under one module root | Done |
| 1 | `src/lib/server/plugins/channels/feishu/*` | `src/lib/server/channels/feishu/*` | Keep all channel integrations under one module root | Done |
| 1 | `src/lib/server/services/sessionStore.ts` | `src/lib/server/sessions/store.ts` | Session persistence is a first-class module, not a generic service | Done |
| 1 | `src/lib/server/services/settingsStore.ts` | `src/lib/server/settings/store.ts` | Runtime settings persistence belongs to settings module | Done |
| 1 | `src/lib/server/services/assistant.ts` | `src/lib/server/providers/assistantService.ts` | LLM invocation belongs to provider/model integration layer | Done |
| 1 | `src/lib/server/runtime.ts` | `src/lib/server/app/runtime.ts` | Make composition root explicit | Done |
| 1 | `src/lib/server/index.ts` | `src/lib/server/app/index.ts` | Put CLI/bootstrap entry under app layer | Done |
| 2 | `src/lib/server/config.ts` | `src/lib/server/settings/*` + `src/lib/server/app/*` | Separate settings schema/defaults from boot wiring | Done |
| 2 | `src/lib/server/core/messageRouter.ts` | `src/lib/server/channels/shared/messageRouter.ts` or retire | Clarify whether this is shared chat orchestration or legacy path | Done |
| 2 | `src/lib/server/services/rateLimiter.ts` | `src/lib/server/infra/rateLimiter.ts` or `app/guardrails/` | Keep guardrail utility out of generic service bucket | Done |
| 3 | `src/lib/server/db/sqlite.ts` | `src/lib/server/infra/db/*` | Isolate persistence helpers from business modules | Done |
| 3 | `src/lib/server/types/message.ts` | `src/lib/shared/types/message.ts` or `sessions/types.ts` | Keep cross-module types in stable shared/module-local home | Done |
| 4 | `src/lib/server/channels/telegram/runtime.ts` | `src/lib/server/channels/telegram/{runtime,commands,scheduling,transport,attachments}/*` | Split oversized file by responsibility | Planned |
| 4 | `src/lib/server/channels/feishu/runtime.ts` | `src/lib/server/channels/feishu/{runtime,commands,transport}/*` | Mirror clearer ownership for Feishu runtime | Planned |

## Execution Order
1. Phase 1: rename/move modules and fix imports.
2. Verify build/typecheck.
3. Phase 2: split settings/bootstrap boundaries.
4. Phase 3: pull generic infra out of business modules.
5. Phase 4: break down oversized channel runtime files.

## Current Status
- Phase 1 completed on 2026-03-02.
- Phase 2 completed on 2026-03-02.
- Phase 3 core infra extraction completed on 2026-03-02.
- Verification completed with `npm run build`.
- Next recommended step: split oversized Telegram and Feishu runtime files by responsibility.
