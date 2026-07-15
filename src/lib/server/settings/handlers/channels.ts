import { sanitizeSingleChannelInstance } from "../sanitize.js";
import type { ChannelInstanceSettings, ChannelSettingsMap } from "../schema.js";
import { validateAgentReferences } from "../validators.js";
import type { SettingsAccessor } from "./locale.js";

export type ChannelInstancesInput = ChannelInstanceSettings[] | { instances: unknown } | unknown;

function normalizeInstances(raw: unknown): ChannelInstanceSettings[] {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { instances?: unknown }).instances))
    ? ((raw as { instances: unknown[] }).instances ?? [])
    : [];
  const out: ChannelInstanceSettings[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    let inst: ChannelInstanceSettings;
    try {
      inst = sanitizeSingleChannelInstance(row);
    } catch {
      continue;
    }
    if (seen.has(inst.id)) continue;
    seen.add(inst.id);
    out.push(inst);
  }
  return out;
}

export function listAllChannels(runtime: SettingsAccessor): ChannelSettingsMap {
  return runtime.getSettings().channels ?? {};
}

export function listChannelInstances(runtime: SettingsAccessor, channel: string): ChannelInstanceSettings[] {
  const ch = String(channel ?? "").trim();
  if (!ch) return [];
  return (runtime.getSettings().channels ?? {})[ch]?.instances ?? [];
}

export function replaceChannelInstances(
  runtime: SettingsAccessor,
  channel: string,
  raw: unknown
): ChannelInstanceSettings[] {
  const ch = String(channel ?? "").trim();
  if (!ch) throw new Error("channel is required");
  const instances = normalizeInstances(raw);
  const current = runtime.getSettings();
  const nextChannels: ChannelSettingsMap = {
    ...(current.channels ?? {}),
    [ch]: { instances }
  };
  const refError = validateAgentReferences(current, { channels: nextChannels });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ channels: nextChannels });
  return (updated.channels ?? {})[ch]?.instances ?? [];
}

export function upsertChannelInstance(
  runtime: SettingsAccessor,
  channel: string,
  raw: unknown,
  previousIdRaw?: unknown
): ChannelInstanceSettings {
  const ch = String(channel ?? "").trim();
  if (!ch) throw new Error("channel is required");
  const inst = sanitizeSingleChannelInstance(raw);
  const previousId = previousIdRaw === undefined ? inst.id : String(previousIdRaw ?? "").trim();
  const current = runtime.getSettings();
  const toRemove = new Set<string>();
  toRemove.add(inst.id);
  if (previousId) toRemove.add(previousId);
  const existing = ((current.channels ?? {})[ch]?.instances ?? []).filter((i) => !toRemove.has(i.id));
  const nextInstances: ChannelInstanceSettings[] = [...existing, inst];
  const nextChannels: ChannelSettingsMap = {
    ...(current.channels ?? {}),
    [ch]: { instances: nextInstances }
  };
  const refError = validateAgentReferences(current, { channels: nextChannels });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ channels: nextChannels });
  const saved = (updated.channels ?? {})[ch]?.instances.find((i) => i.id === inst.id);
  if (!saved) throw new Error(`Instance ${inst.id} was not persisted on channel ${ch}`);
  return saved;
}

export function deleteChannelInstance(
  runtime: SettingsAccessor,
  channel: string,
  instanceId: string
): { ok: true; instances: ChannelInstanceSettings[] } {
  const ch = String(channel ?? "").trim();
  const id = String(instanceId ?? "").trim();
  if (!ch) throw new Error("channel is required");
  if (!id) throw new Error("instance.id is required");
  const current = runtime.getSettings();
  const existing = ((current.channels ?? {})[ch]?.instances ?? []);
  const remaining = existing.filter((i) => i.id !== id);
  if (remaining.length === existing.length) {
    return { ok: true, instances: existing };
  }
  const nextChannels: ChannelSettingsMap = {
    ...(current.channels ?? {}),
    [ch]: { instances: remaining }
  };
  const refError = validateAgentReferences(current, { channels: nextChannels });
  if (refError) throw new Error(refError);
  const updated = runtime.updateSettings({ channels: nextChannels });
  return { ok: true, instances: (updated.channels ?? {})[ch]?.instances ?? [] };
}
