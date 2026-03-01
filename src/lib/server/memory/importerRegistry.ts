import { telegramFileMemoryImporter } from "./importers/telegramFileImporter.js";
import type { MemoryImporter } from "./importers.js";

export const builtInMemoryImporters: MemoryImporter[] = [
  telegramFileMemoryImporter
];
