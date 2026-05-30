# Feishu CardKit Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Feishu agent runs to true CardKit streaming output, aggregate tool progress into one card, and keep approval cards interactive.

**Architecture:** Feishu keeps ordinary outbox/direct text delivery as `post`, but live agent runs use one CardKit interactive card. A focused CardKit helper owns SDK calls and card JSON; a streaming session owns per-run buffering, throttled CardKit updates, tool-progress aggregation, and post-message fallback when CardKit fails. `FeishuManager.processEvent()` switches from the generic text context to a Feishu-specific `MomContext`, mirroring Telegram’s streaming lifecycle while using Feishu CardKit APIs from the OpenClaw reference flow.

**Tech Stack:** TypeScript, SvelteKit server modules, `@larksuiteoapi/node-sdk` CardKit v1, Node built-in test runner via `node --import tsx --test`, npm lockfile.

---

## File Structure

- Modify `package.json` and `package-lock.json`
  - Upgrade `@larksuiteoapi/node-sdk` to `^1.66.0` because the project currently pins `^1.59.0`; local 1.59.0 already exposes CardKit, but the user asked to upgrade if support is incomplete and npm latest is 1.66.0.
- Create `src/lib/server/channels/feishu/cardkit.ts`
  - Build CardKit 2.0 streaming/final cards.
  - Wrap `client.cardkit.v1.card.create`, `cardElement.content`, `card.update`, `card.settings`.
  - Send an IM message referencing a CardKit `card_id` with `msg_type: "interactive"` and content `{"type":"card","data":{"card_id":"..."}}`.
  - Provide a compact tool progress formatter.
- Create `src/lib/server/channels/feishu/cardkit.test.ts`
  - Lock exact SDK payload shapes and card JSON shape.
- Create `src/lib/server/channels/feishu/streamingSession.ts`
  - Own one live Feishu response card per run.
  - Accumulate `assistant_message_event.text_delta` into one answer buffer.
  - Aggregate `tool_execution_start`, `tool_execution_end`, and `subagent_execution` into one tool panel.
  - Suppress runner `ctx.respond(..., false)` tool chatter from becoming separate messages.
  - Fall back to one editable `post` message if CardKit creation/streaming fails.
- Create `src/lib/server/channels/feishu/streamingSession.test.ts`
  - Assert one CardKit message per run, cumulative content streaming, tool aggregation, and fallback behavior.
- Modify `src/lib/server/channels/feishu/runtime.ts`
  - Replace `runSharedTextTask()` for agent events with a Feishu-specific `MomContext` backed by `FeishuStreamingSession` when streaming is enabled.
  - Keep direct outbox sends, queued notices, `/chatid`, host approval cards, file uploads, and approval result cards unchanged.
- Modify `src/routes/settings/feishu/+page.svelte`
  - Add a “Stream agent output with CardKit” checkbox stored as `credentials.streamOutput`.
- Existing tests to keep green:
  - `src/lib/server/channels/feishu/messaging.test.ts`
  - `src/lib/server/channels/feishu/table-conversion.test.ts`
  - Build validation with `npm run build`

## Scope Boundaries

- Implement true CardKit streaming now; do not ship a post-edit-only intermediate path as the main behavior.
- Keep ordinary non-agent/outbox text messages as Feishu `post` rich text.
- Keep approval prompts as separate interactive cards because they require buttons.
- Do not implement inbound Feishu post parsing, Feishu thread replies, mention normalization, or reasoning UI controls in this task.
- Do not create git commits; commits require explicit user instruction.

---

### Task 1: Upgrade and verify Lark SDK CardKit support

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Upgrade the SDK dependency**

Run:

```bash
npm install @larksuiteoapi/node-sdk@^1.66.0
```

Expected: `package.json` and `package-lock.json` update from `^1.59.0` to `^1.66.0`, and npm completes without removing unrelated dependencies.

- [ ] **Step 2: Verify CardKit methods exist after upgrade**

Run:

```bash
node -e "const sdk = require('@larksuiteoapi/node-sdk'); const pkg = require('@larksuiteoapi/node-sdk/package.json'); const c = new sdk.Client({appId:'x', appSecret:'y', appType:sdk.AppType.SelfBuild}); console.log(pkg.version); console.log(Object.keys(c.cardkit.v1.card)); console.log(Object.keys(c.cardkit.v1.cardElement));"
```

Expected output includes a `1.66.x` version and these method names:

```text
create
settings
update
content
```

---

### Task 2: Add CardKit card builders and SDK wrappers

**Files:**
- Create: `src/lib/server/channels/feishu/cardkit.ts`
- Create: `src/lib/server/channels/feishu/cardkit.test.ts`

- [ ] **Step 1: Write failing tests for CardKit payloads and card shape**

Create `src/lib/server/channels/feishu/cardkit.test.ts` with tests that import the helpers below before they exist:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  FEISHU_STREAMING_ELEMENT_ID,
  buildFeishuStreamingCard,
  buildFeishuFinalCard,
  createFeishuCardEntity,
  sendFeishuCardById,
  streamFeishuCardContent,
  setFeishuCardStreamingMode,
  updateFeishuCardEntity
} from "$lib/server/channels/feishu/cardkit.js";

function createMockClient() {
  const calls: Array<{ name: string; payload: unknown }> = [];
  const client = {
    cardkit: {
      v1: {
        card: {
          create: async (payload: unknown) => {
            calls.push({ name: "card.create", payload });
            return { code: 0, msg: "ok", data: { card_id: "card_123" } };
          },
          update: async (payload: unknown) => {
            calls.push({ name: "card.update", payload });
            return { code: 0, msg: "ok", data: {} };
          },
          settings: async (payload: unknown) => {
            calls.push({ name: "card.settings", payload });
            return { code: 0, msg: "ok", data: {} };
          }
        },
        cardElement: {
          content: async (payload: unknown) => {
            calls.push({ name: "cardElement.content", payload });
            return { code: 0, msg: "ok", data: {} };
          }
        }
      }
    },
    im: {
      message: {
        create: async (payload: unknown) => {
          calls.push({ name: "im.message.create", payload });
          return { data: { message_id: "om_123" } };
        }
      }
    }
  };
  return { client: client as never, calls };
}

test("buildFeishuStreamingCard creates CardKit 2.0 streaming card with target element", () => {
  const card = buildFeishuStreamingCard({
    title: "Processing",
    answerText: "Hello",
    tools: [{ toolName: "Read", label: "Read file", status: "running" }],
    isWorking: true
  }) as Record<string, any>;

  assert.equal(card.schema, "2.0");
  assert.equal(card.config.streaming_mode, true);
  assert.equal(card.body.elements.some((element: any) => element.element_id === FEISHU_STREAMING_ELEMENT_ID), true);
  assert.equal(JSON.stringify(card).includes("Read file"), true);
});

test("buildFeishuFinalCard closes streaming mode and keeps tool summary", () => {
  const card = buildFeishuFinalCard({
    title: "Completed",
    answerText: "Done",
    tools: [{ toolName: "Bash", label: "Run tests", status: "success", summary: "passed" }],
    stopReason: "stop",
    elapsedMs: 1200
  }) as Record<string, any>;

  assert.equal(card.schema, "2.0");
  assert.equal(card.config.streaming_mode, false);
  assert.equal(JSON.stringify(card).includes("Done"), true);
  assert.equal(JSON.stringify(card).includes("passed"), true);
});

test("CardKit wrappers send exact SDK payloads", async () => {
  const { client, calls } = createMockClient();
  const card = buildFeishuStreamingCard({ title: "Processing", answerText: "", tools: [], isWorking: true });

  const cardId = await createFeishuCardEntity(client, card);
  const sent = await sendFeishuCardById(client, "oc_chat", cardId);
  await streamFeishuCardContent(client, cardId, FEISHU_STREAMING_ELEMENT_ID, "Hello", 2);
  await updateFeishuCardEntity(client, cardId, buildFeishuFinalCard({ title: "Done", answerText: "Hello", tools: [], stopReason: "stop", elapsedMs: 1 }), 3);
  await setFeishuCardStreamingMode(client, cardId, false, 4);

  assert.deepEqual(sent, { message_id: "om_123" });
  assert.deepEqual(calls.map((call) => call.name), [
    "card.create",
    "im.message.create",
    "cardElement.content",
    "card.update",
    "card.settings"
  ]);
  assert.deepEqual(calls[0].payload, {
    data: { type: "card_json", data: JSON.stringify(card) }
  });
  assert.deepEqual(calls[1].payload, {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "interactive",
      content: JSON.stringify({ type: "card", data: { card_id: "card_123" } })
    }
  });
  assert.deepEqual(calls[2].payload, {
    path: { card_id: "card_123", element_id: FEISHU_STREAMING_ELEMENT_ID },
    data: { content: "Hello", sequence: 2 }
  });
  assert.deepEqual(calls[4].payload, {
    path: { card_id: "card_123" },
    data: { settings: JSON.stringify({ streaming_mode: false }), sequence: 4 }
  });
});

test("CardKit wrappers throw on body-level API errors", async () => {
  const { client } = createMockClient();
  (client as any).cardkit.v1.card.create = async () => ({ code: 230001, msg: "bad card" });

  await assert.rejects(
    () => createFeishuCardEntity(client, { schema: "2.0", config: {}, body: { elements: [] } }),
    /card.create failed: 230001 bad card/
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/cardkit.test.ts
```

Expected: FAIL because `cardkit.ts` does not exist yet.

- [ ] **Step 3: Implement `cardkit.ts`**

Create `src/lib/server/channels/feishu/cardkit.ts` with these exported APIs and behavior:

```ts
import type * as lark from "@larksuiteoapi/node-sdk";
import { markdownToFeishuMarkdown } from "$lib/server/channels/feishu/formatting.js";

export const FEISHU_STREAMING_ELEMENT_ID = "streaming_content";
const FEISHU_TOOL_PANEL_LIMIT = 12;

type StopReason = "stop" | "aborted" | "error" | "waiting_for_approval";

export interface FeishuToolProgressEntry {
  toolName: string;
  displayName?: string;
  label: string;
  status: "running" | "success" | "error";
  summary?: string;
}

interface BuildStreamingCardOptions {
  title: string;
  answerText: string;
  tools: FeishuToolProgressEntry[];
  detailsText?: string;
  isWorking: boolean;
}

interface BuildFinalCardOptions {
  title: string;
  answerText: string;
  tools: FeishuToolProgressEntry[];
  detailsText?: string;
  stopReason: StopReason;
  elapsedMs: number;
}

interface CardKitResponse<TData = Record<string, unknown>> {
  code?: number;
  msg?: string;
  data?: TData;
}

function assertCardKitOk(response: CardKitResponse, api: string): void {
  if (response.code && response.code !== 0) {
    throw new Error(`${api} failed: ${response.code} ${response.msg ?? ""}`.trim());
  }
}

function compactText(text: string, max = 120): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function toolIcon(status: FeishuToolProgressEntry["status"]): string {
  if (status === "running") return "⏳";
  if (status === "error") return "❌";
  return "✅";
}

function buildToolPanel(tools: FeishuToolProgressEntry[]): Record<string, unknown> {
  const visible = tools.slice(-FEISHU_TOOL_PANEL_LIMIT);
  const hidden = tools.length - visible.length;
  const lines = [
    hidden > 0 ? `… ${hidden} earlier tool call(s)` : "",
    ...visible.map((tool) => {
      const name = tool.displayName || tool.toolName || tool.label || "tool";
      const summary = compactText(tool.summary || (tool.label !== name ? tool.label : ""), 90);
      return summary ? `${toolIcon(tool.status)} ${name}: ${summary}` : `${toolIcon(tool.status)} ${name}`;
    })
  ].filter(Boolean);

  return {
    tag: "collapsible_panel",
    expanded: tools.some((tool) => tool.status === "running"),
    header: {
      title: {
        tag: "plain_text",
        content: `🛠️ Tool calls · ${tools.length}`,
        i18n_content: {
          zh_cn: `🛠️ 工具调用 · ${tools.length}`,
          en_us: `🛠️ Tool calls · ${tools.length}`
        }
      }
    },
    elements: [
      {
        tag: "markdown",
        content: lines.length > 0 ? markdownToFeishuMarkdown(lines.join("\n")) : "No tool calls yet."
      }
    ]
  };
}

function buildDetailsPanel(detailsText: string | undefined): Record<string, unknown> | null {
  const details = compactText(detailsText ?? "", 1800);
  if (!details) return null;
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: { title: { tag: "plain_text", content: "运行详情" } },
    elements: [{ tag: "markdown", content: markdownToFeishuMarkdown(details) }]
  };
}

function buildSummaryContent(options: { isWorking?: boolean; stopReason?: StopReason; elapsedMs?: number }): string {
  if (options.isWorking) return "生成中...";
  if (options.stopReason === "error") return `出错 · ${formatElapsed(options.elapsedMs ?? 0)}`;
  if (options.stopReason === "aborted") return `已停止 · ${formatElapsed(options.elapsedMs ?? 0)}`;
  if (options.stopReason === "waiting_for_approval") return `等待审批 · ${formatElapsed(options.elapsedMs ?? 0)}`;
  return `已完成 · ${formatElapsed(options.elapsedMs ?? 0)}`;
}

export function buildFeishuStreamingCard(options: BuildStreamingCardOptions): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [];
  elements.push(buildToolPanel(options.tools));
  elements.push({
    tag: "markdown",
    content: markdownToFeishuMarkdown(options.answerText || " "),
    text_align: "left",
    text_size: "normal_v2",
    element_id: FEISHU_STREAMING_ELEMENT_ID
  });
  const details = buildDetailsPanel(options.detailsText);
  if (details) elements.push(details);
  return {
    schema: "2.0",
    config: {
      streaming_mode: true,
      wide_screen_mode: true,
      update_multi: true,
      summary: { content: buildSummaryContent({ isWorking: options.isWorking }) }
    },
    header: {
      template: "indigo",
      title: { tag: "plain_text", content: options.title }
    },
    body: { elements }
  };
}

export function buildFeishuFinalCard(options: BuildFinalCardOptions): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [];
  if (options.tools.length > 0) elements.push(buildToolPanel(options.tools));
  elements.push({ tag: "markdown", content: markdownToFeishuMarkdown(options.answerText || "_No response._") });
  const details = buildDetailsPanel(options.detailsText);
  if (details) elements.push(details);
  elements.push({ tag: "markdown", text_size: "notation", content: buildSummaryContent({ stopReason: options.stopReason, elapsedMs: options.elapsedMs }) });
  return {
    schema: "2.0",
    config: {
      streaming_mode: false,
      wide_screen_mode: true,
      update_multi: true,
      summary: { content: buildSummaryContent({ stopReason: options.stopReason, elapsedMs: options.elapsedMs }) }
    },
    header: {
      template: options.stopReason === "error" ? "red" : options.stopReason === "aborted" ? "orange" : "green",
      title: { tag: "plain_text", content: options.title }
    },
    body: { elements }
  };
}

export async function createFeishuCardEntity(client: lark.Client, card: Record<string, unknown>): Promise<string> {
  const response = await client.cardkit.v1.card.create({
    data: { type: "card_json", data: JSON.stringify(card) }
  }) as CardKitResponse<{ card_id?: string }>;
  assertCardKitOk(response, "card.create");
  const cardId = response.data?.card_id;
  if (!cardId) throw new Error("card.create failed: empty card_id");
  return cardId;
}

export async function sendFeishuCardById(client: lark.Client, chatId: string, cardId: string): Promise<{ message_id: string }> {
  const response = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify({ type: "card", data: { card_id: cardId } })
    }
  });
  return { message_id: response.data?.message_id || "" };
}

export async function streamFeishuCardContent(client: lark.Client, cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
  const response = await client.cardkit.v1.cardElement.content({
    path: { card_id: cardId, element_id: elementId },
    data: { content: markdownToFeishuMarkdown(content), sequence }
  }) as CardKitResponse;
  assertCardKitOk(response, "cardElement.content");
}

export async function updateFeishuCardEntity(client: lark.Client, cardId: string, card: Record<string, unknown>, sequence: number): Promise<void> {
  const response = await client.cardkit.v1.card.update({
    path: { card_id: cardId },
    data: { card: { type: "card_json", data: JSON.stringify(card) }, sequence }
  }) as CardKitResponse;
  assertCardKitOk(response, "card.update");
}

export async function setFeishuCardStreamingMode(client: lark.Client, cardId: string, streamingMode: boolean, sequence: number): Promise<void> {
  const response = await client.cardkit.v1.card.settings({
    path: { card_id: cardId },
    data: { settings: JSON.stringify({ streaming_mode: streamingMode }), sequence }
  }) as CardKitResponse;
  assertCardKitOk(response, "card.settings");
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/cardkit.test.ts
```

Expected: PASS.

---

### Task 3: Add per-run streaming session and fallback behavior

**Files:**
- Create: `src/lib/server/channels/feishu/streamingSession.ts`
- Create: `src/lib/server/channels/feishu/streamingSession.test.ts`

- [ ] **Step 1: Write failing session tests**

Create `src/lib/server/channels/feishu/streamingSession.test.ts` with tests for one-card streaming, tool aggregation, and post fallback. The tests should build a mock client with `cardkit.v1.card.create/update/settings`, `cardkit.v1.cardElement.content`, and `im.message.create/update` arrays. The assertions must check:

```ts
assert.equal(messageCreateCalls.length, 1);
assert.equal(JSON.parse(messageCreateCalls[0].data.content).data.card_id, "card_1");
assert.deepEqual(contentCalls.map((call) => call.data.content), ["Hello", "Hello world"]);
assert.equal(updateCalls.some((call) => JSON.stringify(call).includes("Read file")), true);
assert.equal(updateCalls.some((call) => JSON.stringify(call).includes("passed")), true);
```

For fallback, make `card.create` throw and assert:

```ts
assert.equal(messageCreateCalls[0].data.msg_type, "post");
assert.equal(messageUpdateCalls.length >= 1, true);
assert.equal(messageCreateCalls.length, 1);
```

- [ ] **Step 2: Run the session test and verify it fails**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/streamingSession.test.ts
```

Expected: FAIL because `streamingSession.ts` does not exist yet.

- [ ] **Step 3: Implement `FeishuStreamingSession`**

Create `src/lib/server/channels/feishu/streamingSession.ts` with these behaviors:

```ts
import type * as lark from "@larksuiteoapi/node-sdk";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { RunnerUiEvent, RunResult } from "$lib/server/agent/core/types.js";
import { formatSubagentProgressLabel, formatSubagentProgressSummary } from "$lib/server/agent/subagentProgress.js";
import { momWarn } from "$lib/server/agent/common/log.js";
import { editFeishuText, sendFeishuText } from "$lib/server/channels/feishu/messaging.js";
import {
  FEISHU_STREAMING_ELEMENT_ID,
  type FeishuToolProgressEntry,
  buildFeishuFinalCard,
  buildFeishuStreamingCard,
  createFeishuCardEntity,
  sendFeishuCardById,
  setFeishuCardStreamingMode,
  streamFeishuCardContent,
  updateFeishuCardEntity
} from "$lib/server/channels/feishu/cardkit.js";

const CARDKIT_FLUSH_INTERVAL_MS = 700;
const POST_FALLBACK_FLUSH_INTERVAL_MS = 1000;

export interface FeishuStreamingSessionOptions {
  client: lark.Client;
  chatId: string;
  runId: string;
  title?: string;
}

export class FeishuStreamingSession {
  private readonly startedAt = Date.now();
  private readonly client: lark.Client;
  private readonly chatId: string;
  private readonly runId: string;
  private readonly title: string;
  private answerText = "";
  private detailsText = "";
  private tools: FeishuToolProgressEntry[] = [];
  private cardId: string | null = null;
  private messageId: string | null = null;
  private fallbackMessageId: string | null = null;
  private sequence = 0;
  private cardCreation: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private pendingFlush = false;
  private closed = false;
  private usePostFallback = false;
  private lastStreamedAnswer = "";

  constructor(options: FeishuStreamingSessionOptions) {
    this.client = options.client;
    this.chatId = options.chatId;
    this.runId = options.runId;
    this.title = options.title ?? "Molibot";
  }

  get finalText(): string {
    return this.answerText.trim();
  }

  async respond(text: string, shouldLog = true): Promise<void> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return;
    if (!shouldLog) {
      if (/^_?→\s+/.test(normalized) || /^_?Error:/.test(normalized)) return;
      this.detailsText = this.detailsText ? `${this.detailsText}\n${normalized}` : normalized;
      this.scheduleFlush();
      return;
    }
    this.answerText = this.answerText ? `${this.answerText}\n${normalized}` : normalized;
    this.scheduleFlush(true);
  }

  async replaceAnswer(text: string): Promise<void> {
    this.answerText = String(text ?? "").trim();
    this.lastStreamedAnswer = "";
    this.scheduleFlush(true);
    await this.flushNow();
  }

  async beginContinuationResponse(partialText: string, notice: string): Promise<void> {
    const finalized = [partialText.trim() || this.answerText.trim(), notice.trim()].filter(Boolean).join("\n\n");
    this.answerText = finalized;
    this.lastStreamedAnswer = "";
    await this.flushNow();
  }

  async respondInThread(text: string): Promise<void> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return;
    this.detailsText = this.detailsText ? `${this.detailsText}\n\n${normalized}` : normalized;
    this.scheduleFlush(true);
  }

  async handleRunnerEvent(event: RunnerUiEvent): Promise<void> {
    if (event.type === "assistant_message_event") {
      await this.handleAssistantEvent(event.event);
      return;
    }
    if (event.type === "tool_execution_start") {
      this.addToolStart(event.toolName, event.label, event.displayName);
      this.scheduleFlush();
      return;
    }
    if (event.type === "tool_execution_end") {
      this.finishTool(event.toolName, event.summary, event.isError, event.displayName);
      this.scheduleFlush();
      return;
    }
    if (event.type === "subagent_execution") {
      const toolName = event.phase === "task_start" || event.phase === "task_end"
        ? `subagent:${event.agent ?? "subagent"}:${event.taskIndex ?? 0}`
        : `subagent:${event.phase}`;
      const label = formatSubagentProgressLabel(event);
      const summary = event.phase === "task_end" || event.phase === "end" ? formatSubagentProgressSummary(event) : undefined;
      if (summary || event.stopReason) {
        this.finishTool(toolName, summary ?? label, event.stopReason === "error", "Subagent");
      } else {
        this.addToolStart(toolName, label, "Subagent");
      }
      this.scheduleFlush();
    }
  }

  async finalize(result: RunResult): Promise<void> {
    this.closed = true;
    this.clearTimer();
    await this.flushNow();
    if (!this.messageId && !this.fallbackMessageId && !this.answerText.trim() && this.tools.length === 0 && !this.detailsText.trim()) return;
    const elapsedMs = Date.now() - this.startedAt;
    if (this.usePostFallback || !this.cardId) {
      await this.flushPostFallback(false);
      return;
    }
    try {
      this.sequence += 1;
      await setFeishuCardStreamingMode(this.client, this.cardId, false, this.sequence);
      this.sequence += 1;
      await updateFeishuCardEntity(
        this.client,
        this.cardId,
        buildFeishuFinalCard({
          title: result.stopReason === "error" ? "Error" : result.stopReason === "aborted" ? "Stopped" : "Completed",
          answerText: this.answerText,
          tools: this.tools,
          detailsText: this.detailsText,
          stopReason: result.stopReason,
          elapsedMs
        }),
        this.sequence
      );
    } catch (error) {
      momWarn("feishu", "streaming_finalize_failed_fallback_post", { runId: this.runId, error: String(error) });
      this.usePostFallback = true;
      await this.flushPostFallback(false);
    }
  }

  private async handleAssistantEvent(event: AssistantMessageEvent): Promise<void> {
    if (event.type !== "text_delta") return;
    this.answerText += event.delta;
    this.scheduleFlush();
  }

  private addToolStart(toolName: string, label: string, displayName?: string): void {
    this.tools.push({ toolName, displayName, label, status: "running" });
  }

  private finishTool(toolName: string, summary: string | undefined, isError: boolean, displayName?: string): void {
    const existing = [...this.tools].reverse().find((tool) => tool.toolName === toolName && tool.status === "running");
    if (existing) {
      existing.status = isError ? "error" : "success";
      existing.summary = summary;
      existing.displayName = displayName ?? existing.displayName;
      return;
    }
    this.tools.push({ toolName, displayName, label: toolName, status: isError ? "error" : "success", summary });
  }

  private scheduleFlush(force = false): void {
    this.pendingFlush = true;
    if (force) this.clearTimer();
    if (this.flushTimer || this.flushInFlight) return;
    const interval = this.usePostFallback ? POST_FALLBACK_FLUSH_INTERVAL_MS : CARDKIT_FLUSH_INTERVAL_MS;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, force ? 0 : interval);
  }

  private clearTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  async flushNow(): Promise<void> {
    this.clearTimer();
    if (this.flushInFlight) await this.flushInFlight;
    if (!this.pendingFlush && !this.closed) return;
    this.pendingFlush = false;
    this.flushInFlight = (this.usePostFallback ? this.flushPostFallback(this.closed) : this.flushCardKit()).finally(() => {
      this.flushInFlight = null;
      if (this.pendingFlush && !this.closed) this.scheduleFlush();
    });
    await this.flushInFlight;
  }

  private async ensureCard(): Promise<void> {
    if (this.cardId || this.messageId || this.usePostFallback) return;
    if (this.cardCreation) return this.cardCreation;
    this.cardCreation = (async () => {
      try {
        const initialCard = buildFeishuStreamingCard({ title: this.title, answerText: this.answerText, tools: this.tools, detailsText: this.detailsText, isWorking: true });
        this.cardId = await createFeishuCardEntity(this.client, initialCard);
        this.sequence = 1;
        const sent = await sendFeishuCardById(this.client, this.chatId, this.cardId);
        this.messageId = sent.message_id;
      } catch (error) {
        momWarn("feishu", "streaming_cardkit_create_failed_fallback_post", { runId: this.runId, error: String(error) });
        this.usePostFallback = true;
      }
    })();
    await this.cardCreation;
  }

  private async flushCardKit(): Promise<void> {
    await this.ensureCard();
    if (this.usePostFallback || !this.cardId) {
      await this.flushPostFallback(false);
      return;
    }
    try {
      this.sequence += 1;
      await updateFeishuCardEntity(
        this.client,
        this.cardId,
        buildFeishuStreamingCard({ title: this.title, answerText: this.answerText, tools: this.tools, detailsText: this.detailsText, isWorking: !this.closed }),
        this.sequence
      );
      if (this.answerText !== this.lastStreamedAnswer) {
        this.sequence += 1;
        await streamFeishuCardContent(this.client, this.cardId, FEISHU_STREAMING_ELEMENT_ID, this.answerText, this.sequence);
        this.lastStreamedAnswer = this.answerText;
      }
    } catch (error) {
      momWarn("feishu", "streaming_cardkit_update_failed_fallback_post", { runId: this.runId, error: String(error) });
      this.usePostFallback = true;
      await this.flushPostFallback(false);
    }
  }

  private renderPostFallbackText(isFinal: boolean): string {
    const toolLines = this.tools.map((tool) => {
      const icon = tool.status === "running" ? "→" : tool.status === "error" ? "✗" : "✓";
      const name = tool.displayName || tool.toolName;
      return tool.summary ? `${icon} ${name}: ${tool.summary}` : `${icon} ${name}`;
    });
    return [
      toolLines.length > 0 ? `工具调用\n${toolLines.join("\n")}` : "",
      this.answerText.trim() ? `回答\n${this.answerText.trim()}${isFinal ? "" : " ..."}` : "",
      this.detailsText.trim() ? `运行详情\n${this.detailsText.trim()}` : ""
    ].filter(Boolean).join("\n\n") || (isFinal ? "_No response._" : "处理中...");
  }

  private async flushPostFallback(isFinal: boolean): Promise<void> {
    const text = this.renderPostFallbackText(isFinal);
    if (this.fallbackMessageId) {
      await editFeishuText(this.client, this.fallbackMessageId, text);
      return;
    }
    const sent = await sendFeishuText(this.client, this.chatId, text);
    this.fallbackMessageId = sent?.message_id ?? null;
  }
}
```

- [ ] **Step 4: Run the session test**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/streamingSession.test.ts
```

Expected: PASS.

---

### Task 4: Wire Feishu runtime to streaming session

**Files:**
- Modify: `src/lib/server/channels/feishu/runtime.ts`

- [ ] **Step 1: Add imports**

Add these imports near existing imports:

```ts
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import type { MomContext, RunResult } from "$lib/server/agent/core/types.js";
import { FeishuStreamingSession } from "$lib/server/channels/feishu/streamingSession.js";
```

- [ ] **Step 2: Add streaming setting resolver**

Add this method to `FeishuManager`:

```ts
private isStreamingOutputEnabled(): boolean {
  const instance = this.getSettings().channels?.feishu?.instances?.find((item) => item.id === this.instanceId);
  const raw = String(instance?.credentials?.streamOutput ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}
```

- [ ] **Step 3: Replace `processEvent()` with Feishu-specific context**

Replace the body of `processEvent()` so it:

1. Computes `activeSessionId` and `runId`.
2. Calls `getTurnOrchestrator().prepareTurn({ chatId, sessionId: activeSessionId, message: event })`.
3. Appends the user/system message through `this.appendConversationMessage()`.
4. Creates `FeishuStreamingSession` only when `this.isStreamingOutputEnabled()` is true.
5. Builds a `MomContext` where:
   - `respond(text, true)` appends to the streaming answer.
   - `respond(text, false)` is swallowed or aggregated, never sent as its own message.
   - `replaceMessage()` replaces the streaming answer.
   - `respondInThread()` appends to streaming details.
   - `onRunnerEvent()` forwards all runner events to the streaming session and still sends host bash approval cards.
   - `uploadFile()` keeps current `sendFeishuFile()` behavior.
6. Calls `runner.run(ctx)`.
7. Calls `streaming.finalize(result)` in `finally`/after run.
8. Logs the final bot response once using `this.store.logBotResponse(chatId, streaming.finalText, messageIdOrNull)` and appends one assistant conversation message if there is final text.
9. Sends `formatRunArchiveNotice()` as a normal `post` message if the run stopped and details were aggregated.

If streaming is disabled, keep the previous `runSharedTextTask()` path unchanged, so the setting is a safe off switch.

- [ ] **Step 4: Preserve host approval cards**

In `onRunnerEvent`, keep this behavior even in streaming mode:

```ts
if (runnerEvent.type === "tool_execution_end" && runnerEvent.hostBashApproval) {
  await this.sendHostToolApprovalCard(chatId, runnerEvent.hostBashApproval);
}
await streaming.handleRunnerEvent(runnerEvent);
```

Expected: approval prompts remain separate interactive cards with buttons; ordinary tool progress stays aggregated in the streaming card.

---

### Task 5: Add Feishu stream-output setting to the UI

**Files:**
- Modify: `src/routes/settings/feishu/+page.svelte`

- [ ] **Step 1: Extend `FeishuBotForm`**

Add:

```ts
streamOutput: boolean;
```

- [ ] **Step 2: Default new bots to streaming enabled**

In `createEmptyBot()`, add:

```ts
streamOutput: true,
```

- [ ] **Step 3: Normalize stream setting**

In `normalizeBot()`, add:

```ts
streamOutput: bot.streamOutput !== false,
```

- [ ] **Step 4: Load setting from credentials**

Extend the loaded credentials type:

```ts
credentials?: { appId?: string; appSecret?: string; verificationToken?: string; encryptKey?: string; streamOutput?: string };
```

Add to mapped bot object:

```ts
streamOutput: String(bot.credentials?.streamOutput ?? "").toLowerCase() !== "false",
```

- [ ] **Step 5: Save setting into credentials**

In the `credentials` object sent to `/api/settings/channel-instance`, add:

```ts
streamOutput: String(normalized.streamOutput)
```

- [ ] **Step 6: Render a checkbox**

Add this next to the existing “Enable this plugin instance” checkbox:

```svelte
<div class="flex items-center gap-3">
  <Checkbox id="feishu-stream-output" bind:checked={selectedBot.streamOutput} />
  <Label for="feishu-stream-output" class="text-sm">Stream agent output with CardKit</Label>
</div>
```

Expected: Feishu instances default to streaming on, and users can disable it without editing JSON.

---

### Task 6: Verify Feishu behavior and build

**Files:**
- Modify only if tests reveal a regression.

- [ ] **Step 1: Run focused Feishu tests**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/cardkit.test.ts src/lib/server/channels/feishu/streamingSession.test.ts src/lib/server/channels/feishu/messaging.test.ts src/lib/server/channels/feishu/table-conversion.test.ts
```

Expected: PASS.

- [ ] **Step 2: Check known formatting test harness**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/formatting.test.ts
```

Expected: It may fail with missing `vitest`; that is a pre-existing test harness issue and should be reported without changing production code.

- [ ] **Step 3: Run build validation**

Run:

```bash
npm run build
```

Expected: PASS. If it fails from unrelated existing repository changes, capture the first relevant error and do not mask it with unrelated refactors.

- [ ] **Step 4: Manual runtime status**

If live Feishu credentials are unavailable locally, explicitly report that live CardKit delivery was not manually exercised. Do not claim a live bot verification unless a real Feishu message was sent.

---

## Self-Review

- Spec coverage: CardKit true streaming is implemented as the main Feishu agent-run path; tool calls aggregate into one card; host approval remains interactive; SDK upgrade is included; post fallback is included; ordinary direct/outbox text remains `post`.
- Placeholder scan: no TODO/TBD/fill-in-later instructions remain.
- Type consistency: helpers consistently use `FEISHU_STREAMING_ELEMENT_ID`, `FeishuToolProgressEntry`, `FeishuStreamingSession`, and SDK payload signatures verified from local `@larksuiteoapi/node-sdk` declarations.
- Git safety: no commit steps are included because commits require explicit user request.
