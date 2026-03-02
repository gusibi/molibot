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
