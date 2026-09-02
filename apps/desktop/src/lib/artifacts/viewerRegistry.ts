import {
  classifyFilePreview,
  rawPreviewKindFromName
} from "@molibot/shared/filePreview";

/**
 * The Artifact Panel's viewer registry.
 *
 * One tab container holds file tabs, diff tabs and Mini App tabs side by side.
 * Selecting a viewer for a file tab is a pure function of the file's metadata
 * (name + declared MIME + media type), never a per-format `if/else` written in a
 * UI component (PRD §3.38, pitfall #7). The shared `classifyFilePreview` and
 * `rawPreviewKindFromName` already implement the empty-MIME -> extension
 * fallback (pitfall #26e: the WebView hands over an empty `File.type` for
 * drag-and-drop and unknown formats), so this registry leans on them rather than
 * re-deriving the rules.
 *
 * Slice 0 registered code, diff, media and system; Slice 1 added `html` and
 * `csv`; Slice 2 added `markdown`, `json` and `svg`; the spreadsheet and document
 * viewers add binary XLS/XLSX tables, sanitized DOCX rendering, and read-only
 * PPTX slides without making the panel parse formats itself. Every addition is
 * a branch here, never a new per-format rule in the panel template: the panel
 * only asks which viewer to mount.
 */

export type ArtifactTabKind = "file" | "diff" | "miniapp";

export type ArtifactScope = "project" | "session";

export type ArtifactViewerId =
  | "code"
  | "diff"
  | "media"
  | "html"
  | "csv"
  | "spreadsheet"
  | "docx"
  | "pptx"
  | "markdown"
  | "json"
  | "svg"
  | "system";

export interface ArtifactMeta {
  /** File name with extension; the primary evidence when MIME is empty. */
  name: string;
  /** Declared MIME type; empty for drag-and-drop / synthesized files. */
  mimeType?: string;
  /** Coarse media category from intake, when available. */
  mediaType?: string;
  /**
   * Owning scope. Never changes which viewer renders the tab — it decides
   * which transports and actions serve it (route URLs, reveal, download).
   */
  scope: ArtifactScope;
}

/** HTML extensions render as a sandboxed preview, not as source. */
const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);

/** CSV/TSV extensions render as a scrollable table with a raw-text toggle. */
const CSV_EXTENSIONS = new Set([".csv", ".tsv"]);

/** Excel workbooks render as a bounded, read-only table with sheet tabs. */
const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx"]);

/** DOCX documents render as a sanitized, read-only document surface. */
const DOCX_EXTENSIONS = new Set([".docx"]);

/** PPTX presentations render as read-only slide canvases. */
const PPTX_EXTENSIONS = new Set([".pptx"]);

/**
 * SVG is an image, but unlike a raster it also has readable source, so it gets
 * its own viewer (rendered / source toggle) rather than the plain media viewer.
 */
const SVG_EXTENSIONS = new Set([".svg"]);

/** Markdown renders through the transcript's own renderer, with a source toggle. */
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/** Plain-text extensions the shared classifier does not recognize as code. */
const TEXT_EXTENSIONS = new Set([".txt", ".log", ".text", ".mdx", ".ini", ".conf", ".cfg", ".env", ".toml"]);

function extensionOf(name: string): string {
  const lower = String(name ?? "").trim().toLowerCase();
  const index = lower.lastIndexOf(".");
  return index >= 0 ? lower.slice(index) : "";
}

/**
 * Media category from declared MIME / mediaType first (wins over a misleading
 * extension), then the extension fallback. Covers `.svg` (an image) and the
 * empty-MIME upload case that `classifyFilePreview` alone would miss.
 */
function detectMediaKind(meta: ArtifactMeta): "image" | "audio" | "video" | "pdf" | "file" {
  const mediaType = String(meta.mediaType ?? "").toLowerCase().trim();
  if (mediaType === "image" || mediaType === "audio" || mediaType === "video") return mediaType;
  const mime = String(meta.mimeType ?? "").toLowerCase().trim();
  const usable = mime && mime !== "application/octet-stream" ? mime : "";
  if (usable.startsWith("image/")) return "image";
  if (usable.startsWith("audio/")) return "audio";
  if (usable.startsWith("video/")) return "video";
  if (usable === "application/pdf") return "pdf";
  return rawPreviewKindFromName(meta.name);
}

/**
 * Maps a file tab's metadata to the viewer that should render it. Diff and Mini
 * App tabs are tab kinds, not file viewers - they never reach this function.
 */
export function matchViewer(meta: ArtifactMeta): ArtifactViewerId {
  // An agent-generated HTML page is a rendered artifact, not source: it opens in
  // the sandboxed HtmlPreview viewer (Slice 1a) so the user sees the page rather
  // than its markup. Special-cased before the media check because `.html` would
  // otherwise fall through to `code`.
  const ext = extensionOf(meta.name);
  if (HTML_EXTENSIONS.has(ext)) return "html";
  if (CSV_EXTENSIONS.has(ext)) return "csv";
  if (SPREADSHEET_EXTENSIONS.has(ext)) return "spreadsheet";
  if (DOCX_EXTENSIONS.has(ext)) return "docx";
  if (PPTX_EXTENSIONS.has(ext)) return "pptx";
  // Ahead of the media check: `.svg` is an image by MIME, but it renders through
  // its own viewer so the source stays one toggle away.
  if (SVG_EXTENSIONS.has(ext)) return "svg";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";

  const media = detectMediaKind(meta);
  if (media !== "file") return "media";

  const kind = classifyFilePreview({
    name: meta.name,
    mimeType: meta.mimeType,
    mediaType: meta.mediaType
  });

  if (isSpreadsheetMime(meta.mimeType)) return "spreadsheet";
  if (isDocxMime(meta.mimeType)) return "docx";
  if (isPptxMime(meta.mimeType)) return "pptx";
  if (kind === "office") return "system";
  // A declared MIME with no matching extension still reaches the right viewer.
  if (kind === "markdown") return "markdown";
  if (kind === "json") return "json";
  if (kind === "csv") return "csv";
  if (TEXT_EXTENSIONS.has(ext)) return "code";
  // Unknown binary (no recognized text/code extension, no media signature) has
  // no inline renderer: the system card offers reveal / open-with-system /
  // download.
  if (kind === "binary") return "system";
  // code, text, yaml -> CodeViewer.
  return "code";
}

/** True for file kinds the registry can render inline (not the system card). */
export function isInlineViewer(viewer: ArtifactViewerId): boolean {
  return viewer !== "system";
}

/**
 * Viewers that render decoded text and therefore need the tab's text content
 * loaded. `media` and `html` stream bytes through a URL instead, and `system`
 * renders no content at all.
 */
export function needsTextContent(viewer: ArtifactViewerId): boolean {
  return viewer === "code" || viewer === "csv" || viewer === "markdown" || viewer === "json" || viewer === "svg";
}

/**
 * Viewers that offer a rendered/source toggle. The toggle state lives in the
 * panel so switching tabs resets it, but which viewers *have* one is a registry
 * fact, not a template condition.
 */
export function hasSourceToggle(viewer: ArtifactViewerId): boolean {
  return viewer === "markdown" || viewer === "svg";
}

function isSpreadsheetMime(mimeType: string | undefined): boolean {
  const mime = String(mimeType ?? "").trim().toLowerCase();
  return mime === "application/vnd.ms-excel"
    || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mime === "application/vnd.ms-excel.sheet.macroenabled.12"
    || mime === "application/vnd.oasis.opendocument.spreadsheet";
}

function isDocxMime(mimeType: string | undefined): boolean {
  const mime = String(mimeType ?? "").trim().toLowerCase();
  return mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isPptxMime(mimeType: string | undefined): boolean {
  const mime = String(mimeType ?? "").trim().toLowerCase();
  return mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}
