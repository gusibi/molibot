import { sanitizeSessionAutoArchiveDays } from "../sanitize.js";
import type { SessionAutoArchiveBotPolicy, SessionAutoArchiveSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

export function getSessionAutoArchive(runtime: SettingsAccessor): SessionAutoArchiveSettings {
  const current = runtime.getSettings().sessionAutoArchive;
  return { enabled: current.enabled, inactiveDays: current.inactiveDays, bots: { ...current.bots } };
}

export function updateSessionAutoArchiveGlobal(
  runtime: SettingsAccessor,
  raw: unknown
): SessionAutoArchiveSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const current = runtime.getSettings().sessionAutoArchive;
  const enabledRaw = source.enabled;
  const enabled = enabledRaw === undefined
    ? current.enabled
    : typeof enabledRaw === "boolean"
      ? enabledRaw
      : String(enabledRaw).toLowerCase() === "true";
  const inactiveDays = source.inactiveDays === undefined
    ? current.inactiveDays
    : sanitizeSessionAutoArchiveDays(source.inactiveDays, current.inactiveDays);
  const updated = runtime.updateSettings({ sessionAutoArchive: { enabled, inactiveDays, bots: { ...current.bots } } });
  const next = updated.sessionAutoArchive;
  return { enabled: next.enabled, inactiveDays: next.inactiveDays, bots: { ...next.bots } };
}

export function upsertSessionAutoArchiveBot(
  runtime: SettingsAccessor,
  botIdRaw: unknown,
  raw: unknown
): SessionAutoArchiveBotPolicy & { botId: string } {
  const botId = String(botIdRaw ?? "").trim();
  if (!botId) throw new Error("botId is required");
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = String(source.mode ?? "inherit").trim();
  if (mode !== "inherit" && mode !== "disabled" && mode !== "custom") {
    throw new Error(`Invalid mode: ${String(source.mode)} (expected inherit|disabled|custom)`);
  }
  const current = runtime.getSettings().sessionAutoArchive;
  let policy: SessionAutoArchiveBotPolicy;
  if (mode === "custom") {
    if (source.inactiveDays === undefined || source.inactiveDays === null || String(source.inactiveDays).trim() === "") {
      policy = { mode };
    } else {
      policy = { mode, inactiveDays: sanitizeSessionAutoArchiveDays(source.inactiveDays, current.inactiveDays) };
    }
  } else {
    policy = { mode: mode as SessionAutoArchiveBotPolicy["mode"] };
  }
  const updated = runtime.updateSettings({
    sessionAutoArchive: { ...current, bots: { ...current.bots, [botId]: policy } }
  });
  const saved = updated.sessionAutoArchive.bots[botId];
  if (!saved) throw new Error(`Bot policy ${botId} was not persisted`);
  return { botId, ...saved };
}

export function deleteSessionAutoArchiveBot(runtime: SettingsAccessor, botIdRaw: unknown): { ok: true } {
  const botId = String(botIdRaw ?? "").trim();
  if (!botId) throw new Error("botId is required");
  const current = runtime.getSettings().sessionAutoArchive;
  if (!(botId in current.bots)) throw new Error("Bot policy not found");
  const bots = { ...current.bots };
  delete bots[botId];
  runtime.updateSettings({ sessionAutoArchive: { ...current, bots } });
  return { ok: true };
}
