import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import type { HookEvent, HookStage, RuntimeHook } from "$lib/server/agent/hooks/types.js";

export class DebugLogHook implements RuntimeHook {
  readonly id = "built-in:debug-log";
  readonly name = "Debug Log";
  readonly kind = "observe" as const;
  readonly priority = 90;
  readonly stages: HookStage[] = [
    "run.started",
    "run.finished",
    "tool.call.blocked",
    "runtime.notice"
  ];

  handle(event: HookEvent): void {
    const data = {
      runId: event.context.runId,
      channel: event.context.channel,
      chatId: event.context.chatId,
      stage: event.stage
    };
    if (event.stage === "tool.call.blocked") {
      momWarn("hooks", "tool_call_blocked", { ...data, payload: event.payload });
      return;
    }
    momLog("hooks", event.stage.replace(/\./g, "_"), data);
  }
}
