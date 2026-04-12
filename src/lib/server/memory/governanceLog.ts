import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { MemoryAddInput, MemoryScope } from "./types.js";

export interface MemoryGovernanceRejection {
  createdAt: string;
  action: "add" | "update";
  channel: string;
  externalUserId: string;
  reason: string;
  content: string;
  layer?: string;
  tags: string[];
}

function ensureFile(filePath: string): void {
  const resolved = resolve(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  if (!existsSync(resolved)) {
    writeFileSync(resolved, "", "utf8");
  }
}

export function appendMemoryGovernanceRejection(params: {
  filePath: string;
  scope: MemoryScope;
  action: "add" | "update";
  input: MemoryAddInput;
  reason: string;
}): void {
  ensureFile(params.filePath);
  const record: MemoryGovernanceRejection = {
    createdAt: new Date().toISOString(),
    action: params.action,
    channel: params.scope.channel,
    externalUserId: params.scope.externalUserId,
    reason: params.reason,
    content: String(params.input.content ?? "").trim(),
    layer: params.input.layer,
    tags: Array.isArray(params.input.tags) ? params.input.tags.map((item) => String(item ?? "")) : []
  };
  appendFileSync(resolve(params.filePath), `${JSON.stringify(record)}\n`, "utf8");
}

export function parseMemoryGovernanceLine(raw: string): MemoryGovernanceRejection | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<MemoryGovernanceRejection>;
    return {
      createdAt: String(parsed.createdAt ?? new Date(0).toISOString()),
      action: parsed.action === "update" ? "update" : "add",
      channel: String(parsed.channel ?? ""),
      externalUserId: String(parsed.externalUserId ?? ""),
      reason: String(parsed.reason ?? ""),
      content: String(parsed.content ?? ""),
      layer: typeof parsed.layer === "string" ? parsed.layer : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((item) => String(item ?? "")) : []
    };
  } catch {
    return null;
  }
}

export function readMemoryGovernanceRejections(filePath: string, limit = 500): {
  items: MemoryGovernanceRejection[];
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    return { items: [], diagnostics };
  }

  let raw = "";
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (error) {
    diagnostics.push(`Failed to read ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
    return { items: [], diagnostics };
  }

  const items = raw
    .split(/\r?\n/)
    .map((line, index) => {
      const parsed = parseMemoryGovernanceLine(line);
      if (!parsed && line.trim()) diagnostics.push(`Skipped invalid rejection line ${index + 1}`);
      return parsed;
    })
    .filter((item): item is MemoryGovernanceRejection => Boolean(item))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Math.max(1, limit));

  return { items, diagnostics };
}
