import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { BuiltInFeaturePlugin } from "$lib/server/plugins/types.js";
import { createCloudflareHtmlPublishTool } from "$lib/server/plugins/cloudflareHtml/publishHtmlTool.js";
import { resolveCloudflareHtmlConfig } from "./config.js";

function isCloudflareHtmlConfigured(settings: RuntimeSettings): boolean {
  const plugin = resolveCloudflareHtmlConfig(settings);
  const hasPublicHost = plugin.accessMode === "direct"
    ? Boolean(plugin.publicBaseHost)
    : Boolean(plugin.workerBaseHost);
  return Boolean(
    plugin.enabled &&
    hasPublicHost &&
    plugin.bucketName &&
    plugin.accountId &&
    plugin.accessKeyId &&
    plugin.secretAccessKey
  );
}

export const cloudflareHtmlFeaturePlugin: BuiltInFeaturePlugin = {
  key: "cloudflare-html",
  settingsKey: "entries",
  name: "Cloudflare HTML Publish",
  version: "built-in",
  description: "Upload complete HTML pages to Cloudflare R2 and return a shareable public link.",
  isEnabled: (settings) => resolveCloudflareHtmlConfig(settings).enabled,
  buildPromptSection: (settings) => {
    const plugin = resolveCloudflareHtmlConfig(settings);
    if (!plugin.enabled) return null;
    const routePrefix = plugin.routePrefix || "/html";
    const objectPrefix = plugin.objectPrefix || "html/";
    const publicPattern = plugin.accessMode === "direct"
      ? `${plugin.publicBaseHost}/${objectPrefix}<random>.html`
      : `${plugin.workerBaseHost}${routePrefix}/<random>.html`;
    if (!isCloudflareHtmlConfigured(settings)) {
      return [
        "## Installed Feature Plugin: Cloudflare HTML Publish",
        "- This plugin is enabled but not fully configured.",
        "- Do not claim HTML publishing is available until the Cloudflare bucket, account, keys, and the selected public-link host are filled in Settings."
      ].join("\n");
    }
    return [
      "## Installed Feature Plugin: Cloudflare HTML Publish",
      "- When you finish a complete local HTML file and the user expects a shareable link, call `publishHtml` before your final answer.",
      "- Only upload local HTML files whose contents are complete documents with `<html>`, `<head>`, and `<body>`.",
      `- Public link mode: ${plugin.accessMode === "direct" ? "Direct R2" : "Worker"}`,
      `- Successful uploads become public at: ${publicPattern}`,
      `- Upload destination prefix inside R2: ${objectPrefix}`,
      "- Never invent a URL. If upload fails, say it failed and report the real error."
    ].join("\n");
  },
  createTools: (context) => {
    if (!isCloudflareHtmlConfigured(context.getSettings())) return [];
    return [createCloudflareHtmlPublishTool(context)];
  }
};
