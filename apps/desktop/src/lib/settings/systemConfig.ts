import type { DesktopSystemConfig, DesktopSystemUpdate } from "@molibot/desktop-contract";

/** Send only edited fields so a save cannot overwrite settings owned by another page or stale sibling values. */
export function buildDesktopSystemPatch(draft: DesktopSystemConfig, saved: DesktopSystemConfig): DesktopSystemUpdate {
  const patch: DesktopSystemUpdate = {};
  for (const key of ["serverPort", "timezone"] as const) {
    if (draft[key] !== saved[key]) Object.assign(patch, { [key]: draft[key] });
  }
  for (const key of ["budget", "subagentRuntime", "browserAutomation", "display"] as const) {
    const changed = Object.fromEntries(Object.entries(draft[key]).filter(([field, value]) => value !== (saved[key] as unknown as Record<string, unknown>)[field]));
    if (Object.keys(changed).length) Object.assign(patch, { [key]: changed });
  }
  return patch;
}
