import { createHash, createHmac, randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "../../settings/index.js";

const publishHtmlSchema = Type.Object({
  html: Type.String(),
  title: Type.Optional(Type.String())
});

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function normalizeBaseUrl(value: string): string {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function normalizeRoutePrefix(value: string): string {
  const raw = String(value ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return raw ? `/${raw}` : "/html";
}

function normalizeObjectPrefix(value: string): string {
  const raw = String(value ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return raw ? `${raw}/` : "html/";
}

function stripLeadingSlashes(value: string): string {
  return String(value ?? "").replace(/^\/+/, "");
}

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isCompleteHtmlDocument(html: string): boolean {
  const source = String(html ?? "").trim().toLowerCase();
  return (
    source.includes("<html") &&
    source.includes("<head") &&
    source.includes("<body") &&
    (source.includes("</html>") || source.includes("</body>"))
  );
}

function buildTimestamp(date: Date): { amzDate: string; shortDate: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    shortDate: iso.slice(0, 8)
  };
}

function buildAuthorization(options: {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  bucketName: string;
  objectKey: string;
  payload: string;
  contentType: string;
  now: Date;
}): { url: string; headers: Record<string, string> } {
  const host = `${options.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${options.bucketName}/${encodeObjectKey(options.objectKey)}`;
  const { amzDate, shortDate } = buildTimestamp(options.now);
  const payloadHash = sha256Hex(options.payload);
  const canonicalHeaders =
    `content-type:${options.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${shortDate}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const dateKey = hmac(`AWS4${options.secretAccessKey}`, shortDate);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      authorization,
      "content-type": options.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    }
  };
}

function buildPublicUrl(settings: RuntimeSettings["plugins"]["cloudflareHtml"], fileName: string): string {
  if (settings.accessMode === "direct") {
    const baseUrl = normalizeBaseUrl(settings.publicBaseHost);
    const objectKey = `${normalizeObjectPrefix(settings.objectPrefix)}${fileName}`;
    return `${baseUrl}/${stripLeadingSlashes(objectKey)}`;
  }
  const baseUrl = normalizeBaseUrl(settings.workerBaseHost);
  const routePrefix = normalizeRoutePrefix(settings.routePrefix);
  return `${baseUrl}${routePrefix}/${fileName}`;
}

function ensureConfigured(settings: RuntimeSettings["plugins"]["cloudflareHtml"]): string | null {
  if (!settings.enabled) return "Cloudflare HTML publish plugin is disabled in settings.";
  if (settings.accessMode === "direct" && !settings.publicBaseHost) {
    return "Cloudflare HTML publish plugin is missing publicBaseHost.";
  }
  if (settings.accessMode !== "direct" && !settings.workerBaseHost) {
    return "Cloudflare HTML publish plugin is missing workerBaseHost.";
  }
  if (!settings.bucketName) return "Cloudflare HTML publish plugin is missing bucketName.";
  if (!settings.accountId) return "Cloudflare HTML publish plugin is missing accountId.";
  if (!settings.accessKeyId) return "Cloudflare HTML publish plugin is missing accessKeyId.";
  if (!settings.secretAccessKey) return "Cloudflare HTML publish plugin is missing secretAccessKey.";
  return null;
}

export function createCloudflareHtmlPublishTool(
  getSettings: () => RuntimeSettings
): AgentTool<typeof publishHtmlSchema> {
  return {
    name: "publish_html",
    label: "publish_html",
    description:
      "Upload a complete HTML document to the configured Cloudflare R2 bucket and return the public URL.",
    parameters: publishHtmlSchema,
    execute: async (_toolCallId, params) => {
      const settings = getSettings().plugins.cloudflareHtml;
      const configError = ensureConfigured(settings);
      if (configError) throw new Error(configError);
      if (!isCompleteHtmlDocument(params.html)) {
        throw new Error("publish_html requires a complete HTML document with <html>, <head>, and <body>.");
      }

      const fileName = `${randomUUID().replace(/-/g, "").slice(0, 20)}.html`;
      const objectKey = `${normalizeObjectPrefix(settings.objectPrefix)}${fileName}`;
      const contentType = "text/html; charset=utf-8";
      const signed = buildAuthorization({
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
        accountId: settings.accountId,
        bucketName: settings.bucketName,
        objectKey,
        payload: params.html,
        contentType,
        now: new Date()
      });
      const response = await fetch(signed.url, {
        method: "PUT",
        headers: signed.headers,
        body: params.html
      });
      if (!response.ok) {
        throw new Error(`Cloudflare R2 upload failed (${response.status}): ${await response.text()}`);
      }

      const publicUrl = buildPublicUrl(settings, fileName);
      return {
        content: [{ type: "text", text: `Published HTML: ${publicUrl}` }],
        details: {
          fileName,
          objectKey,
          url: publicUrl,
          title: String(params.title ?? "").trim()
        }
      };
    }
  };
}
