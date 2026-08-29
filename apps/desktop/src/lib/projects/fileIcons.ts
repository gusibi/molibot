const FILE_ICON_BY_EXT: Record<string, string> = {
  ts: "ph-file-ts", tsx: "ph-file-tsx", mts: "ph-file-ts", cts: "ph-file-ts",
  js: "ph-file-js", jsx: "ph-file-jsx", mjs: "ph-file-js", cjs: "ph-file-js",
  vue: "ph-file-vue", svelte: "ph-file-code", astro: "ph-file-code",
  py: "ph-file-py", pyw: "ph-file-py", rs: "ph-file-rs",
  c: "ph-file-c", h: "ph-file-c", cpp: "ph-file-cpp", cc: "ph-file-cpp", cxx: "ph-file-cpp", hpp: "ph-file-cpp", hh: "ph-file-cpp",
  cs: "ph-file-c-sharp", java: "ph-file-code", kt: "ph-file-code", go: "ph-file-code", rb: "ph-file-code", php: "ph-file-code", swift: "ph-file-code",
  css: "ph-file-css", scss: "ph-file-css", sass: "ph-file-css", less: "ph-file-css",
  html: "ph-file-html", htm: "ph-file-html",
  md: "ph-file-md", mdx: "ph-file-md",
  json: "ph-file-code", json5: "ph-file-code", yaml: "ph-file-code", yml: "ph-file-code", toml: "ph-file-code", xml: "ph-file-code",
  sql: "ph-file-sql", graphql: "ph-file-code", prisma: "ph-file-code",
  sh: "ph-file-code", bash: "ph-file-code", zsh: "ph-file-code",
  ini: "ph-file-ini", conf: "ph-file-ini", cfg: "ph-file-ini", env: "ph-file-ini",
  csv: "ph-file-csv", tsv: "ph-file-csv",
  svg: "ph-file-svg", pdf: "ph-file-pdf",
  png: "ph-file-png", jpg: "ph-file-jpg", jpeg: "ph-file-jpg", gif: "ph-file-image", bmp: "ph-file-image", webp: "ph-file-image", ico: "ph-file-image",
  mp3: "ph-file-audio", wav: "ph-file-audio", flac: "ph-file-audio", m4a: "ph-file-audio", ogg: "ph-file-audio", aac: "ph-file-audio",
  mp4: "ph-file-video", mov: "ph-file-video", webm: "ph-file-video", avi: "ph-file-video", mkv: "ph-file-video",
  zip: "ph-file-zip", tar: "ph-file-archive", gz: "ph-file-archive", tgz: "ph-file-archive", rar: "ph-file-archive", "7z": "ph-file-archive",
  xls: "ph-file-xls", xlsx: "ph-file-xls", doc: "ph-file-doc", docx: "ph-file-doc", ppt: "ph-file-ppt", pptx: "ph-file-ppt",
  txt: "ph-file-txt", log: "ph-file-txt", lock: "ph-file-lock"
};

const FILE_ICON_BY_NAME: Record<string, string> = {
  "dockerfile": "ph-file-code",
  "makefile": "ph-file-code",
  "cmakelists.txt": "ph-file-code",
  "readme": "ph-file-md",
  "readme.md": "ph-file-md",
  "changelog.md": "ph-file-md",
  "license": "ph-file-text",
  "license.md": "ph-file-md",
  ".gitignore": "ph-file-dotted",
  ".gitattributes": "ph-file-dotted",
  ".editorconfig": "ph-file-ini",
  ".env": "ph-file-ini",
  ".env.local": "ph-file-ini",
  "package.json": "ph-file-code",
  "package-lock.json": "ph-file-lock",
  "pnpm-lock.yaml": "ph-file-lock",
  "yarn.lock": "ph-file-lock"
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

export function fileIconName(name: string, kind: string, expanded = false): string {
  if (kind === "directory") return expanded ? "ph-folder-open" : "ph-folder-simple";
  if (kind === "symlink") return "ph-link";
  const namedIcon = FILE_ICON_BY_NAME[name.toLowerCase()];
  if (namedIcon) return namedIcon;
  return FILE_ICON_BY_EXT[extensionOf(name)] || "ph-file-text";
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
