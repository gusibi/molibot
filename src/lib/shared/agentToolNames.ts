/** The model-facing memory tools that replaced the single `memory` action enum. */
export const MEMORY_TOOL_NAMES = ["save_memory", "recall_memory", "forget_memory"] as const;

/**
 * A stored Agent opt-out for the old `memory` tool must keep the replacement
 * tools disabled; silently dropping it would re-enable memory writes. Used on
 * settings load and at runtime so the Agent settings page and the tool gate
 * agree.
 */
export function expandLegacyDisabledToolNames(names: Iterable<string>): Set<string> {
  const expanded = new Set(names);
  if (expanded.delete("memory")) {
    for (const name of MEMORY_TOOL_NAMES) expanded.add(name);
  }
  return expanded;
}
