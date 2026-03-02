import path from "node:path";
import { readJsonFile, storagePaths, writeJsonFile } from "../db/sqlite.js";
import type { MemoryLayer, MemoryScope } from "./types.js";

interface ImportTombstoneRecord {
  channel: string;
  externalUserId: string;
  layer: MemoryLayer;
  content: string;
  createdAt: string;
}

interface ImportTombstoneFile {
  items: ImportTombstoneRecord[];
}

const tombstoneFile = path.join(storagePaths.dataDir, "memory", "import-tombstones.json");

function normalizeContent(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function loadFile(): ImportTombstoneFile {
  const raw = readJsonFile<ImportTombstoneFile>(tombstoneFile, { items: [] });
  return { items: Array.isArray(raw.items) ? raw.items : [] };
}

function saveFile(data: ImportTombstoneFile): void {
  writeJsonFile(tombstoneFile, data);
}

function matches(scope: MemoryScope, layer: MemoryLayer, content: string, row: ImportTombstoneRecord): boolean {
  return row.channel === scope.channel &&
    row.externalUserId === scope.externalUserId &&
    row.layer === layer &&
    normalizeContent(row.content) === normalizeContent(content);
}

export function isImportSuppressed(scope: MemoryScope, layer: MemoryLayer, content: string): boolean {
  return loadFile().items.some((row) => matches(scope, layer, content, row));
}

export function suppressImportedMemory(scope: MemoryScope, layer: MemoryLayer, content: string): void {
  const data = loadFile();
  if (data.items.some((row) => matches(scope, layer, content, row))) return;
  data.items.push({
    channel: scope.channel,
    externalUserId: scope.externalUserId,
    layer,
    content: content.trim(),
    createdAt: new Date().toISOString()
  });
  saveFile(data);
}

export function clearImportedMemorySuppression(scope: MemoryScope, layer: MemoryLayer, content: string): void {
  const data = loadFile();
  const next = data.items.filter((row) => !matches(scope, layer, content, row));
  if (next.length === data.items.length) return;
  saveFile({ items: next });
}
