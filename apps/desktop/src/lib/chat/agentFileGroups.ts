import type { DesktopConversationSearchItem, DesktopSessionFile } from "@molibot/desktop-contract";
import { classifyFilePreview } from "@molibot/shared/filePreview";
export type AgentFileRow = { conversation: DesktopConversationSearchItem; file: DesktopSessionFile };
export const FILE_TYPES = ["image", "video", "audio", "code", "text", "document", "other"] as const;
export type AgentFileType = typeof FILE_TYPES[number];
export function agentFileType(file: DesktopSessionFile): AgentFileType {
  const kind = classifyFilePreview({ name: file.original, mimeType: file.mimeType, mediaType: file.mediaType });
  if (["image", "video", "audio", "code"].includes(kind)) return kind as AgentFileType;
  if (["markdown", "json", "csv", "yaml", "text"].includes(kind)) return "text";
  if (["pdf", "office"].includes(kind)) return "document";
  return "other";
}
export function groupAgentFiles(rows: AgentFileRow[]) {
  return (["generated", "uploaded", "unknown"] as const).map(origin => ({
    origin,
    groups: FILE_TYPES.map(type => ({ type, rows: rows.filter(row => row.file.origin === origin && agentFileType(row.file) === type).sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt) || a.file.original.localeCompare(b.file.original)) })).filter(group => group.rows.length)
  })).filter(section => section.groups.length);
}
