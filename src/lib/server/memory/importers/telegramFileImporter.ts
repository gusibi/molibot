import fs from "node:fs";
import path from "node:path";
import { storagePaths } from "../../db/sqlite.js";
import type { MemoryImportSink, MemoryImporter } from "../importers.js";

function normalizeContent(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function parseMemoryTextLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.startsWith("- ") ? line.slice(2).trim() : line)
    .filter(Boolean);
}

export const telegramFileMemoryImporter: MemoryImporter = {
  key: "telegram-file",
  name: "Telegram Memory Files",
  description: "Imports legacy Telegram MEMORY.md files from the shared memory root.",
  async sync(sink: MemoryImportSink) {
    const memoryRoot = path.join(storagePaths.dataDir, "memory");
    const telegramBotsRoot = path.join(memoryRoot, "moli-t", "bots");
    if (!fs.existsSync(telegramBotsRoot)) {
      return { scannedFiles: 0, importedCount: 0 };
    }

    let scannedFiles = 0;
    let importedCount = 0;
    const botDirs = fs.readdirSync(telegramBotsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());

    for (const botDir of botDirs) {
      const botId = botDir.name;
      const botPath = path.join(telegramBotsRoot, botId);
      const chatDirs = fs.readdirSync(botPath, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const chatDir of chatDirs) {
        const chatId = chatDir.name;
        const chatMemoryFile = path.join(botPath, chatId, "MEMORY.md");
        if (!fs.existsSync(chatMemoryFile)) continue;
        scannedFiles += 1;

        const raw = fs.readFileSync(chatMemoryFile, "utf8");
        const lines = parseMemoryTextLines(raw);
        const scope = { channel: "telegram", externalUserId: chatId };
        const existing = await sink.search(scope, { query: "", limit: 1000, mode: "recent" });
        const existingContents = new Set(existing.map((item) => normalizeContent(item.content).toLowerCase()));

        for (const line of lines) {
          const normalized = normalizeContent(line).toLowerCase();
          if (existingContents.has(normalized)) continue;
          await sink.add(scope, {
            content: line,
            tags: ["imported", "telegram-file", `bot:${botId}`],
            layer: "long_term"
          });
          existingContents.add(normalized);
          importedCount += 1;
        }
      }
    }

    return { scannedFiles, importedCount };
  }
};
