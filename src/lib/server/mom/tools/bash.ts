import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execCommand, stripAnsi } from "./helpers.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail, type TruncationResult } from "./truncate.js";

const bashSchema = Type.Object({
  label: Type.String(),
  command: Type.String(),
  timeout: Type.Optional(Type.Number())
});

interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

function isDeferredWaitCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    /\bsleep\b/.test(normalized) ||
    /\btimeout\b/.test(normalized) ||
    /\bwait\b/.test(normalized) ||
    /\bping\s+-c\b/.test(normalized)
  );
}

function touchesMemoryFiles(command: string): boolean {
  const normalized = command.toLowerCase();
  if (normalized.includes("/api/memory")) return false;
  return /memory\.md|\/memory\//i.test(command);
}

function buildTempOutputPath(cwd: string): string {
  const dir = join(cwd, ".mom-tool-output");
  mkdirSync(dir, { recursive: true });
  return join(dir, `bash-${Date.now()}-${randomBytes(4).toString("hex")}.log`);
}

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
  return {
    name: "bash",
    label: "bash",
    description:
      `Execute a bash command in scratch workspace. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: bashSchema,
    execute: async (_toolCallId, params, signal) => {
      if (isDeferredWaitCommand(params.command)) {
        throw new Error(
          "Waiting/sleep commands are not allowed. For delayed reminders, create a one-shot event file under a watched events directory."
        );
      }
      if (touchesMemoryFiles(params.command)) {
        throw new Error(
          "Direct memory file operations are blocked. Use the memory tool (or /api/memory gateway) for all memory reads/writes/updates."
        );
      }

      const result = await execCommand(params.command, {
        cwd,
        timeoutSeconds: params.timeout,
        signal
      });

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += `${output ? "\n" : ""}${result.stderr}`;
      output = stripAnsi(output);

      const truncation = truncateTail(output);
      let rendered = truncation.content || "(no output)";
      let details: BashToolDetails | undefined;

      if (truncation.truncated) {
        const fullOutputPath = buildTempOutputPath(cwd);
        writeFileSync(fullOutputPath, output, "utf8");
        const startLine = truncation.totalLines - truncation.outputLines + 1;
        const endLine = truncation.totalLines;
        rendered += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${fullOutputPath}]`;
        details = { truncation, fullOutputPath };
      }

      if (result.code !== 0) {
        throw new Error(`${rendered}\n\nCommand exited with code ${result.code}`.trim());
      }

      return {
        content: [{ type: "text", text: rendered }],
        details
      };
    }
  };
}
