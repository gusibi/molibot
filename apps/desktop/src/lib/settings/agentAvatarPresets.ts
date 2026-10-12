import { readdirSync } from "node:fs";

// Built-in avatar presets are whatever image files live in
// `apps/desktop/public/agent-avatars/`; the picker list is derived from that
// directory at build time (virtual:agent-avatars) so adding a file is enough.
const AVATAR_FILE_PATTERN = /\.(svg|png|jpe?g|webp)$/i;
const PUBLIC_BASE = "/agent-avatars";

export type AgentAvatarPreset = { src: string; zh: string; en: string };

function avatarPresetLabel(file: string): { zh: string; en: string } {
  const stem = file.replace(AVATAR_FILE_PATTERN, "");
  if (stem.startsWith("pattern-")) {
    const index = stem.slice("pattern-".length);
    return { zh: `色块头像 ${index}`, en: `Pattern avatar ${index}` };
  }
  if (stem.startsWith("scifi-")) {
    const name = stem.slice("scifi-".length).replace(/-/g, " ");
    const capped = name.charAt(0).toUpperCase() + name.slice(1);
    return { zh: `科幻头像 ${capped}`, en: `Sci-fi avatar ${capped}` };
  }
  const words = stem.replace(/-/g, " ");
  return { zh: words, en: words };
}

export function listAgentAvatarPresets(dir: string): AgentAvatarPreset[] {
  return readdirSync(dir)
    .filter(file => AVATAR_FILE_PATTERN.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(file => ({ src: `${PUBLIC_BASE}/${file}`, ...avatarPresetLabel(file) }));
}
