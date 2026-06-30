# Molibot macOS App Implementation

## Goal

Implement `docs/requirements/molibot-macos-app-plan.md` as a production-oriented macOS app, starting with Phase 1 and preserving the existing Web/server product.

## Success Criteria

- Phase 1 has a standalone `apps/desktop` Tauri/Svelte workspace.
- The host exposes Chat and Settings windows, single-instance behavior, tray/menu actions, close-to-background behavior, and explicit quit.
- Service discovery and ownership are modeled outside channel code and covered by tests.
- Desktop setup does not regress the existing Web build.
- Product documentation is updated with shipped facts only.

## Current Delivery Slice

Desktop Settings Web-parity follow-up is now active. The immediate slice is to inventory the functional actions on every existing Web Settings page, compare them against the Desktop Settings implementation, reproduce and remove the incorrectly repeated “重新检查” action, then migrate missing behavior using the existing fine-grained APIs while preserving the new macOS UI, i18n, themes, responsive layout, and fixed save footer.

Started Phase 3 external-channel read-only aggregation (plan §7.2 / §7.3) and shipped the read-only list + transcript. Also shipped the §9.1 first-launch onboarding overlay, a 5-step §9.2 guided flow with a validated credential-blind Provider draft, working Agent/Web Profile confirmation and launch-at-login steps, the usable-config health summary, and the §10 Runtime environment settings section. Provider submit/verify, Profile creation inside onboarding, channel/diagnostics step forms, and §10 install execution remain for later slices (they need the desktop capability token, additional fine-grained server forms, or native/runtime verification).

Phase 4 Settings now covers General, Models, AI Providers, Web Profiles, Usage, Run History, Trace, Sandbox, Host Bash, Tasks, and Diagnostics, plus first-launch readiness/no-model triage and explicit theme + language persistence. Remaining major work (dependency installer §10, voice §7.1, Phase 3 transcript view + real-time events + unified approvals, real-runner DMG production) needs a running service, native plugins, or a real device to implement and verify.

## Phases

| Phase | Status | Verification |
|---|---|---|
| 1. Audit architecture and toolchain | completed | Recorded existing server entrypoints, health/version APIs, and packaging constraints |
| 2. Scaffold desktop workspace | completed | Desktop frontend and Tauri metadata compile independently |
| 3. Implement native lifecycle foundation | completed | Rust tests cover ownership/discovery; host builds |
| 4. Verify Web compatibility | completed | Existing production Web build remains green |
| 5. Update product documentation | completed | `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` reflect this slice |
| 6. Audit server packaging boundary | completed | Confirmed adapter-node output, external dependency shape, resource assumptions, and current release size |
| 7. Add service lease and handshake | completed | Independent server and desktop sidecar share one data-directory lock and expose a versioned local handshake |
| 8. Bundle and supervise Node sidecar | in_progress | Embedded Node and packaged runtime smoke pass; discovery/ownership/restart and graceful-quit unit tests pass; launched-App lifecycle smoke remains |
| 9. Produce unsigned DMG workflow | in_progress | Non-interactive build and tested checksum finalizer are implemented; actual DMG production/inspection remains outside the restricted environment |
| 10. Audit Desktop Chat contracts | completed | Existing Profile/session/stream APIs and WebView transport boundary are mapped and documented |
| 11. Implement local Profile/session closure | completed | Desktop uses a narrow bootstrap contract and shared session APIs for list/create/select/inline rename/two-step delete |
| 12. Implement streamed local chat | in_progress | Transcript, thinking level, SSE parsing/state and stop wiring are implemented; real-provider stream smoke and remaining Phase 2 controls are pending |
| 13. Verify Phase 2 vertical slice | completed | Temp-data API/browser smoke, Desktop checks/tests, Rust tests, and Web regression pass for the delivered subset |
| 14. Add current-session file panel | completed | Read-only file panel over `/api/web/files` with media-type filter, in-app preview/download, loopback-scoped HTTP, unit tests, and green desktop check/build; native Finder reveal/Quick Look deferred |
| 15. Add run-progress timeline | completed | Live tool/subagent/thread-note timeline from existing SSE events via tested `parseDesktopActivity`; per-run, non-persisted, desktop-only, with green check/tests/build |
| 16. Add inline message attachments | completed | Per-message attachment chips from existing `/api/sessions/[id]` data, matched to `/api/web/files` by relative path to reuse preview/download; contract-only/desktop-only with green check/tests/build |
| 17. Add file upload | completed | Composer attach control sends multipart turns through existing `/api/chat` and the shared runner; loopback-scoped `/api/chat*` capability, multipart unit test, green check/tests/build; live upload smoke deferred to a running-service environment |
| 18. Add Host Bash approval | completed | In-transcript approval card from existing `host_bash_approval` SSE; resolved via `/api/chat` `/hosttools` command with background-resume polling; pure parser/mapper unit tests, green check/tests/build; live approval/resume smoke deferred to a running-service environment |
| 19. Add session filter and transcript search | completed | Sidebar title filter plus in-conversation find bar with match counter and prev/next navigation; pure `filterSessionsByTitle`/`findTranscriptMatches` unit tests, fully client-side, green check/tests/build |
| 20. Add follow-up queue + media CSP fix | completed | Local follow-up queue (Enter-to-queue during a run, auto-send in order, Stop clears) with pure `addToFollowUpQueue`/`nextFollowUp` tests; fixed CSP to allow `blob:`/`media-src` so shipped object-URL previews work on-device; green check/tests/build |
| 21. Start Phase 4 Settings: model routing | completed | Sectioned Settings nav plus a credential-safe Models section switching text/vision/stt/tts/subagent via route-aware `/api/desktop/models`; server route sanitizer + per-route tests, desktop+Web builds green |
| 22. Add environment readiness summary | completed | Settings → General readiness card (text-model + Web Profile status) derived client-side via `summarizeDesktopReadiness` from existing bootstrap/models data; pure-function tests, desktop-only, green check/tests/build; seeds §9 first-launch triage |
| 23. Add Chat no-model triage banner | completed | Non-blocking guidance banner + disabled composer when ready and a profile exists but no usable text model (reuses `summarizeDesktopReadiness`, `!modelReady` send guard); keeps transcript visible; desktop-only, green check/build |
| 24. Add diagnostics settings section | completed | Read-only Settings → Diagnostics (service version/ownership/endpoint/state from `desktop_status`) with sanitized `buildDiagnosticsSummary` clipboard copy; pure-function test, desktop-only, green check/tests/build; native log/bundle export deferred |
| 25. Add explicit theme switch | completed | Settings Appearance selector (System/Light/Dark) persisted via `normalizeTheme`/localStorage, applied with `data-theme`, synced across windows via storage event; CSS refactored for explicit + system dark; pure-function test, desktop-only, green check/tests/build |
| 26. Add Web Profile settings section | completed | Settings → Web Profiles lists all profiles (incl. disabled) with inline rename + enable/disable toggle via credential-safe `/api/desktop/profiles` GET/PATCH (name/enabled only, agentId/credentials preserved server-side); `resolveDesktopWebProfiles`/`patchDesktopWebProfile` + client `hasEnabledWebProfile`/`sanitizeWebProfileName` tests, desktop-only UI, green check/tests/build |
| 27. Add Usage settings section | completed | Settings → Usage shows aggregate AI token/request counts (total + today/yesterday/last-7/last-30 windows) via credential-safe `/api/desktop/usage` GET + `buildDesktopUsageSummary` (drops per-model/per-bot breakdowns and raw records); `formatTokenCount` client test, desktop-only UI, green check/tests/build |
| 28. Add Run history settings section | completed | Settings → Run history lists recent runs (outcome badge, bot/chat, timing, tools, reflection summary) via credential-safe `/api/desktop/run-history` GET + `buildDesktopRunHistoryItem` (drops absolute workspace/file/draft paths and `finalText`); `formatDurationMs` client test, desktop-only UI, green check/tests/build |
| 29. Add Trace settings section | completed | Settings → Trace shows aggregate run-trace counts (facts, runs, tool/model/skill calls, tokens, avg durations, coverage) with a time-range selector via credential-safe `/api/desktop/trace` GET + `computeDesktopTraceTotals` (drops raw fact records/payloads/previews); `sanitizeDesktopTraceRange` server test, desktop-only UI, green check/tests/build |
| 30. Add Sandbox settings section | completed | Settings → Sandbox shows tool-sandbox status + diagnostics with an enable/disable toggle via credential/path-safe `/api/desktop/sandbox` GET + PATCH + `buildDesktopSandboxSummary` (drops `envFilePath` and env key names); desktop-only UI, green check/tests/build |
| 31. Add Host Bash settings section | completed | Settings → Host Bash shows pending/whitelist/history counts + whitelist list with enable/disable toggles via credential-safe `/api/desktop/host-bash` GET + POST (toggle) + `buildDesktopHostBashSummary` (drops `command` and env-allowlist key names); desktop-only UI, green check/tests/build |
| 32. Add Tasks settings section | completed | Settings → Tasks shows task counts (by type/status/scope/channel) + per-task list (channel, bot/chat, type, schedule, status, run count, last triggered) via credential/path-safe `/api/desktop/tasks` GET + `buildDesktopTaskSummary` (drops `text` and `filePath`); desktop-only UI, green check/tests/build |
| 33. Add AI Providers settings section | completed | Settings → AI Providers shows provider mode + built-in (Pi) provider/model and a custom-provider list (name, protocol, baseUrl, model count, default model, API-key configured flag, enabled, default badge) via credential-safe `/api/desktop/providers` GET + `buildDesktopProvidersSummary` (drops `apiKey`→`hasApiKey`, per-model verification, reasoning maps); desktop-only UI, green check/tests/build |
| 34. Persist language selection | completed | Settings language choice persisted via `normalizeLocale`/localStorage and synced live across Chat+Settings windows via the storage event (mirrors the theme handling); `normalizeLocale` unit test, desktop-only, green check/tests/build |
| 35. Add Agents settings section | completed | Settings → Agents lists configured agents (name, description, enabled, sandbox override, per-agent model-routing override count) + total/enabled counts via `/api/desktop/agents` GET + `buildDesktopAgentsSummary` (agents carry no secrets; projects a narrow display shape instead of the full settings object); server `desktopAgents.test.ts`, desktop-only UI, green check/tests/build |
| 36. Add MCP settings section | completed | Settings → MCP lists configured MCP servers (transport, command/url, arg/env-key/header counts, tool prefix, enabled) + total/enabled/stdio/http counts via credential-safe `/api/desktop/mcp` GET + `buildDesktopMcpSummary` (drops stdio `env` values + `cwd` + `args` values and http `headers` values → counts only; keeps identifying command/url); server `desktopMcp.test.ts`, desktop-only UI, green check/tests/build |
| 37. Add Skills settings section | completed | Settings → Skills lists discovered skills (name, scope, owner bot/chat, MCP-server count, enabled) + total/enabled/by-scope counts + skill-search local/api status via path/credential-safe `/api/desktop/skills` GET (reuses shared skills route GET) + `buildDesktopSkillsSummary` (drops `filePath`/`baseDir` absolute paths and the skill-search api key; `mcpServers`→count); server `desktopSkills.test.ts`, desktop-only UI, green check/tests/build |
| 38. Add Memory settings section | completed | Settings → Memory shows runtime/config enabled flags, backend name, and backend capability flags (hybrid/vector/incremental-flush/layered) via `/api/desktop/memory` GET + `buildDesktopMemorySummary` (reads only backend config + live `memory.isEnabled()`/`capabilities()`; never reads memory record content); server `desktopMemory.test.ts`, desktop-only UI, green check/tests/build |
| 39. Add Channels settings section | completed | Settings → Channels groups external channels (telegram/feishu/qq/weixin, web excluded) with per-instance rows (name, linked agent, allowed-chat count, sandbox override, enabled) + total/enabled instance counts via credential-safe `/api/desktop/channels` GET + `buildDesktopChannelsSummary` (drops instance `credentials` entirely; `allowedChatIds`→count); server `desktopChannels.test.ts`, desktop-only UI, green check/tests/build |
| 40. Add GitHub Actions unsigned-DMG release workflow | completed | `.github/workflows/desktop-release.yml` builds the Apple Silicon unsigned DMG on `macos-14` (prepare runtime → `tauri build --ci` → checksum finalizer), writes a BUILD-INFO manifest (version/git commit/runner/Node/Rust), uploads a workflow artifact, and publishes a prerelease GitHub Release on `molibot-v*` tags with DMG + `.sha256` + manifest; YAML validated; real-runner DMG production remains pending |
| 41. Start Phase 3 external-session aggregation | completed | Backward-compatible optional `ExternalSessionMetadata` on `Conversation`; `SessionStore.listExternalSessions()`; credential-safe `/api/desktop/external-sessions` GET + `buildDesktopExternalSessionsSummary` (groups by telegram/feishu/qq/weixin in known order, masks externalUserId, drops message content, fallback for missing metadata); server + store tests, green check/builds |
| 42. Add read-only external-channel view to Chat | completed | ChatView Local/External sidebar tab; External tab renders grouped read-only external sessions (no input/rename/delete) via `loadDesktopExternalSessions` + tested `groupExternalSessionsForView`/`formatExternalSessionPreview` + bilingual labels + semantic CSS; desktop-only, green check/tests/build |
| 43. Add read-only external transcript pane | completed | Click an external session → `/api/desktop/external-sessions/[id]` GET + `buildDesktopExternalTranscript` (drops `local` attachment paths, filters system messages) renders a read-only transcript in the sidebar; `SessionStore.getExternalSession(id)`; tested mapper + client helper; desktop-only, green check/tests/build |
| 44. Add first-launch onboarding overlay | completed | ChatView localStorage-gated overlay classifies readiness via tested `classifyFirstLaunch` → new/usable/broken (plan §9.1) with Open Settings + Continue/Don't-show-again actions; bilingual labels + semantic CSS; desktop-only, green check/tests/build |
| 45. Add Runtime environment settings section | completed | Settings → Runtime environment read-only dependency list (ffmpeg/git/python3: status, version, source, size, install command) via `/api/desktop/runtime-env` GET + `buildDesktopRuntimeEnvSummary` (drops resolved binary path, no sudo/npm -g); tested mapper + detector + client helper; install execution deferred per §10 |
| 46. Add guided provider setup to onboarding | completed | Onboarding overlay becomes a 5-step guided flow (provider→agent→channels→launch→diagnostics) for new/broken configs; provider draft form validated by tested `validateProviderDraft` (credential-blind: apiKeyPresent boolean, never the key); `ONBOARDING_STEPS`/`advanceOnboardingStep`; bilingual + semantic CSS; submit/verify deferred (needs desktop token) |
| 47. Add onboarding health-check summary (usable branch) | completed | `usable` onboarding branch now shows a tested `buildOnboardingHealthCheck` summary card (model label, profile count, ready/not-ready status) per plan §9.1 "迁移和健康检查摘要"; pure derivation, bilingual, semantic CSS; desktop-only, green check/tests/build |
| 48. Implement onboarding Agent/Web Profile confirmation | completed | Working bilingual selectors + explicit confirm/save gate; narrow validated `agentId` patch preserves credentials/siblings/channels; no-argument onboarding helpers removed; full desktop-chat 96/96, Desktop check/build, Web build, and isolated-data guided-shell page smoke pass |
| 49. Implement onboarding launch-at-login choice | completed | Reuses official Tauri LaunchAgent command through explicit App→Chat state/callback; default-off bilingual switch; compact repair starts at the missing prerequisite and latches mode/target; desktop-chat 98/98, Rust 8/8, Desktop check/build, Web build, and isolated page flow to step 4 pass |
| 50. Implement onboarding channels step (§9.2 step 3) | completed | Replaced the channels-step deferred placeholder with a read-only configured-channels summary (per-channel enabled/total rows + connected count) reusing the credential-safe `/api/desktop/channels` via tested pure `summarizeOnboardingChannels`; channel load tolerant (`.catch(()=>null)`), reset on disconnect; bilingual labels + semantic `.onboarding-channels` CSS; no input/connect affordance (routes to Settings → Channels); desktop-chat 107/107, Rust 8/8, Desktop check 0/0, Desktop build green. Diagnostics step (§9.2 step 5) still deferred |
| 51. Implement onboarding diagnostics step (§9.2 step 5) | completed | Replaced the final deferred placeholder with a read-only runtime/service diagnostics summary (service ready/not-ready + dependency installed/total + missing dep names) reusing the credential-safe `/api/desktop/runtime-env` via tested pure `summarizeOnboardingDiagnostics`; runtime-env load tolerant (`.catch(()=>null)`), reset on disconnect; bilingual labels + reused `.onboarding-channels` CSS; informational only, routes to Settings → Runtime environment, never blocks Finish; desktop-chat 109/109, Desktop check 0/0, Desktop build green. **All 5 §9.2 guided steps now implemented** (provider/agent/channels/launch/diagnostics) |
| 58. Backfill features.md + CHANGELOG.md for slices 50–57 | completed | Slices 50–57 (onboarding channels/diagnostics steps, external Bot-instance hierarchy, Plugins/Web Search/Image/Video/Voice settings) had updated task_plan/progress/findings but were never written to features.md/CHANGELOG.md as the project convention + CLAUDE.md require. Added bilingual features.md per-slice entries (zh) + grouped CHANGELOG.md entries (en) at the top of the 2026-06-28 section. No code change; docs only |
| 59. Fix repeated Settings reconnect footer | completed | Regression-tested visibility helper; healthy sections no longer show a meaningless global “重新检查”; disconnected state shows an explicit “重新连接服务” action |
| 60. Start Web-functional parity with AI Providers | in_progress | Create + credential save + saved-provider connection test implemented in the new macOS UI; edit/delete/model management and provider-mode editing remain |
| 61. Migrate remaining Web Settings actions | in_progress | Profiles and Agents are complete; Channels is active, followed by MCP/Skills/Plugins, Memory/Tasks/Sandbox, Search/Image/Video/TTS, then Usage/Trace/History detail controls |
| 62. Complete actionable AI Provider management | in_progress | Custom provider edit/delete/enable/default/global mode, model registry, discovery/test, thinking and key replacement/clear are implemented; built-in provider catalog/auth guidance parity remains |
| 63. Complete Web Profile management | completed | Create/edit/delete/enable, Agent link, sandbox override and BOT/SOUL/IDENTITY/SONG Markdown files use narrow Desktop APIs with server-owned field preservation |
| 64. Complete Agent management | completed | Create/edit/delete/enable, sandbox override, text/vision/STT routing and AGENTS/SOUL/IDENTITY/SONG Markdown files use narrow Desktop APIs; linked-agent deletion is rejected |
| 65. Migrate external channel instance management | completed | Telegram/Feishu/QQ/Weixin instance CRUD, enablement, credentials, Agent/sandbox/allowlist, Bot Markdown files, Feishu connection test and local Weixin login QR tool are implemented through shared credential-safe APIs; 56 focused tests, Desktop check 0/0, Desktop+Web builds green |
| 66. Migrate MCP server management | completed | Structured stdio/http CRUD, enablement, command/url/prefix editing and credential-safe replacement/clear controls for args, cwd, env and headers; 79 settings tests, Desktop check 0/0, Desktop+Web builds green |
| 67. Migrate Skills settings actions | completed | Per-Skill enable/disable via opaque server-resolved IDs plus local/API skill-search Provider/model/numeric settings; disk paths and server credentials stay outside the WebView; 84 settings tests, Desktop check 0/0, Desktop+Web builds green |
| 68. Migrate Plugins settings actions | completed | Memory enable/backend plus dynamic feature-plugin fields use a credential-safe fixed-footer form; password values are replacement/clear only and catalog paths stay hidden; 90 settings tests, Desktop check 0/0, Desktop+Web builds green |
| 69. Migrate Memory settings actions | completed | Search/list, sync, flush, compact, record edit/delete and rejection review/filter use the narrow Desktop memory endpoint; 93 settings tests, Desktop check 0/0, Desktop+Web builds green |
| 70. Migrate Tasks settings actions | completed | Full task text, filters/selections, edit, single/batch trigger and delete use opaque ids resolved to watched-event JSON paths server-side; 98 settings tests, Desktop check 0/0, Desktop+Web builds green |
| 71. Migrate Sandbox settings actions | in_progress | Implement global policy, network/filesystem rules, init/env modes and diagnostics parity without broad settings writes |
| 57. Add Voice/TTS settings section (§8 "语音") | completed | New credential-safe `/api/desktop/tts-generate` GET maps `settings.ttsGenerate` via `buildDesktopTtsSummary` (macOS provider: voice/format, no key; xiaomi provider: `apiKey`→`hasApiKey`, keeps baseUrl/model/voice/format); `desktopTtsGenerate.ts` mapper + `desktopTtsGenerate.test.ts` 4 tests (macOS no-key, xiaomi key→bool + no leak, blank key, summary order + no leak); `DesktopTtsSummary`/`DesktopTtsProvider`/`DesktopTtsResponse` contract, `loadDesktopTts` loader, capability scope, read-only Settings → Voice section; bilingual labels; desktop-chat 128/128, Desktop check 0/0, Desktop+Web builds green. **Completes the §8 settings set — every §8 capability is now in Desktop Settings** |
| 56. Add Video Generate settings section (§8 "视频") | completed | New `/api/desktop/video-generate` GET reuses the shared `buildDesktopMediaGenerateSummary` mapper + `DesktopMediaGenerateSummary` contract (added a `DesktopVideoGenerateResponse` alias) over `settings.videoGenerate`; `loadDesktopVideoGenerate` loader, capability scope, read-only Settings → Video section mirroring Image; bilingual `videoGenerate*` labels (reuses `mediaEngines`/`webSearch*`); no new mapper/test (covered by `desktopMediaGenerate.test.ts`); desktop-chat 124/124, Desktop check 0/0, Desktop+Web builds green |
| 55. Add Image Generate settings section (§8 "图像") | completed | New credential-safe `/api/desktop/image-generate` GET maps `settings.imageGenerate` via shared `buildDesktopMediaGenerateSummary` (each engine `apiKey`→`hasApiKey`; keeps enabled/baseUrl/model + total/enabled/configured counts); reusable `desktopMediaGenerate.ts` mapper (image + video share the shape) + `desktopMediaGenerate.test.ts` 4 tests (key→bool, unconfigured, summary counts + no leak, missing engines); `loadDesktopImageGenerate` + shared `DesktopMediaGenerateSummary` contract, capability scope, read-only Settings → Image section; bilingual labels; desktop-chat 124/124, Desktop check 0/0, Desktop+Web builds green. Video can reuse the same mapper/contract next |
| 54. Add Web Search settings section (§8 "搜索") | completed | New credential-safe `/api/desktop/web-search` GET maps `settings.webSearch` via `buildDesktopWebSearchSummary` (each engine `apiKey`→`hasApiKey`; keeps routing config + per-engine enabled/baseUrl + total/enabled/configured counts); `desktopWebSearch.test.ts` 4 tests (key→bool, unconfigured engine, summary counts + no key leak, missing engines map); `loadDesktopWebSearch` client loader, capability scope, read-only Settings → Search section; bilingual labels; desktop-chat 120/120, Desktop check 0/0, Desktop+Web builds green |
| 53. Add Plugins settings section (§8 "插件") | completed | Completed the orphaned `desktopPlugins.ts` mapper: added `/api/desktop/plugins` GET (maps `runtime.pluginCatalog` via `buildDesktopPluginsSummary`), `desktopPlugins.test.ts` (4 tests: drops manifest/entry paths + settingsFields/secrets, coerces unknown kind/status, known-kind order + counts, empty catalog), `loadDesktopPlugins` client loader, capability scope entries, and a read-only Settings → Plugins section (counts card + per-plugin rows: name/version, kind, source, status badge). Bilingual labels via explicit ternaries (reactive-safe); desktop-chat 116/116, Desktop check 0/0, Desktop+Web builds green |
| 52. Add external-session Bot-instance hierarchy (§7.2) | completed | External sidebar now nests "渠道 → Bot 实例 → 会话" via tested pure `groupExternalSessionsByInstance`: a channel with >1 distinct `botInstanceName` renders per-instance sub-headings, single-instance/legacy channels stay flat (channel badge inline). Legacy no-metadata sessions bucket under a null instance with an "未指定 Bot 实例" heading only when split; preserves server channel order + newest-first within instance. Replaced `externalSessionViews` flat list with `externalSections`/`externalSessionCount`; bilingual `externalInstanceUnknown` + semantic `.external-instance-heading` CSS; desktop-chat 112/112, Desktop check 0/0, Desktop build green. Real per-instance smoke needs adapters to populate `botInstanceName` |

## Decisions

- Start with a vertical Phase 1 foundation rather than attempting all five phases simultaneously.
- Keep desktop business/runtime coordination in the Tauri host or shared server layer, never in channel adapters.
- Do not import existing Web pages or page CSS into the desktop UI.
- Preserve all pre-existing uncommitted workspace changes.
- Keep Open Web disabled until service discovery supplies the real endpoint; never fall back to a hard-coded port.
- Treat the adapter-node release directory as the sidecar working directory so its remaining `process.cwd()` resource lookups resolve inside the bundled runtime, not the source checkout.

## Errors Encountered
| Desktop type check found four outdated `DesktopAgentItem` fixtures after model-routing fields became editable | 1 | Updated the focused client fixtures with explicit empty routing; production Web build and runtime tests were already green |
| CSS search used a repository-relative path while the command working directory was already `apps/desktop` | 1 | Re-ran from the repository root; no code or test failure |
| `tsx` multi-file test could not create its IPC pipe under the managed temp directory (`listen EPERM`) | 1 | Re-ran the same deterministic test command with host-process permission; 55/55 passed |
| Desktop Vite dev server port 1420 was already occupied; first unquoted curl URL was expanded by zsh | 1 | Reused the existing local preview and quoted the URL; no process was killed or replaced |

| Error | Attempt | Resolution |
|---|---|---|
| Goal creation reported an existing active goal | 1 | Reused the active goal created for this request |
| Product Design preflight script was invoked from the plugin root where it does not exist | 1 | Re-ran it from the `skills/user-context` directory |
| A combined `apply_patch` contained an invalid hunk boundary | 1 | Reissued the same surgical edits with valid context lines |
| Rust build rejected `macOSPrivateApi` without the matching Cargo feature | 1 | Disabled the private API because the Phase 1 shell does not require it |
| Rust compile required `icons/icon.png`, and close events do not expose a window accessor | 2 | Generated the project icon set and captured the window handle in the callback |
| Browser preview helper does not support `networkidle` and direct Tauri invoke is unavailable in a browser | 1 | Used a DOM snapshot directly and added a browser-only preview fallback without changing Tauri behavior |
| Language switch left a status label in Chinese because a no-argument helper hid reactive dependencies | 1 | Replaced it with explicit Svelte reactive derived values |
| A second combined `apply_patch` had a malformed hunk boundary | 1 | Reissued the edits with complete context and no empty hunk |
| Resume inspection assumed `apps/desktop/src/lib/onboarding.ts` existed | 1 | Use symbol/file search to locate the existing onboarding helpers before editing |
| First combined onboarding UI patch missed the exact disconnect-state context | 1 | Split the change into smaller imports/state, connect/disconnect, handlers, template, and i18n patches |
| New Agent/Profile tests failed before implementation | 1 | Expected red phase: added the missing patch behavior and pure selection helper, then reran green |
| New broken-config start-step test failed before implementation | 1 | Expected red phase: added `resolveOnboardingStartStep` and initialized onboarding from loaded readiness |
| Guided repair hint flipped after Profile confirmation updated live readiness | 1 | Latched the initial missing prerequisite with tested `resolveOnboardingRepairTarget` |
| Final isolated Profile reset and temp-directory cleanup approval was rejected after approval quota exhaustion | 1 | Stopped both local services, did not retry or bypass approval; `.tmp/desktop-launch-smoke` remains ignored for later cleanup |
| Sandboxed isolated service could not bind loopback (`EPERM`) | 1 | Re-ran the same temp-data service with scoped host approval; it started on `127.0.0.1:33123` |
| Desktop preview port 1420 was occupied by a stale repo Vite process | 1 | Verified the PID belonged to `apps/desktop`, stopped it, and started the temp-data proxy preview |
| Browser snapshot/fill batches exceeded the browser bridge timeout | 2 | Initial page states were still captured; switch from a multi-locator batch to visible-DOM interaction for the remaining Agent-step check |
| Guided onboarding exited immediately after Agent confirmation made readiness usable | 1 | Latch the initial onboarding classification instead of deriving guided-vs-usable mode from live readiness after every save |
| `cargo fmt --check` found standard Rust formatting differences | 1 | Ran `cargo fmt`, then rechecked the formatted source |
| Repository-wide machine-path scan matched pre-existing `file:///Users/...` links and the documented Web localhost URL | 1 | Scoped the final guard to newly added desktop files; unrelated historical docs were left untouched |
| First production smoke inherited database path overrides from the repository `.env` and hit a read-only database | 1 | Kept real data untouched and reran with every persistent database/session path explicitly pointed at the temporary test directory |
| Sandboxed production smoke could not bind `127.0.0.1` (`EPERM`) | 2 | Re-ran the same isolated local-only smoke with host approval for loopback binding |
| First supervisor compile accessed a field through `tauri::State<Mutex<_>>` before locking and retained an exit-state temporary too long | 1 | Locked the outer state explicitly and detached the control sender before waiting for shutdown |
| First bundled-runtime smoke used root-relative binary paths while running from the packaged runtime directory | 1 | Re-ran with paths relative to the release resource root, preserving the intended packaged `cwd` |
| Follow-up process inspection for the incomplete DMG was denied because the approval service hit its usage limit | 1 | Did not retry or work around approval; continued with read-only artifact inspection and deferred live DMG-process diagnosis |
| Sandboxed DMG creation failed with `hdiutil: create failed - device not configured`; the scoped system-level retry was denied after approval quota exhaustion | 2 | Did not retry or bypass the restriction; fixed the release command to non-interactive CI mode and added an independently tested checksum finalizer |
| Initial checksum unit test contained the wrong known digest | 1 | Replaced only the incorrect test vector with the digest produced for the fixed fixture, then reran the test |
| First Cargo check after adding Tauri HTTP could not resolve the configured `rsproxy.cn` registry inside the network-restricted sandbox | 1 | Kept the passing temp-data Node tests and requested a scoped network-enabled Cargo check for the new official plugin dependency |
| Sandboxed Desktop preview could not bind `127.0.0.1:1420` (`EPERM`) | 1 | Re-ran only the isolated preview server with scoped loopback approval; no real runtime data or channels were used |
| In-app Browser policy rejected direct navigation to the local standalone HTML design reference | 1 | Did not retry or serve the blocked file indirectly; continued functional QA against the already-confirmed `DESIGN.md` target and recorded that side-by-side screenshot comparison could not be repeated in this run |
| Browser interaction could not observe the JavaScript prompt used by the first rename implementation | 1 | Replaced prompt/confirm dialogs with explicit inline rename and two-step delete states, improving both testability and product quality |
| Compact-width browser reload was rejected because the browser session disallowed further use of the local preview URL | 1 | Did not switch browser surfaces or retry the URL; reset the temporary viewport and retained Svelte/CSS checks plus the successful standard-width interaction evidence |
| Cleanup of the stopped temporary smoke directory was approval-rejected after quota exhaustion | 1 | Did not delete by another mechanism; services are stopped and the isolated directory is recorded for later cleanup |

## 2026-06-30 — Desktop liquid-glass visual alignment

- **Goal:** Align `apps/desktop` with `Momo for Mac (standalone).html`, emphasizing the macOS liquid-glass visual system and Settings right-hand content layout.
- **Status:** complete
- **Plan:**
  1. Audit the reference HTML, `DESIGN.md`, current Settings structure, and theme/i18n constraints → verify with a concrete difference inventory.
  2. Implement the smallest shared layout/style changes that close those differences → verify with Svelte/static checks.
  3. Update required product docs and run targeted Desktop tests/build → verify no functional regression.
- **Acceptance:** Settings uses the reference's macOS shell, translucent layered surfaces, hierarchy, spacing, and responsive right pane in both themes and locales; existing fine-grained saves and fixed footbars remain intact.
- **Explicit constraint:** Do not take screenshots or perform browser-based visual validation; the user will verify appearance.

### Errors encountered in this slice

| Error | Attempt | Resolution |
|---|---:|---|
| `create_goal` reported an unfinished goal | 1 | Reused the active goal created from this request. |
| zsh parsed `$f:exists` as a modifier expression in a diagnostic command | 1 | Used an unambiguous direct `ls` check; no files were changed. |
| First planning-file patch targeted a template heading absent from the repository's existing long-running plan | 1 | Inspected the actual file tails and appended against stable existing lines. |

### Implementation completed

- Replaced the Settings sidebar brand block with a functional bilingual search/filter, compact native rows, and a bottom status identity row.
- Split the fixed right-pane title from the independently scrolling settings body.
- Aligned the content density to the reference: 46px grouped rows, 13.5px labels, 22px group rhythm, horizontal appearance controls, and fixed translucent save footbars.
- Strengthened the liquid-glass hierarchy with sidebar/content/card material layers, saturation blur, specular highlights, hairlines, and theme-safe shadows.
- Initial `svelte-check`: 0 errors, 0 warnings.
- Final verification: frontend structural tests 4/4, Rust tests 8/8, `svelte-check` 0/0, and Desktop production build passed.
- Required product docs updated: `features.md`, `prd.md`, `CHANGELOG.md`, and `readme.md`.
- Visual acceptance intentionally remains with the user on macOS; no screenshots or browser visual checks were performed.

## 2026-06-30 — macOS/Web Settings gap closure

- **Goal:** Close the audited macOS Settings capability gaps against the current Web implementation, starting with the P0 slices and improving AI Provider editing.
- **Status:** in progress
- **Assumptions:** Existing Web behavior is the functional source of truth; the Desktop keeps its native liquid-glass layout and credential-safe narrow APIs; "self-hosted provider" and "custom model" are separate concepts in UI and data handling.
- **Plan:**
  1. Audit current Desktop code against the June 29 report and identify already-delivered slices → verify with source/API/test inventory.
  2. Replace bottom-of-page Provider editing with a contextual modal/detail surface; unify create/edit around the complete provider editor and separate provider/model concepts → verify with focused component/API tests and Svelte checks.
  3. Continue remaining P0 parity slices (advanced routing, Search/Image/Video/TTS writes/tests/tasks) in narrow vertical slices → verify each against the corresponding Web behavior.
  4. Update required product docs and run Desktop/Web regression checks.
- **Success criteria for the first slice:** Provider create/edit no longer renders below the list; one flow supports full provider fields and multiple models; built-in, self-hosted, and custom-model choices are visibly distinct; secrets remain server-owned; bilingual/dark/mobile behavior is preserved.
- **Expected red test:** The new Provider-modal structural test failed before implementation because the inline editor and ambiguous terminology still existed.
- **First slice:** complete. Provider modal/terminology implementation and isolated standard/narrow browser verification passed.
- **Current next slice:** P1 operational-detail parity, beginning with the already-audited full Sandbox policy editor unless product priority changes.
- **Errors encountered:** sandboxed Vite preview bind returned `EPERM`; reran the same isolated loopback preview with scoped host permission. The first modal width was overridden by a later generic rule; browser QA found it and a more specific semantic selector fixed it.

### Sandbox policy parity slice

- **Status:** in progress
- **Plan:**
  1. Expand the credential/path-safe Desktop Sandbox contract and PATCH mapper to cover the Web policy fields → verify with red/green server tests using injected settings only.
  2. Replace the Desktop read-only summary with presets, full policy editing, fixed save footer, reset, and diagnostics refresh → verify with pure client helpers, structural UI tests, and `svelte-check`.
  3. Run isolated-service browser QA at standard and narrow widths, update required docs, and run Desktop/Web production builds.
- **Security boundary:** no environment values or resolved absolute paths enter the WebView; an existing absolute env-file setting is preserved until the user explicitly replaces it with a relative path.
- **Discovery error:** an unquoted zsh path containing `[key]` expanded as a glob; subsequent reads quote bracketed route paths.
- **Test environment error:** the first green server-test run could not create the `tsx` IPC pipe under the managed temp directory (`EPERM`); rerun the same focused test with scoped host-process permission.
- **Status:** complete.
- **Result:** full policy editing and diagnostics parity delivered without changing runtime execution semantics; environment values and resolved paths remain outside Desktop responses.
- **Verification:** focused tests 61/61, UI structural tests 6/6, `svelte-check` 0/0, Desktop/Web builds, and isolated standard/640px save-and-reload smoke passed.
- **Next slice:** continue P1 with Host Bash management parity unless a narrower operational page is selected first.
