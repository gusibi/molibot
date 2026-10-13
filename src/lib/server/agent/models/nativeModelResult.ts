import type { JsonValue } from "@earendil-works/chord";
import { defineEntry, ROOT_CONVERSATION_ID, type Cursor } from "@earendil-works/pi-durable";
import { currentPiInvocation } from "$lib/server/agent/durable/piInvocation.js";
import { PiPreparationRecoveryError } from "$lib/server/agent/durable/piPreparationEffects.js";
import { classifyToolSideEffect } from "$lib/server/agent/tools/sideEffectClassification.js";

const Intent = defineEntry<{ task: number; stage: string; fingerprint: string }>("molibot.model-intent");
const Response = defineEntry<{ task: number; stage: string; value: JsonValue }>("molibot.model-response");
const active = new Set<string>();

/** Native entries own raw responses; unknown requests also block a new call ID for the same operation. */
export async function nativeModelResult<T>(input: unknown, request: () => Promise<T>, account: (value: T) => void, stage = "request"): Promise<T> {
  const invocation = currentPiInvocation();
  if (!invocation) {
    const value = await request();
    account(value);
    return value;
  }
  const { api, context, storagePath } = invocation;
  const fingerprint = classifyToolSideEffect("model", input).idempotencyKey;
  const key = `${storagePath}:${api.taskId}:${stage}`;
  active.add(key);
  try {
    const committed = await api.commit(async tx => {
      const intents: Array<{ task: number; stage: string; fingerprint: string }> = [];
      const responses = new Map<string, JsonValue>();
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries({ conversationId: ROOT_CONVERSATION_ID }, 64, cursor);
        for (const entry of page.items) {
          if (Intent.is(entry)) intents.push(entry.data);
          if (Response.is(entry)) responses.set(`${entry.data.task}:${entry.data.stage}`, entry.data.value);
        }
        cursor = page.next;
      } while (cursor !== undefined);
      const own = intents.find(item => item.task === api.taskId && item.stage === stage);
      if (own && own.fingerprint !== fingerprint) throw new PiPreparationRecoveryError("Model arguments changed during recovery.");
      const cached = responses.get(`${api.taskId}:${stage}`);
      if (cached !== undefined) return { value: cached };
      const replaySafe = stage.startsWith("poll:");
      for (const intent of intents) {
        if (replaySafe || intent.fingerprint !== fingerprint || responses.has(`${intent.task}:${intent.stage}`)) continue;
        if (intent.task === api.taskId || !active.has(`${storagePath}:${intent.task}:${intent.stage}`)) {
          throw new PiPreparationRecoveryError("The remote model outcome is unknown; review it before resending the same billed operation, even with a new call ID.");
        }
      }
      if (!own) await tx.appendEntry(Intent, ROOT_CONVERSATION_ID, { data: { task: api.taskId, stage, fingerprint } });
      return undefined;
    }, context);
    if (committed) {
      const value = structuredClone(committed.value) as T;
      account(value);
      return value;
    }
    context.abortSignal?.throwIfAborted();
    const value = await request();
    // Accounting remains truthful when cancellation prevents committing or projecting the response.
    account(value);
    const serialized = JSON.parse(JSON.stringify(value)) as JsonValue;
    await api.commit(tx => tx.appendEntry(Response, ROOT_CONVERSATION_ID, { data: { task: api.taskId, stage, value: serialized } }), context);
    return value;
  } finally { active.delete(key); }
}
