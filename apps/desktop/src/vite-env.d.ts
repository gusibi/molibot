/// <reference types="vite/client" />

declare module "virtual:agent-avatars" {
  import type { AgentAvatarPreset } from "./lib/settings/agentAvatarPresets";
  const presets: AgentAvatarPreset[];
  export default presets;
}
