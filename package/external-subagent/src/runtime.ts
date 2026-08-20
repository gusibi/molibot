import { ClaudeCodeProvider } from "./providers/claude-code/provider.js";
import { CodexProvider } from "./providers/codex/provider.js";
import type {
  ExternalSubagentProvider,
  ExternalSubagentProviderId,
  ExternalSubagentRequest,
  ExternalSubagentResult,
  ExternalSubagentRuntimeOptions,
  ProviderAvailability
} from "./types.js";

export const MAX_OUTPUT_CHARS = 6000;
export const OUTPUT_HEAD_CHARS = 3000;
export const OUTPUT_TAIL_CHARS = 3000;

/**
 * Compresses long output by keeping head and tail chunks with an ellipsis in between.
 */
export function compressOutput(
  text: string,
  maxChars = MAX_OUTPUT_CHARS,
  headChars = OUTPUT_HEAD_CHARS,
  tailChars = OUTPUT_TAIL_CHARS
): string {
  if (text.length <= maxChars) {
    return text;
  }
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const omitted = text.length - headChars - tailChars;
  return `${head}\n\n... [${omitted} characters omitted] ...\n\n${tail}`;
}

export class ExternalSubagentRuntime {
  private readonly providers = new Map<ExternalSubagentProviderId, ExternalSubagentProvider>();

  constructor(private readonly options?: ExternalSubagentRuntimeOptions) {
    this.registerProvider(
      new CodexProvider({
        runtimesDir: options?.runtimesDir,
        disposeGraceMs: options?.defaultDisposeGraceMs
      })
    );
    this.registerProvider(
      new ClaudeCodeProvider({
        runtimesDir: options?.runtimesDir,
        disposeGraceMs: options?.defaultDisposeGraceMs
      })
    );
  }

  registerProvider(provider: ExternalSubagentProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: ExternalSubagentProviderId): ExternalSubagentProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Unknown external subagent provider: ${id}`);
    }
    return provider;
  }

  async isProviderAvailable(
    id: ExternalSubagentProviderId,
    options?: { customPath?: string }
  ): Promise<ProviderAvailability> {
    const provider = this.getProvider(id);
    return provider.isAvailable(options);
  }

  async run(
    providerId: ExternalSubagentProviderId,
    request: ExternalSubagentRequest
  ): Promise<ExternalSubagentResult> {
    const provider = this.getProvider(providerId);
    const startTime = Date.now();

    // Setup combined abort/timeout signal
    const timeoutMs = request.timeoutMs > 0 ? request.timeoutMs : 600_000;
    const controller = new AbortController();
    let isTimeout = false;
    let isParentAbort = false;

    const timeoutId = setTimeout(() => {
      isTimeout = true;
      controller.abort(new Error(`External subagent timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timeoutId.unref === "function") {
      timeoutId.unref();
    }

    const onParentAbort = (): void => {
      if (!isTimeout) {
        isParentAbort = true;
        controller.abort(new Error("External subagent aborted by user"));
      }
    };

    if (request.signal) {
      if (request.signal.aborted) {
        clearTimeout(timeoutId);
        return {
          provider: providerId,
          output: "",
          stopReason: "aborted",
          diagnostic: "Request was aborted before execution",
          durationMs: 0
        };
      }
      request.signal.addEventListener("abort", onParentAbort, { once: true });
    }

    try {
      const result = await provider.run({
        ...request,
        signal: controller.signal
      });

      // Classify final stop reason if aborted/timed out
      if (isTimeout) {
        return {
          ...result,
          output: compressOutput(result.output),
          stopReason: "timeout",
          diagnostic: `External subagent timed out after ${timeoutMs}ms`,
          durationMs: Date.now() - startTime
        };
      }

      if (isParentAbort || request.signal?.aborted) {
        return {
          ...result,
          output: compressOutput(result.output),
          stopReason: "aborted",
          diagnostic: "External subagent was cancelled by user",
          durationMs: Date.now() - startTime
        };
      }

      return {
        ...result,
        output: compressOutput(result.output),
        durationMs: Date.now() - startTime
      };
    } catch (err: unknown) {
      if (isTimeout) {
        return {
          provider: providerId,
          output: "",
          stopReason: "timeout",
          diagnostic: `External subagent timed out after ${timeoutMs}ms`,
          durationMs: Date.now() - startTime
        };
      }
      if (isParentAbort || request.signal?.aborted) {
        return {
          provider: providerId,
          output: "",
          stopReason: "aborted",
          diagnostic: "External subagent was cancelled by user",
          durationMs: Date.now() - startTime
        };
      }

      return {
        provider: providerId,
        output: "",
        stopReason: "error",
        diagnostic: `${providerId} execution failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime
      };
    } finally {
      clearTimeout(timeoutId);
      if (request.signal) {
        request.signal.removeEventListener("abort", onParentAbort);
      }
    }
  }
}
