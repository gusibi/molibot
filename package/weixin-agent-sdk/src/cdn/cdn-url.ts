/**
 * Unified CDN URL construction for Weixin CDN upload/download.
 */

/** 设为 true 时，当服务端未返回 full_url 字段，回退到客户端拼接 URL；false 则直接报错。 */
export const ENABLE_CDN_URL_FALLBACK = true;

/** Build a CDN download URL from encrypt_query_param. */
export function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

/** Prefer the server-signed URL; otherwise construct it from the supplied upload parameter. */
export function buildCdnUploadUrl(params: {
  cdnBaseUrl: string;
  uploadParam?: string;
  uploadFullUrl?: string;
  filekey: string;
}): string {
  const fullUrl = params.uploadFullUrl?.trim();
  if (fullUrl) return fullUrl;
  if (!params.uploadParam) throw new Error("Weixin getuploadurl returned no upload URL");
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}
