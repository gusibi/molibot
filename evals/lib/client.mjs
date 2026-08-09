import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Driving one task's turns over the local HTTP API, and recovering what the
 * assertions need afterwards.
 *
 * `/api/chat` answers with the reply text only, so the tool trace is read back
 * from the stored transcript: `ConversationActivityCollector` persists one
 * activity per tool call with `key = "<toolName>-<n>"`. That is the same record
 * the Desktop transcript renders, which is what makes a `tool_used` assertion
 * check the thing the user would actually see happen.
 */

const EVAL_PROFILE_ID = "personal";
const EVAL_HTTP_TIMEOUT_MS = 15 * 60 * 1000;
const EVAL_HTTP_DISPATCHER = new Agent({
  headersTimeout: EVAL_HTTP_TIMEOUT_MS,
  bodyTimeout: EVAL_HTTP_TIMEOUT_MS
});

function evalFetch(input, init = {}) {
  return undiciFetch(input, { ...init, dispatcher: EVAL_HTTP_DISPATCHER });
}

/**
 * One web user id per task.
 *
 * `getOrCreateConversation` falls back to the *latest existing* conversation
 * for a user when given no id — and an unknown id lands in the same branch — so
 * omitting the id does not mean "start fresh". With one id shared across the
 * run, every task after the first appended to one long transcript: `tool_used`
 * saw every earlier task's tools, and the memory tasks "passed" through
 * ordinary context because `new_session` never made a new session.
 *
 * The user id is also the memory scope (`MemoryScope.externalUserId` is
 * `web:<profile>:<userId>`), so per-task ids give each task its own memory as
 * well — tasks cannot contaminate each other's recall. Within a task the id
 * stays fixed, and `new_session` goes through `POST /api/sessions`, the same
 * "new chat" affordance the UI uses: a genuinely new conversation, same memory
 * scope. That combination is what makes the C group test memory rather than
 * transcript context.
 */
function taskUserId(taskId) {
  return `eval-${taskId.toLowerCase()}`;
}

async function createSession(endpoint, userId) {
  const response = await evalFetch(`${endpoint}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sameOriginHeaders(endpoint) },
    body: JSON.stringify({ userId, profileId: EVAL_PROFILE_ID })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(`could not start a new session: ${body?.error ?? `HTTP ${response.status}`}`);
  }
  return String(body.session.id);
}

async function listPendingApprovals(endpoint, sessionId) {
  const response = await evalFetch(`${endpoint}/api/desktop/host-bash`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sameOriginHeaders(endpoint) },
    body: JSON.stringify({ action: "list_pending", profileId: EVAL_PROFILE_ID, sessionId })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) return [];
  return Array.isArray(body.approvals) ? body.approvals : [];
}

async function approveOnce(endpoint, sessionId, requestId) {
  const response = await evalFetch(`${endpoint}/api/desktop/host-bash`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sameOriginHeaders(endpoint) },
    body: JSON.stringify({
      action: "resolve_approval",
      profileId: EVAL_PROFILE_ID,
      sessionId,
      requestId,
      decision: "approve_once"
    })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(`could not approve eval tool request: ${body?.error ?? `HTTP ${response.status}`}`);
  }
}

async function sendTurnWithApprovals(endpoint, input, { sessionId, autoApprove }) {
  if (!autoApprove) return sendTurn(endpoint, input);

  let settled = false;
  let turnError;
  const approved = new Set();
  const turn = sendTurn(endpoint, input)
    .catch((error) => { turnError = error; return null; })
    .finally(() => { settled = true; });
  while (!settled) {
    await delay(250);
    for (const approval of await listPendingApprovals(endpoint, sessionId)) {
      const requestId = String(approval?.requestId ?? "").trim();
      if (!requestId || approved.has(requestId)) continue;
      await approveOnce(endpoint, sessionId, requestId);
      approved.add(requestId);
    }
  }
  const result = await turn;
  if (turnError) throw turnError;
  return result;
}

function toolNameFromActivityKey(key) {
  const separator = key.lastIndexOf("-");
  return separator <= 0 ? key : key.slice(0, separator);
}

/**
 * SvelteKit rejects a form-shaped POST whose `Origin` does not match the
 * request URL, and `fetch` from Node sends no `Origin` at all — so every
 * attachment upload came back "Cross-site POST form submissions are forbidden"
 * before this existed (CLAUDE.md pitfall 25, third surface).
 *
 * The fix belongs here, not in `csrf-trusted-origins.mjs`: this client really
 * is same-origin with the service it just started, so it should say so. Adding
 * a new trusted origin would weaken the check for every deployment to work
 * around a missing header in one test harness.
 */
function sameOriginHeaders(endpoint) {
  return { origin: new URL(endpoint).origin };
}

export async function sendTurn(endpoint, { prompt, files = [], conversationId, fixtureDir, userId }) {
  const url = `${endpoint}/api/chat`;
  let response;

  if (files.length > 0) {
    const form = new FormData();
    form.set("userId", userId);
    form.set("profileId", EVAL_PROFILE_ID);
    form.set("message", prompt);
    if (conversationId) form.set("conversationId", conversationId);
    for (const relative of files) {
      const absolute = path.resolve(fixtureDir, relative);
      const bytes = readFileSync(absolute);
      form.append("files", new Blob([bytes]), path.basename(absolute));
    }
    response = await evalFetch(url, { method: "POST", body: form, headers: sameOriginHeaders(endpoint) });
  } else {
    response = await evalFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...sameOriginHeaders(endpoint) },
      body: JSON.stringify({
        userId,
        profileId: EVAL_PROFILE_ID,
        message: prompt,
        conversationId
      })
    });
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    const detail = body?.error ?? `HTTP ${response.status}`;
    throw new Error(`chat request failed: ${detail}`);
  }
  return {
    reply: String(body.response ?? ""),
    conversationId: String(body.conversationId ?? ""),
    stopReason: body.stopReason ?? null
  };
}

export async function readToolTrace(endpoint, conversationId, userId) {
  const url = new URL(`${endpoint}/api/sessions/${encodeURIComponent(conversationId)}`);
  url.searchParams.set("userId", userId);
  url.searchParams.set("profileId", EVAL_PROFILE_ID);
  const response = await evalFetch(url);
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) return [];
  const tools = [];
  for (const message of body.session?.messages ?? []) {
    for (const activity of message.activities ?? []) {
      if (activity.kind !== "tool") continue;
      tools.push(toolNameFromActivityKey(String(activity.key ?? "")));
    }
  }
  return tools;
}

export async function runTaskTurns(endpoint, task, { fixtureDir }) {
  const userId = taskUserId(task.id);
  let conversationId = task.autoApprove ? await createSession(endpoint, userId) : undefined;
  const sessions = new Map();
  const replies = [];

  for (const turn of task.turns) {
    if (turn.newSession) conversationId = await createSession(endpoint, userId);
    const result = await sendTurnWithApprovals(endpoint, {
      prompt: turn.prompt,
      files: turn.files,
      conversationId,
      fixtureDir,
      userId
    }, { sessionId: conversationId, autoApprove: task.autoApprove });
    conversationId = result.conversationId;
    sessions.set(conversationId, userId);
    replies.push(result.reply);
  }

  // Tools are the union across every session the task touched: a memory task
  // asserts on what the *last* turn said, but a "did it actually call the
  // tool" check must not be blinded by a new_session boundary.
  const tools = [];
  for (const [id, owner] of sessions) {
    tools.push(...(await readToolTrace(endpoint, id, owner)));
  }

  return { reply: replies.at(-1) ?? "", replies, tools, conversationIds: [...sessions.keys()] };
}
