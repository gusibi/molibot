# Findings

## Repository Scan
- Root project is a SvelteKit app plus server runtime, CLI entry, Telegram runtime, and a nested `package/mory` package.
- `README.md` says the current backend core is concentrated in `src/lib/server/`.
- Build artifacts and generated directories (`build`, `dist`, `.svelte-kit`, `node_modules`) exist in repo/worktree and add visual noise during manual inspection.

## Naming / Boundary Findings
- `src/lib/server/` is acting as a catch-all backend root instead of a cleanly partitioned application layer. It currently mixes runtime bootstrap, business orchestration, channel adapters, prompt/runtime internals, memory backends, plugin discovery, and storage helpers.
- `mom` is not random project-specific naming. It is inherited from the upstream `pi-mono` package and stands for `Master Of Mischief`, an agent runtime capable of tools, prompts, memory injection, and workspace execution.
- `package/mory` is a separate SDK-style package for memory orchestration/storage, while `src/lib/server/memory` is the host application's memory gateway/backend integration layer. The two are related but sit at different architectural levels.
- `plugins/channels/*` and `channels/registry.ts` overlap conceptually: one directory contains concrete channel implementations while another contains channel plugin contracts/registration. This split is technically valid but hard to read because the naming does not reveal the distinction.
- `core/messageRouter.ts` still reflects the earlier “unified chat router” architecture, while Telegram/Feishu now use the richer `mom` runtime directly. That means the repo contains both an older generic path and a newer agent-runtime path.

## Structural Hotspots
- `src/lib/server/plugins/channels/telegram/runtime.ts` is very large (1835 lines). It currently mixes transport integration, queueing, formatting, event watching, prompt preview generation, model switching commands, file handling, and runtime/session orchestration in one file.
- `src/lib/server/plugins/channels/feishu/runtime.ts` is also large (700 lines) and appears to mirror part of the Telegram runtime shape.
- `src/lib/server/runtime.ts` is the composition root but also contains substantial settings sanitization and logging logic. This makes the real bootstrap path harder to see.
- `src/lib/server/config.ts` carries environment loading, settings types, defaults, and channel-settings mapping. It is both schema and bootstrap config assembler.
- Route structure is comparatively clearer than backend structure: `/settings/*` and `/api/settings/*` already hint at business domains like AI, Telegram, Feishu, Memory, Skills, Tasks.

## Refactor Direction
- The strongest organizing signal in the current product is domain/business capability, not technical layer. Existing visible domains are: `ai`, `channels`, `memory`, `skills`, `tasks`, `sessions`, and `workspace/runtime`.
- `mom` should likely be renamed or wrapped under a product-specific name such as `agent-runtime` or `workspace-runtime`; otherwise every future contributor has to learn upstream lore before understanding the codebase.
- `package/mory` should remain separate as an SDK package, but in the app layer its integration should live under an explicit domain path such as `domains/memory/backends/mory`.

## Applied Migration
- Phase 1 was executed with no behavior change target:
  - `runtime.ts` and `index.ts` moved under `src/lib/server/app/`
  - `mom` moved to `src/lib/server/agent/`
  - built-in Telegram/Feishu implementations moved to `src/lib/server/channels/`
  - `sessionStore`, `settingsStore`, and `assistant` moved to `sessions/`, `settings/`, and `providers/`
- `npm run build` succeeded after import/path updates, so the phase-1 directory migration is build-clean.
- Phase 2 was executed next:
  - former `config.ts` was split into `src/lib/server/app/env.ts` and `src/lib/server/settings/{schema,defaults}.ts`
  - shared router moved from `src/lib/server/core/messageRouter.ts` to `src/lib/server/channels/shared/messageRouter.ts`
- `npm run build` also succeeded after the phase-2 boundary split.
- Phase 3 extraction was also applied:
  - `rateLimiter.ts` moved to `src/lib/server/infra/rateLimiter.ts`
  - storage helpers moved to `src/lib/server/infra/db/storage.ts`
  - shared message contracts moved to `src/lib/shared/types/message.ts`
- `npm run build` succeeded after the infra/shared extraction as well.

## Additional Cleanup
- `src/lib/memoryStorageBackend.ts` was confirmed unused by repository-wide search and deleted.
- Keeping `src/lib/server/` is still the right call: it gives a strong server-only boundary for runtime/channel/memory code in a SvelteKit app. The problem was internal organization under `server`, not the existence of the `server` layer itself.

## Telegram Runtime Refactor
- The first Telegram split should stay shallow because this repository is likely to keep receiving AI-assisted edits.
- A low-risk extraction was applied:
  - `formatting.ts` now owns Telegram markdown-to-HTML formatting and send/edit helpers
  - `queue.ts` now owns the per-chat async queue implementation
  - `stt.ts` now owns STT route resolution and transcription HTTP calls
  - `types.ts` now owns small runtime-local helper types
- This reduced `src/lib/server/channels/telegram/runtime.ts` from 1835 lines to 1534 lines without changing the runtime's orchestration shape.

## Shared Channel Duplication
- Telegram and Feishu carried near-identical queue implementations that differed only by log channel name. That duplication is now removed in favor of `src/lib/server/channels/shared/queue.ts`.
- Telegram `stt.ts` and Feishu `message-intake.ts` duplicated the same STT provider-target resolution and OpenAI-compatible transcription request flow. That common core now belongs in `src/lib/server/channels/shared/stt.ts`.
- Image/attachment intake was intentionally not deduplicated. Although both channels eventually produce `attachments`/`imageContents`, the upstream message payloads, file-download APIs, and media-type heuristics are still channel-specific enough that extracting them now would increase risk rather than reduce it.

## Feishu Media Gap
- Telegram outbound media support was already complete: `uploadFile` could send text, image, audio, and generic documents.
- Feishu outbound media support was previously missing entirely because `MomContext.uploadFile` in `src/lib/server/channels/feishu/runtime.ts` was an empty stub.
- That gap is now closed with channel-local helpers:
  - small text files can be sent as normal Feishu text cards
  - images upload via `im.image.create` and send as `msg_type: "image"`
  - uploaded audio/video first attempt channel-native `audio` / `media` messages and fall back to `file`
  - generic files upload via `im.file.create` and send as `msg_type: "file"`
- Feishu still keeps `setTyping` and true thread-targeted replies as no-ops/same-message fallbacks. Those are separate capability decisions, not blockers for file/media delivery.
