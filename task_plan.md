# Task Plan

## Goal
- Add a unified and safe model-switch path for Molibot.
- Avoid direct AI-driven edits to the runtime settings file.
- Support the same switching flow across Telegram, Feishu, API, and agent tools.
- Add persistent AI token accounting and expose aggregated usage analytics in Settings.
- Keep first-run startup robust on new machines, especially for the Mory SQLite backend.

## Phases
| Step | Status | Notes |
| --- | --- | --- |
| Inspect current model-switch implementation | complete | Web/API, Telegram `/models`, runtime settings persistence, and agent tool boundaries verified |
| Record safety findings and target design | complete | Confirmed current safe path is `updateSettings`, but agent `bash` can still bypass file guards |
| Implement shared switch service and guardrails | complete | Extracted selection/build logic into shared module, added agent tool, and blocked direct settings-file shell edits |
| Wire channels and API to shared switch flow | complete | Telegram and Feishu commands plus a narrow switch API now reuse the shared model-switch service |
| Add runtime token accounting and settings analytics | complete | Added append-only usage tracker, request-path recording, usage API, and `/settings/ai` dashboard |
| Fix Mory first-run bootstrap on clean machines | complete | Ensured memory/SQLite parent dirs exist before opening the Mory database so startup no longer fails on a fresh machine |
| Verify build and update docs | complete | Updated `features.md`, `prd.md`, and progress records after successful `npm run build` |

## Errors Encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
