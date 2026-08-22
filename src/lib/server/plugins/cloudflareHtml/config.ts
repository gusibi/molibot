import { getPluginConfigStore, type PluginConfigStore } from "$lib/server/plugins/contract/configStore.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

export interface CloudflareHtmlPluginConfig {
  enabled: boolean;
  accessMode: "worker" | "direct";
  workerBaseHost: string;
  publicBaseHost: string;
  routePrefix: string;
  bucketName: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectPrefix: string;
}

export const DEFAULT_CLOUDFLARE_HTML_CONFIG: CloudflareHtmlPluginConfig = {
  enabled: false,
  accessMode: "worker",
  workerBaseHost: "",
  publicBaseHost: "",
  routePrefix: "/html",
  bucketName: "",
  accountId: "",
  accessKeyId: "",
  secretAccessKey: "",
  objectPrefix: "html/"
};

export function resolveCloudflareHtmlConfig(settings?: RuntimeSettings, injectedStore?: PluginConfigStore): CloudflareHtmlPluginConfig {
  const hostEnabled = Boolean(settings?.plugins?.entries?.["cloudflare-html"]?.enabled ?? settings?.plugins?.cloudflareHtml?.enabled);
  let diskConfig: Record<string, unknown> = {};
  let secretAccessKey = "";

  try {
    const configStore = injectedStore ?? getPluginConfigStore();
    const readRes = configStore.readConfig("cloudflare-html", 1);
    if (readRes.status === "ok") diskConfig = readRes.values;
    secretAccessKey = configStore.readSecretValues("cloudflare-html").secretAccessKey ?? "";
  } catch {
    // The legacy built-in remains usable until it is migrated as its own slice.
  }

  const legacy = settings?.plugins?.cloudflareHtml;

  return {
    enabled: hostEnabled,
    accessMode: (diskConfig.accessMode as any) ?? legacy?.accessMode ?? DEFAULT_CLOUDFLARE_HTML_CONFIG.accessMode,
    workerBaseHost: String(diskConfig.workerBaseHost ?? legacy?.workerBaseHost ?? "").trim(),
    publicBaseHost: String(diskConfig.publicBaseHost ?? legacy?.publicBaseHost ?? "").trim(),
    routePrefix: String(diskConfig.routePrefix ?? legacy?.routePrefix ?? DEFAULT_CLOUDFLARE_HTML_CONFIG.routePrefix).trim(),
    bucketName: String(diskConfig.bucketName ?? legacy?.bucketName ?? "").trim(),
    accountId: String(diskConfig.accountId ?? legacy?.accountId ?? "").trim(),
    accessKeyId: String(diskConfig.accessKeyId ?? legacy?.accessKeyId ?? "").trim(),
    secretAccessKey: secretAccessKey || legacy?.secretAccessKey || "",
    objectPrefix: String(diskConfig.objectPrefix ?? legacy?.objectPrefix ?? DEFAULT_CLOUDFLARE_HTML_CONFIG.objectPrefix).trim()
  };
}
