// External channel (bot instance) settings — state + orchestration.
import { deleteDesktopChannel, loadDesktopBotFiles, loadDesktopChannels, saveDesktopBotFiles, saveDesktopChannel, testDesktopChannel } from "../api";
import type { DesktopChannelSaveRequest, DesktopChannelsSummary, DesktopExternalChannel } from "@molibot/desktop-contract";
import type { Locale } from "../i18n";
import { emptyProfileFiles } from "../settings/profileFiles";
import { session, setError } from "./session.svelte";

export const DESKTOP_CHANNELS: DesktopExternalChannel[] = ["telegram", "feishu", "qq", "weixin"];

export const CHANNEL_FIELD_CONFIG: Record<DesktopExternalChannel, { visible: string[]; secret: string[] }> = {
  telegram: { visible: ["streamOutput"], secret: ["token"] },
  feishu: { visible: ["appId", "streamOutput"], secret: ["appSecret", "verificationToken", "encryptKey"] },
  qq: { visible: ["appId"], secret: ["clientSecret"] },
  weixin: { visible: ["baseUrl"], secret: [] }
};

export type ChannelEditor = DesktopChannelSaveRequest & { isNew: boolean; files: Record<string, string> };
type QrModule = { toDataURL: (text: string, options?: Record<string, unknown>) => Promise<string> };

export function externalChannelLabel(channel: DesktopExternalChannel, currentLocale: Locale): string {
  if (channel === "weixin") return currentLocale === "zh-CN" ? "微信" : "WeChat";
  if (channel === "feishu") return currentLocale === "zh-CN" ? "飞书" : "Feishu";
  if (channel === "qq") return "QQ";
  return "Telegram";
}

export const channelsStore = $state({
  channels: null as DesktopChannelsSummary | null,
  loading: false,
  endpoint: "",
  channelEdit: null as ChannelEditor | null,
  saving: false,
  editorLoading: false,
  testing: false,
  actionMessage: "",
  qrLink: "",
  qrImage: "",
  qrLoading: false,
  qrError: ""
});

let qrModulePromise: Promise<QrModule> | null = null;

export async function loadChannels(endpoint: string): Promise<void> {
  channelsStore.endpoint = endpoint;
  channelsStore.loading = true;
  session.error = "";
  try {
    channelsStore.channels = await loadDesktopChannels(endpoint);
  } catch (cause) {
    channelsStore.endpoint = "";
    setError(cause);
  } finally {
    channelsStore.loading = false;
  }
}

export function beginNewChannel(channel: DesktopExternalChannel): void {
  channelsStore.channelEdit = {
    isNew: true,
    channel,
    id: `${channel}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`,
    name: "",
    enabled: true,
    agentId: "",
    sandboxEnabled: null,
    allowedChatIds: [],
    fields: channel === "weixin" ? { baseUrl: "https://ilinkai.weixin.qq.com" } : channel === "telegram" || channel === "feishu" ? { streamOutput: "true" } : {},
    secretValues: {},
    clearSecrets: [],
    files: emptyProfileFiles()
  };
  channelsStore.actionMessage = "";
}

export async function beginChannelEdit(channel: DesktopExternalChannel, instanceId: string): Promise<void> {
  const endpoint = session.endpoint;
  const instance = channelsStore.channels?.groups.find((group) => group.channel === channel)?.instances.find((item) => item.id === instanceId);
  if (!endpoint || !instance || channelsStore.editorLoading) return;
  channelsStore.editorLoading = true;
  try {
    channelsStore.channelEdit = {
      isNew: false,
      channel,
      previousId: instance.id,
      id: instance.id,
      name: instance.name,
      enabled: instance.enabled,
      agentId: instance.agentId,
      sandboxEnabled: instance.sandboxEnabled,
      allowedChatIds: [...instance.allowedChatIds],
      fields: { ...instance.fields },
      secretValues: {},
      clearSecrets: [],
      files: { ...emptyProfileFiles(), ...(await loadDesktopBotFiles(endpoint, channel, instance.id)) }
    };
    channelsStore.actionMessage = "";
  } catch (cause) {
    setError(cause);
  } finally {
    channelsStore.editorLoading = false;
  }
}

export function updateChannelEdit(updater: (draft: ChannelEditor) => ChannelEditor): void {
  if (channelsStore.channelEdit) channelsStore.channelEdit = updater(channelsStore.channelEdit);
}

export function toggleChannelSecretClear(key: string): void {
  updateChannelEdit((draft) => ({
    ...draft,
    clearSecrets: draft.clearSecrets?.includes(key)
      ? draft.clearSecrets.filter((item) => item !== key)
      : [...(draft.clearSecrets ?? []), key]
  }));
}

export async function saveChannelEditor(): Promise<void> {
  const endpoint = session.endpoint;
  const channelEdit = channelsStore.channelEdit;
  if (!endpoint || !channelEdit || channelsStore.saving || !channelEdit.id.trim()) return;
  channelsStore.saving = true;
  session.error = "";
  try {
    channelsStore.channels = await saveDesktopChannel(endpoint, {
      channel: channelEdit.channel,
      previousId: channelEdit.isNew ? undefined : channelEdit.previousId,
      id: channelEdit.id.trim(),
      name: channelEdit.name,
      enabled: channelEdit.enabled,
      agentId: channelEdit.agentId,
      sandboxEnabled: channelEdit.sandboxEnabled,
      allowedChatIds: channelEdit.allowedChatIds,
      fields: channelEdit.fields,
      secretValues: channelEdit.secretValues,
      clearSecrets: channelEdit.clearSecrets
    });
    await saveDesktopBotFiles(endpoint, channelEdit.channel, channelEdit.id.trim(), channelEdit.files);
    channelsStore.channelEdit = null;
    channelsStore.actionMessage = session.text.channelSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    channelsStore.saving = false;
  }
}

export async function removeChannelInstance(channel: DesktopExternalChannel, instanceId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || channelsStore.saving || !window.confirm(session.text.channelDeleteConfirm)) return;
  channelsStore.saving = true;
  try {
    channelsStore.channels = await deleteDesktopChannel(endpoint, channel, instanceId);
    if (channelsStore.channelEdit?.channel === channel && channelsStore.channelEdit.previousId === instanceId) channelsStore.channelEdit = null;
    channelsStore.actionMessage = session.text.channelDeleted;
  } catch (cause) {
    setError(cause);
  } finally {
    channelsStore.saving = false;
  }
}

export async function testChannelEditor(): Promise<void> {
  const endpoint = session.endpoint;
  const channelEdit = channelsStore.channelEdit;
  if (!endpoint || !channelEdit || channelEdit.channel !== "feishu" || channelsStore.testing) return;
  channelsStore.testing = true;
  try {
    const result = await testDesktopChannel(endpoint, {
      channel: channelEdit.channel,
      instanceId: channelEdit.previousId ?? channelEdit.id,
      fields: channelEdit.fields,
      secretValues: channelEdit.secretValues
    });
    channelsStore.actionMessage = result.ok ? `${session.text.channelTestPassed}${result.label ? ` · ${result.label}` : ""}` : `${session.text.channelTestFailed}: ${result.error ?? ""}`;
  } catch (cause) {
    channelsStore.actionMessage = `${session.text.channelTestFailed}: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    channelsStore.testing = false;
  }
}

export async function generateChannelQr(): Promise<void> {
  const link = channelsStore.qrLink.replace(/\s+/g, "").trim();
  channelsStore.qrLink = link;
  channelsStore.qrImage = "";
  channelsStore.qrError = "";
  if (!link) {
    channelsStore.qrError = session.text.channelQrMissing;
    return;
  }
  channelsStore.qrLoading = true;
  try {
    qrModulePromise ??= import("qrcode") as Promise<QrModule>;
    const qr = await qrModulePromise;
    channelsStore.qrImage = await qr.toDataURL(link, { width: 320, margin: 2, errorCorrectionLevel: "M" });
  } catch (cause) {
    channelsStore.qrError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    channelsStore.qrLoading = false;
  }
}

export function clearChannelQr(): void {
  channelsStore.qrLink = "";
  channelsStore.qrImage = "";
  channelsStore.qrError = "";
}
