// Tauri bridge for the on-disk imported-theme store. Parsing and token mapping
// live in lib/theme/vscodeTheme.ts; this module only moves records and file text
// across the native boundary.

import { invoke } from "@tauri-apps/api/core";
import type { StoredImportedTheme } from "../theme/vscodeTheme";

export interface ThemeSourceFile {
  fileName: string;
  contents: string;
}

export type ThemeDirectoryKind = "builtin" | "extensions";

export interface ThemeSourceDirectory {
  id: string;
  kind: ThemeDirectoryKind;
  path: string;
  /** The folder exists and contains at least one extension that ships a color theme. */
  hasThemes: boolean;
}

export async function listImportedThemes(): Promise<StoredImportedTheme[]> {
  return invoke<StoredImportedTheme[]>("list_imported_themes");
}

export async function saveImportedTheme(theme: StoredImportedTheme): Promise<void> {
  await invoke("save_imported_theme", { theme });
}

export async function deleteImportedTheme(id: string): Promise<void> {
  await invoke("delete_imported_theme", { id });
}

/** Opens the native picker; resolves to `null` when the user cancels. */
export async function pickThemeSourceFile(): Promise<ThemeSourceFile | null> {
  return invoke<ThemeSourceFile | null>("pick_theme_source_file");
}

/** Editor theme folders that exist on this machine, for the "open folder" buttons. */
export async function listThemeDirectories(): Promise<ThemeSourceDirectory[]> {
  return invoke<ThemeSourceDirectory[]>("list_theme_directories");
}

export async function openThemeDirectory(id: string): Promise<void> {
  await invoke("open_theme_directory", { id });
}
