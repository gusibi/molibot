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

/**
 * Dotfiles with no real extension that are plain-text config. `extensionOf`
 * treats the whole filename as the extension (`.gitignore` -> ext `.gitignore`),
 * so without this set they fall through to `"binary"` and the Artifact Panel
 * offers only a system-open card instead of showing the contents. `.DS_Store`
 * and other binary dotfiles are deliberately omitted (issue #31 bug 3).
 */
const TEXT_DOTFILES = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".gitkeep",
  ".mailmap",
  ".dockerignore",
  ".npmignore",
  ".yarnignore",
  ".eslintignore",
  ".prettierignore",
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
  ".nvmrc",
  ".node-version",
  ".ruby-version",
  ".python-version",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  ".stylelintrc",
  ".bashrc",
  ".zshrc",
  ".profile",
  ".bash_profile"
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

  if (TEXT_DOTFILES.has(String(input.name ?? "").trim().toLowerCase())) return "text";

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
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".pjpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  // WebKit renders these natively on macOS, so the Project panel can show them inline.
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".caf": "audio/x-caf",
  ".silk": "audio/silk",
  ".amr": "audio/amr",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".ogv": "video/ogg",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".3gp": "video/3gpp",
  ".pdf": "application/pdf"
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

export type RawPreviewKind = "image" | "audio" | "video" | "pdf" | "file";

/**
 * What the Project file viewer can render for a filename by streaming its raw
 * bytes. Unlike `mediaTypeFromName` this separates PDF, which needs its own
 * embed rather than the media elements.
 */
export function rawPreviewKindFromName(filename: string): RawPreviewKind {
  const mime = mimeFromFilename(filename);
  if (!mime) return "file";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}
