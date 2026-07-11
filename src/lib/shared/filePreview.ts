export type FilePreviewKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "markdown"
  | "json"
  | "csv"
  | "yaml"
  | "code"
  | "text"
  | "office"
  | "binary";

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".xml"
]);

const OFFICE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".odp",
  ".ods",
  ".odt",
  ".ppt",
  ".pptx",
  ".rtf",
  ".xls",
  ".xlsx"
]);

function extensionOf(name: string): string {
  const trimmed = String(name ?? "").trim().toLowerCase();
  const index = trimmed.lastIndexOf(".");
  return index >= 0 ? trimmed.slice(index) : "";
}

export function classifyFilePreview(input: {
  name?: string;
  mimeType?: string;
  mediaType?: string;
}): FilePreviewKind {
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const mediaType = String(input.mediaType ?? "").trim().toLowerCase();
  const ext = extensionOf(String(input.name ?? ""));

  if (mediaType === "image" || mimeType.startsWith("image/")) return "image";
  if (mediaType === "audio" || mimeType.startsWith("audio/")) return "audio";
  if (mediaType === "video" || mimeType.startsWith("video/")) return "video";

  if (mimeType === "application/pdf" || ext === ".pdf") return "pdf";
  if (mimeType === "text/markdown" || ext === ".md") return "markdown";
  if (mimeType === "application/json" || ext === ".json") return "json";
  if (mimeType === "text/csv" || ext === ".csv") return "csv";
  if (
    mimeType === "application/x-yaml" ||
    mimeType === "text/yaml" ||
    ext === ".yaml" ||
    ext === ".yml"
  ) {
    return "yaml";
  }

  if (mimeType.startsWith("text/")) {
    if (CODE_EXTENSIONS.has(ext)) return "code";
    return "text";
  }

  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (OFFICE_EXTENSIONS.has(ext)) return "office";

  if (
    mimeType.includes("word") ||
    mimeType.includes("sheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("powerpoint") ||
    mimeType.includes("presentation") ||
    mimeType.includes("officedocument")
  ) {
    return "office";
  }

  return "binary";
}

export function isTextPreviewKind(kind: FilePreviewKind): boolean {
  return (
    kind === "markdown" ||
    kind === "json" ||
    kind === "csv" ||
    kind === "yaml" ||
    kind === "code" ||
    kind === "text"
  );
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".silk": "audio/silk",
  ".amr": "audio/amr",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo"
};

/** Best-effort MIME type from a filename's extension. Returns null when unknown. */
export function mimeFromFilename(filename: string): string | null {
  const mime = MIME_BY_EXTENSION[extensionOf(filename)];
  return mime ?? null;
}

/** Derives a coarse media category from a filename for attachment rendering. */
export function mediaTypeFromName(filename: string): "image" | "audio" | "video" | "file" {
  const mime = mimeFromFilename(filename);
  if (!mime) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}
