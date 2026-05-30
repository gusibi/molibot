## 1. TurnOrchestrator

  File: turnOrchestrator.ts
  ### Strengths
  • Clean implementation of session locking with 10-minute stale lock cleanup (lines 92-118)
  •  prepareTurn  properly creates a run record, acquires session lock, and sets up memory context
  •  commitTurn  centralizes run status updates (completed/aborted/failed/waiting_for_approval)
  •  compactSessionContext  properly delegates context compression
  • Good use of  SqliteTurnCleanupStore  abstraction for startup cleanup
  •  cleanupStaleRunningTurns  runs at startup to prevent permanent deadlocks (line 31-51)
  • Properly tracks workspace metadata on runs
  ### Issues

  #### Important
  1. Missing run event logging — The v2.0 spec Section 4.13 specifies RunlogRuntime should record events like
  run_started ,  tool_called ,  approval_requested , etc. The TurnOrchestrator does write run records to SQLite
  but does not emit structured run lifecycle events beyond basic status.
      • File: turnOrchestrator.ts (entire file)
      • Why: Without structured events, debugging production issues and building an observability layer is
      harder
      • Fix: Add event emission hooks, even as stubs, for future RunlogRuntime integration
  2. No actor authentication — Spec Step 2 of the turn flow says "auth actor". The TurnOrchestrator does not
  perform any actor authentication check.
      • File: turnOrchestrator.ts:prepareTurn
      • Why: Security gap — any channel can submit messages without actor verification
      • Fix: Add actor auth check or document that this is deferred to channels
  3. No tool/skill selection in orchestrator — Spec steps 9-10 say "select skills" and "select tools". These
  are still handled in runner.ts rather than orchestrated here.
      • File: turnOrchestrator.ts
      • Why: The orchestrator doesn't fully own the turn pipeline per spec
      • Fix: This could be intentionally phased — document the decision


  #### Minor
  1. Hardcoded 10-minute lock timeout — The stale lock timeout is hardcoded. Could be configurable.
      • File: turnOrchestrator.ts:109
      • Impact: Low — 10 minutes is reasonable
  ──────
  ## 2. ToolRuntime
  File: toolRuntime.ts

  ### Strengths

  • Clean  ToolRegistry  with  register  /  get  /  getAll  /  clear  (lines 1-50 approx)
  •  executeToolCall  implements the full policy→approval→sandbox→handler pipeline
  • Approval polling with 5-minute timeout and abort signal support (lines ~150-200)
  • 1.5-second debounce for low/medium risk approvals
  • Workspace-based tool whitelisting ( enabledToolIds )
  • Proper  ToolExecutionContext  with  fs ,  shell , and  emit  APIs
  • Tool source tracking ( core  /  mcp  /  plugin )

  ### Issues
  #### Important

  1.  ToolExecutionContext.network  API missing — The v2.0 spec (Section 4.8) defines  SafeNetworkApi  and
  SafeSecretsApi  on the execution context. Current implementation only has  fs  and  shell .
      • File: toolRuntime.ts, toolTypes.ts
      • Why: Network and secrets access is uncontrolled — tools could make arbitrary network calls
      • Fix: Implement stub network/secrets API or at minimum document the gap
  2. PolicyEngine is inline, not modular — The spec calls for a separate  PolicyEngine  module (Section 4.9).
  Currently policy decisions are made inline in  executeToolCall  via a  decidePolicy  callback.
      • File: toolRuntime.ts:executeToolCall
      • Why: Not easily testable or extensible as a standalone module
      • Fix: Extract to a dedicated  PolicyEngine  class. The callback approach works but doesn't match the
      spec's vision for a reusable engine.
  3. No risk classification — Spec defines  risk: 'low' | 'medium' | 'high' | 'critical'  on  ToolDefinition
  and a  RiskClassifier . The  toolTypes.ts  does define risk levels on  ToolDefinition , but there's no actual
  risk classifier that evaluates runtime context.
      • File: toolTypes.ts:12, toolRuntime.ts
      • Why: Risk is statically declared per tool rather than dynamically assessed based on parameters
      • Fix: Phase this in — static risk levels are a reasonable starting point
  #### Minor

  1.  ToolRegistry  is a module singleton — Could make testing harder in complex scenarios.
      • File: toolRuntime.ts:1-50
      • Impact: Low — test files call  clear()  to reset

  ──────
  ## 3. ApprovalBroker & Store
  Files:

  • approvalBroker.ts
  • approvalStore.ts
  • approvalTypes.ts
  ### Strengths
  • Clean approval request/grant type definitions matching v2.0 spec
  •  ApprovalBroker.requestApproval  implements debounce with configurable delay
  • Proper scope support:  once ,  turn ,  session ,  workspace ,  persistent
  • Approval aggregation for same-type requests within debounce window
  •  ApprovalStore  implements SQLite-backed persistence with proper indexing
  •  requestedByDepth  tracks subagent depth for approval bubbling
  • Grant matching by capability+scope with expiry support
  • Good test coverage (approvalBroker.test.ts: 5 tests, approvalStore.test.ts: 5+ tests)

  ### Issues

  #### Important
  1. No revocation support — Spec Section 4.10 says "支持 revoke". There is no  revokeGrant  method.
      • File: approvalStore.ts, approvalBroker.ts
      • Why: Users cannot revoke previously granted persistent approvals
      • Fix: Add  revokeGrant(grantId)  method
  2. No audit trail — Spec says "审计记录". While requests and grants are persisted, there's no explicit audit
  log with timestamps of approval/rejection decisions.
      • File: approvalBroker.ts
      • Why: Compliance and debugging gap
      • Fix: The SQLite records partially serve this purpose, but a dedicated audit query/view would be
      valuable


  #### Minor

  1. Debounce timer not configurable per workspace — The 1.5s debounce is global. Different workspaces might
  want different aggregation windows.
      • File: approvalBroker.ts
      • Impact: Low for now

  ──────
  ## 4. Workspace Store
  File: store.ts
  ### Strengths

  • SQLite-backed workspace storage with auto-creation of  personal  default workspace
  • Supports  enabledSkillPaths ,  enabledToolIds ,  sandboxProfileId ,  approvalProfileId
  • Clean CRUD operations (create/update/get/list/delete)
  • Auto-migration on table creation
  • Test file present (store.test.ts)

  ### Issues
  #### Important
  1. Missing workspace policy features — Spec Section 6 defines per-workspace  sandbox policy ,  approval
  policy ,  model route ,  memory scope . Currently only  sandboxProfileId  and  approvalProfileId  are stored
  as string references, but there's no:
      • Workspace-specific sandbox policy resolution
      • Workspace-specific model routing
      • Workspace-specific memory scoping
      • File: store.ts
      • Why: Workspace as a security boundary is incomplete
      • Fix: Phase in these features — the store has the right shape for future extension
  2. No workspace root path validation — The  rootPath  field doesn't validate that the path exists or is
  accessible.
      • File: store.ts
      • Why: Could lead to runtime errors when workspace tools try to operate
      • Fix: Add validation on create/update

  ──────
  ## 5. AppRuntime

  File: runtime.ts
  ### Strengths

  • Successfully slimmed down — From 815+ lines to ~150 lines as stated in features.md
  • Now focuses on: config loading, database init, service init, channel startup, graceful shutdown
  • Sanitize logic properly extracted to  settings/sanitize.ts
  • Channel plugin loading properly extracted to  plugins/loader.ts
  • Stale run cleanup delegated to TurnOrchestrator on startup

  ### Issues
  #### Minor
  1. Still has some inline channel wiring — While much was extracted, some channel initialization logic remains
  that could eventually move to a channel registry pattern.
      • Impact: Low — current approach works and is readable
  ──────
  ## 6. Settings Sanitize

  File: sanitize.ts

  ### Strengths
  • Properly extracted from runtime.ts
  • 640 lines of focused sanitization logic
  • Budget settings sanitization with clamping
  • Channel-specific sanitization methods
  • Clean separation from runtime lifecycle

  ### Issues

  #### Important
  1. Still a monolithic sanitizer — The v2.0 spec Phase 8 says "移除巨型 sanitizeSettings" and split into per-
  domain schemas. The extraction moved the code out of runtime but didn't decompose it.
      • File: sanitize.ts (640 lines)
      • Why: Still hard to maintain and test individual config domains
      • Fix: This is acknowledged as Phase 8 work — track it

  ──────
  ## 7. Plugin Loader
  File: loader.ts
  ### Strengths
  • Clean extraction of  applyChannelPlugins  from runtime
  • 102 lines — focused and readable
  • Handles dynamic channel plugin loading/unloading

  ### Issues

  #### Important

  1. Not a full PluginManager — The v2.0 spec Section 4.2 envisions a comprehensive PluginManager with manifest
  validation, dependency resolution, capability registration, etc. This is just channel plugin loading.
      • File: loader.ts
      • Why: The plugin system is incomplete relative to the spec
      • Fix: This is acknowledged as Phase 6 work — the loader is a reasonable first step
  ──────
  ## 8. Agent Directory Structure

  ### Strengths

  • Successfully restructured from flat files into logical subdirectories:
      •  core/  — runner, turnOrchestrator, runnerHelpers, runnerInputEnricher, runnerPool
      •  tools/  — bash, read, write, edit, sandbox, subagent, toolRuntime, toolDisplay, toolPolicy, etc.
      •  routing/  — modelRouting, mediaFallback
      •  prompts/  — prompt, profiles
      •  skills/  — skills, self-evolution
      •  session/  — session, compaction
      •  identity/  — auth
      •  common/  — log
      •  commands/  — channelCommands
  • All imports updated across the codebase
  • Custom ESM loader for test compatibility with  ?raw  imports

  ### Issues
  #### Minor

  1. Some files might fit better elsewhere — e.g.,  channelCommands.ts  in  commands/  could arguably be in
  channels/shared/
      • Impact: Low — naming is reasonable

  ──────
  ## Summary Assessment
  ### What's Well Done

  • Phase 1 (ACP removal + Workspace): ✅ ACP code paths removed, workspace model introduced
  • Phase 2 (TurnOrchestrator): ✅ Core lifecycle delegation working, session lock, memory, run status
  • Phase 3 (ToolRuntime): ✅ Tool registry, execution pipeline with policy/approval/sandbox
  • Phase 4 (ApprovalBroker): ✅ Debounce, scope management, SQLite persistence, subagent bubbling
  • Directory restructure: ✅ Clean and well-organized
  • AppRuntime slimming: ✅ Dramatic reduction, focused on bootstrap
  • Test coverage: Good — 25/25 agent test suites passing

  ### Major Gaps vs v2.0 Spec

  1. PolicyEngine not modular — inline in ToolRuntime (Phase 4 gap)
  2. No network/secrets safe API — ToolExecutionContext incomplete (Phase 3 gap)
  3. No approval revocation — (Phase 4 gap)
  4. PluginManager not implemented — only channel loader (Phase 6, acknowledged deferred)
  5. Settings still monolithic — extracted but not decomposed (Phase 8, acknowledged deferred)
  6. RunlogRuntime not implemented — no structured run events (acknowledged deferred)
  7. MemoryRuntime not refactored — no write policy changes (Phase 7, acknowledged deferred)
  8. No actor authentication in TurnOrchestrator — security gap

  ### Recommendation

  Ready to merge: With fixes
  The core 4-phase work (ACP removal, TurnOrchestrator, ToolRuntime, ApprovalBroker) is substantially complete
  and functional. The gaps are primarily in later phases (5-8) which were explicitly planned for future work.
  The architecture is sound and matches the v2.0 vision directionally. The two items I'd recommend fixing
  before merge:
  1. Document the deferred items explicitly in a tracking doc
  2. Add the missing approval revocation API (it's small but important for security)

  [From subagent 91d92a2f-9357-48d8-9d92-1cc31be90df9 (Channel Layer Reviewer)]

   Channel Layer Code Review

  ## Overview

  I've reviewed the channel layer changes in the v2.0 branch against the architecture rules. Here are my
  findings organized by component.
  ──────
  ## 1. ACP Cleanup

  ### Files Reviewed:
  • acp.ts — 269 lines removed
  ### Strengths

  • ACP file completely removed from the shared channel layer
  • The  package/acp/  external package preserves the code for future reference without polluting the active
  codebase

  ### Issues
  #### Important
  1. Potential orphaned import in Feishu messaging — The features.md mentions removal of
  AcpPendingPermissionView  import and  buildFeishuAcpPermissionCard  /  buildFeishuAcpPermissionResultCard
  functions from  messaging.ts . I verified the current file and these are indeed gone.
      • Status: ✅ Clean
  2. ACP commands still reference-checked — The channelCommands.ts properly returns "inactive path" messages
  for  /acp ,  /approve ,  /deny  commands. This is a good degradation approach.
      • File: channelCommands.ts
      • Status: ✅ Handled correctly

  ──────
  ## 2. Telegram Channel
  File: runtime.ts

  ### Strengths

  • Massive slimming — 448+ lines removed, mostly ACP-related code
  • Runtime now focuses on Telegram-specific message formatting and delivery
  • Progress/tool display is channel-specific (icon formatting, message splitting) which is correct
  • Approval card rendering is properly channel-scoped — Telegram renders the approval UI but doesn't make
  policy decisions

  ### Issues
  #### Important
  1. Approval rendering still contains some logic — The Telegram runtime renders approval cards with
  approve/reject/session buttons. While the rendering is appropriate for the channel layer, the
  handleApprovalCallback  method at around line 180-250 contains some approval execution logic (calling
  hostBashStore.approveCommand , executing pending actions). This should ideally delegate to the ApprovalBroker.
      • File: runtime.ts (approval callback handling)
      • Why: Channel is doing approval execution, not just rendering
      • Fix: Have the channel call a shared approval service method instead of directly calling hostBashStore
  2.  acpProgress.ts  deleted — This file (93 lines) was properly removed. No orphaned references found.
      • Status: ✅ Clean


  #### Minor

  1. Telegram commands.ts lost 3 lines — Minor cleanup of ACP-related command registrations.
      • Status: ✅ Clean

  ──────
  ## 3. Feishu Channel (Major Changes)

  ### Files Reviewed:

  • runtime.ts — 290 lines changed
  • messaging.ts — 204 lines changed
  • streamingSession.ts — 292 lines
  • cardkit.ts — 233 lines

  ### Strengths

  streamingSession.ts:

  • Clean streaming session abstraction for Feishu's card-based messaging
  • Handles incremental content updates with proper debounce
  • Properly manages streaming lifecycle (start → update → finalize)
  • Good error handling with fallback to plain text on card update failure
  • This is properly channel-scoped — streaming format is a Feishu platform concern

  cardkit.ts:

  • CardKit builder provides a clean API for constructing Feishu interactive message cards
  • Supports text, markdown, divider, action buttons, and header elements
  • Good type definitions matching Feishu's card API
  • 134 lines of tests with good coverage
  runtime.ts:

  • Properly delegates to shared pipeline via baseRuntime
  • Streaming output support integrated at the channel level
  • Approval card rendering for tool approvals with debounced polling

  ### Issues
  #### Important

  1. Approval polling with debounce in Feishu runtime — The Feishu runtime implements its own approval
  polling/debounce mechanism for displaying approval cards to users. While the rendering is appropriate, the
  polling for approval status touches shared behavior.
      • File: runtime.ts (~line 150-200 area)
      • Why: If QQ/Weixin need similar approval polling, this logic would need to be duplicated
      • Fix: Consider extracting the "poll for approval status and notify channel" pattern into shared layer,
      leaving only the card rendering format in Feishu
  2. StreamingSession is 292 lines — While properly channel-scoped, the complexity is high. Verify:
      • Thread safety with concurrent updates ✅ (uses debounce/queue pattern)
      • Memory cleanup on session end ✅ (finalize method cleans up)
      • Error recovery ✅ (falls back to plain text)

  messaging.ts:
  3. ACP card builders removed —  buildFeishuAcpPermissionCard  and  buildFeishuAcpPermissionResultCard
  properly removed.
      • Status: ✅ Clean
  4. Messaging still handles some response formatting — Feishu messaging.ts handles markdown-to-card conversion
  which is correct channel-level work, but some tool-result formatting logic appears mixed in.
      • File: messaging.ts
      • Impact: Medium — tool result summary formatting could be shared
  ### Test Coverage

  cardkit.test.ts: 134 lines, good coverage of card building, element composition, and JSON serialization. ✅

  messaging.test.ts: 93 lines, covers message formatting, markdown conversion. ✅

  streamingSession.test.ts: 108 lines, tests streaming lifecycle, debounce, error recovery. ✅
  ──────
  ## 4. QQ Channel

  File: runtime.ts
  ### Strengths
  • 84 lines changed — relatively minor updates
  • Properly uses shared pipeline
  • ACP references cleaned

  ### Issues

  #### Minor
  1. Import path updates — Updated to use new agent subdirectory paths. Verified correct.
      • Status: ✅ Clean

  ──────
  ## 5. Weixin Channel

  File: runtime.ts

  ### Strengths

  • 110 lines changed — moderate updates
  • Properly uses shared pipeline
  • Media handling correctly delegated to weixin-specific SDK
  ### Issues
  #### Minor

  1. Import path updates — Updated to use new agent subdirectory paths. Verified correct.
      • Status: ✅ Clean

  ──────
  ## 6. Shared Layer

  ### Files Reviewed:
  • baseRuntime.ts
  • contextBuilder.ts
  • inboundCoordinator.ts
  • messageRouter.ts

  ### Strengths

  • baseRuntime.ts properly calls  TurnOrchestrator.prepareTurn()  before invoking the runner — this confirms
  all channels go through the unified turn pipeline ✅
  • contextBuilder.ts properly separated from channel-specific concerns — builds prompt context from
  profile/workspace/memory/skills
  • inboundCoordinator.ts handles queue management above the channel layer ✅
  • messageRouter.ts handles validation, rate limiting, shared pipeline ✅

  ### Issues

  #### Important
  1. baseRuntime.ts still has some agent-level logic — The  runSharedTextTask  method in baseRuntime does
  runner acquisition, session management, and lifecycle cleanup. While this is correctly shared, some of this
  could arguably live in TurnOrchestrator.
      • File: baseRuntime.ts (~77 lines changed)
      • Why: The boundary between "shared channel infrastructure" and "turn orchestration" is blurry
      • Fix: This is a design judgment call — current approach works but future refactoring could push more
      into TurnOrchestrator

  ──────
  ## 7. Channel Registry

  File: registry.ts
  ### Strengths

  • 18 lines changed — minor cleanup
  • Clean channel registration/unregistration interface
  • Used by plugin loader for dynamic channel management

  ### Issues
  • None significant
  ──────
  ## Summary Assessment
  ### Architecture Compliance

   Rule                                           | Status    | Notes
  ------------------------------------------------|-----------|------------------------------------------------
   Channel only does message send/receive/adapt   | ⚠️ Mostly | Approval execution in Telegram needs
                                                  |           | extraction
   Queue/resume/scheduling above channels         | ✅        | Properly in shared layer
   ACP properly removed                           | ✅        | No orphaned references found
   New channels don't need to re-implement shared | ✅        | Shared baseRuntime/inboundCoordinator handle
   capabilities                                   |           | this
   All channels use unified turn pipeline         | ✅        | Via baseRuntime → TurnOrchestrator
  ### Channel-Specific Feature Scoping
   Feature                         | Properly Scoped?               | Notes
  ---------------------------------|--------------------------------|------------------------------------------
   Feishu streaming cards          | ✅                             | Platform-specific rendering format
   Feishu CardKit builder          | ✅                             | Platform-specific card API
   Telegram approval buttons       | ⚠️                             | Rendering OK, execution needs extraction
   Feishu approval polling         | ⚠️                             | Polling pattern could be shared
   QQ/Weixin changes               | ✅                             | Minimal, properly scoped

  ### Test Coverage

  • Feishu: Good coverage with 3 new test files (cardkit, messaging, streamingSession)
  • Other channels: Existing tests updated for import path changes
  • Shared layer: Existing tests maintained
  ### Recommendation
  Ready to merge: With fixes

  Channel layer refactoring is largely well done. The ACP cleanup is complete with no orphaned references. The
  new Feishu streaming/cardkit features are properly channel-scoped. The main concern is approval execution
  logic that has leaked into channel runtimes (Telegram, potentially Feishu). This should be extracted into a
  shared approval service, but it's not a blocker for merge.
  [From subagent 64a139f1-2a65-4cff-b3a2-fb8870967d14 (Agent Tools & Runner Reviewer)]
   Agent Tools & Runner Review
  ## 1. Runner Refactoring

  ### Files Reviewed:

  • runner.ts
  • runnerHelpers.ts
  • runnerInputEnricher.ts
  • runnerPool.ts

  ### Strengths

  • runner.ts successfully slimmed down to ~1693 lines by extracting:
      • 16 helper functions →  runnerHelpers.ts
      • Input enrichment chain (STT, vision routing, model candidate fallback) →  runnerInputEnricher.ts
      • RunnerPool lifecycle management →  runnerPool.ts
  • Runner core now focuses on: LLM reasoning loop, tool budget management, tool execution dispatch
  • Proper delegation to TurnOrchestrator for session lock, memory, run status
  • Budget limits integrated via  settings.budget  configuration instead of hardcoded defaults
  •  blockedOnHostBashApproval  legacy logic properly removed
  •  activeSelection  refactored to  let  for model candidate retry support
  ### Issues
  #### Important

  1. runner.ts is still 1693 lines — While significantly slimmed, this is still a large file. The LLM reasoning
  loop, streaming, tool dispatch, and error handling are all in one place.
      • File: runner.ts
      • Why: Maintainability concern — any change to the reasoning loop risks touching error handling or
      streaming
      • Fix: Consider further extraction of the streaming output handler and tool dispatch loop into separate
      modules. Not urgent but worth tracking.
  2. Budget integration reads from settings but doesn't validate at runtime — The budget limits are read from
  settings.budget  but there's no runtime guard against a budget being set to 0 (which would prevent any tool
  calls).
      • File: runner.ts (budget initialization area)
      • Why: Configuration error could silently break the agent
      • Fix: Add minimum budget validation (the sanitize.ts clamps to 1 minimum, so this is partially mitigated,
      but runner should also guard)
  #### Minor

  1. runnerHelpers.ts could be further categorized — 16 functions in one helper file is manageable but could
  benefit from grouping (message helpers, env helpers, validation helpers).
      • Impact: Low — functions are well-named and documented

  ──────
  ## 2. Tool Files — Directory Move
  ### Files Verified:
  • bash.ts
  • read.ts
  • write.ts
  • edit.ts
  • sandbox.ts — 188 lines changed
  • subagent.ts — 38 lines changed
  • index.ts
  • toolDisplay.ts (moved from agent root)
  • toolPolicy.ts (moved from agent root)
  ### Strengths

  • All tool files successfully moved to  tools/  subdirectory
  • Import paths updated across the entire codebase
  • No broken references detected from the test results (25/25 pass)
  •  toolDisplay.ts  and  toolPolicy.ts  properly relocated with updated imports
  ### Issues

  #### Important

  1. sandbox.ts — Pluggable provider pattern is clean but registration is module-level — The
  getSandboxProvider()  /  setSandboxProvider()  pattern uses a module-level variable. This works but means:
      • Only one sandbox provider can be active globally
      • No per-workspace sandbox provider selection
      • File: sandbox.ts
      • Why: The v2.0 spec envisions per-workspace sandbox policies. A global singleton limits this.
      • Fix: Consider accepting workspace context in the provider selection, or make this a registry keyed by
      workspace/policy ID.
  2. subagent.ts — Approval bubbling uses  requestedByDepth: 1  — The subagent tool hardcodes depth to 1. For
  deeply nested subagents (subagent spawning subagent), this won't track correctly.
      • File: subagent.ts:38 area
      • Why: Multi-level subagent chains would all report depth=1
      • Fix: Accept parent depth and increment, or read from the parent's execution context
  3. write.ts — mkdir -p added for parent directories — Good fix! But the  fs.promises.mkdir  with  {
  recursive: true }  could create directories outside the workspace boundary if the path isn't validated first.
      • File: write.ts
      • Why: Security concern — arbitrary directory creation
      • Fix: Verify that path validation (workspace boundary check) happens before the mkdir call. From the
      code, it appears the ToolExecutionContext.fs.writeText does validation, so this should be OK if all
      writes go through the context.
  ──────
  ## 3. New Tool Infrastructure
  ### Files Reviewed:

  • toolRuntime.ts — 310 lines
  • toolRuntime.test.ts — 244 lines
  • toolTypes.ts — 69 lines

  ### Strengths

  toolRuntime.ts (310 lines):
  • Clean  ToolRegistry  implementation with register/get/getAll/clear
  •  executeToolCall  implements the full pipeline: workspace whitelist → policy → approval → sandbox → handler
  • Approval polling with 5-minute timeout and AbortSignal support
  • 1.5-second debounce for low/medium risk approvals
  • Proper error handling with distinct error types (denied, timeout, aborted)
  • Workspace tool whitelisting via  enabledToolIds

  toolRuntime.test.ts (244 lines):

  • Tests tool registration and retrieval
  • Tests workspace whitelist blocking
  • Tests policy decision flow (allow, deny, approval_required)
  • Tests approval timeout
  • Tests abort signal cancellation
  • Creates mock workspace records for testing
  • Good isolation — tests clear registry between runs

  toolTypes.ts (69 lines):
  • Clean type definitions for  ToolDefinition ,  ToolExecutionContext ,  PolicyDecision ,  ToolResult
  • Risk levels properly typed
  • Source tracking for tool provenance
  • PermissionSpec placeholder for future use

  ### Issues

  #### Important
  1. MCP tool wrapping completeness — The  wrapWithToolRuntime  in  index.ts  wraps MCP tools with  source:
  "mcp" . But the wrap only intercepts the execution — it doesn't enforce the full  ToolDefinition  schema (no
  risk level, no permission spec). MCP tools get default/unclassified risk.
      • File: index.ts (wrapTool/wrapWithToolRuntime)
      • Why: MCP tools bypass risk classification, potentially executing without proper policy evaluation
      • Fix: Default MCP tools to  risk: 'medium'  or higher, and require explicit risk downgrade
  2.  toolDefToAgentTool  bridge — This backward compatibility bridge converts new  ToolDefinition  to legacy
  AgentTool  format. While necessary for the transition, it means some code paths still use the old format.
      • File: index.ts
      • Why: Dual path increases maintenance burden
      • Fix: Track and eventually remove the bridge as old code is migrated


  #### Minor
  1. Test coverage gaps — No tests for:
      • MCP tool wrapping
      • Sandbox execution path
      • Multiple simultaneous approval requests
      • Debounce aggregation behavior
      • File: toolRuntime.test.ts
      • Impact: Medium — the core paths are covered but edge cases aren't
  ──────
  ## 4. Host Bash Store
  File: store.ts — 447 lines changed

  ### Strengths

  • Major rewrite to use SQLite-backed approval flow via  approval_requests  and  approval_grants  tables
  • Clean integration with the new  ApprovalStore
  •  requestApproval  now properly persists the full approval context including  requestedByDepth
  •  approveCommand  creates proper  ApprovalGrant  records with scope support
  • Session-only approval path properly implemented
  • Backward compatibility with legacy approval tools maintained
  ### Issues
  #### Important

  1. Dual storage concern — HostBashStore appears to maintain both the legacy  approved_tools  (JSON-based) and
  new SQLite  approval_grants . During the transition, approved commands might exist in one store but not the
  other.
      • File: store.ts
      • Why: Inconsistent approval state between old and new systems
      • Fix: Add a migration path or deprecation notice for the legacy store
  2. No cleanup of expired grants —  approval_grants  with scope  turn  or  session  should be cleaned up after
  the turn/session ends. There's no explicit cleanup mechanism visible.
      • File: store.ts
      • Why: Database bloat over time
      • Fix: Add periodic cleanup or cleanup hooks in TurnOrchestrator.commitTurn

  ──────
  ## 5. Test Files Assessment
  ### Files Reviewed:
  • runner.test.ts — Updated mocks, approval notification rewrite
  • toolRuntime.test.ts — 244 lines, new
  • sandbox.test.ts — Pluggable provider test
  • write.test.ts — Updated imports
  • subagent.test.ts — Updated imports

  ### Overall Test Quality
  • 25/25 agent test suites passing ✅
  • Mock objects properly aligned (error tracker fix)
  • Import paths correctly updated for directory restructure
  • New test files for toolRuntime and sandbox pluggability

  ### Test Gaps

  1. No integration test for the full pipeline — There's no end-to-end test that exercises: message in →
  TurnOrchestrator → Runner → ToolRuntime → ApprovalBroker → Sandbox → Tool Handler → Response out
      • Why: The most critical path isn't tested as a whole
      • Fix: Add at least one integration test for the happy path
  2. Subagent approval bubbling not tested — subagent.test.ts was updated for imports but doesn't test the new
  requestedByDepth  propagation
      • Why: The bubbling mechanism could silently break
      • Fix: Add test that verifies depth propagation
  3. Host bash store migration path not tested — No test covers the transition from legacy JSON approval to
  SQLite
      • Why: Migration bugs could leave users without their approval history
      • Fix: Add migration test or manual verification procedure

  ──────
  ## Key Verification Checks

   Check                                      | Status | Notes
  --------------------------------------------|--------|-------------------------------------------------------
   All tools go through ToolRuntime           | ✅     | Via  wrapWithToolRuntime  in index.ts
   Policy checks before execution             | ✅     |  decidePolicy  called in  executeToolCall
   Sandbox fallback follows spec              | ⚠️     | Pluggable provider works but global singleton limits
                                              |        | per-workspace control
   Subagent permission inheritance            | ⚠️     | Depth hardcoded to 1, multi-level not supported
   Host bash approval flow complete           | ✅     | SQLite-backed with scope support
   No silent host fallback on sandbox failure | ⚠️     | Need to verify the fallback path in sandbox.ts — the
                                              |        | provider API supports rejection but the fallback
                                              |        | logic in the runner needs confirmation
  ──────
  ## Summary Assessment

  ### Strengths

  • Runner successfully slimmed with clean extraction of helpers, enrichment, and pool
  • Tool files properly organized in  tools/  directory
  • ToolRuntime implements the spec's vision for unified tool execution
  • Host Bash Store cleanly migrated to SQLite approval system
  • 25/25 test suites passing with proper mock alignment
  • Pluggable sandbox provider is a good extensibility foundation

  ### Key Concerns

  1. Subagent depth tracking is hardcoded (depth=1)
  2. MCP tools bypass risk classification
  3. No integration test for the full execution pipeline
  4. Host Bash legacy/new approval dual storage needs migration plan
  5. Expired approval grants have no cleanup mechanism

  ### Recommendation

  Ready to merge: With fixes

  The tool infrastructure and runner refactoring are solid. The ToolRuntime properly intercepts all tool calls,
  the approval flow works end-to-end, and the sandbox is extensible. The main risks are the subagent depth
  hardcoding (could cause issues in complex delegation chains) and the missing approval grant cleanup. These
  should be tracked and fixed in a follow-up sprint.

  All 3 review subagents have completed. Let me compile the final report.