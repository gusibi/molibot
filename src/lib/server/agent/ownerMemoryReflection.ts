import type { MomEvent } from "$lib/server/agent/events.js";

type ReflectionInternal = NonNullable<MomEvent["internal"]>;
type ReflectionResult = { scannedConversations?: number; scannedMessages: number; createdCandidates: number };

export interface OwnerMemoryReflectionResult {
  completedTargets: number;
  scannedConversations: number;
  scannedMessages: number;
  createdCandidates: number;
}

export async function executeOwnerMemoryReflection(
  internals: ReflectionInternal[],
  run: (internal: ReflectionInternal) => Promise<ReflectionResult>,
  notify?: (text: string) => Promise<void>
): Promise<OwnerMemoryReflectionResult> {
  let completedBots = 0;
  let scannedConversations = 0;
  let scannedMessages = 0;
  let createdCandidates = 0;
  const failures: unknown[] = [];

  for (const internal of internals) {
    try {
      const result = await run(internal);
      completedBots += 1;
      scannedConversations += result.scannedConversations ?? 0;
      scannedMessages += result.scannedMessages;
      createdCandidates += result.createdCandidates;
    } catch (cause) {
      failures.push(cause);
    }
  }

  if (failures.length > 0) {
    if (notify) {
      await notify(`每日记忆反思执行失败：${completedBots} 个 Bot 已完成，${failures.length} 个 Bot 失败；扫描 ${scannedMessages} 条消息，新增 ${createdCandidates} 条待确认记忆。请查看自动任务历史。`);
    }
    throw new AggregateError(failures, `${failures.length} memory reflection target(s) failed.`);
  }

  if (notify) {
    await notify(`每日记忆反思已执行：${completedBots} 个 Bot，扫描 ${scannedMessages} 条消息，新增 ${createdCandidates} 条待确认记忆。`);
  }
  return { completedTargets: completedBots, scannedConversations, scannedMessages, createdCandidates };
}
