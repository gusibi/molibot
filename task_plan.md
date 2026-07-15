# Memory Center three-tab redesign (2026-07-15)

## Goal
Implement the selected Memory Center visuals as three separate product views: Option 1 as Overview, Option 2 as Topics, and the existing management surface as All Memories, while preserving the in-progress memory trace work and showing only facts derived from real memory data.

## Current phase
Complete

## Phases
1. Audit the current memory contract, UI changes, and projection seams — complete
2. Add tested Overview/Topic projections without fabricated confidence or summaries — complete
3. Implement independent Overview / Topics / All Memories tabs and interactions — complete
4. Verify i18n, light/dark themes, 860×620 responsive behavior, tests, and production build — complete
5. Capture both selected states, run visual design QA, update product docs, and adversarially review — complete

## Verification gates
- Overview and Topics remain separate tabs and match their separately selected visual targets.
- Overview, topic facts, recent changes, and counts come from real memory/candidate fields; no mock profile facts ship.
- Existing trace, candidate confirmation, source/version, edit/delete, allow-injection, and advanced maintenance behavior remains available.
- UI supports Chinese/English, light/dark themes, keyboard access, and the 860×620 minimum window.
- `design-qa.md` ends with `final result: passed` for both Overview and Topics before handoff.

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| “1 + 2” was initially interpreted as a single merged page | 1 | User clarified that Option 1 is Overview and Option 2 is Topics; implementation now treats them as independent tabs. |
| `rg` treated a search pattern beginning with `--` as a command flag | 1 | Re-ran with `rg -e` and the same literal alternatives; source inspection completed. |
| Root `node_modules/.bin` does not expose `svelte-check` | 1 | Run the package-scoped `pnpm exec svelte-check` command instead of repeating the missing root binary path. |
| Existing dialog structure test required `aria-label` on the memory form itself | 1 | Restored the form label while keeping the enclosing semantic dialog; no product behavior changed. |
| New projection regression test initially called the fixture helper by the wrong name | 1 | Replaced `item(...)` with the existing `memory(...)` fixture and reran the unchanged assertion; 4/4 projection tests pass. |

---

# PR #15 merge and release (2026-07-15)

## Goal
Publish the verified PR #15 settings-API split as a synchronized Molibot release without including unrelated dirty-worktree changes.

## Current phase
Complete

## Phases
1. Confirm PR/remote state, current versions/tags, and isolate unrelated local changes — complete
2. Put the verified PR #15 merge result on `master` — complete
3. Increment root/Desktop patch versions and synchronize Tauri/Cargo identifiers — complete
4. Verify version consistency, focused regressions, production build, and release diff — complete
5. Commit, tag, push, publish GitHub Release, and verify remote state — complete

## Release gates
- Client and bundled service ship together; no mixed-version compatibility requirement.
- Do not include unrelated changes from the user's primary worktree.
- Use the release skill's base-10 patch carry rule and synchronize all five version files.
- Do not overwrite an existing tag or GitHub Release.
- Release notes must describe the actual PR #15 delta and verified compatibility fixes.

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| `git worktree add` could not resolve the newly merged remote commit | 1 | Fetch only `origin/master`, verify the fetched OID, then create the isolated release worktree from that local ref. |
| Offline pnpm install could not open pnpm's cache SQLite database inside the sandbox | 1 | Retry the same offline, frozen-lockfile install with approved cache access; no network dependency resolution or lockfile mutation is requested. |
| Fresh release worktree API test could not resolve `$lib` in 12 test files | 1 | Generate SvelteKit aliases with `svelte-kit sync`, then rerun the unchanged API suite; 122 assertions had already passed and no product assertion failed. |

---

# GitHub issue #13 completion re-audit (2026-07-14)

## Goal
Reconcile the implemented Desktop UI against every requirement and acceptance item
in GitHub issue #13, using current-page screenshots and source evidence, and correct
the prior overstatement that the entire PRD had been verified.

## Current phase
Complete — audit only; implementation remains open

## Phases
1. Load the audit/browser procedures and current Issue #13 acceptance criteria — complete
2. Capture and inspect the real Settings flow at target window sizes/themes/locales — complete with named screenshot limits on populated long-list pages
3. Map all PRD items to complete / partial / missing with code and screenshot evidence — complete
4. Report the honest gap list and propose the smallest completion plan — complete

## Verification gates
- No “complete” claim without a direct screenshot, executable behavior check, or exact source evidence.
- Dropdown typography, dimensions, visible value, and responsive behavior are measured, not inferred from CSS names.
- P0, P1, P2, and Apple-interaction additions are reported separately.
- This turn is an audit; no product fixes are applied until the user asks to continue implementation.

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| The browser skill cache path from the session catalog no longer existed | 1 | Located the current installed cache version `26.707.72221`; load that exact skill before browser work. |
| Unquoted `?window=settings` was expanded by zsh as a filename pattern | 1 | Quote URLs in subsequent local probes; do not repeat the unquoted command. |
| Model-page screenshot capture timed out after the navigation and metric read | 1 | Do not retry the same composite action; take a fresh DOM snapshot, then capture and measure in smaller calls. |
| Model screenshot timed out again as a standalone viewport capture | 2 | The page contains very large native option lists; refresh state, measure separately, then try an explicit 860×620 clip as the third and final screenshot method. |
| Explicit 860×620 clipped Model screenshot also timed out | 3 | Stop retrying Browser screenshots for this populated page. Keep DOM/computed-style evidence and name the visual-capture blocker; continue with Providers/Trace/Tasks where screenshots may succeed. |
| Provider viewport screenshot timed out on the first attempt | 1 | Do not spend more screenshot retries on another huge populated list; record DOM/style evidence and continue to smaller surfaces. |
| Trace viewport screenshot timed out on the first attempt | 1 | Record the populated Trace DOM as evidence and continue; no repeated capture on the unbounded list. |
| Saved browser screenshots had JPEG bytes under `.png` names, so the image viewer rendered them incorrectly | 1 | Convert accepted captures to real PNG files with the system image converter and inspect the converted files. |
| The controlled tab became stale before the Chat workspace audit | 1 | Keep the existing browser binding, discard the stale tab, and obtain a fresh tab as required by the Browser recovery procedure. |

---

# Release after Issue #10 Agent City (2026-07-15)

## Goal
Increment root and Desktop patch versions using the project's base-10 rule, synchronize all Desktop/Tauri/Cargo identifiers, verify the release build, push `master` and the version tag, and publish a GitHub Release so the Agent City build can be inspected.

## Current phase
Phase 4 — commit and tag release candidate

## Phases
1. Confirm clean repository, current versions, tags, remote, and release notes — complete
2. Increment root/Desktop versions and synchronize Tauri/Cargo — complete
3. Verify version consistency, focused tests, diagnostics, and production build — complete
4. Commit the release, create the version tag, and confirm clean state — in progress
5. Push `master` and tags, then publish the GitHub Release — pending

## Release gates
- Use patch +1 with decimal carry; no two-digit semantic-version segment.
- Do not tag a dirty or unverified tree.
- Release notes come from the current top `CHANGELOG.md` entry.
- Do not overwrite an existing local or remote tag/release.

---

# GitHub issue #13 PRD implementation (2026-07-14)

## Goal
Implement every accepted requirement in GitHub issue #13 as a production-ready,
verified Molibot change while preserving shared-layer architecture boundaries.

## Current phase
Complete

## Phases
1. Read the full issue, comments, project PRD/design constraints, and map acceptance criteria — complete
2. Audit current implementation and select the smallest architecture seam — complete
3. Add focused failing regressions and implement the PRD incrementally — complete
4. Run focused and proportional verification, then adversarially review likely failure points — complete
5. Update `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md`; deliver evidence — complete

## Verification gates
- Every issue #13 requirement maps to code and executable evidence.
- Shared orchestration remains above Channel adapters; transient runtime controls never enter persisted model context.
- Persistence tests use temporary/injectable stores and do not touch live user data.
- Any UI change follows `DESIGN.md`, uses existing shadcn/shared semantics, and passes bilingual/theme/responsive checks.
- `git diff --check` and relevant tests/builds pass; adversarial review findings are fixed before delivery.

## Decisions
| Decision | Rationale |
| --- | --- |
| Defer implementation choices until the full issue and current seams are inspected | The user supplied the PRD by reference; silently guessing its scope would risk building the wrong behavior. |
| Evolve the existing shared Desktop semantic CSS and extracted sections | Most foundations already exist; replacing the UI stack would violate the PRD non-goals and create needless regression risk. |
| Treat the Issue P0 plus directly coupled P1 consistency items as the first complete implementation boundary | P0 establishes the shared shell/templates; orphan wording, duration, destructive menus, and semantic colors are inseparable acceptance details on the same target pages. |
| Reuse existing native controls and semantic classes; add only shared primitives needed by multiple pages | This keeps the change surgical and honors the existing shadcn/shared-component policy without duplicating page-local widgets. |
| Preserve business contracts and derive presentation status from existing task fields | The PRD explicitly excludes business-logic rewrites; current task data already exposes enabled, execution, result, and history dimensions. |

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| Anonymous GitHub page read for issue #13 returned a cache miss | 1 | Switch to the authenticated GitHub CLI/API and load the body plus comments. |
| Issue #13 regression suite failed 6 new assertions before implementation | 1 | Expected red state; implement the shared tokens/header, target-page semantics, task template, Message Unit, and duration helper next. |
| First green UI run retained 2 stale pre-PRD structural assertions | 1 | Updated the toolbar assertion to its shared token and replaced obsolete task-row run-count wording with the new separated latest-result contract. |
| One broad CSS patch missed an exact automation selector despite the selector being present | 1 | Split the patch into small token/chat/settings/automation hunks and applied each against freshly inspected context. |
| `corepack pnpm --dir apps/desktop run check` could not open pnpm's cache SQLite database | 1 | Used the app-local `svelte-check` binary with the same project tsconfig; diagnostics run without package-manager cache access. |
| First direct Svelte check rejected an `{@const}` nested below a settings branch | 1 | Moved the declaration to the immediate child of its `{#each}` block; rerun passed with 0 errors and 0 warnings. |
| Sandboxed Vite could not bind a local preview port; the default preview port was already occupied | 1 | Started the same local-only preview with approved bind access on port 1421 and kept it isolated from the existing process. |
| Shared assistant-name props inferred the literal type `"Molibot"` from localized defaults | 1 | Annotated the three shared component props as `string`; no caller or rendering behavior changed. |
| Final parallel API test could not create tsx's temporary IPC socket | 1 | The same test had already passed 69/69; rerun it alone after diagnostics to avoid parallel IPC contention. |

---

# Project runtime and display overrides (2026-07-12)

## Release v2.4.7 / Desktop v0.4.4 (2026-07-14)

### Goal
Publish the verified issue #6/#11/#12 fixes as a synchronized Molibot release,
then close the issues once the commit and tag are present on GitHub.

### Phases
1. Verify dirty-worktree scope, current versions, branch, remote, and tag availability — complete
2. Bump root 2.4.6 → 2.4.7 and Desktop 0.4.3 → 0.4.4; sync Tauri/Cargo — complete
3. Re-run release verification and adversarial diff review — complete
4. Commit all release changes and create release boundary tag v2.4.7 — complete
5. Push commit/tag, publish GitHub Release, verify remote state — complete
6. Close shipped issues #6/#11/#12 with release evidence — complete

### Verification gates
- Root, Desktop, Tauri, Cargo manifest, and lockfile versions are synchronized.
- No file outside the audited issue fixes, required docs, planning logs, or version metadata enters the commit.
- Relevant tests, Desktop diagnostics, production build, and diff checks pass before tagging.
- GitHub Release notes come from the current 2026-07-14 CHANGELOG entry.
- Issues close only after v2.4.7 is visible remotely.

### Decisions
| Decision | Rationale |
| --- | --- |
| Release root v2.4.7 and Desktop v0.4.4 | Both current patch segments are below 9, so the skill's base-10 carry rule increments each by one. |
| Include the full current worktree in one release commit | The worktree was clean before this issue batch; every current change belongs to the audited fixes, tests, required docs, or planning evidence. |
| Use only the CHANGELOG delta since v2.4.6 as release notes | Existing 2026-07-14 entries shipped in v2.4.6; the new issue #6/#11/#12 section is the complete unreleased delta. |

### Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| Broad `git push origin --tags` was rejected as unnecessarily risky | 1 | Push only the intended `v2.4.7` tag explicitly. |


## GitHub issues #8, #6, #12, #11 completion audit (2026-07-14)

### Goal
Verify each issue against its full acceptance criteria and current behavior;
close completed issues, and implement plus verify the smallest missing pieces
before closing incomplete issues.

### Phases
1. Read issue bodies/comments/labels and map acceptance criteria — complete
2. Audit implementation, tests, redundancy, and prior rejections — complete
3. Add focused regressions and implement only confirmed gaps — complete
4. Run focused and proportional regression checks — complete
5. Update required product docs, adversarially review, and close verified issues — complete

### Verification gates
- Every issue conclusion cites concrete code and executable verification.
- No issue is closed while any acceptance criterion remains unverified.
- Runtime orchestration stays in shared layers rather than Channel adapters.
- Tests use temporary/injectable persistence and do not touch live user data.

### Decisions
| Decision | Rationale |
| --- | --- |
| Close #8 only after running its existing focused UI/server regressions | Delivery docs and code exist, but executable evidence is required. |
| Register every shared RunnerPool for Trace snapshot/abort | The existing Trace route only saw channel-manager pools; a shared registry also covers ordinary Web, Project, and channel-bound Project runs without Channel-specific orchestration. |
| Make Desktop Stop reload only after the server reports runner quiescence | The current client abort/reload races the server's partial-output persistence. |
| Deepen transcript ownership at one shared projection seam | UI Session should retain conversation/presentation metadata while Agent entries own normal message content; callers should not reimplement mapping. |

### Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| Anonymous GitHub page fetch returned cache misses for #6, #12, and #11 | 1 | Use authenticated GitHub CLI/API for complete issue context. |
| Combined planning-file patch used a stale template table context | 1 | Re-read current headers and split the update into exact hunks. |
| Sandboxed GitHub CLI could not reach api.github.com | 1 | Re-ran the same read with approved network access; all issue JSON loaded. |
| Local service probe on port 8000 found no running service | 1 | Used temp-store tests and build verification; did not mutate or start the user's service. |
| Root `node_modules` has no `svelte-check` binary | 1 | Use the Desktop app's installed `apps/desktop/node_modules/.bin/svelte-check`. |
| First Stop source-order assertion capped the match at 240 characters | 1 | Assert explicit source indices so comments do not make the behavioral check brittle. |
| Direct Runner test execution could not load bundled Markdown | 1 | Re-ran with the repository Markdown loader. |
| Full Runner tests initially opened the real read-only settings database | 1 | Set `SETTINGS_DB_FILE` to a temporary SQLite path; all 25 tests passed without touching user data. |
| Registry regression initially created a workspace fixture in the repository | 1 | Moved it to `mkdtemp`, added cleanup, and removed the generated artifact. |


## Owner memory task notification target (2026-07-14)

### Goal
Allow the user to choose one authorized Feishu or Telegram chat as the single
Owner memory-task notification destination, and always report success with
zero/nonzero output or terminal failure.

### Phases
1. Add red settings/routing/runtime regressions — complete
2. Persist and validate the selected notification target — complete
3. Send one aggregate success/failure notice per Owner task — complete
4. Add bilingual responsive Desktop selector — complete
5. Verify, document, and adversarially review — complete

### Verification gates
- Only enabled Feishu/Telegram Bot authorized chats are selectable.
- The selected target survives save/restart; removed authorization degrades safely.
- Zero-output success, nonzero success, and terminal failure each send exactly one human notice.
- Notification delivery never enters model/session context.

### Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| Combined planning-file patch missed the current `findings.md` context | 1 | Re-read each file header and applied separate current-context patches; no product code was touched. |

## Goal
Add inherited Project settings for Sandbox, model, thinking, tool progress,
reasoning display, and runlog notices. Sandbox-off must not auto-approve Host Bash.

## Phases
1. Persist and validate Project overrides — complete
2. Apply Sandbox and Project Chat display overrides — complete
3. Apply Project-bound channel runlog/display resolution — complete
4. Verify, document, and adversarially review — complete

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| New owner scheduler exports and task category were absent | 1 | Expected red state; implement the owning scheduler and Desktop projection seams next. |
| UI Tab class assertion and narrowed `systemKind` contract failed | 1 | Added a stable semantic Tab class and narrowed the compatibility fallback to the contract union. |
| Root `tsc --noEmit` reports broad pre-existing dependency/package errors | 1 | Filtered diagnostics to touched files; fixed the new watcher callback and test typing errors, and retain focused Svelte/build verification. |
| Combined lifecycle/UI patch missed the exact delete-route context | 1 | Split the change into precise file-local hunks after re-reading the affected blocks. |
| Desktop Project PATCH intersection retained non-null source fields | 1 | Replaced it with an explicit nullable patch contract. |
| New sandbox precedence test referenced an unimported full settings fixture | 1 | Replaced it with the minimal typed settings slice used by the resolver. |

---

# Skills first-load card reactivity (2026-07-13)

## Goal

When the Skills API asynchronously returns items, render every card immediately
and keep search filtering reactive; never show a nonzero total beside an empty grid.

## Phases

1. Reproduce the exact 26-total/0-card DOM state — completed
2. Add a red regression contract at the component seam — completed
3. Replace stale legacy derivation with Svelte 5 runes — completed
4. Verify initial render, search, diagnostics, and production build — completed

## Verification gates

- First visit with 26 API items renders 26 cards.
- Typing an exact Skill name narrows the grid to the matching card.
- Desktop UI tests and Svelte diagnostics pass.


# Bot Project mode (2026-07-12)

## Goal

Allow mobile/channel conversations to select a registered Project and run
subsequent turns through the existing Project-aware Agent path without the app.

## Phases

1. Persist conversation binding with temp-DB tests — complete
2. Add shared `/project` command and runtime injection — complete
3. Verify shared/Feishu behavior and invariants — complete
4. Update product docs and adversarial review — complete

## Verification gates

- Binding is isolated by channel + Bot instance + conversation scope.
- Deleted Projects safely fall back to ordinary Chat mode.
- Runner receives Project root/instructions/model/thinking defaults.
- All Bot channels gain this only through shared layers.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| zsh expanded `[id]` in a route filename and aborted the tail of one read-only inspection command | 1 | Quoted the SvelteKit route path on the next inspection; no mutation occurred. |
| Experimental `acceptFirstMouse` config made Cargo reject a missing `macos-private-api` feature | 1 | Reverted the unproven experiment; require a UI-level discriminator before choosing the native-click branch. |
| Root `pnpm check` script does not exist | 1 | Use focused typed node tests and the repository production build gate. |

---

# Project-local Skill discovery fix (2026-07-12)

## Goal

Load `<projectRoot>/.agents/skills/` for Project conversations and Desktop slash
suggestions, with project scope and project-first duplicate precedence, while
keeping non-Project conversations unchanged.

## Phases

1. Build a deterministic red regression at the shared Skill-loader seam — complete
2. Add project scope/root discovery and precedence — complete
3. Thread projectRoot through Runner, prompt, skillSearch, and command surfaces — complete
4. Make Desktop suggestions resolve `projectId` server-side — complete
5. Update docs and run adversarial verification — complete

## Verification gates

- Project `.agents/skills/foo/SKILL.md` appears in runtime and slash suggestions.
- Project `foo` wins over same-name Bot/global/chat Skill with diagnostics.
- Non-Project conversations never see Project Skills.
- Prompt cache keys isolate Project A from Project B.
- Removing the directory safely falls back to existing scopes.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Desktop check found the installed-Skills scope label accepted only global/bot/chat | 1 | Added the Project scope label and bilingual copy. |

---

# Composer suggestions, command presentation, and Project defaults (2026-07-12)

## Goal

Implement shared slash-command/Skill suggestions for Chat and Project Chat,
visually distinguish recognized command and Skill invocations in transcripts,
and add a Project settings module with inherited model/thinking defaults.

## Assumptions

- Project defaults apply to new Project Sessions; a Session may temporarily
  override them without mutating global model routing.
- Resolution order is Session -> Project -> Global.
- Agent selection is intentionally excluded; project instruction files remain
  the source of project-specific Agent behavior.
- Existing uncommitted work is user-owned and must be preserved.

## Phases

1. Audit command, Skill, model, Session, and Project persistence seams — complete
2. Add shared composer suggestion catalog and focused tests — complete
3. Add shared keyboard-accessible suggestion UI to both chat surfaces — complete
4. Add recognized command/Skill transcript presentation — complete
5. Add Project settings persistence, UI, and runtime inheritance — complete
6. Update required product docs and run adversarial verification — complete

## Verification gates

- `/` suggestions come from runtime command/Skill data, not a duplicated UI list.
- Disabled or unavailable Skills do not appear as executable suggestions.
- IME composition, arrows, Enter/Tab, Escape, mouse selection, and Shift+Enter work.
- Recognized commands, Skills, and unknown slash text render distinctly and safely.
- Project A defaults never mutate global routing or Project B.
- New Sessions inherit Project defaults; Session selection wins afterward.
- Chat and Project reuse the same composer and transcript modules.
- Desktop passes zh/en, light/dark, and narrow-width verification.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Combined model-override patch missed the exact `ConversationHost.projectId` type | 1 | Inspected the interface and reapplied the same change as smaller surgical patches. |
| First Desktop check found a prop-name mismatch in `SlashSuggestionMenu` | 1 | Passed `activeSuggestionIndex` through the declared `activeIndex` prop. |
| Desktop Geist regression rejected `backdrop-filter` in the new suggestion popover | 1 | Removed blur and used the existing opaque card surface plus popover shadow. |
| Adversarial diff review found the model override applied to constructor initialization instead of the per-turn settings read | 1 | Restored constructor settings and moved the immutable override into `run(ctx)` before validation/candidate resolution. |
| Repository-wide raw `tsc --noEmit` reports existing dependency/package/type failures across Anthropic SDK, QQ/OpenClaw, shadcn exports, memory/media tests, and channels | 1 | Confirmed none reference this feature; used the repository-supported production build, Desktop Svelte check, and focused typed tests as release gates. |
| Desktop API node tests imported a Svelte runes catalog through `conversationTurn` and failed because `$state` is compiler-only | 1 | Split the pure invocation catalog/classifier from the reactive Svelte adapter; node code now imports only the pure module. |

---

# Daily materials internal task (2026-07-11)

## Goal

Implement `docs/requirements/daily-materials-task-handoff.md` end to end without routing internal work through the ordinary Agent Runner.

## Phases

1. Audit seams and establish red tests — complete
2. Implement event contract, isolated watermark reader, and service — complete
3. Wire runtime dispatch, scheduling, and manual trigger — complete
4. Implement settings/API/Desktop controls — complete
5. Update momo-agent templates and docs — complete
6. Verify, adversarially review, and update product docs — complete

## Verification gates

- Daily-material and reflection watermarks remain isolated.
- Failure, abort, and path escape never advance watermark or write scratch fallback.
- Internal manual trigger never enters the ordinary Agent Runner.
- Old settings sanitize safely and Desktop saves preserve unrelated fields.
- Manual trigger writes the dated file inside the registered Project.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Planning/source patches failed to write | 1-3 | Disk had only ~101 MiB free at 100% usage; removed only the reproducible Desktop `dist` build output before retrying. |
| First Desktop plugin persistence fixture used an empty memory-backend catalog | 1 | Added the fixture's expected `mory` backend; production validation remains unchanged. |
| Parallel Desktop `corepack pnpm check` wrapper hung without diagnostics | 1 | Terminated only that check process and verified with installed `svelte-check` and `vite` binaries. |

---

# Unified conversation and project sidebar plan

# Configurable memory reflection schedule and completion notice (2026-07-11)

## Goal

Allow the daily memory reflection time to be configured from Desktop and emit a
separate human-facing completion notice after a successful run, without routing
the reflection itself through the chat Runner or persisting runtime controls as
conversation messages.

## Assumptions

- The schedule is a global Memory plugin setting in local `HH:mm` time and is
  applied per enabled Bot using the Bot timezone already used by reflection.
- A completion notice is sent only when at least one new candidate is created;
  zero-candidate runs remain quiet.
- The notification uses existing channel delivery infrastructure and is never
  appended to model/session context.

## Phases

1. **Trace settings → watched event → internal dispatch → channel notice** — complete
2. **Add regression tests for schedule persistence and notice separation** — complete
3. **Implement shared settings, scheduler, runtime notice, and Desktop UI** — complete
4. **Run focused/full regression, visual/type checks, and update docs** — complete

## Verification gates

- Valid `HH:mm` values survive granular settings save/reload; invalid values are
  sanitized without losing unrelated Memory fields.
- Scheduler rewrites only the managed reflection event when configured time
  changes and preserves the internal execution contract.
- Successful runs with candidates emit one user notice; empty, failed, aborted,
  or retried duplicate runs emit none.
- No reflection prompt/control text or notice becomes a conversation message or
  future model context.
- Desktop control is bilingual, theme-safe, responsive, and uses existing
  shared settings components and fixed save footbar behavior.

---

# Memory review bug fixes (2026-07-11)

## Goal

Fix the five confirmed review findings without expanding memory behavior:
complete-day reflection coverage, per-candidate isolation, embedding key rotation,
embedding failure cooldown, and linear-time compaction membership checks.

## Phases

1. **Add five red-capable regression tests** — complete
2. **Apply surgical fixes at the owning seams** — complete
3. **Run focused and memory-wide regression suites** — complete
4. **Adversarial review and required documentation updates** — complete

## Verification gates

- A 03:00 scheduled run reads the previous complete local calendar day.
- One rejected extracted candidate does not suppress valid siblings or prevent
  the projection watermark from advancing.
- Rotating an embedding API key reconfigures the backend without persisting or
  logging the secret.
- After one embedding failure, add/search use lexical fallback during a bounded
  cooldown instead of repeating network attempts.
- Compaction uses constant-time membership sets for expired and duplicate IDs.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| All five new regression cases failed against the reviewed implementation | Initial red run | Confirmed each root cause, then applied one owning-seam fix per finding. |
| Broad catch around candidate creation could hide storage failures | First adversarial review | Added `MemoryCandidateValidationError`; reflection skips only malformed extracted candidates and still propagates infrastructure failures. |

---

# Memory improvement remaining delivery — T1b/T3/T4/T5/T6b/T7 (2026-07-11)

## Goal

Complete every remaining in-scope task in
`docs/requirements/memory-improvement-plan.md` without pausing for intermediate
approval. T8/T9 and Project runtime automatic cleanup remain out of scope.

## Assumptions

- The approved v2.2 C0 contracts are authoritative; implementation will not
  silently change identity, candidate, reflection, or prompt-injection policy.
- Reflection and Candidate Inbox ship together before memory defaults flip.
- Provider-backed embeddings must degrade cleanly; no API key is required for
  lexical operation or repository tests.
- All persistent tests use temporary/injectable storage, never user runtime DBs.

## Phases

1. **Map remaining seams and close T1b tokenizer consistency** — complete
2. **Implement T3 + T5 candidate/reflection state machine and importer governance** — complete
3. **Flip safe defaults and add json-file → mory migration** — complete
4. **Implement T4 semantic retrieval, namespace filters, and resumable backfill** — complete
5. **Implement T6b content/agent-self applications** — complete
6. **Implement T7 audit details, pinning, versions, and forgetting** — complete
7. **Complete Desktop Inbox/audit UI and APIs** — complete
8. **Run four end-to-end scenarios, adversarial review, full regression, docs** — complete

## Verification gates

- Pending candidates never enter prompt retrieval; confirm is atomic/idempotent.
- Reflection retries and aborts preserve watermark/fingerprint invariants and
  never write conversation messages or send channel output.
- Semantic retrieval is namespace-filtered and lexical fallback stays available.
- Content duplicate checks are explicit-only; content never leaks into chat.
- Pinned records survive compact/forgetting; versions/sources are inspectable.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Unified tokenizer made changed same-path values fall below the old similarity threshold and insert | First T1b regression | Stable-path records now always follow their update policy after exact duplicate detection; wording similarity no longer decides path identity. |
| New retrieval fixture was filtered by planner/type interaction | First T1b regression | Kept the tokenizer assertion focused by using a profile-compatible semantic type and asserting the write succeeded before retrieval. |
| Candidate confirmation fixture was shorter than the existing governance minimum | First Candidate Store test | Changed the fixture to a complete durable statement; retained production governance instead of weakening it for tests. |
| Narrowing per-message extraction removed a hint table still used by write governance | Combined focused regression | Restored the governance-only table while keeping automatic classification restricted to explicit remember intent. |
| Pin/expiry fixture hit mory's quality threshold before exercising retention | First T7 end-to-end run | Made the test memories explicit high-confidence event records so the test isolates pin/expiry behavior. |

---

# Memory improvement batch 1 — T2 + T6a (2026-07-11)

## Goal

Activate mory stable-path version chains and introduce the namespace/domain
model in one compatible schema batch. Do not implement reflection or Candidate
Inbox early.

## Contract status

- C0.1–C0.6 reviewed against current code — approved.
- mory is the only formal backend for new capabilities; json-file remains
  readable and compatible without receiving the new behavior.
- Namespace is the storage/version-chain isolation key; domain is audit and
  injection policy metadata; type remains mory's closed semantic type.

## Phases

1. **Map current gateway/mory schema and ingestion seams** — complete
2. **Add namespace/domain and stable-path contracts with migration** — complete
3. **Activate version-chain behavior and query plans** — complete
4. **Add focused namespace/version/migration tests** — complete
5. **Adversarial review, regression, and documentation** — complete

## Verification gates

- Same namespace + type + subject updates one version chain.
- Different subjects and different namespaces never overwrite each other.
- Unstructured text keeps a unique path and `lowConfidencePath: true`.
- Ordinary prompt lookup merges only owner/current-chat/current-agent; Project
  lookup additionally includes current project; content is never auto-injected.
- Existing json-file and legacy mory records remain readable.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Combined runtime-scope patch missed an already-clean formatting context | First scope-wiring patch | Split the patch into surgical edits; no partial changes were produced by the failed patch. |
| New default-domain test referenced an undefined timestamp constant | First focused regression run | Replaced it with the explicit fixed timestamp used by the surrounding tests. |

---

# Project Session output routing and inspection implementation (2026-07-11)

## Goal

Implement `docs/requirements/project-session-provenance-and-inspection.md` in
four verified slices. Runtime automatic cleanup is explicitly deferred.

## Implementation phases

1. **Slice A — P0 output safety** — complete
   - Disable Project-mode Bash mtime artifact relocation.
   - Store truncated Bash full output under Project runtime `tool-output`.
   - Preserve ordinary Bot behavior and add focused regression tests.
2. **Slice B — shared output routing** — complete
   - Introduce `RunOutputLayout`, explicit project/scratch targets, and
     structured file-tool details without filename-based routing guesses.
3. **Slice C — read-only ProjectInspection** — complete
   - Add bounded tree/file preview and hardened scoped Git status/diff routes.
4. **Slice D — Desktop project file panel** — complete
   - Add localized Files/Changes/Attachments tabs using existing shared UI.
   - Verify light/dark themes, keyboard behavior, and narrow widths.
5. **Documentation and adversarial verification** — complete
   - Run focused and regression tests; update features/prd/changelog/readme.

## Success criteria

- Project commands never relocate concurrently edited project files.
- Project root receives no Molibot scratch, attachment, or full-output metadata.
- Project inspection is bounded, read-only, root-confined, and does not invoke
  Agent Bash.
- The Desktop accurately labels project-global Files/Changes and session-local
  Attachments.
- Runtime automatic cleanup remains out of scope.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Root package has no `check` script | `npm run check -- --output human` | Use the repository's available build/test scripts and direct focused Node tests instead. |
| Desktop API test command doubled the `apps/desktop` path | Combined `--dir apps/desktop` with an `apps/desktop` working directory | Run pnpm from the repository root or omit `--dir` when already inside the package. |
| Desktop UI suite expects removed `ph-chats-circle` sidebar icon | Full Desktop test run; failure is in concurrent/pre-existing `ChatSidebar.svelte` changes outside Project inspection | Leave unrelated sidebar code untouched; retain passing Svelte check and Project-specific UI assertion evidence, and report the unrelated regression separately. |

---

## Goal

Move Projects out of their separate desktop page and into the chat sidebar as a
collapsible first-level group, while fixing creation and display of empty
sessions. The existing project directory and Agent-context behavior remains
unchanged.

## Confirmed product decisions

- The sidebar has two first-level groups: **Conversations** and **Projects**.
- Conversations contain channels as second-level nodes; projects contain
  projects as second-level nodes. Sessions are third-level nodes in both.
- First- and second-level groups are independently expandable; several may be
  open simultaneously. Their expansion state persists locally across restarts.
- Toggling a group is navigation-only: it must never change the active right
  pane or interrupt an Agent run.
- Project rows only expand/collapse. Clicking a project session selects it in
  the shared chat pane. There is no Projects page.
- Top-level New Conversation creates/reuses the Web empty draft. A project has
  its own New Conversation action; it creates/reuses that project's empty
  draft. Each scope has at most one empty draft.
- Empty drafts are saved immediately and only appear once persistence succeeds.
  On failure, preserve the active chat and present a retryable error.
- Project sessions never duplicate into the Conversations group.
- Ordering is newest activity first within every second-level node.
- Header format is `source-or-project / session name`.
- Creation of a project expands it but changes neither the active right pane
  nor session selection. Existing project directory behavior and management
  actions remain.
- Deleting an active session opens the next most-recent session in its group;
  if none remains, show an unselected empty state without recreating a draft.

## Implementation phases

1. **Map and test current data flows** — complete
   - Verify Web draft creation, project session API behavior, current title
     ownership, and existing test coverage.
2. **Unify sidebar and selection state** — complete
   - Replace the separate Projects view with the shared sidebar tree and
     selection-aware shared chat pane.
3. **Correct draft lifecycle** — complete
   - Persist/reuse blank Web and project sessions and update ordering safely.
4. **Apply the responsive, bilingual themed UI** — complete
   - Build the three-level navigation using existing UI patterns/tokens.
5. **Verify and document** — complete
   - Unit/integration checks, desktop visual checks in light/dark and Chinese/
     English, then update project documentation required by AGENTS.md.

## Verification gates

- New Web and project sessions appear immediately after a successful save.
- Repeated creation reopens the scope's existing empty session.
- Existing sessions, management actions, channel transport, project working
  directory behavior, and active Agent runs remain intact.
- Collapsing/expanding multiple groups persists across restart and never alters
  the right pane.
- The Projects page and its sidebar shortcut no longer exist.

## Proposed technical design

### Session persistence contract

- Add a shared session-store operation that returns the existing message-less
  conversation for a scope, or creates exactly one when none exists. Its scope
  is a Web profile or a single project id.
- Expose it through the existing granular Web-session and project-session
  endpoints. Both responses return the full session summary and whether the
  result was reused; do not make the client infer emptiness from a title.
- Keep project ownership in the session store so project sessions stay excluded
  from the normal Web query and retain their project execution workspace.

### Sidebar and active-pane model

- Replace the single `expandedChannel` and its single item array with a
  persisted tree state plus per-node loading/cache records. Expansion is wholly
  independent from selection.
- Merge the project list into `ChatSidebar`; remove the `mainView` switch,
  `ProjectsView`, and the Projects navigation shortcut.
- Treat the active target as a discriminated source (Web, project, or
  read-only external channel). Reuse the chat shell, transcript and composer
  primitives; source-specific data loading and runtime context stay behind the
  existing Web/project adapters rather than leaking project logic into channel
  adapters.
- The active header derives from the selected target as
  `source name / session title`. Unselected state has no synthetic session.

### Lifecycle and recovery

- New-conversation actions await the idempotent persistence result before
  changing selection or list state. They then expand only the parent required
  to reveal the newly selected session.
- Successful sends refresh only the owning node to maintain newest-first order.
- A deleted active session selects the next item from its own loaded node; if
  none exists it clears selection without creating a replacement.
- Failed loads/creates retain the existing active target, show a scoped,
  retryable error, and never insert an optimistic phantom row.

## Expected implementation surface

- Desktop: `App.svelte`, `ChatView.svelte`, `ChatSidebar.svelte`, the existing
  channel accordion/session-row components, project list/store/chat adapters,
  and desktop i18n/tests.
- Service: session-store scope helpers, Web and project session routes, their
  API client contracts, and tests using temporary session/project storage.
- Documentation after implementation: `features.md`, `prd.md`,
  `CHANGELOG.md`, and `README.md` as required by the repository instructions.

## Errors encountered

| Error | Resolution |
| --- | --- |
| Search included absent `packages/` directory | Restrict subsequent searches to verified workspace roots. |
| zsh expanded bracketed Svelte route path as a glob | Quote literal route paths in subsequent reads. |

## Planning status

Implementation started after user approval. Phases 2 and 3 proceed together:
the persisted draft contract must exist before the unified sidebar can select it.

## Delivery result

All planned phases are complete. The Desktop sidebar and project pane passed
`svelte-check`, the Desktop UI/HTTP/Rust suite, and server/client Session tests.

---

# Project session file provenance and change visibility analysis (2026-07-11)

## Goal

Define the smallest shared design that lets a user inspect, from a Project
conversation, (1) files intentionally attached to that turn, (2) files created
or changed by tools during that turn, and (3) the resulting project tree and
Git diff. This is analysis only; no product code is changed in this phase.

## Phases

1. Map current attachment, tool-event, project-session, and Git integration paths — complete.
2. Identify the gaps against turn-scoped provenance and project change visibility — complete.
3. Propose the shared module/interface, data model, UI surfaces, migration, and verification plan — complete.

## Decision constraints

- Project roots remain the user's files. Never write Molibot metadata into them.
- Scratch artifacts remain outside the project root and must retain session/run provenance.
- Project tree and Git state are views of the real filesystem; do not cache them as the source of truth.
- Cross-channel/runtime orchestration remains shared; Project UI only renders shared facts.

## Proposed design

- Add one shared `TurnFileProvenance` module. It records emitted artifacts for
  every session/run and, for Project runs, compares a pre/post project manifest
  to record observed created/modified/deleted paths. It stores durable facts by
  `runId` and `sessionId` outside the project root.
- Add a read-only `ProjectInspection` module. It lazily lists a bounded project
  tree and returns Git status/diff scoped to the registered project root. It
  never shells through the Agent and never exposes parent-repository paths.
- Present two deliberately distinct views: `This turn` (run-scoped artifacts
  and observed changes) and `Project changes` (live tree/Git working state).
  This avoids falsely claiming that every current Git change was made by the
  Agent.

## Review-ready specification

The complete review specification is now
`docs/requirements/project-session-provenance-and-inspection.md`. It covers
storage, privacy, concurrency, Git/non-Git behavior, lifecycle, UI, delivery
slices, and verification. `prd.md` records the feature as planned P1.

---

# Automation workspace density refresh (2026-07-10)

## Goal

Make the desktop Automation workspace compact and scan-friendly: a selected
sidebar shortcut must be visible, task rows must remain dense, and selecting a
row must reveal its execution details in a dedicated right-hand pane.

## Implementation phases

1. **Map existing workspace, task actions, and style primitives** — complete
2. **Build the compact two-pane Automation workspace** — complete
3. **Wire sidebar active state and preserve task actions** — complete
4. **Verify localized, themed, responsive behavior and document** — complete

## Verification gates

- Automation and Skills show a visible selected state in the chat sidebar.
- Automation rows show title, schedule, state, and next/last run without
  expanding into cards; selecting a row opens its full detail and run history.
- Existing create, edit, run, and delete behavior remains available.
- Light/dark, Chinese/English, keyboard focus, and narrow-window layouts remain usable.

## Delivery result

The Automation workspace now uses the requested dense list/detail structure.
`svelte-check` and all Desktop chat UI checks pass; the existing local preview
confirmed both sidebar active states and reported no console errors. Its service
was not connected, so live task rows could not be populated during that preview.

---

# Automation interaction and scheduling controls (2026-07-10)

## Goal

Keep Automations list-first by default, reveal a closable detail pane only for
the selected task, show per-task execution activity without globally blocking
the workspace, prevent automation runs from leaking into ordinary sessions,
and support pausing individual periodic tasks.

## Implementation phases

1. **Reproduce the automation-session leak and map task execution state** — complete
2. **Add persisted task enabled/paused state and scheduler guard** — complete
3. **Refine list-first workspace interactions and per-task execution UI** — complete
4. **Verify focused regressions, UI behavior, and documentation** — complete

## Verification gates

- A fresh periodic automation run never appears in normal Web/Channel session navigation.
- Triggering task A leaves task B runnable and selectable while A alone shows running state.
- Paused tasks do not dispatch through the watcher and can be resumed without recreation.
- The default workspace shows only search, compact summary, and list; detail opens and closes predictably.

## Delivery result

All requested interaction fixes are complete. Focused server/session tests,
Desktop Svelte diagnostics, Desktop UI regression tests, production build, and
the scoped `git diff --check` passed. The worktree has one pre-existing,
unrelated trailing-blank-line warning in `webSearchTool.test.ts`; it was left
untouched. Production build keeps only its existing dynamic-import advisories.
# Agent workspace in Desktop main navigation (2026-07-12)

## Goal

Add an Agent workspace directly below Skills in the macOS app sidebar. It shows
only user-created agents (never the built-in `default`) as a playful office of
walking pug characters, backed by real Desktop Agent data.

## Assumptions

- The navigation label is `Agent` in Chinese and `Agents` in English; the page
  can use the warmer `Agent 工作室` / `Agent Studio` title.
- This is a main-app workspace, not a third Tauri window.
- The first delivery uses existing Agent configuration data and implements a
  polished, responsive animated scene; live run/subagent telemetry remains a
  later slice unless the existing runtime exposes it without core-runner risk.

## Phases

1. **Map main navigation, workspace switching, Agent API, and test seams** — complete
2. **Add red-capable navigation/data filtering tests** — complete
3. **Implement Agent workspace and pug office animation** — complete
4. **Verify bilingual/dark/mobile behavior and regressions** — complete
5. **Adversarial review and required product documentation updates** — complete

## Verification gates

- Agent/Agents appears immediately below Skills and opens without leaving the main window.
- The built-in `default` Agent never renders; each user-created Agent renders exactly once.
- Empty state points users to Agent settings.
- Pug characters visibly walk/idle and respect reduced-motion preferences.
- Existing New Task, Skills, Automations, Projects, and conversations still work.
- Desktop type checks, UI tests, and production build pass.

---
# Trace active-run control for Web and Desktop (2026-07-12)

## Goal

Add a shared active-runs control surface to both Trace pages that distinguishes
live runners from orphan Trace facts and supports exact stop or audit-preserving cleanup.

## Phases

1. Expose read-only RunnerPool snapshots and exact session abort — complete
2. Build credential-safe active-run projection and action API — complete
3. Add responsive Web and Desktop Trace controls — complete
4. Verify live/stuck/orphan behavior and full builds — complete
5. Update product documentation — complete

## Verification gates

- A live run is never inferred from Trace alone.
- Stop targets the exact channel, Bot, chat, and session represented by the row.
- Orphan cleanup marks the Trace run aborted; it does not delete audit data.
- Web and Desktop show the same statuses and actions.
- Persistent tests use only in-memory or temporary stores.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Equal-duration active-run fixtures had a brittle ordering assertion | 1 | Assert each run's classified status by ID; ordering is only guaranteed by duration. |
| Root `pnpm check` does not exist | 1 | Use the repository's full `pnpm build` SvelteKit verification instead. |

---
# GitHub bug repair #1-#6 (2026-07-13)

## Goal

Reproduce, repair, and verify GitHub issues #1 through #6 without expanding
scope into enhancements #7-#9 or overwriting pre-existing worktree changes.

## Assumptions

- The six issues labeled `bug` are the scope for this pass.
- Existing uncommitted edits are user-owned and must be preserved; overlapping
  edits will be reviewed and completed rather than reverted.
- Issue closure/commenting is deferred until each issue has a verified fix.

## Phases

1. Build a red-capable feedback loop for each issue — completed for #1-#5; #6 requires a storage decision
2. Rank and test root-cause hypotheses — completed
3. Apply the smallest owning-layer fixes and regression tests — completed for #1-#5
4. Run focused, type/build, UI, and adversarial verification — completed for #1-#5
5. Update `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` — completed

## Verification gates

- #1 Project file panel requests a valid Project inspection/raw route, never a
  Svelte HTML 404 response.
- #2 Session A live output/queue/approval never appears in Session B.
- #3 Repeated New Chat actions reuse the one empty Session per scope.
- #4 First navigation to Agents, Skills, or Automations renders immediately.
- #5 failed/interrupted tool activities reach a terminal state and persisted
  transcripts never show an eternal running spinner.
- #6 each conversation has one canonical persisted history; any compatibility
  index/projection is clearly non-duplicative and migration-safe.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| zsh expanded the `[id]` route segment as a glob | 1 | Quoted the full route filename for direct test execution. |
| Experimental Tauri `acceptFirstMouse` config failed Cargo feature validation and had no causal evidence | 1 | Reverted the experiment completely; browser instrumentation proved clicks were delivered and API/bootstrap failure was the real cause. |
| Initial Desktop proxy targeted IPv4 while the isolated backend listened on IPv6 localhost | 1 | Restarted the proxy with `http://localhost:3000` and reran the browser discriminator. |
| A duplicate isolated backend start hit `ServiceLeaseConflictError` | 1 | Reused the existing lease-owning backend, then deliberately stopped/restarted it for fault injection. |
| zsh loop variable `path` shadowed `PATH`, hiding `curl`/`head` | 1 | Renamed the loop variable and used direct endpoint checks. |
| zsh kept a newline-delimited changed-file scalar as one `rg` path | 1 | Switched to NUL-delimited `git ... -z | xargs -0 rg`; no machine path/private macOS config was introduced by this pass. |

---
# Owner-level memory automations and task tabs (2026-07-13)

## Goal

Replace per-channel/per-Bot managed memory automations with one owner-level
scheduler entry that dynamically discovers current targets at run time, and
separate user-created and system-managed automations in Desktop.

## Assumptions

- System tasks are runtime-managed events with an explicit persisted marker;
  ordinary events created from the Automations UI remain user tasks.
- One owner-level event may fan out internally across current Bot/channel
  targets while retaining per-target/per-conversation watermarks and failure
  isolation.
- Existing legacy managed files must be migrated safely without touching user
  events or real runtime databases in tests.

## Phases

1. Define owner event identity, dynamic target collection, and migration — complete
2. Implement owner-level dispatch and target-isolated execution — complete
3. Add bilingual responsive user/system task tabs — complete
4. Add regression coverage and run type/build checks — complete
5. Adversarial review and required documentation updates — complete

## Verification gates

- Exactly one managed reflection event and at most one managed daily-materials
  event exist for the owner, regardless of Bot count.
- A Bot added after scheduler startup configuration is included on the next run
  without creating another watched-event file.
- Legacy per-Bot managed files are removed or disabled idempotently; user task
  files are never modified.
- User/System tabs classify tasks by explicit metadata, not filenames or empty
  text, and work in Chinese, English, light, dark, and narrow layouts.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Root `tsc --noEmit` reports broad pre-existing dependency/package errors | 1 | Filtered diagnostics to touched files, fixed all local issues, and used focused typed tests plus both supported production builds as the release gates. |
| First adversarial pass found legacy cleanup occurred after the missing-manager early exit | 1 | Moved recognized managed-file migration before manager lookup, so stale tasks are removed even for currently inactive channels. |

---
# Issue #6 UI Session storage naming and lifecycle (2026-07-13)

## Goal

Rename the misleading Web `users` persistence layout to `ui-sessions`, migrate
existing data safely, and make Web conversation deletion remove both the UI
Session and its Agent context without changing external-channel persistence.

## Assumptions

- `UI Session` is the canonical name for the Web-facing title, ordering,
  activities, attachments, and currently compatible transcript projection.
- This slice renames and migrates that projection; converting it to
  metadata-only storage is a separate migration because current UI activities
  and attachment state are not yet fully reconstructable from Agent context.
- All persistence verification uses temporary directories only.

## Phases

1. Add failing layout-migration and synchronized-deletion tests — completed
2. Implement idempotent `users` to `ui-sessions` migration — completed
3. Implement shared Web Session lifecycle deletion — completed
4. Run focused/full verification and adversarial review — completed
5. Update domain and product documentation — completed

## Verification gates

- New Web conversations never create a `users` directory or root
  `sessions-index.json`.
- Existing indexed Web conversations migrate to `ui-sessions` without data or
  ordering loss, and obsolete empty directories are removed only afterward.
- Deleting a Web conversation removes its UI file/index entry and Agent
  `.json`, `.jsonl`, and metadata files, including when it is the last context.
- Feishu, Telegram, QQ, Weixin, and other external channels remain context-only.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Looked for `CONTEXT-FORMAT.md` beside the skills root | 1 | Resolved the reference relative to the `domain-modeling` skill directory. |

---

# Desktop Trace delete feedback (2026-07-14)

## Goal

Make the Desktop Trace “Delete record” action visibly confirm, submit the
existing per-run action, and remove the orphan row after refresh.

## Assumptions

- “Delete record” keeps the existing audit-preserving behavior: the run fact is
  marked aborted instead of physically deleting all Trace facts.
- The current `TraceSection.svelte` and shared UI changes are user work and must
  be preserved; this fix stays inside the Trace action seam.
- Persistence verification uses an in-memory Trace store only.

## Phases

1. Add a red-capable Desktop UI action contract — complete
2. Replace the browser-native confirmation with an in-app dialog — complete
3. Verify client request, server transition, refresh, and types — complete
4. Run adversarial review and update required product docs — complete

## Verification gates

- Clicking the menu action always opens visible in-app confirmation UI.
- Confirming calls the existing action API exactly once for the selected run.
- A cleared orphan no longer appears in the active-runs projection.
- Chinese/English copy, dark theme tokens, keyboard dismissal, and narrow layout
  reuse the existing shared modal system.

## Adversarial review

- Duplicate submission: confirmation clears synchronously and `activeRunBusy`
  disables every row action before the request starts.
- Keyboard dismissal: the dialog receives focus after rendering, so Escape is
  handled by the overlay rather than the now-covered overflow-menu trigger.
- Refresh race: orphan persistence changes synchronously before the awaited
  refresh; the 3-second poll remains a fallback if a later refresh is needed.
- Failure visibility: request failures still surface through the existing
  `activeRunMessage` and do not silently mutate the local list.
- Audit safety: no DELETE endpoint or physical Trace-fact removal was added.

---
# GitHub issue #13 full completion execution (2026-07-14)

## Goal
Finish every missing or unverified requirement in Issue #13 sequentially. A goal is
complete only after implementation, focused regression coverage, real-page interaction,
and screenshot review at the required viewport/theme/locale states.

## Current phase
Complete — G0 through G9 accepted

## Execution goals

| Goal | Scope | Status | Completion evidence |
| --- | --- | --- | --- |
| G0 | Full PRD matrix, current branch/diff, reusable preview harness | complete | Every section 1–33 mapped to code/test/visual evidence |
| G1 | Shared foundation: tokens, radii, motion, typography, AppShell/PageHeader/SettingGroup/SettingRow/Select/Search/Badge/Empty/Skeleton/Overflow primitives | complete | Product-surface geometry and interactive durations use shared tokens; target pages use shared components |
| G2 | Settings shell and General: header/description, sidebar/footer, scroll edge, fixed save footbar, scope copy | complete | 860×620 + wide, zh/en, light/dark screenshots and keyboard checks |
| G3 | Models | complete | Human-readable primary values, technical secondary details, equal compact selects, complete first viewport |
| G4 | Providers | complete | Human-readable names, constrained list/detail, correct filters/sort/actions, equal controls |
| G5 | Trace | complete | Bounded data presentation, semantic metrics, secondary raw details, human labels/actions |
| G6 | Automations | complete | One canonical list/detail workspace, natural schedules, separated states, history, refresh/stop/undo, overlay behavior |
| G7 | Chat | complete | Agent identity, human model metadata, Message Unit actions/details, compact composer, search/keyboard behavior |
| G8 | Cross-app interaction/accessibility | complete | immediate/interruptible feedback, shortcuts, anchored overlays, reduced preferences, focus, screen-reader semantics, low-performance behavior |
| G9 | Adversarial audit and documentation correction | complete | Tests/build/checks green; real screenshots accepted; PRD/features/changelog/readme truthful |

## Non-negotiable verification gates

- No goal becomes complete from source-string assertions alone.
- Every target page is exercised with real populated data when available.
- UI checks cover 860×620 and a wide window, Chinese/English, light/dark, keyboard,
  reduced motion, reduced transparency, and increased contrast as applicable.
- Tests must not read or write the user's real settings, task, Trace, queue, or runtime stores.
- Existing user/concurrent work is preserved; every changed line traces to Issue #13.
- The final adversarial review lists and fixes the 3–5 likeliest failure modes.

## Assumptions

- Issue #13 is the source of truth; its P0, P1, P2, Apple interaction additions,
  and acceptance checklists are all in scope because the user explicitly requested all gaps.
- The project-specific Molibot macOS layer in `DESIGN.md` overrides generic frontend
  styling advice. The direction is restrained, dense, system-native, and functional.
- Shared components may be added where the same semantic control occurs on multiple pages;
  business APIs and Channel/runtime architecture are not redesigned unless required by an
  explicit interaction acceptance item.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Combined DESIGN/Issue read exceeded direct output limit | 1 | Preserve the issue inventory already captured and read `DESIGN.md` in bounded chunks to EOF before editing UI. |
| Presentation helper test could not import the not-yet-created module | 1 | Expected red-first state; added the presentation module and reran the focused suite green. |
| Svelte rejected an exported interface inside an instance script | 1 | Made the component-local option interface non-exported; no public type export is needed. |
| Three source-contract tests still expected PageHeader and General markup inside App.svelte | 1 | Updated the tests to follow the new shared components and assert the intended flat SettingGroup behavior. |
| Direct assignment to `scrollTop` was blocked by the controlled DOM proxy | 1 | Used the element's `scrollTo()` method instead; the real scrolled header state and edge opacity were verified. |

# GitHub issue #10 completion, merge, and delivery (2026-07-15)

## Goal
Audit the existing issue #10 worktree against the full PRD, preserve and merge its work into `master`, then complete and verify every remaining first-version acceptance requirement.

## Current phase
Phase 5 — complete

## Phases
1. Map the issue requirements to current branch code, tests, and visual evidence — complete (implementation is incomplete)
2. Commit the preserved worktree changes and merge the branch into current `master` — complete
3. Implement only confirmed gaps on `master`, with focused regressions — complete
4. Verify projection, UI behavior, diagnostics, build, themes/locales/responsiveness, and visual quality — complete (live narrow viewport and composed WebGL screenshot are explicitly not claimed)
5. Update `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md`; adversarially review and deliver — complete

## Verification gates
- No completion claim without requirement-by-requirement source/test evidence and current visual QA.
- Preserve all existing issue-worktree changes; do not discard uncommitted work.
- Three.js remains a rendering boundary; shared projection owns layout and Activity semantics, with no Channel changes.
- UI supports Chinese/English, light/dark themes, reduced motion, narrow windows, DOM semantics, and automatic 2D fallback.
- `git diff --check`, focused tests, Desktop diagnostics, and production build pass.

## Decisions
| Decision | Rationale |
| --- | --- |
| Audit before committing or merging | The worktree contains substantial uncommitted implementation, while its branch commit is one release behind `master`; completion must be based on content and verification rather than branch/issue status. |
| Preserve the work by committing it on the issue branch before merge | Git cannot merge uncommitted work, and the user explicitly asked to merge it even if incomplete. |

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| Anonymous web open of issue #10 returned a cache miss | 1 | Used authenticated `gh issue view` with approved network access. |
| Sandboxed `gh issue view` could not reach `api.github.com` | 1 | Re-ran with the required scoped network approval and loaded the full issue. |
| First focused-test tool call had malformed orchestration syntax | 1 | Correct the tool-call object and run the unchanged test command once. |
| Sandboxed `tsx` could not create its temporary IPC socket (`EPERM`) | 1 | Re-run the focused test with scoped host execution; do not alter package state. |
| Sandboxed Git could not create the linked-worktree `index.lock` | 1 | Re-run the same scoped add/commit with repository metadata write approval. |
| Initial merge metadata write was blocked by the sandbox | 1 | Re-ran the scoped merge with Git metadata approval. |
| Merge found conflicts in App state, Agent Studio CSS, and three planning logs | 1 | Combined v2.4.8 low-performance/settings state with the Agent preview pane, selected the new city CSS that intentionally supersedes the old office, and appended both sides of historical logs. |
| First parallel post-merge diagnostics ran before Three.js installation completed | 1 | The focused pnpm test installed the already-locked dependency; rerun diagnostics after installation rather than changing source. |
| Sandboxed pnpm build could not open its cache SQLite database | 1 | Run the installed Vite binary directly, avoiding package-manager cache mutation. |
| Local visual-QA port 1422 was already occupied | 1 | Preserve the existing process and start the isolated preview on the next free port. |
| Local visual-QA port 1423 was also occupied | 2 | Stop trying the adjacent app ports and use an isolated high development port. |
| Historical `service/server.mjs` start path no longer exists | 1 | Discover the current package script/entrypoint before starting the service; do not guess another path. |
| Sandboxed current `npm start` could not bind localhost:3000 | 1 | Re-run the same repository start script with scoped local-bind approval. |
| Approved service start found an existing data-directory owner while the service script reports stopped | 1 | Inspect only the reported PID before deciding whether it is stale or a live alternate service; do not kill it implicitly. |
| Sandboxed `ps -fp 99675` was denied | 1 | Re-run the read-only process inspection with scoped approval. |
| Combined post-onboarding DOM/screenshot capture timed out during screenshot | 1 | Keep the app state, take a fresh DOM snapshot alone, then use a bounded screenshot method instead of repeating the composite call. |
| Bounded 1020×800 Agent-content screenshot also timed out | 2 | Stop repeating page screenshot capture; inspect the semantic DOM and read the WebGL canvas output separately, then use a different visual surface if full composition remains unavailable. |
| First canvas-inspection orchestration string contained an unescaped nested template literal | 1 | Replace the display-only template literal with plain string concatenation; no browser or repository state changed. |
| In-app browser viewport override reported success but remained 1280×800 on two checks | 1–2 | Stop repeating the unsupported override in this browser; correct the evidence record and retain source/responsive tests for narrow behavior without claiming live 860×620 validation. |

---
# Memory Center and per-turn Memory Trace implementation (2026-07-15)

## Goal
Ship the first real Molibot memory-observability slice: the Memory page clearly separates saved and pending memories, Chat lists the exact memories injected into each answer, and the same turn separately reports memories newly stored or updated.

## Current phase
Complete

## Phases
1. Freeze exact final-injection, trace, write-receipt, and message-binding contracts; add focused red tests — complete
2. Implement shared final-injection snapshot, persistent trace store, and stable Assistant source-entry binding — complete
3. Capture structured memory write receipts and expose lazy Desktop/API contracts — complete
4. Implement Chat memory trigger/drawer and reorganize the Memory center with bilingual, responsive, themed UI — complete
5. Run focused/full verification, adversarial review, and update product documentation — complete

## Verification gates
- The reference count equals the final memories actually serialized into the LLM context, never retrieved or merely selected counts.
- Historical traces render immutable snapshots even after a memory is edited or deleted.
- “Answer references” and “stored this turn” remain separate facts and UI sections.
- Trace/write-receipt failure cannot block or alter the Agent answer.
- Trace tests use temporary/injectable SQLite stores and never touch the user runtime database.
- Desktop UI is verified in Chinese/English, light/dark, wide/narrow layouts, keyboard flow, and Svelte diagnostics.
- `git diff --check`, focused tests, relevant full suites, and production build pass before completion.

## Decisions
| Decision | Rationale |
| --- | --- |
| Materialize prompt text and injected items in one shared step | The existing prompt compactor trims a selected set again; deriving UI metadata earlier would produce a false count and false history. |
| Bind traces to the final visible Assistant context entry via `sourceEntryId` | Message IDs can be reprojected while the context entry is the stable persisted answer produced by the run. |
| Capture write receipts from structured tool results in the shared Runner | Text previews are lossy and Channels must not own cross-channel Agent behavior. |
| Keep reference trace and write receipt as separate sections | A memory provided to the model and a memory persisted by the turn are different lifecycle events. |
| Preserve the current technical memory tools behind an advanced surface | Existing debugging power remains available while the default page becomes understandable to normal users. |

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| zsh expanded the bracketed SvelteKit route path as a glob | 1 | Quote bracketed route paths in inspection commands; no repository state changed. |
| Root package has no `npm run check` script | 1 | Inspect the declared scripts and use the repository's actual diagnostics command; no package state changed. |
| Direct `tsx` Runner test could not load imported Markdown templates | 1 | Re-run Runner coverage with the repository's `scripts/register-loader.js` invocation used by package tests. |
| Runner suite reached the real read-only settings/approval database and 6 tests failed before exercising this change | 1 | Do not retry against user data; use an isolated temporary data/config environment for any further Runner run, and rely on focused pure/injectable tests meanwhile. |
| Combined verification's `tsx` CLI could not bind its sandbox IPC socket | 1 | Keep the already-green Svelte result and rerun tests through `node --import tsx --test`, which does not need the CLI IPC server. |
| Sandboxed Desktop preview could not bind localhost | 1 | Start the same local-only preview with scoped bind approval; no external network exposure. |

---

# Project Chat blank transcript fix (2026-07-15)

## Goal
Restore existing Project Session messages without changing external Feishu/Telegram transcript behavior.

## Current phase
Complete

## Phases
1. Reproduce against the reported Project Session and verify persistence/API data — complete
2. Trace Project selection through Store, Runtime, and renderer — complete
3. Add a focused regression and remove duplicate transcript loading — complete
4. Verify the real DOM, Svelte diagnostics, production build, docs, and diff — complete

## Errors encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| Initial browser target used port 5173, while the Desktop Vite server was on 1420 | 1 | Inspect the existing process listener, then use an isolated preview on 4179 without disturbing the user's app. |
| The broad Project Store file includes an unrelated stale first test | 1 | Use the two exact Project Session regression names as the valid bug-fix seam; separately run Svelte diagnostics, API tests, production build, and real-page DOM verification. |
| The installed planning skill package has no `scripts/check-complete.sh` at its documented root | 1 | Record the packaging mismatch and use the explicit completed phase list plus clean `git diff --check` as the completion gate. |
# 一次性提醒任务收件箱（2026-07-15）

## 目标

在 Desktop“自动任务”工作区增加“一次性任务”Tab：只展示一次性提醒，触发前显示“提醒”，成功触发后显示“已提醒”；新触发的提醒产生未读角标，进入该 Tab 后标记已读；周期任务行为保持不变。

## 成功标准

- [x] 一次性提醒与周期任务、系统任务分 Tab 展示，历史诊断任务不混入产品列表。
- [x] 未触发/已触发状态由 watched event JSON 的运行时状态可靠派生。
- [x] 只有功能上线后新触发的一次性提醒产生未读，旧历史记录不会形成未读洪水。
- [x] 进入“一次性任务”Tab 后持久化已读，并同步清除侧边栏“自动任务”角标。
- [x] 周期任务不参与提醒未读机制。
- [x] 中英文、明暗主题和窄屏布局沿用现有设计体系。
- [x] 服务端测试、Desktop UI 测试、类型检查/构建通过。

## 阶段

1. **已完成** — 核对设计规范、数据模型、API 与触发落盘路径。
2. **已完成** — 实现提醒未读状态和已读写回，并覆盖测试。
3. **已完成** — 实现第三个 Tab、todo 列表和侧边栏角标。
4. **已完成** — 更新中英文文案及产品文档。
5. **已完成** — 完成测试、构建和对抗式回归检查。

## 约束与决定

- 提醒继续以 watched event JSON 和运行时事件系统为唯一事实源。
- 已读动作定义为用户进入“一次性任务”Tab；这样角标不会在用户尚未看到提醒时消失。
- 未读标志只在新的一次性提醒成功触发时写入，缺少该标志的历史记录视为已读。
- 保留工作区中所有与本功能无关的未提交修改。

---
# 系统任务执行会话不可打开（2026-07-15）

## 目标

修复 Desktop 自动任务中系统任务已执行但打开执行会话显示“会话可能已清理”的问题，确保真实存在的内部任务执行记录可以读取，同时继续正确处理确实已被 retention 清理的会话。

## 成功标准

- [ ] 建立可重复、秒级、能捕获“执行存在但 session 返回空”的反馈循环。
- [ ] 确认系统任务 execution lease 的 session/workspace 存储位置与 Desktop 详情解析路径。
- [ ] 写出先失败后通过的回归测试，使用临时目录/SQLite。
- [ ] 系统任务会话能显示真实 user/assistant 内容；普通渠道任务与真实已清理会话行为不回归。
- [ ] 更新 features / prd / CHANGELOG / readme，并通过聚焦测试、Svelte 检查和构建。

## 阶段

1. **进行中** — 用当前运行服务或最小夹具建立红色反馈循环。
2. **待处理** — 排名并验证 3–5 个可证伪假设。
3. **待处理** — 写回归测试并实施最小修复。
4. **待处理** — 更新文档并完成对抗式验证。

---
## 2026-07-15：内部审批 / Event Session 归属与侧栏标题修复

### 目标
严格按用户指定顺序完成五项修复：审批专用 API → Event 原始 Session → 历史内部记录安全回填/隐藏 → 侧栏标题自适应 → 完整回归。

### 验收顺序
1. [complete] 审批只走专用 API，`/hosttools approve-session ...` 不再作为普通消息创建 Session。
2. [complete] watched Event 持久化原始来源 Session，并在提醒触发时回到该 Session。
3. [complete] 对历史 `/hosttools...` 与 `[EVENT:...]` 做可逆分类回填/普通 Chat 隐藏，不删除用户数据。
4. [complete] 侧栏标题可使用随侧栏增大的可用宽度，同时保留时间与操作区。
5. [complete] 回归断言覆盖内部 Session 隔离、提醒来源 Session、标题宽度增长；更新产品文档并完成构建。

### 约束
- 修改顺序不可交换；每项先红灯后修复并验证。
- 分类与隐藏必须可逆，原始 Session/消息不得删除。
- 审批、Event 归属和历史分类属于共享上层，不下沉 Channel。
- UI 遵循 DESIGN.md，中英、明暗主题与窄窗口保持兼容。
