/**
 * Semantic glyph categories a file can render with. The UI maps each category
 * to a concrete Reicon component in `fileKindIcons.ts`; repository colours
 * (see `FILE_ICON_COLOR_BY_*`) carry language identity on top.
 */
export type FileIconKind =
  | "folder"
  | "folder-open"
  | "symlink"
  | "code"
  | "data"
  | "config"
  | "lock"
  | "text"
  | "document"
  | "sheet"
  | "slides"
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "zip"
  | "archive"
  | "file";

const FILE_KIND_BY_EXT: Record<string, FileIconKind> = {
  ts: "code", tsx: "code", mts: "code", cts: "code",
  js: "code", jsx: "code", mjs: "code", cjs: "code",
  vue: "code", svelte: "code", astro: "code",
  py: "code", pyw: "code", rs: "code",
  c: "code", h: "code", cpp: "code", cc: "code", cxx: "code", hpp: "code", hh: "code",
  cs: "code", java: "code", kt: "code", go: "code", rb: "code", php: "code", swift: "code",
  css: "code", scss: "code", sass: "code", less: "code",
  html: "code", htm: "code",
  md: "text", mdx: "text",
  json: "data", json5: "data", yaml: "data", yml: "data", toml: "data", xml: "data",
  sql: "data", graphql: "code", prisma: "code",
  sh: "code", bash: "code", zsh: "code",
  ini: "config", conf: "config", cfg: "config", env: "config",
  csv: "sheet", tsv: "sheet",
  svg: "image", pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", bmp: "image", webp: "image", ico: "image",
  mp3: "audio", wav: "audio", flac: "audio", m4a: "audio", ogg: "audio", aac: "audio",
  mp4: "video", mov: "video", webm: "video", avi: "video", mkv: "video",
  zip: "zip", tar: "archive", gz: "archive", tgz: "archive", rar: "archive", "7z": "archive",
  xls: "sheet", xlsx: "sheet", doc: "document", docx: "document", ppt: "slides", pptx: "slides",
  txt: "text", log: "text", lock: "lock"
};

const FILE_KIND_BY_NAME: Record<string, FileIconKind> = {
  "dockerfile": "code",
  "makefile": "code",
  "cmakelists.txt": "code",
  "readme": "text",
  "readme.md": "text",
  "changelog.md": "text",
  "license": "text",
  "license.md": "text",
  ".gitignore": "config",
  ".gitattributes": "config",
  ".editorconfig": "config",
  ".env": "config",
  ".env.local": "config",
  "package.json": "data",
  "package-lock.json": "lock",
  "pnpm-lock.yaml": "lock",
  "yarn.lock": "lock"
};

/*
 * These are the familiar language colours used by repository/code browsers.
 * They are intentionally data, not extension-specific CSS rules, so the same
 * result is shared by the tree, search hits, open tabs, and system card.
 */
const FILE_ICON_COLOR_BY_EXT: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", mts: "#3178c6", cts: "#3178c6",
  js: "#f1e05a", jsx: "#f1e05a", mjs: "#f1e05a", cjs: "#f1e05a",
  vue: "#41b883", svelte: "#ff3e00", astro: "#ff5d01",
  py: "#3776ab", pyw: "#3776ab", rs: "#dea584",
  c: "#555555", h: "#555555", cpp: "#f34b7d", cc: "#f34b7d", cxx: "#f34b7d", hpp: "#f34b7d", hh: "#f34b7d",
  cs: "#178600", java: "#b07219", kt: "#a97bff", go: "#00add8", rb: "#701516", php: "#4f5d95", swift: "#f05138",
  css: "#563d7c", scss: "#c6538c", sass: "#c6538c", less: "#1d365d",
  html: "#e34c26", htm: "#e34c26",
  md: "#0969da", mdx: "#0969da",
  json: "#cbcb41", json5: "#cbcb41", yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221", xml: "#e37933",
  sql: "#e38c00", graphql: "#e10098", prisma: "#2d3748",
  sh: "#89e051", bash: "#89e051", zsh: "#89e051",
  ini: "#6d8086", conf: "#6d8086", cfg: "#6d8086", env: "#ecd53f",
  csv: "#237346", tsv: "#237346",
  svg: "#ffb13b", pdf: "#f40f02",
  png: "#a074c4", jpg: "#a074c4", jpeg: "#a074c4", gif: "#a074c4", bmp: "#a074c4", webp: "#a074c4", ico: "#a074c4",
  mp3: "#e879f9", wav: "#e879f9", flac: "#e879f9", m4a: "#e879f9", ogg: "#e879f9", aac: "#e879f9",
  mp4: "#8c8c8c", mov: "#8c8c8c", webm: "#8c8c8c", avi: "#8c8c8c", mkv: "#8c8c8c",
  zip: "#737373", tar: "#737373", gz: "#737373", tgz: "#737373", rar: "#737373", "7z": "#737373",
  xls: "#1d6f42", xlsx: "#1d6f42", doc: "#2b579a", docx: "#2b579a", ppt: "#c43e1c", pptx: "#c43e1c",
  txt: "#6e7781", log: "#6e7781", lock: "#8b949e"
};

const FILE_ICON_COLOR_BY_NAME: Record<string, string> = {
  dockerfile: "#2496ed",
  makefile: "#6e7781",
  "package.json": "#cb3837",
  "package-lock.json": "#cb3837",
  "pnpm-lock.yaml": "#f69220",
  "yarn.lock": "#2c8ebb",
  "readme.md": "#0969da",
  "changelog.md": "#0969da",
  license: "#6e7781",
  "license.md": "#0969da",
  ".gitignore": "#f05032",
  ".gitattributes": "#f05032",
  ".editorconfig": "#6d8086",
  ".env": "#ecd53f",
  ".env.local": "#ecd53f"
};

const DIRECTORY_ICON_COLOR = "#54aeff";

function extensionOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

export function fileIconKind(name: string, kind: string, expanded = false): FileIconKind {
  if (kind === "directory") return expanded ? "folder-open" : "folder";
  if (kind === "symlink") return "symlink";
  const namedKind = FILE_KIND_BY_NAME[name.toLowerCase()];
  if (namedKind) return namedKind;
  return FILE_KIND_BY_EXT[extensionOf(name)] || "file";
}

export function fileIconStyle(name: string, kind: string): string {
  if (kind === "directory") return `--file-color: ${DIRECTORY_ICON_COLOR};`;
  if (kind !== "file") return "";
  const normalizedName = name.toLowerCase();
  const color = FILE_ICON_COLOR_BY_NAME[normalizedName] || FILE_ICON_COLOR_BY_EXT[extensionOf(normalizedName)];
  return color ? `--file-color: ${color};` : "";
}

const SIZE_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function formatSize(bytes = 0): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${index === 0 ? String(value) : SIZE_FORMAT.format(value)} ${units[index]}`;
}
