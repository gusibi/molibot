# Task Plan

## Goal
Add a Settings page for viewing scheduled event tasks, grouped by task type and shown in tables with status and key metadata.

## Phases
- [completed] Inspect existing settings UI and event storage layout
- [completed] Add server inventory API for event tasks
- [completed] Add `/settings/tasks` page and settings navigation entry
- [completed] Update `prd.md` and `features.md`
- [completed] Run targeted verification

## Decisions
- Use a read-only inventory API under `/api/settings/tasks`
- Add a standalone settings page instead of overloading Telegram settings
- Group tasks by event `type` and render each group as a table
