import { isActiveTurnConflictError } from "$lib/server/agent/core/turnOrchestrator.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export async function retryApprovalAutoResume(input: {
  run: () => Promise<void>;
  maxAttempts: number;
  delayMs: number;
  onWarn?: (event: "approval_auto_resume_retrying" | "approval_auto_resume_failed", meta: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    error: string;
  }) => void;
  onRetryExhausted?: () => Promise<void> | void;
}): Promise<void> {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      await input.run();
      return;
    } catch (error) {
      const retryable = isActiveTurnConflictError(error) && attempt < input.maxAttempts;
      input.onWarn?.(retryable ? "approval_auto_resume_retrying" : "approval_auto_resume_failed", {
        attempt,
        maxAttempts: input.maxAttempts,
        delayMs: input.delayMs,
        error: error instanceof Error ? error.message : String(error)
      });
      if (!retryable) {
        await input.onRetryExhausted?.();
        return;
      }
      await sleep(input.delayMs);
    }
  }
}
