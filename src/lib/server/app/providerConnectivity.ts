import type { Model } from "@earendil-works/pi-ai";
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import { getPiCatalogModels, streamWithPiRuntime } from "$lib/server/providers/piRuntime.js";
import { safeErrorMessage } from "$lib/server/agent/identity/auth.js";

/**
 * Connectivity check for providers whose credentials live in `auth.json`.
 *
 * The existing provider test (`/api/desktop/provider-test`) only covers
 * self-hosted endpoints: it requires a saved `baseUrl` + `apiKey` and dials them
 * directly. Built-in providers have neither, so an OAuth login could only ever
 * be reported as "a credential exists" — never as "a request actually works".
 * That gap hid a live regression where every request bypassed
 * `streamWithPiRuntime`, leaving OAuth providers unusable while Settings still
 * showed them as signed in.
 *
 * This check goes through the same `streamWithPiRuntime` the runner uses, so a
 * pass means the real request path works, not just that a token is on disk.
 */

const PROBE_SYSTEM_PROMPT = "Reply with exactly: PONG";
const PROBE_TEXT = "ping";
const PROBE_MAX_TOKENS = 16;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ProviderConnectivityResult {
  ok: boolean;
  providerId: string;
  /** Model the probe actually used — the caller may not have named one. */
  modelId: string;
  elapsedMs: number;
  /** First line of the reply, so the UI can show that content came back. */
  reply?: string;
  error?: string;
}

export interface ProviderConnectivityOptions {
  providerId: string;
  /** Preferred model; falls back to the provider's first catalog entry. */
  modelId?: string;
  timeoutMs?: number;
  /** Overrides the shared pi runtime stream; used by tests. */
  streamFn?: StreamFn;
  catalog?: (providerId: string) => readonly Model<any>[];
}

/**
 * Pick the model to probe with.
 *
 * A named model is honoured only when the catalog actually has it, so a stale
 * `defaultModel` saved in settings cannot make the check fail for a reason that
 * has nothing to do with the credential.
 */
export function pickProbeModel(
  models: readonly Model<any>[],
  requested?: string
): Model<any> | undefined {
  const wanted = String(requested ?? "").trim();
  if (wanted) {
    const match = models.find((model) => model.id === wanted);
    if (match) return match;
  }
  return models[0];
}

/**
 * Providers report failures as an Error, a string, or a bare object; a plain
 * `String(value)` on the last one yields "[object Object]" and loses the reason.
 */
function describeError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const row = value as { errorMessage?: unknown; message?: unknown; error?: unknown };
    const nested = row.errorMessage ?? row.message ?? row.error;
    if (typeof nested === "string" && nested.trim()) return nested;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.slice(0, 200) ?? "";
}

export async function checkProviderConnectivity(
  options: ProviderConnectivityOptions
): Promise<ProviderConnectivityResult> {
  const providerId = options.providerId.trim();
  const catalog = (options.catalog ?? getPiCatalogModels)(providerId);
  const model = pickProbeModel(catalog, options.modelId);
  const startedAt = Date.now();

  if (!model) {
    return {
      ok: false,
      providerId,
      modelId: String(options.modelId ?? "").trim(),
      elapsedMs: 0,
      error: `No built-in models are registered for '${providerId}'.`
    };
  }

  // The probe must not outlive the request: an unreachable endpoint would
  // otherwise hold the connection until the platform's own timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const context = {
      systemPrompt: PROBE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: PROBE_TEXT }] }] as AgentMessage[],
      tools: []
    };
    const stream = (options.streamFn ?? streamWithPiRuntime)(
      model,
      context as never,
      { maxTokens: PROBE_MAX_TOKENS, signal: controller.signal } as never
    );

    let reply = "";
    let streamError = "";
    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const type = String(event.type ?? "");
      if (type === "text_delta") reply += String(event.delta ?? "");
      if (type === "text_end" && !reply) reply += String(event.content ?? "");
      if (type === "error") {
        const partial = event.message as { errorMessage?: unknown } | undefined;
        streamError ||= describeError(event.error ?? partial?.errorMessage ?? "Stream error");
      }
      if (type === "done") {
        const message = event.message as { stopReason?: string; errorMessage?: string } | undefined;
        if (message?.stopReason === "error") streamError ||= describeError(message.errorMessage ?? "Stream error");
      }
    }

    const elapsedMs = Date.now() - startedAt;
    if (streamError) {
      return { ok: false, providerId, modelId: model.id, elapsedMs, error: safeErrorMessage(streamError) };
    }
    // A provider that answers with nothing at all is not a working route, even
    // though the transport did not fail.
    if (!reply.trim()) {
      return {
        ok: false,
        providerId,
        modelId: model.id,
        elapsedMs,
        error: "The provider accepted the request but returned no content."
      };
    }
    return { ok: true, providerId, modelId: model.id, elapsedMs, reply: firstLine(reply) };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      providerId,
      modelId: model.id,
      elapsedMs,
      error: aborted
        ? `The provider did not respond within ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.`
        : safeErrorMessage(error)
    };
  } finally {
    clearTimeout(timer);
  }
}
