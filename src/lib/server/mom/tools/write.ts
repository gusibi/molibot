import { basename, dirname, extname, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execCommand, shellEscape } from "./helpers.js";
import { createPathGuard, resolveToolPath } from "./path.js";

const writeSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  content: Type.String()
});

export function createWriteTool(options: { cwd: string; workspaceDir: string; chatId: string }): AgentTool<typeof writeSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);
  const eventsDir = resolve(options.workspaceDir, "events");

  const parseReminderShorthand = (input: string): { at: string; text: string } | null => {
    const m = input.trim().match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+([\s\S]+)$/
    );
    if (!m) return null;
    const at = new Date(m[1]).toISOString();
    if (!Number.isFinite(new Date(at).getTime())) return null;
    const text = m[2].trim();
    if (!text) return null;
    return { at, text };
  };

  const normalizeReminderWrite = (rawPath: string, label: string, content: string): { path: string; content: string } | null => {
    const shorthand = parseReminderShorthand(content);
    if (!shorthand) return null;
    const lowerPath = rawPath.toLowerCase();
    const lowerLabel = label.toLowerCase();
    const looksLikeReminder =
      lowerPath.includes("/events/") ||
      lowerPath.includes("/tmp/events/") ||
      /(^|\/)(reminder|event)[-_]/.test(lowerPath) ||
      lowerLabel.includes("reminder") ||
      lowerLabel.includes("event");
    if (!looksLikeReminder) return null;

    const rawBase = basename(rawPath, extname(rawPath)).replace(/[^\w.-]/g, "_") || `reminder_${Date.now()}`;
    const normalizedPath = resolve(eventsDir, `${rawBase}.json`);
    const eventPayload = {
      type: "one-shot" as const,
      chatId: options.chatId,
      text: shorthand.text,
      at: shorthand.at
    };
    return {
      path: normalizedPath,
      content: `${JSON.stringify(eventPayload, null, 2)}\n`
    };
  };

  return {
    name: "write",
    label: "write",
    description: "Create or overwrite a file. Parent directories are created automatically.",
    parameters: writeSchema,
    execute: async (_toolCallId, params, signal) => {
      const requestedPath = resolveToolPath(options.cwd, params.path);
      const normalized = normalizeReminderWrite(requestedPath, params.label, params.content);
      const filePath = normalized?.path ?? requestedPath;
      const content = normalized?.content ?? params.content;
      ensureAllowedPath(filePath);
      const dir = dirname(filePath);
      const cmd = `mkdir -p ${shellEscape(dir)} && printf '%s' ${shellEscape(content)} > ${shellEscape(filePath)}`;
      const result = await execCommand(cmd, { cwd: options.cwd, signal });
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to write ${params.path}`);
      }
      if (normalized) {
        return {
          content: [
            {
              type: "text",
              text: `Normalized reminder shorthand and wrote one-shot event JSON to ${filePath}`
            }
          ],
          details: undefined
        };
      }
      return {
        content: [{ type: "text", text: `Wrote ${content.length} bytes to ${params.path}` }],
        details: undefined
      };
    }
  };
}
