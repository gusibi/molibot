import { telegramFileMemoryImporter } from "$lib/server/memory/importers/telegramFileImporter.js";
import type { MemoryImporter } from "$lib/server/memory/importers.js";

export const builtInMemoryImporters: MemoryImporter[] = [
  telegramFileMemoryImporter
];
