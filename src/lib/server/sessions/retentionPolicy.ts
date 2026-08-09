import type { TurnRetentionPolicy } from "$lib/shared/types/message.js";

export type { TurnRetentionPolicy } from "$lib/shared/types/message.js";

export interface RetentionCapabilities {
  futureContext: boolean;
  searchable: boolean;
  memoryEligible: boolean;
}

const CAPABILITIES: Record<TurnRetentionPolicy, RetentionCapabilities> = {
  standard: { futureContext: true, searchable: true, memoryEligible: true },
  no_memory: { futureContext: true, searchable: true, memoryEligible: false },
  not_searchable: { futureContext: true, searchable: false, memoryEligible: false },
  turn_only: { futureContext: false, searchable: false, memoryEligible: false }
};

export function retentionCapabilities(policy: TurnRetentionPolicy | undefined): RetentionCapabilities {
  return CAPABILITIES[policy ?? "standard"];
}

/**
 * Recognizes explicit retention instructions only. The stronger policy wins
 * when a message contains more than one phrase.
 */
export function classifyTurnRetention(text: string): TurnRetentionPolicy {
  const value = String(text ?? "");
  // Talking about the controls is not the same as applying one. Keep the
  // narrow, common explanatory forms out of the policy path so documentation
  // questions do not silently disappear from later context.
  if (
    /^(?:请)?(?:解释|说明|定义|比较|分析).*(?:仅本轮|不记忆|不可搜索)/i.test(value.trim())
    || /(?:仅本轮|不记忆|不可搜索).*(?:是什么意思|什么含义|有何区别|怎么理解)/i.test(value)
  ) return "standard";
  if (
    /(?:仅|只)(?:在|限于|用于)?(?:本轮|这一轮|这轮|本次对话|这次对话)(?:使用|有效)?/i.test(value)
    || /(?:this turn only|only for this turn|only in this conversation)/i.test(value)
  ) return "turn_only";
  if (
    /(?:不可|不允许|不要|别)(?:被)?搜索|不要让(?:它|这(?:段|条|个)?内容)?被搜索|do not (?:index|search)|not searchable/i.test(value)
  ) return "not_searchable";
  if (
    /(?:不要|不用|别)(?:记住|记忆|保存到记忆)|不记忆|do not remember|don't remember/i.test(value)
  ) return "no_memory";
  return "standard";
}
