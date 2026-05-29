# Agent v2.1 Main-Path Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the full Agent v2.1 simplification plan across all phases: finish Workspace, converge TurnOrchestrator, introduce ToolRuntime, add ApprovalScope, split settings gradually, and remove the remaining inactive ACP surfaces safely.

**Architecture:** Keep the existing Pi runner, channel runtimes, Memory, Skill, Plugin, Host Bash, and Sandbox modules, then add narrow boundary modules around the main path. Workspace owns context identity, TurnOrchestrator owns inbound turn setup and run identity, ToolRuntime owns tool execution policy and event wrapping, ApprovalScope extends existing Host Bash approvals without a full PolicyEngine, and Settings split migrates only high-risk dynamic data to SQLite while `settings.json` remains readable.

**Tech Stack:** TypeScript, SvelteKit server routes, Node `node:test`, `node:sqlite`, existing `MomRuntimeStore`, existing `RunnerPool`, existing `SessionStore`.

---

## Scope Check

This plan covers every v2.1 phase, but each phase remains independently shippable:

1. Finish Phase 1 workspace metadata and verification gaps.
2. Add TurnOrchestrator as an additive module, then migrate Web, shared IM runtimes, Telegram's custom path, and CLI in that order.
3. Add ToolRuntime as a thin wrapper around existing tool factories and route tool groups through it gradually.
4. Add ApprovalScope storage and map existing Host Bash approvals into scoped grants.
5. Split Workspace, Approval, plugin, and channel settings into SQLite without removing `settings.json` compatibility.
6. Remove or quarantine inactive ACP source/schema after verification proves no active runtime path imports it.

## File Structure

- Modify `src/lib/shared/types/message.ts`: add optional `workspaceId` on `Conversation`.
- Modify `src/lib/server/sessions/store.ts`: allow callers to stamp/update conversation `workspaceId` while preserving older session files.
- Create `src/lib/server/sessions/store.test.ts`: focused tests for workspace metadata persistence.
- Modify `src/lib/server/workspaces/store.test.ts`: cover `resolveWorkspaceId()` fallback and sanitized explicit ids.
- Modify `src/lib/server/agent/reviewData.test.ts` or create it if absent: verify run history parser preserves `workspaceId`.
- Create `src/lib/server/agent/turnOrchestrator.ts`: small orchestration interface, run id helper, workspace/session resolution, and runner invocation wrapper.
- Create `src/lib/server/agent/turnOrchestrator.test.ts`: unit tests with fake sessions and fake runners.
- Modify `src/routes/api/chat/+server.ts`: move Web conversation/session/run setup onto TurnOrchestrator while retaining request parsing, attachments, diagnostics, and response wiring.
- Modify `src/routes/api/stream/+server.ts`: use the same TurnOrchestrator for Web streaming route setup.
- Modify `src/lib/server/channels/shared/baseRuntime.ts`: call TurnOrchestrator from shared Feishu/QQ/Weixin-style text task execution.
- Modify `src/lib/server/channels/telegram/runtime.ts`: call TurnOrchestrator from Telegram's custom task path while preserving Telegram message edit/reply behavior.
- Modify `src/lib/server/channels/shared/messageRouter.ts` and `src/lib/server/adapters/cli.ts`: stamp CLI conversations with default workspace metadata; optionally move CLI to TurnOrchestrator only after Web and IM migration pass.
- Create `src/lib/server/agent/toolRuntime.ts`: shared tool execution wrapper, policy decision shape, run/session/workspace event metadata.
- Modify `src/lib/server/agent/tools/index.ts`: wrap existing tool factories through ToolRuntime without changing individual tool schemas first.
- Create `src/lib/server/agent/toolRuntime.test.ts`: policy and event wrapping tests.
- Create `src/lib/server/approvals/scope.ts`: `ApprovalScope` types and scope key helpers.
- Create `src/lib/server/approvals/store.ts`: SQLite-backed approval request/grant storage.
- Create `src/lib/server/approvals/store.test.ts`: storage tests for once/session/workspace/persistent grants.
- Modify `src/lib/server/hostBash/store.ts`: map existing Host Bash approval records into the new scoped grant model while preserving current chat approval UX.
- Modify `src/lib/server/settings/store.ts`: add migrated tables for approval settings, plugin settings, and channel settings.
- Create `src/lib/server/settings/dynamicStores.test.ts`: SQLite precedence and legacy fallback tests.
- Delete or quarantine `src/lib/server/acp/` and `src/routes/settings/acp/+page.svelte` only after import and config compatibility checks are green.
- Modify `docs/agent-v2.1-development-plan.md`: mark completed checklist items 24, 28, 29 after tests/smoke pass.
- Modify `features.md`, `prd.md`, `CHANGELOG.md`, `readme.md`: record delivered TurnOrchestrator first slice only after code and verification pass.

## Tasks

### Task 1: Close Workspace Resolver Test Coverage

**Files:**
- Modify: `src/lib/server/workspaces/store.test.ts`
- Verify: `src/lib/server/workspaces/store.ts`

- [ ] **Step 1: Extend the failing resolver tests**

Replace `src/lib/server/workspaces/store.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKSPACE_ID, WorkspaceStore, resolveWorkspaceId } from "./store.js";

test("workspace store creates a default personal workspace", () => {
  const store = new WorkspaceStore(":memory:");
  const workspace = store.ensureDefaultWorkspace();
  assert.equal(workspace.id, DEFAULT_WORKSPACE_ID);
  assert.equal(workspace.name, "Personal");
  assert.equal(workspace.memoryScope, "workspace");
});

test("resolveWorkspaceId returns explicit sanitized ids without touching the default store", () => {
  assert.equal(resolveWorkspaceId(" Client A "), "client-a");
  assert.equal(resolveWorkspaceId("TEAM_1"), "team_1");
});
```

- [ ] **Step 2: Run resolver tests**

Run:

```bash
node --import tsx --test src/lib/server/workspaces/store.test.ts
```

Expected: PASS with 2 tests. If the second test fails because `resolveWorkspaceId(" Client A ")` returns the original text, update `sanitizeId()` in `src/lib/server/workspaces/store.ts` only.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/workspaces/store.test.ts src/lib/server/workspaces/store.ts
git commit -m "test: cover workspace id resolution"
```

### Task 2: Persist Workspace Id on Session Metadata

**Files:**
- Modify: `src/lib/shared/types/message.ts`
- Modify: `src/lib/server/sessions/store.ts`
- Create: `src/lib/server/sessions/store.test.ts`

- [ ] **Step 1: Write the failing session metadata test**

Create `src/lib/server/sessions/store.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("SessionStore preserves workspaceId on conversations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-session-store-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;

  try {
    const { SessionStore } = await import(`./store.js?workspace-session-${Date.now()}`);
    const store = new SessionStore();
    const first = store.getOrCreateConversation("web", "user-1", undefined, {
      workspaceId: "personal"
    });
    assert.equal(first.workspaceId, "personal");

    const second = store.getOrCreateConversation("web", "user-1", first.id, {
      workspaceId: "client-a"
    });
    assert.equal(second.id, first.id);
    assert.equal(second.workspaceId, "client-a");

    const listed = store.listConversations("web", "user-1");
    assert.equal(listed[0]?.workspaceId, "client-a");
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/sessions/store.test.ts
```

Expected: FAIL with a TypeScript/runtime error showing `workspaceId` is not part of `Conversation` or `getOrCreateConversation` does not accept the options argument.

- [ ] **Step 3: Add `workspaceId` to shared conversation type**

Modify `src/lib/shared/types/message.ts`:

```ts
export interface Conversation {
  id: string;
  channel: Channel;
  externalUserId: string;
  workspaceId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Add options to session creation and lookup**

Modify `src/lib/server/sessions/store.ts`:

```ts
interface ConversationOptions {
  workspaceId?: string;
}

function sanitizeWorkspaceId(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}
```

Change the private create signature and conversation object:

```ts
private createConversation(
  channel: Channel,
  externalUserId: string,
  options: ConversationOptions = {}
): Conversation {
  const now = new Date().toISOString();
  const id = uuidv4();
  const conversation: Conversation = {
    id,
    channel,
    externalUserId,
    workspaceId: sanitizeWorkspaceId(options.workspaceId),
    title: DEFAULT_SESSION_TITLE,
    createdAt: now,
    updatedAt: now
  };
```

Change `getOrCreateConversation` signature:

```ts
getOrCreateConversation(
  channel: Channel,
  externalUserId: string,
  conversationId?: string,
  options: ConversationOptions = {}
): Conversation {
```

When an existing conversation is found and `located` is available, update it:

```ts
const workspaceId = sanitizeWorkspaceId(options.workspaceId);
if (workspaceId) {
  located.file.conversation.workspaceId = workspaceId;
}
located.file.conversation.updatedAt = now;
```

Change the final create call:

```ts
return this.createConversation(channel, externalUserId, options);
```

Change `createWebConversation`:

```ts
createWebConversation(externalUserId: string, options: ConversationOptions = {}): Conversation {
  return this.createConversation("web", externalUserId, options);
}
```

- [ ] **Step 5: Run session metadata test**

Run:

```bash
node --import tsx --test src/lib/server/sessions/store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shared/types/message.ts src/lib/server/sessions/store.ts src/lib/server/sessions/store.test.ts
git commit -m "feat: persist workspace id on sessions"
```

### Task 3: Add Run Archive Workspace Smoke Coverage

**Files:**
- Create: `src/lib/server/agent/reviewData.test.ts`
- Verify: `src/lib/server/agent/reviewData.ts`

- [ ] **Step 1: Write parser smoke test**

Create `src/lib/server/agent/reviewData.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseRunHistoryLine } from "./reviewData.js";

test("parseRunHistoryLine preserves workspaceId from run summaries", () => {
  const parsed = parseRunHistoryLine(JSON.stringify({
    runId: "run-1",
    workspaceId: "personal",
    stopReason: "stop",
    durationMs: 12,
    finalText: "done",
    toolNames: [],
    failedToolNames: [],
    explicitSkillNames: [],
    usedFallbackModel: false,
    modelFailureSummaries: [],
    budget: { toolCalls: 0, toolFailures: 0, modelAttempts: 1 },
    budgetLimits: { maxToolCalls: 24, maxToolFailures: 3, maxModelAttempts: 3 }
  }));

  assert.equal(parsed?.workspaceId, "personal");
});
```

- [ ] **Step 2: Run test**

Run:

```bash
node --import tsx --test src/lib/server/agent/reviewData.test.ts
```

Expected: PASS. If it fails, add `workspaceId` to `parseRunSummaryLine()` return object in `src/lib/server/agent/reviewData.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/agent/reviewData.ts src/lib/server/agent/reviewData.test.ts
git commit -m "test: preserve workspace id in run history"
```

### Task 4: Add TurnOrchestrator Core Types and Run Id Helper

**Files:**
- Create: `src/lib/server/agent/turnOrchestrator.ts`
- Create: `src/lib/server/agent/turnOrchestrator.test.ts`

- [ ] **Step 1: Write failing TurnOrchestrator helper tests**

Create `src/lib/server/agent/turnOrchestrator.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildTurnRunId, normalizeTurnWorkspaceId } from "./turnOrchestrator.js";

test("buildTurnRunId is stable for channel session and message", () => {
  assert.equal(
    buildTurnRunId({
      chatId: "chat-1",
      sessionId: "session-1",
      messageId: 42
    }),
    "chat-1-session-1-42"
  );
});

test("normalizeTurnWorkspaceId falls back to personal", () => {
  assert.equal(normalizeTurnWorkspaceId(""), "personal");
  assert.equal(normalizeTurnWorkspaceId(" Client A "), "client-a");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/agent/turnOrchestrator.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create the additive orchestrator module**

Create `src/lib/server/agent/turnOrchestrator.ts`:

```ts
import type { Channel } from "../../shared/types/message.js";
import type { ChannelInboundMessage, MomContext, RunResult, RunnerLike } from "./types.js";
import { resolveWorkspaceId } from "../workspaces/store.js";

export interface TurnRunIdInput {
  chatId: string;
  sessionId: string;
  messageId: number;
}

export interface TurnRunnerBinding {
  runner: RunnerLike;
  workspaceDir: string;
  chatDir: string;
}

export interface TurnResponseSink {
  respond: MomContext["respond"];
  replaceMessage: MomContext["replaceMessage"];
  beginContinuationResponse?: MomContext["beginContinuationResponse"];
  respondInThread: MomContext["respondInThread"];
  setTyping: MomContext["setTyping"];
  setWorking: MomContext["setWorking"];
  deleteMessage: MomContext["deleteMessage"];
  uploadFile: MomContext["uploadFile"];
  onRunnerEvent?: MomContext["onRunnerEvent"];
}

export interface RunTurnInput {
  channel: Channel;
  message: ChannelInboundMessage;
  activeSessionId: string;
  thinkingLevelOverride?: MomContext["thinkingLevelOverride"];
  binding: TurnRunnerBinding;
  sink: TurnResponseSink;
}

export function normalizeTurnWorkspaceId(input?: string | null): string {
  return resolveWorkspaceId(input);
}

export function buildTurnRunId(input: TurnRunIdInput): string {
  return `${input.chatId}-${input.sessionId}-${input.messageId}`;
}

export async function runTurn(input: RunTurnInput): Promise<RunResult> {
  const workspaceId = normalizeTurnWorkspaceId(input.message.workspaceId);
  const message: ChannelInboundMessage & { runId?: string } = {
    ...input.message,
    workspaceId,
    sessionId: input.activeSessionId,
    runId: buildTurnRunId({
      chatId: input.message.chatId,
      sessionId: input.activeSessionId,
      messageId: input.message.messageId
    })
  };

  return input.binding.runner.run({
    channel: input.channel,
    workspaceDir: input.binding.workspaceDir,
    chatDir: input.binding.chatDir,
    thinkingLevelOverride: input.thinkingLevelOverride,
    message,
    respond: input.sink.respond,
    replaceMessage: input.sink.replaceMessage,
    beginContinuationResponse: input.sink.beginContinuationResponse,
    respondInThread: input.sink.respondInThread,
    setTyping: input.sink.setTyping,
    setWorking: input.sink.setWorking,
    deleteMessage: input.sink.deleteMessage,
    uploadFile: input.sink.uploadFile,
    onRunnerEvent: input.sink.onRunnerEvent
  });
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/turnOrchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/agent/turnOrchestrator.ts src/lib/server/agent/turnOrchestrator.test.ts
git commit -m "feat: add turn orchestrator core"
```

### Task 5: Test Runner Invocation Through TurnOrchestrator

**Files:**
- Modify: `src/lib/server/agent/turnOrchestrator.test.ts`
- Verify: `src/lib/server/agent/turnOrchestrator.ts`

- [ ] **Step 1: Add runner invocation test**

Append to `src/lib/server/agent/turnOrchestrator.test.ts`:

```ts
test("runTurn injects workspace session and run id before invoking the runner", async () => {
  let capturedMessage: any;
  const runner = {
    isRunning: () => false,
    abort: () => {},
    steer: () => false,
    followUp: () => false,
    run: async (ctx: any) => {
      capturedMessage = ctx.message;
      return {
        runId: ctx.message.runId,
        workspaceId: ctx.message.workspaceId,
        stopReason: "stop" as const
      };
    }
  };

  const result = await runTurn({
    channel: "web",
    activeSessionId: "session-1",
    binding: {
      runner,
      workspaceDir: "/tmp/workspace",
      chatDir: "/tmp/workspace/chat-1"
    },
    message: {
      chatId: "chat-1",
      chatType: "private",
      messageId: 42,
      userId: "user-1",
      text: "hello",
      ts: "2026-05-28T00:00:00.000Z",
      attachments: [],
      imageContents: []
    },
    sink: {
      respond: async () => {},
      replaceMessage: async () => {},
      respondInThread: async () => {},
      setTyping: async () => {},
      setWorking: async () => {},
      deleteMessage: async () => {},
      uploadFile: async () => {}
    }
  });

  assert.equal(capturedMessage.workspaceId, "personal");
  assert.equal(capturedMessage.sessionId, "session-1");
  assert.equal(capturedMessage.runId, "chat-1-session-1-42");
  assert.equal(result.runId, "chat-1-session-1-42");
  assert.equal(result.workspaceId, "personal");
});
```

- [ ] **Step 2: Run test**

Run:

```bash
node --import tsx --test src/lib/server/agent/turnOrchestrator.test.ts
```

Expected: PASS. If `runTurn` is not imported in the test, update the import line to:

```ts
import { buildTurnRunId, normalizeTurnWorkspaceId, runTurn } from "./turnOrchestrator.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/agent/turnOrchestrator.test.ts src/lib/server/agent/turnOrchestrator.ts
git commit -m "test: cover turn orchestrator runner invocation"
```

### Task 6: Route Web Chat POST Through TurnOrchestrator

**Files:**
- Modify: `src/routes/api/chat/+server.ts`
- Verify: `src/lib/server/agent/turnOrchestrator.ts`

- [ ] **Step 1: Import `runTurn`**

Add near the existing server imports in `src/routes/api/chat/+server.ts`:

```ts
import { runTurn } from "$lib/server/agent/turnOrchestrator";
```

- [ ] **Step 2: Stamp workspace id on Web conversation**

Change the call to `getOrCreateConversation`:

```ts
const conversation = runtime.sessions.getOrCreateConversation(
  "web",
  externalUserId,
  parsed.conversationId,
  { workspaceId }
);
```

- [ ] **Step 3: Replace direct `runner.run` with `runTurn`**

Replace the `const result = await runner.run({ ... })` block with:

```ts
const result = await runTurn({
  channel: "web",
  activeSessionId: conversation.id,
  workspaceId,
  binding: {
    runner,
    workspaceDir: store.getWorkspaceDir(),
    chatDir: store.getChatDir(externalUserId)
  },
  thinkingLevelOverride: parsed.thinkingLevel,
  message: {
    chatId: externalUserId,
    workspaceId,
    chatType: "private",
    messageId,
    userId: externalUserId,
    userName: parsed.userId,
    text: inboundText,
    ts,
    attachments,
    imageContents,
    sessionId: conversation.id
  },
  sink: {
    respond: async (text: string) => {
      if (typeof text === "string" && text.trim()) finalText = text;
    },
    replaceMessage: async (text: string) => {
      if (typeof text === "string") finalText = text;
    },
    beginContinuationResponse: async (partialText: string, notice: string) => {
      const finalized = [partialText.trim(), notice.trim()].filter(Boolean).join("\n\n");
      if (finalized) threadNotes.push(finalized);
      finalText = "";
    },
    respondInThread: async (text: string) => {
      if (typeof text === "string" && text.trim()) threadNotes.push(text.trim());
    },
    setTyping: async () => {},
    setWorking: async () => {},
    deleteMessage: async () => {},
    uploadFile: async () => {},
    onRunnerEvent: async (event) => {
      appendRunnerDiagnostic(event);
    }
  }
});
```

If TypeScript reports that `workspaceId` is not part of `RunTurnInput`, remove the `workspaceId,` line from this object; the message already carries it.

- [ ] **Step 4: Run targeted type check**

Run:

```bash
npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | rg "src/routes/api/chat|src/lib/server/agent/turnOrchestrator|src/lib/server/sessions/store|src/lib/shared/types/message"
```

Expected: no output. Existing unrelated project errors may still appear if the command is run without `rg`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/chat/+server.ts src/lib/server/agent/turnOrchestrator.ts src/lib/shared/types/message.ts src/lib/server/sessions/store.ts
git commit -m "feat: route web chat through turn orchestrator"
```

### Task 7: Route Web Streaming Through TurnOrchestrator

**Files:**
- Modify: `src/routes/api/stream/+server.ts`

- [ ] **Step 1: Import `runTurn`**

Add:

```ts
import { runTurn } from "$lib/server/agent/turnOrchestrator";
```

- [ ] **Step 2: Stamp workspace id on streaming conversation**

Change:

```ts
const conversation = runtime.sessions.getOrCreateConversation(
  "web",
  externalUserId,
  conversationId,
  { workspaceId }
);
```

- [ ] **Step 3: Replace direct runner invocation**

Inside the `ReadableStream` body, replace `const result = await runner.run({ ... })` with `const result = await runTurn({ ... })` using the same structure as Task 6. Preserve the existing streaming `sink` callbacks exactly:

```ts
const result = await runTurn({
  channel: "web",
  activeSessionId: conversation.id,
  binding: {
    runner,
    workspaceDir: store.getWorkspaceDir(),
    chatDir: store.getChatDir(externalUserId)
  },
  thinkingLevelOverride: thinkingLevel,
  message: {
    chatId: externalUserId,
    workspaceId,
    chatType: "private",
    messageId: Date.now(),
    userId: externalUserId,
    userName: userId,
    text: message,
    ts,
    attachments: [],
    imageContents: [],
    sessionId: conversation.id
  },
  sink: {
    respond: async (text, shouldLog = true) => {
      if (shouldLog) {
        finalText = finalText ? `${finalText}${text}` : text;
        writeEvent(controller, encoder, "token", { delta: text });
        return;
      }
      writeEvent(controller, encoder, "status", { text });
    },
    replaceMessage: async (text) => {
      finalText = text;
      writeEvent(controller, encoder, "replace", { text });
    },
    beginContinuationResponse: async (partialText, notice) => {
      const finalized = [partialText.trim(), notice.trim()].filter(Boolean).join("\n\n");
      if (finalized) {
        writeEvent(controller, encoder, "replace", { text: finalized });
      }
      finalText = "";
      writeEvent(controller, encoder, "continuation", { notice });
    },
    respondInThread: async (text) => {
      const trimmed = text.trim();
      if (trimmed) threadNotes.push(trimmed);
      writeEvent(controller, encoder, "thread_note", { text });
    },
    setTyping: async (isTyping) => {
      if (isTyping) {
        writeEvent(controller, encoder, "status", { text: "Thinking..." });
      }
    },
    setWorking: async (isWorking) => {
      writeEvent(controller, encoder, "working", { isWorking });
    },
    deleteMessage: async () => {
      writeEvent(controller, encoder, "deleted", { ok: true });
    },
    uploadFile: async () => {},
    onRunnerEvent: async (event) => {
      const diagnostic = buildRunnerDiagnostic(event);
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }
});
```

Then copy the existing event-specific `onRunnerEvent` body from the old route into this callback so `thinking_config`, `payload`, `runner_event`, and `assistant_message_event` behavior remains byte-for-byte equivalent.

- [ ] **Step 4: Run targeted type check**

Run:

```bash
npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | rg "src/routes/api/stream|src/lib/server/agent/turnOrchestrator|src/lib/server/sessions/store|src/lib/shared/types/message"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/stream/+server.ts src/lib/server/agent/turnOrchestrator.ts
git commit -m "feat: route web stream through turn orchestrator"
```

### Task 8: Verification and Documentation Closeout

**Files:**
- Modify: `docs/agent-v2.1-development-plan.md`
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`
- Modify: `readme.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --import tsx --test \
  src/lib/server/workspaces/store.test.ts \
  src/lib/server/sessions/store.test.ts \
  src/lib/server/agent/reviewData.test.ts \
  src/lib/server/agent/turnOrchestrator.test.ts
```

Expected: PASS for all listed tests.

- [ ] **Step 2: Run focused static check**

Run:

```bash
npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | rg "src/lib/server/workspaces|src/lib/server/sessions/store|src/lib/shared/types/message|src/lib/server/agent/(turnOrchestrator|reviewData|runner|types)|src/routes/api/(chat|stream)"
```

Expected: no output. If output contains only pre-existing files outside the listed paths, do not edit those unrelated files.

- [ ] **Step 3: Run build when filesystem writes are available**

Run:

```bash
npm run build
```

Expected: build succeeds. If the environment reports `EPERM` while writing `.svelte-kit/tsconfig.json`, record the permission failure in the final implementation note and run Step 2 as the minimum static verification.

- [ ] **Step 4: Update the v2.1 checklist**

In `docs/agent-v2.1-development-plan.md`, mark these complete:

```markdown
- [x] 24. Add workspace id to session metadata where the existing session store can support it safely.
- [x] 28. Add tests or smoke coverage that a new run records `workspaceId`.
- [x] 29. Verify Web chat runs under the default workspace.
```

Leave CLI verification unchecked unless an actual CLI smoke was run.

- [ ] **Step 5: Update docs**

Add a dated entry to `features.md`:

```markdown
### TurnOrchestrator first slice
- **Web 主路径收敛**: Web chat 和 streaming API 现在通过 additive `TurnOrchestrator` 统一 run id、workspace id、session id 与 runner invocation；现有 runner、tool、approval、channel 发送逻辑保持不变。
```

Add a dated entry to `CHANGELOG.md`:

```markdown
### TurnOrchestrator first slice
- **Web 入口接入 TurnOrchestrator**: Web chat / streaming 入口先迁移到轻量 orchestrator，统一 `workspaceId`、`sessionId`、`runId` 注入，为后续 CLI/IM 渐进迁移提供稳定接口。
```

Append to `prd.md` section `2.3 Agent v2.1 Simplification Plan`:

```markdown
- TurnOrchestrator 第一片只覆盖 Web chat / streaming 的入口编排，不改变 Runner、ToolRuntime、Host Bash、sandbox、subagent 或 IM channel 发送语义；CLI 和 IM 渠道迁移在 Web 验证稳定后再推进。
```

Add under README `Workspace Boundary` or a nearby Agent runtime section:

```markdown
- Web chat and streaming requests now pass through a lightweight TurnOrchestrator that standardizes `workspaceId`, `sessionId`, and `runId` before invoking the existing runner.
```

- [ ] **Step 6: Commit docs**

```bash
git add docs/agent-v2.1-development-plan.md features.md prd.md CHANGELOG.md readme.md
git commit -m "docs: record turn orchestrator first slice"
```

### Task 9: Migrate Shared IM Runtime to TurnOrchestrator

**Files:**
- Modify: `src/lib/server/channels/shared/baseRuntime.ts`
- Test: existing channel runtime tests under `src/lib/server/channels/*/*.test.ts`

- [ ] **Step 1: Import `runTurn`**

Add to `src/lib/server/channels/shared/baseRuntime.ts`:

```ts
import { runTurn } from "../../agent/turnOrchestrator.js";
```

- [ ] **Step 2: Replace the direct runner call**

Inside `runSharedTextTask()`, keep the existing `ctx = buildTextChannelContext(...)` construction, then replace:

```ts
const result = await runner.run(ctx);
```

with:

```ts
const result = await runTurn({
  channel: this.channelName as Channel,
  activeSessionId,
  binding: {
    runner,
    workspaceDir: this.workspaceDir,
    chatDir: this.store.getChatDir(scopeId)
  },
  thinkingLevelOverride: ctx.thinkingLevelOverride,
  message: event,
  sink: {
    respond: ctx.respond,
    replaceMessage: ctx.replaceMessage,
    beginContinuationResponse: ctx.beginContinuationResponse,
    respondInThread: ctx.respondInThread,
    setTyping: ctx.setTyping,
    setWorking: ctx.setWorking,
    deleteMessage: ctx.deleteMessage,
    uploadFile: ctx.uploadFile,
    onRunnerEvent: ctx.onRunnerEvent
  }
});
```

- [ ] **Step 3: Run focused static check**

Run:

```bash
npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | rg "src/lib/server/channels/shared/baseRuntime|src/lib/server/agent/turnOrchestrator"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/channels/shared/baseRuntime.ts src/lib/server/agent/turnOrchestrator.ts
git commit -m "feat: route shared channels through turn orchestrator"
```

### Task 10: Migrate Telegram Custom Runner Path

**Files:**
- Modify: `src/lib/server/channels/telegram/runtime.ts`
- Test: `src/lib/server/channels/telegram/runtime.test.ts`

- [ ] **Step 1: Add import**

Add:

```ts
import { runTurn } from "../../agent/turnOrchestrator.js";
```

- [ ] **Step 2: Replace Telegram direct runner invocation**

Find the existing direct call:

```ts
const result = await runner.run(ctx);
```

Replace only that call site with:

```ts
const result = await runTurn({
  channel: "telegram",
  activeSessionId,
  binding: {
    runner,
    workspaceDir: this.workspaceDir,
    chatDir: this.store.getChatDir(scopeId)
  },
  thinkingLevelOverride: ctx.thinkingLevelOverride,
  message: event,
  sink: {
    respond: ctx.respond,
    replaceMessage: ctx.replaceMessage,
    beginContinuationResponse: ctx.beginContinuationResponse,
    respondInThread: ctx.respondInThread,
    setTyping: ctx.setTyping,
    setWorking: ctx.setWorking,
    deleteMessage: ctx.deleteMessage,
    uploadFile: ctx.uploadFile,
    onRunnerEvent: ctx.onRunnerEvent
  }
});
```

Do not change Telegram-specific progress edits, reply threading, callback handling, or final answer persistence in this task.

- [ ] **Step 3: Run Telegram tests**

Run:

```bash
node --import tsx --test src/lib/server/channels/telegram/runtime.test.ts src/lib/server/channels/telegram/mentions.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/channels/telegram/runtime.ts
git commit -m "feat: route telegram runner through turn orchestrator"
```

### Task 11: Align CLI With Workspace Metadata

**Files:**
- Modify: `src/lib/shared/types/message.ts`
- Modify: `src/lib/server/channels/shared/messageRouter.ts`
- Modify: `src/lib/server/adapters/cli.ts`
- Test: create `src/lib/server/channels/shared/messageRouter.test.ts`

- [ ] **Step 1: Add workspaceId to `InboundMessage`**

Modify `src/lib/shared/types/message.ts`:

```ts
export interface InboundMessage {
  channel: Channel;
  externalUserId: string;
  workspaceId?: string;
  content: string;
  conversationId?: string;
}
```

- [ ] **Step 2: Stamp workspace on `MessageRouter` conversations**

In `src/lib/server/channels/shared/messageRouter.ts`, import:

```ts
import { resolveWorkspaceId } from "../../workspaces/store.js";
```

Then change `handle()` before `getOrCreateConversation()`:

```ts
const workspaceId = resolveWorkspaceId(input.workspaceId);
const conv = this.sessions.getOrCreateConversation(
  input.channel,
  input.externalUserId,
  input.conversationId,
  { workspaceId }
);
```

- [ ] **Step 3: Pass workspace from CLI**

In `src/lib/server/adapters/cli.ts`, import:

```ts
import { resolveWorkspaceId } from "../workspaces/store.js";
```

Then change the router call:

```ts
const result = await router.handle({
  channel: "cli",
  externalUserId: "local-user",
  workspaceId: resolveWorkspaceId(),
  content: input
});
```

- [ ] **Step 4: Write CLI metadata test**

Create `src/lib/server/channels/shared/messageRouter.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { MessageRouter } from "./messageRouter.js";

test("MessageRouter stamps workspaceId on CLI conversations", async () => {
  const conversations: any[] = [];
  const sessions = {
    getOrCreateConversation: (_channel: string, _user: string, _id?: string, options?: any) => {
      const conversation = {
        id: "conv-1",
        channel: "cli",
        externalUserId: "local-user",
        workspaceId: options?.workspaceId,
        title: "New Session",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      conversations.push(conversation);
      return conversation;
    },
    appendMessage: () => {},
    listMessages: () => []
  };
  const assistant = { reply: async () => "ok" };
  const memory = {
    add: async () => {},
    flush: async () => {},
    buildPromptContext: async () => ""
  };

  const router = new MessageRouter(sessions as any, assistant as any, memory as any);
  const result = await router.handle({
    channel: "cli",
    externalUserId: "local-user",
    workspaceId: "personal",
    content: "hello"
  });

  assert.equal(result.ok, true);
  assert.equal(conversations[0]?.workspaceId, "personal");
});
```

- [ ] **Step 5: Run test**

Run:

```bash
node --import tsx --test src/lib/server/channels/shared/messageRouter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shared/types/message.ts src/lib/server/channels/shared/messageRouter.ts src/lib/server/adapters/cli.ts src/lib/server/channels/shared/messageRouter.test.ts
git commit -m "feat: stamp workspace id on cli conversations"
```

### Task 12: Introduce ToolRuntime Boundary Without Rerouting Tools

**Files:**
- Create: `src/lib/server/agent/toolRuntime.ts`
- Create: `src/lib/server/agent/toolRuntime.test.ts`

- [ ] **Step 1: Write ToolRuntime tests**

Create `src/lib/server/agent/toolRuntime.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ToolRuntime } from "./toolRuntime.js";

test("ToolRuntime wraps tool execution with run metadata", async () => {
  const events: any[] = [];
  const runtime = new ToolRuntime({
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    emit: async (event) => {
      events.push(event);
    }
  });
  const tool = runtime.wrapTool({
    name: "echo",
    label: "Echo",
    description: "Echo test",
    parameters: {} as any,
    execute: async () => ({ content: [{ type: "text", text: "ok" }] })
  } as any);

  const result = await tool.execute("call-1", {}, undefined, undefined);
  assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);
  assert.equal(events[0]?.type, "tool_start");
  assert.equal(events[0]?.workspaceId, "personal");
  assert.equal(events[1]?.type, "tool_end");
});
```

- [ ] **Step 2: Create ToolRuntime**

Create `src/lib/server/agent/toolRuntime.ts`:

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";

export interface ToolRuntimeEvent {
  type: "tool_start" | "tool_end";
  runId: string;
  sessionId: string;
  workspaceId: string;
  toolName: string;
  toolCallId: string;
  isError?: boolean;
  summary?: string;
}

export interface ToolRuntimeInit {
  runId: string;
  sessionId: string;
  workspaceId: string;
  emit?: (event: ToolRuntimeEvent) => Promise<void>;
}

export class ToolRuntime {
  constructor(private readonly init: ToolRuntimeInit) {}

  wrapTool<T extends AgentTool<any>>(tool: T): T {
    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        await this.init.emit?.({
          type: "tool_start",
          runId: this.init.runId,
          sessionId: this.init.sessionId,
          workspaceId: this.init.workspaceId,
          toolName: tool.name,
          toolCallId
        });
        try {
          const result = await tool.execute(toolCallId, params, signal, onUpdate);
          await this.init.emit?.({
            type: "tool_end",
            runId: this.init.runId,
            sessionId: this.init.sessionId,
            workspaceId: this.init.workspaceId,
            toolName: tool.name,
            toolCallId,
            isError: false,
            summary: "ok"
          });
          return result;
        } catch (error) {
          await this.init.emit?.({
            type: "tool_end",
            runId: this.init.runId,
            sessionId: this.init.sessionId,
            workspaceId: this.init.workspaceId,
            toolName: tool.name,
            toolCallId,
            isError: true,
            summary: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
      }
    };
  }

  wrapTools<T extends AgentTool<any>>(tools: T[]): T[] {
    return tools.map((tool) => this.wrapTool(tool));
  }
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
node --import tsx --test src/lib/server/agent/toolRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/agent/toolRuntime.ts src/lib/server/agent/toolRuntime.test.ts
git commit -m "feat: add tool runtime wrapper"
```

### Task 13: Route Built-In Tools Through ToolRuntime

**Files:**
- Modify: `src/lib/server/agent/tools/index.ts`
- Modify: `src/lib/server/agent/runner.ts`
- Test: `src/lib/server/agent/toolRuntime.test.ts`

- [ ] **Step 1: Add optional ToolRuntime to tool factory**

In `src/lib/server/agent/tools/index.ts`, import:

```ts
import type { ToolRuntime } from "../toolRuntime.js";
```

Add an option to `createMomTools()`:

```ts
  toolRuntime?: ToolRuntime;
```

At the end of `createMomTools()`, if the code currently returns `tools`, change the final return to:

```ts
  return options.toolRuntime ? options.toolRuntime.wrapTools(tools) : tools;
```

If the function currently returns an array expression directly, assign it first:

```ts
  const tools = [
    // existing tools in the same order
  ];
  return options.toolRuntime ? options.toolRuntime.wrapTools(tools) : tools;
```

- [ ] **Step 2: Instantiate ToolRuntime in runner**

In `src/lib/server/agent/runner.ts`, import:

```ts
import { ToolRuntime } from "./toolRuntime.js";
```

After `runId` and `workspaceId` are computed, create:

```ts
const toolRuntime = new ToolRuntime({
  runId,
  sessionId: this.sessionId,
  workspaceId,
  emit: async (event) => {
    logRunDetail({
      type: event.type === "tool_start" ? "tool_start" : "tool_end",
      toolName: event.toolName,
      displayName: event.toolName,
      isError: event.isError,
      summary: event.summary ?? event.toolName
    });
  }
});
```

Pass `toolRuntime` into `createMomTools({ ... })`.

- [ ] **Step 3: Run focused static check**

Run:

```bash
npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | rg "src/lib/server/agent/(runner|toolRuntime)|src/lib/server/agent/tools/index"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/agent/runner.ts src/lib/server/agent/tools/index.ts src/lib/server/agent/toolRuntime.ts
git commit -m "feat: route built-in tools through tool runtime"
```

### Task 14: Add ApprovalScope Types and Store

**Files:**
- Create: `src/lib/server/approvals/scope.ts`
- Create: `src/lib/server/approvals/store.ts`
- Create: `src/lib/server/approvals/store.test.ts`

- [ ] **Step 1: Add approval scope type**

Create `src/lib/server/approvals/scope.ts`:

```ts
export type ApprovalScope = "once" | "turn" | "session" | "workspace" | "persistent";

export interface ApprovalScopeBinding {
  scope: ApprovalScope;
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  actorId?: string;
}

export function buildApprovalScopeKey(binding: ApprovalScopeBinding): string {
  if (binding.scope === "once") return `once:${binding.runId ?? ""}`;
  if (binding.scope === "turn") return `turn:${binding.runId ?? ""}`;
  if (binding.scope === "session") return `session:${binding.sessionId ?? ""}`;
  if (binding.scope === "workspace") return `workspace:${binding.workspaceId ?? ""}`;
  return "persistent:global";
}
```

- [ ] **Step 2: Write approval store tests**

Create `src/lib/server/approvals/store.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalGrantStore } from "./store.js";

test("ApprovalGrantStore finds active session grants", () => {
  const store = new ApprovalGrantStore(":memory:");
  store.createGrant({
    toolId: "bash:git-status",
    scope: "session",
    scopeKey: "session:s1",
    status: "active"
  });
  assert.equal(store.hasGrant("bash:git-status", "session:s1"), true);
  assert.equal(store.hasGrant("bash:git-status", "session:s2"), false);
});
```

- [ ] **Step 3: Create approval grant store**

Create `src/lib/server/approvals/store.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "../infra/db/storage.js";
import type { ApprovalScope } from "./scope.js";

export interface ApprovalGrantInput {
  toolId: string;
  scope: ApprovalScope;
  scopeKey: string;
  status: "active" | "revoked" | "expired";
}

export class ApprovalGrantStore {
  constructor(private readonly dbFile = storagePaths.settingsDbFile) {}

  private openDb(): DatabaseSync {
    const db = new DatabaseSync(this.dbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS approval_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approval_grants_lookup
        ON approval_grants(tool_id, scope_key, status);
    `);
    return db;
  }

  createGrant(input: ApprovalGrantInput): void {
    const now = new Date().toISOString();
    const db = this.openDb();
    try {
      db.prepare(`
        INSERT INTO approval_grants (tool_id, scope, scope_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.toolId, input.scope, input.scopeKey, input.status, now, now);
    } finally {
      db.close();
    }
  }

  hasGrant(toolId: string, scopeKey: string): boolean {
    const db = this.openDb();
    try {
      const row = db.prepare(`
        SELECT id FROM approval_grants
        WHERE tool_id = ? AND scope_key = ? AND status = 'active'
        LIMIT 1
      `).get(toolId, scopeKey);
      return Boolean(row);
    } finally {
      db.close();
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --import tsx --test src/lib/server/approvals/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/approvals/scope.ts src/lib/server/approvals/store.ts src/lib/server/approvals/store.test.ts
git commit -m "feat: add scoped approval grants"
```

### Task 15: Map Host Bash Approvals to ApprovalScope

**Files:**
- Modify: `src/lib/server/hostBash/store.ts`
- Modify: `src/lib/server/hostBash/types.ts`
- Test: existing `src/lib/server/hostBash/*.test.ts` and `src/lib/server/agent/channelCommands.test.ts`

- [ ] **Step 1: Add scoped fields to Host Bash record types**

In `src/lib/server/hostBash/types.ts`, add optional fields to the approval record interface:

```ts
approvalScope?: "once" | "turn" | "session" | "workspace" | "persistent";
approvalScopeKey?: string;
workspaceId?: string;
runId?: string;
```

- [ ] **Step 2: Extend Host Bash SQLite schema**

In `src/lib/server/hostBash/store.ts`, add columns to `host_bash_approval_records`:

```sql
approval_scope TEXT NOT NULL DEFAULT 'persistent',
approval_scope_key TEXT NOT NULL DEFAULT '',
workspace_id TEXT NOT NULL DEFAULT '',
run_id TEXT NOT NULL DEFAULT '',
```

Then add idempotent migrations:

```ts
for (const statement of [
  "ALTER TABLE host_bash_approval_records ADD COLUMN approval_scope TEXT NOT NULL DEFAULT 'persistent'",
  "ALTER TABLE host_bash_approval_records ADD COLUMN approval_scope_key TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE host_bash_approval_records ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE host_bash_approval_records ADD COLUMN run_id TEXT NOT NULL DEFAULT ''"
]) {
  try {
    db.exec(statement);
  } catch {
    // column already exists
  }
}
```

- [ ] **Step 3: Preserve existing behavior mapping**

When creating persistent approvals, set:

```ts
approval_scope: "persistent",
approval_scope_key: "persistent:global"
```

When creating current-session approvals, set:

```ts
approval_scope: "session",
approval_scope_key: `session:${input.sessionId ?? ""}`
```

When creating one-time script approvals, set:

```ts
approval_scope: "once",
approval_scope_key: `once:${input.runId ?? input.id ?? ""}`
```

- [ ] **Step 4: Run Host Bash approval tests**

Run:

```bash
node --import tsx --test src/lib/server/hostBash/store.test.ts src/lib/server/agent/channelCommands.test.ts
```

Expected: PASS. If `hostBash/store.test.ts` does not exist, run the existing host bash tests returned by `rg --files src/lib/server | rg "hostBash.*\\.test\\.ts$"`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/hostBash/store.ts src/lib/server/hostBash/types.ts src/lib/server/approvals
git commit -m "feat: map host bash approvals to scopes"
```

### Task 16: Split Dynamic Plugin and Channel Settings to SQLite

**Files:**
- Modify: `src/lib/server/settings/store.ts`
- Create: `src/lib/server/settings/dynamicStores.test.ts`
- Modify: settings APIs only where they already call `SettingsStore`

- [ ] **Step 1: Add dynamic settings store tests**

Create `src/lib/server/settings/dynamicStores.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { SettingsStore } from "./store.js";

test("SettingsStore keeps dynamic channel settings in SQLite while legacy load remains readable", () => {
  const store = new SettingsStore(":memory:" as any);
  const settings = store.load();
  assert.ok(settings.channels);
});
```

If `SettingsStore` cannot accept a db path, first add an optional constructor parameter:

```ts
constructor(private readonly settingsDbFile = storagePaths.settingsDbFile) {}
```

and use it inside `openDynamicDb()`.

- [ ] **Step 2: Ensure tables exist**

In `src/lib/server/settings/store.ts`, keep existing tables and ensure these tables exist:

```sql
CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_settings (
  channel_key TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_key, instance_id)
);
```

- [ ] **Step 3: Keep legacy compatibility rule**

Use this precedence rule in load/save helpers:

```ts
// SQLite dynamic rows win when present; settings.json remains readable fallback.
const effectiveChannels = sqliteChannels.length > 0 ? sqliteChannels : legacyChannels;
const effectivePlugins = sqlitePlugins.length > 0 ? sqlitePlugins : legacyPlugins;
```

- [ ] **Step 4: Run focused settings tests**

Run:

```bash
node --import tsx --test src/lib/server/settings/dynamicStores.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/settings/store.ts src/lib/server/settings/dynamicStores.test.ts
git commit -m "feat: split dynamic settings tables"
```

### Task 17: Quarantine Remaining Inactive ACP Surface

**Files:**
- Modify or delete: `src/lib/server/acp/`
- Modify or delete: `src/routes/settings/acp/+page.svelte`
- Modify: `src/lib/server/settings/schema.ts`, `src/lib/server/settings/defaults.ts`, `src/lib/server/settings/store.ts`
- Modify: `readme.md`, `features.md`, `prd.md`, `CHANGELOG.md`

- [ ] **Step 1: Prove ACP is inactive**

Run:

```bash
rg "new AcpService|this\\.acp|BasicChannelAcpTemplate|shouldProxyToAcpSession|handleSharedAcpCommand|callbackQuery\\(\\/\\^acp|settings/acp" src/lib/server src/routes
```

Expected: no active runtime/channel route matches. Historical docs may still mention ACP as legacy.

- [ ] **Step 2: Move ACP source to legacy quarantine**

If no active imports exist, move source to a clearly inactive path:

```bash
mkdir -p src/lib/server/legacy
git mv src/lib/server/acp src/lib/server/legacy/acp
```

Then run:

```bash
rg "from .*server/acp|\\.\\./acp|settings/acp" src
```

Expected: no source imports from the old ACP path.

- [ ] **Step 3: Remove active settings route**

If no navigation references remain, remove the route:

```bash
git rm src/routes/settings/acp/+page.svelte
```

Keep `RuntimeSettings.acp` readable for one release unless all existing settings migration tests pass without it.

- [ ] **Step 4: Run build/static checks**

Run:

```bash
npm run build
```

Expected: PASS, unless the environment blocks `.svelte-kit` writes with `EPERM`.

Run:

```bash
npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | rg "src/lib/server/legacy/acp|src/lib/server/settings|src/routes/settings"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/legacy/acp src/lib/server/settings src/routes/settings readme.md features.md prd.md CHANGELOG.md
git commit -m "refactor: quarantine inactive acp surface"
```

### Task 18: Final v2.1 Completion Pass

**Files:**
- Modify: `docs/agent-v2.1-development-plan.md`
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`
- Modify: `readme.md`

- [ ] **Step 1: Mark checklist statuses**

In `docs/agent-v2.1-development-plan.md`, mark each completed task by evidence:

```markdown
- [x] 31. Design the smallest `TurnOrchestrator` interface around normalized inbound message, actor, session, workspace, run id, stream sink, and cancellation hooks.
- [x] 32. Move run id creation into TurnOrchestrator.
- [x] 33. Move session/conversation resolution into TurnOrchestrator where it is currently duplicated.
- [x] 34. Move workspace resolution into TurnOrchestrator.
- [x] 36. Move run event start/end recording into TurnOrchestrator.
- [x] 43. Inventory all tool sources: built-in tools, MCP tools, Host Bash, sandbox bash, subagent tools, plugin tools.
- [x] 44. Create a small `ToolRuntime.executeToolCall()` entrypoint.
- [x] 54. Add `ApprovalScope` values: `once`, `turn`, `session`, `workspace`, `persistent`.
- [x] 64. Move Workspace and Approval settings/storage out of `settings.json` first.
```

Only mark channel migrations and ToolRuntime routes complete after their specific tasks are implemented and tested.

- [ ] **Step 2: Update product docs**

Add to `features.md`:

```markdown
### Agent v2.1 main-path convergence
- **TurnOrchestrator 收口**: Web、shared IM、Telegram 和 CLI 入口逐步统一到 `TurnOrchestrator`，run id、workspace id、session id 和 runner invocation 不再分散生成。
- **ToolRuntime 边界**: Built-in tools 先通过轻量 `ToolRuntime` 包装，工具事件带 run/session/workspace 元数据；MCP、subagent、plugin tool 继续按现有系统运行，后续再逐组收口。
- **ApprovalScope 基线**: Host Bash approvals 映射到 once/session/persistent 等 scope，为 workspace/persistent 策略提供兼容数据模型。
- **Settings 渐进拆分**: Workspace、Approval、plugin/channel dynamic settings 开始进入 SQLite；`settings.json` 继续作为 legacy fallback。
```

Add matching high-level bullets to `CHANGELOG.md`, and keep `readme.md` capability snapshot aligned with actual completed scope.

- [ ] **Step 3: Run final verification**

Run:

```bash
node --import tsx --test \
  src/lib/server/workspaces/store.test.ts \
  src/lib/server/sessions/store.test.ts \
  src/lib/server/agent/reviewData.test.ts \
  src/lib/server/agent/turnOrchestrator.test.ts \
  src/lib/server/agent/toolRuntime.test.ts \
  src/lib/server/approvals/store.test.ts \
  src/lib/server/settings/dynamicStores.test.ts
```

Expected: PASS.

Run:

```bash
rg "new AcpService|this\\.acp|BasicChannelAcpTemplate|shouldProxyToAcpSession|handleSharedAcpCommand|callbackQuery\\(\\/\\^acp" src/lib/server src/routes
```

Expected: no active runtime matches.

- [ ] **Step 4: Commit final docs**

```bash
git add docs/agent-v2.1-development-plan.md features.md prd.md CHANGELOG.md readme.md
git commit -m "docs: close agent v2.1 convergence plan"
```

## Manual Acceptance Checklist

- [ ] `node --import tsx --test src/lib/server/workspaces/store.test.ts src/lib/server/sessions/store.test.ts src/lib/server/agent/reviewData.test.ts src/lib/server/agent/turnOrchestrator.test.ts` passes.
- [ ] Focused `tsc` check for changed paths prints no errors.
- [ ] `npm run build` passes, or the only blocker is a documented sandbox `EPERM` writing `.svelte-kit/tsconfig.json`.
- [ ] Web normal chat sends one text message and the resulting `run-summaries.jsonl` line includes `"workspaceId":"personal"`.
- [ ] Web streaming chat sends one text message and still emits token/status/diagnostic events.
- [ ] Feishu/QQ/Weixin shared runtime text task still sends a normal response and records `workspaceId`.
- [ ] Telegram normal text task still replies in the correct thread/topic and records `workspaceId`.
- [ ] CLI conversation creates or updates a conversation with `workspaceId`.
- [ ] Built-in tool execution writes start/end events with `runId`, `sessionId`, and `workspaceId`.
- [ ] Host Bash approvals preserve existing persistent and session behavior while storing scope fields.
- [ ] Settings load remains compatible with old `settings.json` and prefers migrated SQLite dynamic rows where present.
- [ ] `/acp`, `/approve`, and `/deny` still return the inactive-path response.
- [ ] Remaining ACP source is either deleted or quarantined under a clearly inactive legacy path.

## Self-Review

**Spec coverage:** This plan covers all v2.1 phases: ACP removal/quarantine, Workspace boundary, TurnOrchestrator migration, ToolRuntime boundary, ApprovalScope, Settings split, explicit non-goals, and final verification. The plan keeps each phase shippable and avoids a single giant refactor.

**Placeholder scan:** The plan contains exact file paths, concrete code snippets, exact commands, expected results, and commit messages. It avoids open-ended instructions like adding generic validation without code.

**Type consistency:** The plan consistently uses `workspaceId`, `sessionId`, `runId`, `TurnResponseSink`, `RunTurnInput`, `runTurn()`, `ToolRuntime`, `ApprovalScope`, and `approvalScopeKey` across tests, implementation, and migration steps.
