import { buildBaseInfo, classifyFetchError } from "../api/api.js";
import { encryptAesEcb } from "./aes-ecb.js";
import { buildCdnUploadUrl } from "./cdn-url.js";
import { logger } from "../util/logger.js";
import { describeNetworkError, networkRuntimeInfo, safeDiagnosticText } from "../util/network-diagnostics.js";
import { redactUrl } from "../util/redact.js";

/** Maximum retry attempts for CDN upload. */
const UPLOAD_MAX_RETRIES = 3;

/**
 * Upload one buffer to the Weixin CDN with AES-128-ECB encryption.
 * Returns the download encrypted_query_param from the CDN response.
 * Retries up to UPLOAD_MAX_RETRIES times on server errors; client errors (4xx) abort immediately.
 */
export async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadParam?: string;
  uploadFullUrl?: string;
  filekey: string;
  cdnBaseUrl: string;
  label: string;
  aeskey: Buffer;
}): Promise<{ downloadParam: string }> {
  const { buf, uploadParam, uploadFullUrl, filekey, cdnBaseUrl, label, aeskey } = params;
  const ciphertext = encryptAesEcb(buf, aeskey);
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, uploadFullUrl, filekey });
  logger.debug(`${label}: CDN POST url=${redactUrl(cdnUrl)} ciphertextSize=${ciphertext.length}`);

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    const startedAt = performance.now();
    try {
      const res = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get("x-error-message") ?? (await res.text());
        logger.error(
          `${label}: CDN client error attempt=${attempt} status=${res.status} errMsg=${safeDiagnosticText(errMsg)}`,
        );
        throw new Error(`CDN upload client error ${res.status}: ${safeDiagnosticText(errMsg)}`);
      }
      if (res.status !== 200) {
        const errMsg = res.headers.get("x-error-message") ?? `status ${res.status}`;
        logger.error(
          `${label}: CDN server error attempt=${attempt} status=${res.status} errMsg=${safeDiagnosticText(errMsg)}`,
        );
        throw new Error(`CDN upload server error: ${safeDiagnosticText(errMsg)}`);
      }
      downloadParam = res.headers.get("x-encrypted-param") ?? undefined;
      if (!downloadParam) {
        logger.error(
          `${label}: CDN response missing x-encrypted-param header attempt=${attempt}`,
        );
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      logger.debug(`${label}: CDN upload success attempt=${attempt}`);
      break;
    } catch (err) {
      logger.error(JSON.stringify({
        event: "cdn_upload_failed", filekey, attempt,
        elapsedMs: Math.round(performance.now() - startedAt),
        endpoint: redactUrl(cdnUrl), ciphertextSize: ciphertext.length,
        uploadAddressKind: uploadFullUrl?.trim() ? "full_url" : "parameter",
        runtime: { ...networkRuntimeInfo(), sdkChannelVersion: buildBaseInfo().channel_version }, errorDetails: describeNetworkError(err)
      }));
      const failure = classifyFetchError(err);
      lastError = err instanceof Error && err.message === "fetch failed"
        ? new Error(`Weixin CDN upload failed: ${failure.type}${failure.code ? ` (${failure.code})` : ""}: ${failure.description}`, { cause: err })
        : err;
      if (err instanceof Error && err.message.includes("client error")) throw err;
      if (attempt < UPLOAD_MAX_RETRIES) {
        logger.error(
          `${label}: attempt ${attempt} failed, retrying... url=${redactUrl(cdnUrl)} error=${safeDiagnosticText(err)}`,
        );
      } else {
        logger.error(
          `${label}: all ${UPLOAD_MAX_RETRIES} attempts failed url=${redactUrl(cdnUrl)} error=${safeDiagnosticText(err)}`,
        );
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
  }
  return { downloadParam };
}
