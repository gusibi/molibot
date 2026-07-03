// Bot/profile markdown file names shared by the channels and web-profiles
// editors, plus a helper that seeds an empty editable set.
export const PROFILE_FILE_NAMES = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;

export function emptyProfileFiles(): Record<string, string> {
  return Object.fromEntries(PROFILE_FILE_NAMES.map((name) => [name, ""]));
}
