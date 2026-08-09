import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import { SYSTEM_TASK_BOTS_DIR, SYSTEM_TASK_OWNER_ID } from "$lib/server/agent/commands/taskChannels.js";
import type { MomEvent } from "$lib/server/agent/events.js";

export interface DurableExecutionEventInput {
  executionId: string;
  expectedVersion: number;
  runAt?: Date;
}

export function durableExecutionEventsDir(dataDir = config.dataDir): string {
  return resolve(dataDir, SYSTEM_TASK_BOTS_DIR, SYSTEM_TASK_OWNER_ID, "events");
}

function safeExecutionId(executionId: string): string {
  return executionId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function durableExecutionEventFilePath(input: DurableExecutionEventInput, dataDir = config.dataDir): string {
  return join(durableExecutionEventsDir(dataDir), `durable-execution-${safeExecutionId(input.executionId)}-v${input.expectedVersion}.json`);
}

function eventFor(input: DurableExecutionEventInput): MomEvent {
  const runAt = (input.runAt ?? new Date()).toISOString();
  const base: Omit<Extract<MomEvent, { type: "one-shot" }>, "type" | "at"> = {
    enabled: true,
    taskId: `durable-execution:${input.executionId}:v${input.expectedVersion}`,
    chatId: `durable-execution:${input.executionId}`,
    text: "",
    execution: "internal",
    internal: {
      kind: "durable-execution",
      durable: {
        executionId: input.executionId,
        expectedVersion: input.expectedVersion
      }
    }
  };
  return { ...base, type: "one-shot", at: runAt };
}

function matches(input: DurableExecutionEventInput, event: MomEvent): boolean {
  return event.execution === "internal"
    && event.internal?.kind === "durable-execution"
    && event.internal.durable?.executionId === input.executionId
    && event.internal.durable.expectedVersion === input.expectedVersion;
}

/**
 * Durable work is activated by the same watched JSON seam as every other
 * internal event. The file name is versioned, so a retry/continuation gets a
 * new event slot while repeated startup reconciliation remains idempotent.
 */
export function enqueueDurableExecutionEvent(input: DurableExecutionEventInput, dataDir = config.dataDir): string {
  const eventsDir = durableExecutionEventsDir(dataDir);
  mkdirSync(eventsDir, { recursive: true });
  const filePath = durableExecutionEventFilePath(input, dataDir);
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      if (matches(input, current)) return filePath;
    } catch {
      // Replace only this owned event file when it is malformed.
    }
  }
  writeFileSync(filePath, `${JSON.stringify(eventFor(input), null, 2)}\n`, "utf8");
  return filePath;
}
