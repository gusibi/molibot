# Feishu Post Rich Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send ordinary Feishu channel replies as `post` rich-text messages while keeping interactive cards for approval flows.

**Architecture:** Keep the current Feishu runtime, outbox, and approval callback architecture intact. Change only the outbound text delivery path in `messaging.ts`: normal text becomes Feishu `msg_type: "post"` with an `md` rich-text segment, while `sendFeishuCard()` and host bash approval cards remain `msg_type: "interactive"`.

**Tech Stack:** TypeScript, SvelteKit server modules, `@larksuiteoapi/node-sdk`, Node built-in test runner via `node --import tsx --test`.

---

## File Structure

- Modify `src/lib/server/channels/feishu/messaging.ts`
  - Add a post-content builder for Feishu rich text.
  - Change `sendFeishuText()` to send post messages instead of reply cards.
  - Change `editFeishuText()` to update post messages with `im.message.update`.
  - Keep `sendFeishuCard()`, approval card builders, and existing file/image/audio delivery helpers intact.
- Create `src/lib/server/channels/feishu/messaging.test.ts`
  - Assert ordinary text sends use `msg_type: "post"`.
  - Assert post content uses `zh_cn.content: [[{ tag: "md", text }]]`.
  - Assert editing ordinary text updates a post message.
  - Assert explicit cards still use `msg_type: "interactive"`.
- Existing tests to keep green:
  - `src/lib/server/channels/feishu/formatting.test.ts`
  - `src/lib/server/channels/feishu/table-conversion.test.ts`

## Scope Boundaries

This phase does not implement inbound post parsing, thread replies, mention normalization, CardKit streaming, or configurable reply modes. Those remain follow-up enhancements.

---

### Task 1: Lock expected Feishu outbound message types with tests

**Files:**
- Create: `src/lib/server/channels/feishu/messaging.test.ts`
- Modify: none

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/channels/feishu/messaging.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeishuPostContent,
  sendFeishuCard,
  sendFeishuText,
  editFeishuText
} from "$lib/server/channels/feishu/messaging.js";

function createMockClient() {
  const createCalls: unknown[] = [];
  const updateCalls: unknown[] = [];

  const client = {
    im: {
      message: {
        create: async (payload: unknown) => {
          createCalls.push(payload);
          return { data: { message_id: `om_${createCalls.length}` } };
        },
        update: async (payload: unknown) => {
          updateCalls.push(payload);
          return { data: { message_id: "om_updated" } };
        }
      }
    }
  };

  return { client: client as never, createCalls, updateCalls };
}

test("buildFeishuPostContent wraps markdown in a Feishu post md segment", () => {
  const content = JSON.parse(buildFeishuPostContent("# Title\n\n- item"));

  assert.deepEqual(Object.keys(content), ["zh_cn"]);
  assert.equal(content.zh_cn.content[0][0].tag, "md");
  assert.match(content.zh_cn.content[0][0].text, /Title/);
  assert.match(content.zh_cn.content[0][0].text, /item/);
});

test("sendFeishuText sends ordinary replies as post messages", async () => {
  const { client, createCalls } = createMockClient();

  const result = await sendFeishuText(client, "oc_chat", "Hello **Feishu**");

  assert.deepEqual(result, { message_id: "om_1" });
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "post",
      content: buildFeishuPostContent("Hello **Feishu**")
    }
  });
});

test("editFeishuText updates ordinary replies as post messages", async () => {
  const { client, updateCalls } = createMockClient();

  const result = await editFeishuText(client, "om_123", "Updated **post**");

  assert.equal(result, "om_123");
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0], {
    path: { message_id: "om_123" },
    data: {
      msg_type: "post",
      content: buildFeishuPostContent("Updated **post**")
    }
  });
});

test("sendFeishuCard keeps explicit cards as interactive messages", async () => {
  const { client, createCalls } = createMockClient();
  const card = {
    config: { wide_screen_mode: true },
    elements: [{ tag: "markdown", content: "Needs approval" }]
  };

  const result = await sendFeishuCard(client, "oc_chat", card as never);

  assert.deepEqual(result, { message_id: "om_1" });
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "interactive",
      content: JSON.stringify(card)
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the right reason**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/messaging.test.ts
```

Expected: FAIL because `buildFeishuPostContent` is not exported yet, or because `sendFeishuText()` still sends `interactive` cards.

- [ ] **Step 3: Do not change production code in this task**

Keep the failure as the red TDD state for Task 2.

---

### Task 2: Send normal Feishu text as post rich text

**Files:**
- Modify: `src/lib/server/channels/feishu/messaging.ts`
- Test: `src/lib/server/channels/feishu/messaging.test.ts`

- [ ] **Step 1: Add post constants and content builder near the existing card constants**

In `src/lib/server/channels/feishu/messaging.ts`, near `FEISHU_CARD_MARKDOWN_LIMIT`, add:

```ts
const FEISHU_POST_MARKDOWN_LIMIT = 4000;
```

Below `chunkSegmentsForCards()`, add this exported helper:

```ts
export function buildFeishuPostContent(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text: formatFeishuText(text) }]]
    }
  });
}
```

- [ ] **Step 2: Add a post sender helper**

In `src/lib/server/channels/feishu/messaging.ts`, below `sendFeishuCard()`, add:

```ts
async function sendFeishuPost(
  client: lark.Client,
  chatId: string,
  text: string
): Promise<{ message_id: string } | null> {
  const res = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "post",
      content: buildFeishuPostContent(text)
    }
  });
  return { message_id: res.data?.message_id || "" };
}
```

- [ ] **Step 3: Replace `sendFeishuText()` card delivery with post delivery**

Replace the body of `sendFeishuText()` with:

```ts
export async function sendFeishuText(
  client: lark.Client | undefined,
  chatId: string,
  text: string
): Promise<{ message_id: string } | null> {
  if (!client || !text.trim()) return null;
  try {
    let firstMessage: { message_id: string } | null = null;

    for (const chunk of chunkMarkdown(text, FEISHU_POST_MARKDOWN_LIMIT)) {
      const sent = await sendFeishuPost(client, chatId, chunk);
      if (!firstMessage) firstMessage = sent;
    }

    return firstMessage;
  } catch (error) {
    momWarn("feishu", "send_message_failed", { error: String(error) });
    return null;
  }
}
```

- [ ] **Step 4: Replace `editFeishuText()` card patching with post update**

Replace `editFeishuText()` with:

```ts
export async function editFeishuText(
  client: lark.Client | undefined,
  messageId: string,
  text: string
): Promise<string | null> {
  if (!client || !messageId.trim() || !text.trim()) return null;
  try {
    await client.im.message.update({
      path: { message_id: messageId },
      data: {
        msg_type: "post",
        content: buildFeishuPostContent(text)
      }
    });
    return messageId;
  } catch (error) {
    momWarn("feishu", "edit_message_failed", { error: String(error) });
    return null;
  }
}
```

- [ ] **Step 5: Run the focused messaging test**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/messaging.test.ts
```

Expected: PASS.

---

### Task 3: Verify existing Feishu formatting and table behavior still works

**Files:**
- Modify: only if tests reveal a regression in `src/lib/server/channels/feishu/formatting.ts` or `src/lib/server/channels/feishu/messaging.ts`
- Test: `src/lib/server/channels/feishu/formatting.test.ts`
- Test: `src/lib/server/channels/feishu/table-conversion.test.ts`

- [ ] **Step 1: Run existing Feishu tests**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/table-conversion.test.ts src/lib/server/channels/feishu/messaging.test.ts
```

Expected: PASS.

- [ ] **Step 2: Check whether `formatting.test.ts` is runnable in this repo**

Run:

```bash
node --import tsx --test src/lib/server/channels/feishu/formatting.test.ts
```

Expected: It may fail because this file imports `vitest` while the root project does not currently provide a Vitest binary. If it fails only with a missing `vitest` module, record that as a pre-existing test harness issue instead of changing production code.

- [ ] **Step 3: Run TypeScript/build validation**

Run:

```bash
npm run build
```

Expected: PASS. If it fails due to unrelated pre-existing repository changes, capture the first relevant error and do not mask it with unrelated refactors.

---

### Task 4: Manual behavior checklist for Feishu runtime

**Files:**
- Modify: none unless manual verification reveals a bug in `src/lib/server/channels/feishu/messaging.ts`

- [ ] **Step 1: Verify ordinary replies no longer call the card path in tests**

Confirm `messaging.test.ts` has an assertion where `sendFeishuText()` produces:

```ts
msg_type: "post"
```

and not:

```ts
msg_type: "interactive"
```

- [ ] **Step 2: Verify approval cards still call the card path in tests**

Confirm `messaging.test.ts` has an assertion where `sendFeishuCard()` produces:

```ts
msg_type: "interactive"
```

- [ ] **Step 3: Report manual Feishu runtime status**

If live Feishu credentials are not available locally, explicitly report that live Feishu delivery was not manually exercised. Do not claim a live bot verification unless a real message was sent through a configured Feishu instance.

---

## Self-Review

- Spec coverage: ordinary replies use Feishu post rich text; approval cards remain interactive; edit path updates post messages; scope excludes inbound/thread/CardKit work.
- Placeholder scan: no TBD/TODO/fill-in-later instructions remain.
- Type consistency: the plan uses `buildFeishuPostContent()`, `sendFeishuText()`, `editFeishuText()`, and `sendFeishuCard()` consistently across tests and implementation.
- Git safety: this plan intentionally omits commit steps because commits were not explicitly requested in the conversation.
