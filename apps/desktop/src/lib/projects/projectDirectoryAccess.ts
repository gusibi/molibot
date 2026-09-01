/** Permission failures emitted when the sidecar cannot enumerate a Project root. */
export function isProjectDirectoryAccessError(message: string | undefined): boolean {
  return /\b(?:EPERM|EACCES)\b[\s\S]*\b(?:scandir|readdir)\b/i.test(String(message ?? ""));
}

/** Compares the persisted root with the path returned by the native folder picker. */
export function sameProjectDirectory(selected: string, expected: string): boolean {
  const normalize = (value: string) => value
    .normalize("NFC")
    .replaceAll("\\", "/")
    .replace(/\/+$/, "");
  return Boolean(selected && expected) && normalize(selected) === normalize(expected);
}
