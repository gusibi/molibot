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

const FILE_ICON_COLOR_BY_EXT: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", mts: "#3178c6", cts: "#3178c6",
  js: "#e8d44d", jsx: "#e8d44d", mjs: "#e8d44d", cjs: "#e8d44d",
  vue: "#41b883", svelte: "#ff3e00", astro: "#a371f7",
  py: "#3776ab", rs: "#dea584",
  c: "#519aba", h: "#519aba", cpp: "#519aba", cc: "#519aba", cxx: "#519aba", hpp: "#519aba", hh: "#519aba",
  cs: "#178600", java: "#5382a1", kt: "#a97bff", go: "#00add8", rb: "#cc342d", php: "#777bb4", swift: "#f05138",
  css: "#2965f1", scss: "#c6538c", sass: "#cd6799", less: "#2965f1",
  html: "#e34c26", htm: "#e34c26",
  md: "#519aba", mdx: "#519aba",
  json: "#519aba", json5: "#519aba", yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221", xml: "#e37933",
  sql: "#e38c00", svg: "#ffb13b", pdf: "#e53935",
  png: "#a371f7", jpg: "#a371f7", jpeg: "#a371f7", gif: "#a371f7", bmp: "#a371f7", webp: "#a371f7", ico: "#a371f7",
  mp3: "#e879f9", wav: "#e879f9", flac: "#e879f9", m4a: "#e879f9", ogg: "#e879f9", aac: "#e879f9",
  mp4: "#e879f9", mov: "#e879f9", webm: "#e879f9", avi: "#e879f9", mkv: "#e879f9",
  zip: "#737373", tar: "#737373", gz: "#737373", rar: "#737373",
  xls: "#1d6f42", xlsx: "#1d6f42", csv: "#1d6f42", tsv: "#1d6f42",
  doc: "#2b579a", docx: "#2b579a", ppt: "#c43e1c", pptx: "#c43e1c", lock: "#a371f7"
};

function extensionOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

export function fileIconName(name: string, kind: string, expanded = false): string {
  if (kind === "directory") return expanded ? "ph-folder-open" : "ph-folder-simple";
  if (kind === "symlink") return "ph-link";
  return FILE_ICON_BY_EXT[extensionOf(name)] || "ph-file-text";
}

export function fileIconStyle(name: string, kind: string): string {
  if (kind !== "file") return "";
  const color = FILE_ICON_COLOR_BY_EXT[extensionOf(name)];
  return color ? `--file-color: ${color};` : "";
}

export function formatSize(bytes = 0): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${index === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}
