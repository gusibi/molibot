# Task Plan: Telegram Multi-Session Commands

## Goal
Add Telegram commands for session lifecycle (`/new`, `/clear`, `/sessions`, `/delete_sessions`, `/help`) and support multiple switchable contexts per chat.

## Phases
- [x] Phase 1: Inspect current Telegram runtime and context storage model
- [x] Phase 2: Implement multi-session context storage with active session pointer
- [x] Phase 3: Wire Telegram command handlers and session switching/deletion flows
- [x] Phase 4: Adapt runner lifecycle to session-aware runner keys
- [x] Phase 5: Build verification and docs update (`features.md`, `prd.md`)

## Key Decisions
- Keep session scope per Telegram chat (`chatId`), with active session pointer persisted on disk.
- Context file layout: `data/telegram-mom/<chatId>/contexts/<sessionId>.json`.
- Backward compatibility: auto-migrate legacy `context.json` to `contexts/default.json`.

## Status
**Completed** - commands implemented and `npm run build` passes.

## 2026-02-25 Addendum: Telegram Multi-Bot
- [x] Phase 1: Analyze single-bot constraints in settings/runtime/adapter
- [x] Phase 2: Introduce `telegramBots[]` schema with legacy migration compatibility
- [x] Phase 3: Refactor runtime to manage multiple Telegram managers concurrently
- [x] Phase 4: Upgrade `/settings/telegram` to multi-bot list UI
- [x] Phase 5: Build verification + docs updates (`features.md`, `prd.md`)
- [x] Phase 6: Add event delivery-mode split (`text` vs `agent`) and async event callback status flow

## 2026-02-25 Addendum: Memory Plugin
- [x] Phase 1: Confirm feasibility and identify settings/runtime/chat integration points
- [x] Phase 2: Implement pluggable memory architecture (`gateway` + replaceable `core`)
- [x] Phase 3: Add memory APIs (`add/search/flush/delete/update`)
- [x] Phase 4: Inject memory retrieval into chat reply path
- [x] Phase 5: Add plugin settings page with memory enable toggle
- [x] Phase 6: Build verification + docs updates (`features.md`, `prd.md`)

## 2026-02-25 Addendum: Memory v2 Strategy Execution
- [x] Phase 1: Extend memory protocol with layered records and core capability negotiation
- [x] Phase 2: Upgrade json-file core to hybrid search (keyword + recency)
- [x] Phase 3: Implement incremental flush with per-conversation cursor
- [x] Phase 4: Upgrade chat memory usage policy (manual capture + per-turn incremental flush + layered prompt context)
- [x] Phase 5: Add human-readable memory mirrors (`MEMORY.md` + `daily/*.md`)
- [x] Phase 6: Build verification + docs updates (`features.md`, `prd.md`)

## 2026-02-25 Addendum: Memory v2 Round 2 (Governance)
- [x] Phase 1: Add memory governance metadata (`factKey`, `hasConflict`, `expiresAt`)
- [x] Phase 2: Implement conflict detection and expired-memory filtering in core
- [x] Phase 3: Extend memory API with operations-friendly `list` action and TTL-aware add/update
- [x] Phase 4: Build `/settings/memory` operations page (list/search/flush/edit/delete)
- [x] Phase 5: Wire settings navigation to memory management page
- [x] Phase 6: Build verification + docs updates (`features.md`, `prd.md`)

## 2026-02-25 Addendum: Telegram Memory Directory Unification
- [x] Phase 1: Move Telegram mom memory read path to `${DATA_DIR}/memory` unified root
- [x] Phase 2: Add legacy memory file auto-migration from workspace/chat directories
- [x] Phase 3: Update runner memory instructions to new path conventions
- [x] Phase 4: Expand tool path guard to allow shared memory root writes
- [x] Phase 5: Build verification + docs updates (`features.md`, `prd.md`)

## 2026-02-25 Addendum: Gateway-Only Memory + Unified View
- [x] Phase 1: Extend memory gateway/core with all-scope query and external file sync capability
- [x] Phase 2: Add runtime periodic sync to import Telegram file memories into gateway
- [x] Phase 3: Add Telegram `memory` tool and wire runner to gateway for memory context
- [x] Phase 4: Block direct memory file operations in generic file/shell tools
- [x] Phase 5: Upgrade `/settings/memory` to unified cross-scope view with sync stats
- [x] Phase 6: Build verification + docs updates (`features.md`, `prd.md`)
