# Personal Assistant Capability Matrix

Last verified: 2026-08-09

This file is the single current-status source for Molibot's work/life assistant capabilities. `prd.md` sections below the current-status banner are design and delivery history: their old status wording must not be used to create new work. `features.md` and `CHANGELOG.md` remain delivery logs, not backlogs.

## Status contract

| Status | Meaning |
|---|---|
| 已交付 | Implemented and backed by machine evidence or an explicit owner live acceptance. |
| 部分交付 | Useful end-to-end capability exists, but the stated boundary still has a concrete gap. |
| 待验证 | Implementation exists; the named live/release evidence is still missing. |
| 未开始 | No product implementation exists. This is not automatically approved backlog work. |

## Current matrix

| Area | Capability | Status | Current evidence and boundary |
|---|---|---|---|
| Evaluation | Deterministic golden-set harness | 已交付 | 31 tasks, strict state/trace/text assertions, isolated `DATA_DIR`, external-channel kill switch, fixture generation, and harness tests are present. |
| Evaluation | Full baseline | 已交付 | Full run on 2026-08-10 after the harness upload fix: **30/31**, 0 errors, 0 unproven. The only failure is A5, which is `baseline: unknown` by design — the sandbox blocks egress, so the Agent correctly asks for Host approval and an unattended run stops there. The earlier 23/31 on the same day was a harness defect (global `FormData` through undici's `fetch`), not a capability regression; B2-B6 went 1/6 → 6/6 once the body was built in the sending realm. |
| Memory | Owner/project namespaces and turn retention | 已交付 | `owner:` / `project:` routing and `standard`, `no_memory`, `not_searchable`, `turn_only` are enforced across context, search, reflection, and memory writes. Historical namespace rows are intentionally not migrated. |
| Memory | `add_content` routing | 已交付 | Only explicit published-content `world_knowledge` is accepted. Personal facts, preferences, and missing types fail and direct the Agent to `add`; `content:` is not added to normal recall. |
| Input | Public webpage reading | 已交付 | `webFetch` has SSRF, redirect, size, timeout, cache, Markdown conversion, and context-budget controls. It is not an authenticated browser. |
| Input | PDF/DOCX/XLSX reading | 已交付 | `docExtract` handles native text/tables and bounded PDF OCR through the configured vision route. |
| Input | Image/OCR analysis | 已交付 | `imageAnalyze` uses the configured Agent/global vision route with bounded workspace paths and output. |
| Output | DOCX/XLSX/PDF deliverable export | 已交付 | `documentExport` re-reads and verifies files before atomic publication or attachment. |
| Output | PPTX generation | 未开始 | Deliberately deferred. Existing PPTX support is read-only preview, not presentation generation. Do not infer this task from the delivered document formats. |
| Tasks | Runtime Todo, one-shot reminders, and periodic automation CRUD | 已交付 | Stable-id create/list/get/update/delete exists. Unscheduled Todo never triggers. Optional Mini App Todo remains a separate data model. |
| Notifications | Restart catch-up, expiry, offline honesty, and duplicate suppression | 已交付 | Desktop/Web, Telegram, and Feishu live chains passed create/update/trigger/completed receipt/delete. Unit guards cover short restart catch-up, expiry, offline failure, and stable-slot suppression. External delivery remains at-least-once in the crash-after-send/before-local-ack window. |
| Mini Apps | Agent creation/install H2 | 已交付 | Final live H2 passed 1/1 in 280 seconds with installed manifest, validate/install/inspect receipts, and continued service activity after install. |
| Mini Apps | Mini App/Pi extension fault isolation | 已交付 | Untrusted runtimes execute in bounded child processes; exit, loop, timeout, cancellation, and reconstruction have regression coverage. This is fault isolation, not a permission sandbox. |
| Mini Apps | Microphone recording and transcription path | 已交付 | Product owner confirmed the Mini App microphone works in the real app on 2026-08-09. Raw upload, recording segmentation, transcription, retry, and persistence machinery were already delivered. Denial/device-loss automation remains test hardening, not a capability blocker. |
| Artifacts | Shared read-only Artifact Inspector | 已交付 | Project and Session use the shared registry; code, media, HTML, CSV, JSON, XLS/XLSX, DOCX, PDF, and PPTX have bounded viewers or explicit system fallback. |
| Maintenance | Safe legacy data cleanup | 已交付 | `clean-data-dir.mjs --apply` reclaimed 326MB on 2026-08-09; a follow-up scan reports zero safe items. Six review-only files (raw responses, settings backups, `event.log`, Skill backup) remain by design and require separate owner decisions. |
| External actions | Generic Skill/MCP/Connector integration seam | 部分交付 | The extension seam is delivered, but concrete calendar/contact/email integrations are not shipped. External integration work starts only after the product owner selects one. |
| External actions | Calendar | 未开始 | Intentionally external Skill/MCP/Connector scope, not a built-in Runtime feature. Create work only after the product owner selects an integration. |
| External actions | Contacts | 未开始 | Same external integration boundary as calendar. |
| External actions | Email | 未开始 | Same external integration boundary as calendar. |
| External actions | Browser automation | 未开始 | Explicitly excluded from the current plan because inheriting a browser runtime is too heavy. `webFetch` is the supported public-page reader. |

## Maintenance rule

When capability status changes, update this matrix in the same slice as the code/evidence. Add implementation detail to `features.md`, planning rationale to `prd.md`, and a release-facing summary to `CHANGELOG.md`, but do not copy a second status table into those files.
