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
