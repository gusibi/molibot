import type { RuntimeSettings } from "../../settings/index.js";
import type { BuiltInFeaturePlugin, PluginSettingField } from "../types.js";
import { createCloudflareHtmlPublishTool } from "./publishHtmlTool.js";

const cloudflareHtmlSettingsFields: PluginSettingField[] = [
  {
    key: "enabled",
    label: "Enable Cloudflare HTML publish",
    type: "boolean",
    defaultValue: false,
    description: "Turn on this plugin so Agent can publish complete HTML pages."
  },
  {
    key: "accessMode",
    label: "Public link mode",
    type: "select",
    defaultValue: "worker",
    description: "Choose whether final links are returned through your Worker or directly through a public R2 host.",
    options: [
      { value: "worker", label: "Worker" },
      { value: "direct", label: "Direct R2" }
    ]
  },
  {
    key: "workerBaseHost",
    label: "Worker base host",
    type: "text",
    placeholder: "https://html.example.com",
    description: "Used when public link mode is Worker."
  },
  {
    key: "publicBaseHost",
    label: "Public R2 base host",
    type: "text",
    placeholder: "https://pub-xxxxxxxx.r2.dev",
    description: "Used when public link mode is Direct R2."
  },
  {
    key: "routePrefix",
    label: "Route prefix",
    type: "text",
    defaultValue: "/html",
    placeholder: "/html",
    description: "Public route prefix served by your Worker."
  },
  {
    key: "bucketName",
    label: "Bucket name",
    type: "text",
    required: true,
    description: "R2 bucket used for HTML uploads."
  },
  {
    key: "accountId",
    label: "Account ID",
    type: "text",
    required: true
  },
  {
    key: "accessKeyId",
    label: "Access Key ID",
    type: "text",
    required: true
  },
  {
    key: "secretAccessKey",
    label: "Secret Access Key",
    type: "password",
    required: true
  },
  {
    key: "objectPrefix",
    label: "R2 object prefix",
    type: "text",
    defaultValue: "html/",
    placeholder: "html/",
    description: "Objects are uploaded into this prefix inside the bucket."
  }
];

function isCloudflareHtmlConfigured(settings: RuntimeSettings): boolean {
  const plugin = settings.plugins.cloudflareHtml;
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
  key: "cloudflare-html-publish",
  name: "Cloudflare HTML Publish",
  version: "built-in",
  description: "Upload complete HTML pages to Cloudflare R2 and return a shareable public link.",
  settingsKey: "cloudflareHtml",
  settingsFields: cloudflareHtmlSettingsFields,
  isEnabled: (settings) => settings.plugins.cloudflareHtml.enabled,
  buildPromptSection: (settings) => {
    const plugin = settings.plugins.cloudflareHtml;
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
      "- When you finish a complete HTML page and the user expects a shareable link, call `publish_html` before your final answer.",
      "- Only upload complete documents that include `<html>`, `<head>`, and `<body>`.",
      `- Public link mode: ${plugin.accessMode === "direct" ? "Direct R2" : "Worker"}`,
      `- Successful uploads become public at: ${publicPattern}`,
      `- Upload destination prefix inside R2: ${objectPrefix}`,
      "- Never invent a URL. If upload fails, say it failed and report the real error."
    ].join("\n");
  },
  createTools: (context) => {
    if (!isCloudflareHtmlConfigured(context.getSettings())) return [];
    return [createCloudflareHtmlPublishTool(context.getSettings)];
  }
};
