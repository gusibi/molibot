# Agent/Subagent Sandbox Research

Date: 2026-05-25

## Purpose

Molibot already has a first version of agent/subagent sandboxing. This document turns that baseline into a product direction by looking at users, competitors, boundaries, durable data structures, page interactions, and acceptance criteria.

This is a planning and research document only. It does not prescribe code changes yet.

## Assumptions

- The current first version covers main Agent `bash` and built-in subagent `bash`.
- Browser, Computer Use, ACP, MCP, and channel delivery are intentionally outside the first sandbox boundary.
- Channel adapters should stay responsible only for platform I/O and message normalization. Queueing, approvals, subagent progress, sandbox policy, recovery, and run orchestration belong in shared runtime layers.
- Temporary runtime controls, user-facing explanations, and persistent debugging records must remain separated.

## Current Molibot Baseline

Molibot already has:

- Built-in delegated roles: `scout`, `planner`, `worker`, `reviewer`, and `skill-drafter`.
- Abstract subagent model levels: `haiku`, `sonnet`, `opus`, and `thinking`, resolved through configured model routes instead of concrete vendor IDs.
- Shared subagent lifecycle events surfaced across Web, Telegram, Feishu, Weixin, QQ, and run traces.
- Sandbox settings for Agent/subagent `bash`: env handling, network allow/deny, filesystem deny/allow, diagnostics, and soft-disable behavior.
- Host Bash approval records and whitelist in SQLite, with persistent, one-time, and current-session approval modes.
- `/settings/sandbox`, `/settings/host-bash`, `/settings/agents`, and live run diagnostics as the current operator surfaces.

Main gaps:

- No explicit policy profile layer. Operators see low-level toggles, but not task-oriented modes.
- No checkpoint/recovery concept tied to delegated runs.
- Subagent run data is visible, but not yet shaped as an operator-first "run ledger" with inputs, policy, approvals, artifacts, and recovery state.
- Sandbox diagnostics are per current runtime state, not longitudinal evidence for each run.
- The system can pause for approval, but does not yet make "what will happen after approval" obvious enough for non-technical operators.

## Users

### 1. Solo Builder Operator

They use Molibot as a personal multi-channel agent. They want stronger autonomy without giving an agent unrestricted machine access.

Jobs:

- Let the agent inspect, edit, test, and produce artifacts while staying inside a predictable workspace.
- Approve occasional host access without repeating the same decision every minute.
- Understand why a run paused and what will happen after approval.
- Recover when an agent changed too much or generated the wrong artifact.

### 2. Small-Team Maintainer

They use Molibot with shared bots, multiple channels, and team-visible runs.

Jobs:

- Know which bot/session/subagent requested host access.
- Audit who approved what, when, and for which scope.
- Keep channel behavior consistent while adding or changing channels.
- Review delegated work without reading every raw tool log.

### 3. Power User / Workflow Author

They create repeatable skills, scheduled workflows, and subagent roles.

Jobs:

- Route cheap models to scouting/drafting and stronger models to implementation/review.
- Define safe task modes for read-only research, workspace edits, and host-assisted commands.
- Keep generated artifacts in predictable directories.
- Inspect failed delegated runs and tune instructions or sandbox policy.

### 4. Security-Conscious Operator

They are willing to trade speed for control.

Jobs:

- Deny direct reads of secret files and env files.
- Restrict network egress to known package registries or internal services.
- Keep MCP/browser/desktop surfaces explicit instead of pretending one shell sandbox controls everything.
- Export or inspect audit records for approvals and run outcomes.

## Competitor Research

### Claude Code

Relevant pattern: subagents are first-class Markdown files with YAML frontmatter. They define `name`, `description`, tool access, model, permission mode, skills, MCP servers, hooks, memory scope, background behavior, and optional worktree isolation. Claude Code also exposes lifecycle hooks such as `SubagentStart` and `SubagentStop`.

Sources:

- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/hooks

What Molibot should learn:

- Keep subagents file-backed and inspectable.
- Add explicit tool allow/deny and permission mode concepts to subagent inventory.
- Consider isolated worktree-style execution later, but not before run recovery is designed.
- Surface subagent lifecycle as structured events, not ordinary chat text.

What not to copy yet:

- Full user-defined subagent editing in V1. Molibot should first stabilize built-in roles, run ledger, and policy profiles.

### OpenAI Codex CLI / Cloud Tasks

Relevant pattern: sandbox policy and approval policy are separate. Codex-style modes distinguish read-only, workspace-write, and full access, while approvals can be on-request, on-failure, session-level, persistent policy, or never. The CLI also treats sandbox escalation as an explicit user decision.

Sources:

- https://developers.openai.com/codex/cli
- https://openai-codex.mintlify.app/concepts/sandboxing
- https://www.mintlify.com/openai/codex/concepts/approvals

What Molibot should learn:

- Separate "what the sandbox permits" from "when the user is asked".
- Keep session-only approvals short-lived and scoped to the current chat/session.
- Make approval prompts show command, cwd/scope, reason, and proposed future effect.
- Add named policies for common risk profiles.

What not to copy blindly:

- A generic "danger full access" UI as a normal happy path. Molibot is multi-channel and local-first; broad host access must remain exceptional and auditable.

### GitHub Copilot Cloud Agent

Relevant pattern: autonomous tasks run in a GitHub Actions-powered ephemeral environment, create branches/PRs, support custom agents, and use firewall controls for internet access. It emphasizes transparency through branch/commit/PR workflow and logs.

Sources:

- https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall

What Molibot should learn:

- Background work needs a visible lifecycle and review artifact.
- Custom agent profiles need scope: repo/project, org/global, or enterprise-like managed policy.
- Network controls need clear limitations; firewall/sandbox coverage must state which tools are not covered.

What not to copy:

- PR-first workflow as the only output. Molibot also handles chat, reminders, files, skills, and personal workflows, so PRs are only one possible artifact.

### Replit Agent

Relevant pattern: checkpoints and rollbacks capture complete project state, AI conversation context, environment configuration, memory, and optionally databases. Agent checkpoints appear in history and Git integration, with rollback/roll-forward flows.

Sources:

- https://docs.replit.com/references/version-control/checkpoints-and-rollbacks
- https://docs.replit.com/learn/build-with-agent
- https://docs.replit.com/core-concepts/project-editor/app-setup/secrets

What Molibot should learn:

- Recovery is part of the product, not a nice-to-have.
- Each meaningful run should create a concise checkpoint summary or at least a recoverable run boundary.
- UI should help the user decide between fix-forward and rollback.

What not to copy:

- Full database rollback in the near term. Molibot should start with workspace artifact/session/run metadata recovery before touching external databases.

### Devin

Relevant pattern: environment readiness is treated as the highest-leverage setup. Declarative blueprints build VM snapshots; every session starts from a known-good state. Blueprints include install/setup steps and lightweight knowledge such as lint/test/build commands.

Sources:

- https://docs.devin.ai/onboard-devin/environment
- https://docs.devin.ai/onboard-devin/environment/blueprints
- https://docs.devin.ai/enterprise/environment-management/overview

What Molibot should learn:

- "Sandbox" is not enough; the agent also needs a prepared environment.
- Snapshot/build status is operator-facing product state.
- Store project command knowledge separately from ordinary chat memory.

What not to copy:

- Enterprise blueprint hierarchy immediately. Molibot can start with global profile + bot/workspace policy profiles.

### OpenHands

Relevant pattern: the default and recommended local isolation is Docker sandbox; process mode exists but is explicitly unsafe; remote sandbox supports hosted deployments.

Sources:

- https://docs.openhands.dev/openhands/usage/runtimes/overview
- https://docs.openhands.dev/openhands/usage/runtimes/docker
- https://docs.all-hands.dev/

What Molibot should learn:

- Make sandbox provider explicit: OS sandbox today, Docker/remote provider later.
- Label unsafe modes directly.
- Support workspace mounts deliberately.

What not to copy:

- Docker-only architecture. Molibot's current OS sandbox and local multi-channel runtime are useful; Docker should be an additional provider, not a rewrite.

### Cursor

Relevant pattern: modes map user intent to tool access. Ask is read-only, Agent can explore/edit/run commands, Manual is focused direct editing, and Custom modes let users configure capabilities.

Sources:

- https://docs.cursor.com/chat/overview
- https://docs.cursor.com/agent
- https://docs.cursor.com/cli/reference/permissions

What Molibot should learn:

- Users understand task modes better than raw policy toggles.
- Read-only exploration is a distinct, valuable mode.
- Custom modes should be presented as combinations of tools and instructions, not only raw JSON.

## Recommended Product Boundary

### P0: Stabilize and Explain the First Version

Keep scope narrow:

- Main Agent `bash` and built-in subagent `bash` are sandbox-covered.
- Host Bash approval remains operator-controlled.
- Existing channels consume shared events; no channel gets custom sandbox logic.
- Settings pages are operator control surfaces, not places where the agent approves itself.

Add clarity:

- State coverage and non-coverage directly in UI and docs.
- Make every approval prompt say whether it is persistent, one-time, or session-only.
- Store enough run metadata to reconstruct why a sandbox/approval decision happened.

### P1: Policy Profiles and Run Ledger

Add a higher-level operator model:

- `Observe`: read-only inspection, no writes, no host fallback.
- `Build`: workspace writes allowed, controlled network, approvals on failure.
- `Strict`: deny network by default, approvals on request, stronger secret guards.
- `Host-Assisted`: workspace build mode plus explicit Host Bash approval path.

The profile expands into low-level sandbox settings, but the UI keeps the profile visible.

Add a run ledger:

- Parent run and subagent runs share a run tree.
- Each run records effective sandbox profile, model route, tool set, approvals, artifacts, diagnostics, and terminal state.
- Long raw logs remain in run detail files or database rows; chat receives summaries.

### P2: Recovery and Checkpoints

Add safety net before broadening autonomy:

- Create run-level checkpoints around high-risk edit/build/delegation phases.
- Store artifact manifests and changed-file summaries.
- Offer "compare current vs before run", "restore generated artifacts", and eventually "rollback workspace changes" where Git/workspace state supports it.

### P3: Provider Expansion

Only after P0-P2:

- Add Docker sandbox provider for stronger isolation and reproducible dependencies.
- Consider worktree isolation for implementation/reviewer subagents.
- Add managed/team policy scopes if Molibot moves toward multi-user/team deployment.

## Non-Goals

- Do not move queueing, approvals, recovery, or delegation into channel adapters.
- Do not persist approval cards, sandbox errors, or temporary "no tools" controls as normal assistant messages.
- Do not claim MCP, Browser, Computer Use, ACP, or channel delivery are protected by the shell sandbox.
- Do not create a generic "always allow host" mode as a default path.
- Do not add custom user-defined subagent creation before the built-in inventory, policy, run ledger, and recovery model are stable.
- Do not store machine-specific absolute paths in docs, prompts, defaults, or UI examples.

## Data Structures

These are target shapes, not current implementation requirements.

### Sandbox Policy Profile

```ts
interface SandboxPolicyProfile {
  id: string;
  name: string;
  description: string;
  scope: "global" | "agent" | "bot" | "chat";
  enabled: boolean;
  mode: "observe" | "build" | "strict" | "host-assisted" | "custom";
  appliesTo: {
    parentBash: boolean;
    builtInSubagentBash: boolean;
    mcp: false;
    browser: false;
    computerUse: false;
    acp: false;
  };
  sandbox: ToolSandboxSettings;
  approval: {
    defaultMode: "on-request" | "on-failure" | "never";
    allowSessionApproval: boolean;
    allowPersistentApproval: boolean;
    requireReason: boolean;
  };
  createdAt: string;
  updatedAt: string;
}
```

### Delegated Run Ledger

```ts
interface AgentRunRecord {
  id: string;
  parentRunId?: string;
  sessionId: string;
  channel: string;
  chatId: string;
  agentKind: "parent" | "subagent";
  subagentName?: string;
  taskPreview: string;
  modelRouteKey: string;
  policyProfileId: string;
  sandboxEffectiveHash: string;
  status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "aborted";
  stopReason?: "stop" | "error" | "aborted" | "waiting_for_approval";
  startedAt?: string;
  endedAt?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    cost: number;
  };
  summary?: string;
}
```

### Sandbox Decision Event

```ts
interface SandboxDecisionEvent {
  id: string;
  runId: string;
  toolCallId?: string;
  eventType:
    | "sandbox_applied"
    | "sandbox_disabled"
    | "sandbox_denied"
    | "host_approval_requested"
    | "host_approval_approved"
    | "host_approval_rejected"
    | "host_session_fallback_used";
  commandPreview?: string;
  cwdScope: "scratch" | "workspace" | "unknown";
  policyProfileId: string;
  diagnosticSummary?: string;
  createdAt: string;
}
```

### Artifact Manifest

```ts
interface RunArtifactManifest {
  runId: string;
  artifactDir: string;
  files: Array<{
    relativePath: string;
    kind: "text" | "image" | "html" | "json" | "binary" | "unknown";
    source: "parent" | "subagent" | "tool";
    subagentName?: string;
    sizeBytes?: number;
    createdAt: string;
    checksum?: string;
  }>;
}
```

### Checkpoint Boundary

```ts
interface RunCheckpoint {
  id: string;
  runId: string;
  type: "before_run" | "after_run" | "manual";
  summary: string;
  changedFiles: Array<{
    relativePath: string;
    changeType: "added" | "modified" | "deleted" | "unknown";
  }>;
  restorable: boolean;
  restoreStrategy: "git" | "artifact-manifest" | "manual";
  createdAt: string;
}
```

## Page Interactions

### `/settings/sandbox`

Goal: make policy understandable before raw controls.

Recommended structure:

1. Top summary: "Sandbox covers Agent bash and built-in subagent bash only."
2. Policy profile selector: Observe / Build / Strict / Host-Assisted / Custom.
3. Effective coverage matrix:
   - Parent bash: covered
   - Built-in subagent bash: covered
   - Browser / Computer Use / ACP / MCP / channel delivery: not covered, explicit host-access surfaces
4. Env section:
   - inherit mode
   - allowed keys
   - denied keys
   - `.env.sandbox.local` presence and missing key diagnostics
5. Filesystem/network section:
   - allow/deny lists
   - readable explanation of what common commands can or cannot do
6. Diagnostics section:
   - supported platform
   - dependency status
   - sandbox initialized
   - last run that used this policy

### `/settings/host-bash`

Goal: audit and manage, not approve silently.

Recommended additions:

- Pending table should show "approval consequence":
  - approve once: runs this exact pending command once
  - this session: runs this command and allows later sandbox-denied bash fallback in the same session
  - persistent: adds reusable command whitelist entry
- Add filter by channel/bot/session/subagent.
- Add detail drawer with original command, sanitized env keys, filesystem/network permission class, reason, and linked run id.
- Keep approval/rejection in chat unless a future explicit operator mode allows web approval.

### `/settings/agents`

Goal: make built-in subagents understandable and trustable.

Recommended additions:

- Show each built-in subagent's:
  - purpose
  - tool allowlist
  - model level and effective model
  - read/write capability class
  - sandbox policy profile
  - last 10 runs
- Do not allow editing built-in roles in P0/P1. Add "copy as custom" only after run ledger and policy profiles are stable.

### Web Live Run Diagnostics

Goal: make delegation visible without log spam.

Recommended run tree:

- Parent run row
- Nested subagent rows with status icons
- Each row shows model route, policy profile, elapsed time, tool count, and terminal reason
- Approval pause row clearly says:
  - what is waiting
  - who can approve
  - what happens after approval
  - which command/session will be affected

### Recovery / Checkpoints Page

Goal: make autonomy reversible.

First version:

- Show run list with changed files and artifact manifests.
- Allow downloading run detail and artifacts.
- Allow comparing generated artifacts from before/after where available.

Later:

- Git-backed rollback for workspace changes.
- Artifact-only restore for generated reports/files.
- Conversation/run replay for debugging, without injecting old temporary controls into model context.

## Acceptance Criteria

### P0: Documentation and UI Clarity

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| SS-P0-01 | Sandbox coverage is explicit | Settings and docs state that first-version sandbox covers only Agent/subagent `bash`, not Browser, Computer Use, ACP, MCP, or channel I/O. |
| SS-P0-02 | Approval modes are understandable | Every Host Bash approval prompt and audit row identifies persistent, one-time, or session-only behavior and the consequence of approving. |
| SS-P0-03 | Runtime context stays clean | Approval cards, sandbox raw errors, and temporary model controls are not persisted as ordinary assistant messages. |
| SS-P0-04 | Subagent usage is visible | Web and shared text channels show subagent start/end/task progress through shared runtime events. |
| SS-P0-05 | Diagnostics are safe | Sandbox diagnostics show keys, paths, statuses, and redacted summaries without exposing secret values. |

### P1: Policy Profiles and Run Ledger

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| SS-P1-01 | Named sandbox profiles | Operator can select Observe, Build, Strict, Host-Assisted, or Custom, and see the effective low-level policy. |
| SS-P1-02 | Run tree persistence | Parent and subagent runs are stored with parent/child relationships, model route, policy profile, status, usage, and summary. |
| SS-P1-03 | Approval linkage | Host Bash approval records link back to the run and tool call that requested them. |
| SS-P1-04 | Artifact manifest | Runs record generated artifacts under workspace-relative paths with source and basic file metadata. |
| SS-P1-05 | Channel neutrality | Adding a new channel does not require reimplementing sandbox policy, approval records, run ledger, or subagent lifecycle logic. |

### P2: Recovery

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| SS-P2-01 | Run checkpoints | High-risk edit/delegation runs create before/after checkpoint records with changed-file summaries. |
| SS-P2-02 | Review before rollback | UI shows what would be restored before any rollback or artifact restore action. |
| SS-P2-03 | Artifact recovery | Operator can restore or download generated artifacts without replaying the agent run. |
| SS-P2-04 | Fix-forward guidance | Failed runs expose concise failure cause, last approval/sandbox event, and suggested next operator action. |

## Open Questions

1. Should web approval be allowed in `/settings/host-bash`, or should approval remain chat-only for stronger user intent?
2. Should policy profile scope be global-only first, or immediately support agent/bot overrides?
3. Should "checkpoint" initially mean Git diff metadata only, or should Molibot copy changed generated artifacts into a restorable archive?
4. Should Docker sandbox be considered after policy profiles, or only after checkpoint/recovery exists?
5. How much custom subagent authoring should be allowed before the run ledger is complete?

## Recommended Next Step

Do not broaden host access yet. The next product step should be P0/P1: named policy profiles plus a run ledger that ties together parent runs, subagent runs, sandbox decisions, Host Bash approvals, model routing, and artifacts.

That gives Molibot the same trust-building foundation competitors converge on: clear modes, explicit approvals, visible delegation, audit trails, and recovery boundaries.
