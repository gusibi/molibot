# Built-In Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in `webSearch` Agent tool with settings-page configuration and multiple search-engine providers.

**Architecture:** Implement search as shared Agent-layer infrastructure under `src/lib/server/agent/search`, with provider adapters behind a common interface and one built-in tool registered from `createMomTools`. Runtime settings own engine enablement, credentials, routing, timeouts, and defaults; Channels do not contain search logic.

**Tech Stack:** SvelteKit, TypeScript, `@sinclair/typebox`, built-in `fetch`, shadcn-svelte settings components.

---

### Task 1: Settings Shape

**Files:**
- Modify: `src/lib/server/settings/schema.ts`
- Modify: `src/lib/server/settings/defaults.ts`
- Modify: `src/lib/server/settings/sanitize.ts`
- Modify: `src/lib/server/settings/store.ts`

- [ ] Add `WebSearchSettings` types with `enabled`, `defaultRoute`, `defaultEngine`, `maxResults`, `timeoutMs`, `retryTimeoutMs`, and per-engine configs.
- [ ] Add defaults from `MOLIBOT_WEB_SEARCH_*` env vars, with `duckduckgo` enabled by default.
- [ ] Add sanitizers that clamp numeric fields, preserve unknown provider keys only when explicitly supported, and never require paid API keys for startup.
- [ ] Add `webSearch` to raw settings load/save paths.

### Task 2: Search Runtime

**Files:**
- Create: `src/lib/server/agent/search/types.ts`
- Create: `src/lib/server/agent/search/providers.ts`
- Create: `src/lib/server/agent/search/router.ts`
- Create: `src/lib/server/agent/search/webSearchTool.ts`
- Test: `src/lib/server/agent/search/router.test.ts`
- Test: `src/lib/server/agent/search/webSearchTool.test.ts`

- [ ] Define a normalized search input/result contract.
- [ ] Implement provider adapters for `duckduckgo`, `brave`, `tavily`, `exa`, `serper`, `baidu`, and `bocha`.
- [ ] Implement route selection and fallback order based on the existing web-search skill policy.
- [ ] Implement one retry on timeout using `retryTimeoutMs`.
- [ ] Return structured results plus diagnostics.

### Task 3: Tool Registration

**Files:**
- Modify: `src/lib/server/agent/tools/index.ts`
- Modify: `src/lib/server/agent/tools/toolClassification.ts`

- [ ] Register `webSearch` as a built-in Agent tool.
- [ ] Classify it as `medium` risk because it performs external network access.

### Task 4: Settings UI

**Files:**
- Modify: `src/routes/settings/+layout.svelte`
- Create: `src/routes/settings/search/+page.svelte`
- Create: `src/routes/api/settings/web-search/test/+server.ts`

- [ ] Add Settings navigation entry.
- [ ] Build a shadcn-svelte based Search Settings page with enable switches, route/default controls, engine credentials, timeout and max result fields.
- [ ] Add a test-query endpoint that uses current settings plus unsaved form values to return route diagnostics and a preview result.

### Task 5: Documentation

**Files:**
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] Record the built-in search capability, settings page, and provider scope.
- [ ] Note future providers outside MVP.

### Task 6: Verification

**Commands:**
- `npm run build`
- Targeted TypeScript/tsx imports for new modules if the full build is blocked.

- [ ] Verify settings compile.
- [ ] Verify unit tests pass.
- [ ] Verify the app builds or report the blocking existing issue.
