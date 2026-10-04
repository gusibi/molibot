import type { DesktopSystemConfig, DesktopSystemUpdate } from "$lib/shared/desktop";
import type { SettingsAccessor } from "$lib/server/settings/handlers/locale";
import { readSystemConfig, updateSystemConfig } from "$lib/server/settings/handlers/system";

export function readDesktopSystem(runtime: SettingsAccessor): DesktopSystemConfig {
  const settings = readSystemConfig(runtime);
  return {
    serverPort: settings.serverPort, timezone: settings.timezone, budget: settings.budget,
    subagentRuntime: settings.subagentRuntime, browserAutomation: settings.browserAutomation,
    display: settings.display!
  };
}

/** Only edited system fields are saved; execution policy and unrelated settings remain owned by their pages. */
export async function updateDesktopSystem(runtime: SettingsAccessor, input: DesktopSystemUpdate): Promise<DesktopSystemConfig> {
  const patch: DesktopSystemUpdate = {};
  for (const key of ["serverPort", "timezone", "budget", "subagentRuntime", "browserAutomation", "display"] as const) {
    if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
  }
  await updateSystemConfig(runtime, patch);
  return readDesktopSystem(runtime);
}
