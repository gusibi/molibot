# Findings

- Event task files currently live primarily under `${DATA_DIR}/moli-t/bots/<botId>/events/*.json`.
- Chat-local event directories also exist under `${DATA_DIR}/moli-t/bots/<botId>/<chatId>/scratch/events/*.json`.
- Existing settings subpages follow a consistent pattern: sidebar nav, fetch-on-mount, server API under `/api/settings/*`.
- Event files already include enough metadata for the UI: `type`, `chatId`, `delivery`, schedule fields, and optional `status`.
- A read-only inventory endpoint is sufficient for V1; task mutation/cancel actions can come later without blocking visibility.
- `npm run build` succeeds after adding the new tasks API and settings page.
