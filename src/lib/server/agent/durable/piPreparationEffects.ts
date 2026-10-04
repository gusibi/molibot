import { createHash } from "node:crypto";
import type { JsonValue, Context } from "@earendil-works/chord";
import type { HookApi } from "@earendil-works/pi-durable";
import type { ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";

/** One effect per named stage. An intent without a receipt is never automatically replayed. */
export class PiPreparationRecoveryError extends Error {}

export function createPiPreparationEffects(api: HookApi, context: Context, assertAuthority: () => void): NonNullable<ToolExecutionContext["preparationEffects"]> {
  const running = new Set<string>();
  return {
    async run<T>(stage: string, input: unknown, execute: () => Promise<T>): Promise<T> {
      if (running.has(stage)) throw new Error(`Preparation stage ${stage} is already running.`);
      running.add(stage);
      try {
        assertAuthority();
        context.abortSignal?.throwIfAborted();
        const key = `molibot.preparation:${stage}`;
        const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const intent = await api.memo<string>(`${key}:intent`, context);
        if (intent !== undefined && intent !== fingerprint) throw new PiPreparationRecoveryError(`Preparation stage ${stage} arguments changed during recovery.`);
        const receipt = await api.memo<{ value: JsonValue }>(`${key}:receipt`, context);
        if (receipt !== undefined) {
          if (intent === undefined) throw new PiPreparationRecoveryError(`Preparation stage ${stage} has no execution intent.`);
          return structuredClone(receipt.value) as T;
        }
        if (intent !== undefined) throw new PiPreparationRecoveryError(`Preparation stage ${stage} outcome is unknown; review it before continuing.`);
        await api.memo(`${key}:intent`, fingerprint, context);
        assertAuthority();
        context.abortSignal?.throwIfAborted();
        let value: T;
        try { value = await execute(); }
        catch (cause) {
          context.abortSignal?.throwIfAborted();
          throw new PiPreparationRecoveryError(`Preparation stage ${stage} outcome is unknown: ${String(cause)}`);
        }
        // A cancelled owner cannot commit a receipt or start the next stage.
        assertAuthority();
        context.abortSignal?.throwIfAborted();
        const serialized = JSON.parse(JSON.stringify({ value }));
        if (!("value" in serialized)) throw new Error(`Preparation stage ${stage} returned no serializable receipt.`);
        await api.memo(`${key}:receipt`, serialized, context);
        return value;
      } finally { running.delete(stage); }
    }
  };
}
