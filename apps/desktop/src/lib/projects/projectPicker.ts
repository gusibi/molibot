export function projectNameFromPath(selectedPath: string): string {
  const normalized = String(selectedPath ?? "").trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) ?? "";
}
