import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getAgentDir, getAgentForBot, writeProfileFiles } from "../profiles.js";
import type { RuntimeSettings } from "../../settings/index.js";
import { resolveDataRootFromWorkspacePath } from "../workspace.js";

const PROFILE_FILE_NAMES = ["BOT.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md", "SONG.md"] as const;
type ProfileFileName = (typeof PROFILE_FILE_NAMES)[number];

const profileFileSchema = Type.Object({
  label: Type.String(),
  action: Type.Union([
    Type.Literal("read"),
    Type.Literal("bootstrap"),
    Type.Literal("write"),
    Type.Literal("edit")
  ]),
  file: Type.Union(PROFILE_FILE_NAMES.map((name) => Type.Literal(name))),
  content: Type.Optional(Type.String()),
  oldText: Type.Optional(Type.String()),
  newText: Type.Optional(Type.String()),
  autoBootstrap: Type.Optional(Type.Boolean())
});

function stripEditableBody(content: string): string {
  return content
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    .replace(/\n---\nlast_updated:[\s\S]*$/m, "")
    .trim();
}

function readEditableBody(filePath: string): string {
  if (!existsSync(filePath)) return "";
  return stripEditableBody(readFileSync(filePath, "utf8"));
}

function ensureKnownProfileFile(fileName: string): ProfileFileName {
  const normalized = String(fileName ?? "").trim();
  if ((PROFILE_FILE_NAMES as readonly string[]).includes(normalized)) {
    return normalized as ProfileFileName;
  }
  throw new Error(`Unsupported profile file: ${fileName}`);
}

function resolveParentProfileFileName(file: ProfileFileName): string {
  if (file === "BOT.md") return "AGENTS.md";
  return file;
}

function resolveBotRoot(workspaceDir: string): string {
  const normalized = resolve(workspaceDir);
  const marker = "/bots/";
  const index = normalized.replace(/\\/g, "/").indexOf(marker);
  if (index < 0) {
    throw new Error(`Workspace is not a bot runtime path: ${workspaceDir}`);
  }
  return normalized;
}

function resolveScopePaths(params: {
  channel: string;
  workspaceDir: string;
  getSettings: () => RuntimeSettings;
  file: ProfileFileName;
}): {
  botId: string;
  botFilePath: string;
  agentFilePath: string | null;
  globalFilePath: string;
  agentId: string;
} {
  const botRoot = resolveBotRoot(params.workspaceDir);
  const botId = basename(botRoot);
  const file = ensureKnownProfileFile(params.file);
  const parentFile = resolveParentProfileFileName(file);
  const settings = params.getSettings();
  const agentId = getAgentForBot(settings, params.channel, botId);
  const dataRoot = resolveDataRootFromWorkspacePath(botRoot);
  const botFilePath = join(botRoot, file);
  const agentFilePath = agentId ? join(getAgentDir(agentId), parentFile) : null;
  const globalFilePath = join(dataRoot, parentFile);
  return {
    botId,
    botFilePath,
    agentFilePath,
    globalFilePath,
    agentId
  };
}

function resolveBaselineSource(paths: {
  agentFilePath: string | null;
  globalFilePath: string;
}): { scope: "agent" | "global"; filePath: string } | null {
  if (paths.agentFilePath && existsSync(paths.agentFilePath)) {
    return { scope: "agent", filePath: paths.agentFilePath };
  }
  if (existsSync(paths.globalFilePath)) {
    return { scope: "global", filePath: paths.globalFilePath };
  }
  return null;
}

function bootstrapBotFile(params: {
  channel: string;
  workspaceDir: string;
  getSettings: () => RuntimeSettings;
  file: ProfileFileName;
}): { source: "agent" | "global" | "empty"; inheritedFrom: string } {
  const paths = resolveScopePaths(params);
  if (existsSync(paths.botFilePath)) {
    return { source: "empty", inheritedFrom: "bot_exists" };
  }

  const baseline = resolveBaselineSource({
    agentFilePath: paths.agentFilePath,
    globalFilePath: paths.globalFilePath
  });
  const inherited = baseline ? readEditableBody(baseline.filePath) : "";
  writeProfileFiles({
    scope: "bot",
    channel: params.channel,
    botId: paths.botId,
    files: { [params.file]: inherited }
  });

  if (baseline) {
    return { source: baseline.scope, inheritedFrom: baseline.filePath };
  }
  return { source: "empty", inheritedFrom: "(none)" };
}

export function createProfileFilesTool(options: {
  channel: string;
  workspaceDir: string;
  getSettings: () => RuntimeSettings;
}): AgentTool<typeof profileFileSchema> {
  return {
    name: "profileFiles",
    label: "profileFiles",
    description:
      "Manage bot profile markdown files (BOT/SOUL/USER/TOOLS/IDENTITY/SONG) with parent fallback (agent first, then global).",
    parameters: profileFileSchema,
    execute: async (_toolCallId, params) => {
      const file = ensureKnownProfileFile(params.file);
      const autoBootstrap = params.autoBootstrap !== false;
      const paths = resolveScopePaths({
        channel: options.channel,
        workspaceDir: options.workspaceDir,
        getSettings: options.getSettings,
        file
      });

      if (params.action === "read") {
        const botExists = existsSync(paths.botFilePath);
        const baseline = resolveBaselineSource({
          agentFilePath: paths.agentFilePath,
          globalFilePath: paths.globalFilePath
        });
        const effectiveSource = botExists
          ? `bot:${paths.botFilePath}`
          : baseline
            ? `${baseline.scope}:${baseline.filePath}`
            : "none";
        const content = botExists
          ? readEditableBody(paths.botFilePath)
          : baseline
            ? readEditableBody(baseline.filePath)
            : "";
        return {
          content: [{
            type: "text",
            text: [
              `file: ${file}`,
              `source: ${effectiveSource}`,
              `agentId: ${paths.agentId || "(none)"}`,
              "",
              content || "(empty)"
            ].join("\n")
          }],
          details: undefined
        };
      }

      if (params.action === "bootstrap") {
        const result = bootstrapBotFile({
          channel: options.channel,
          workspaceDir: options.workspaceDir,
          getSettings: options.getSettings,
          file
        });
        return {
          content: [{
            type: "text",
            text: `Bootstrapped ${file} from ${result.source} (${result.inheritedFrom})`
          }],
          details: undefined
        };
      }

      if (!existsSync(paths.botFilePath) && autoBootstrap) {
        bootstrapBotFile({
          channel: options.channel,
          workspaceDir: options.workspaceDir,
          getSettings: options.getSettings,
          file
        });
      }

      const current = readEditableBody(paths.botFilePath);

      if (params.action === "write") {
        if (typeof params.content !== "string") {
          throw new Error("content is required for write action");
        }
        writeProfileFiles({
          scope: "bot",
          channel: options.channel,
          botId: paths.botId,
          files: { [file]: params.content }
        });
        return {
          content: [{ type: "text", text: `Updated ${file} for bot ${paths.botId}` }],
          details: undefined
        };
      }

      if (params.action === "edit") {
        if (typeof params.oldText !== "string" || typeof params.newText !== "string") {
          throw new Error("oldText and newText are required for edit action");
        }
        if (!current.includes(params.oldText)) {
          throw new Error(`${file} does not contain the target oldText`);
        }
        if (current.split(params.oldText).length - 1 > 1) {
          throw new Error(`${file} oldText appears multiple times; provide a unique snippet`);
        }
        const next = current.replace(params.oldText, params.newText);
        writeProfileFiles({
          scope: "bot",
          channel: options.channel,
          botId: paths.botId,
          files: { [file]: next }
        });
        return {
          content: [{ type: "text", text: `Edited ${file} for bot ${paths.botId}` }],
          details: undefined
        };
      }

      throw new Error(`Unsupported action: ${params.action}`);
    }
  };
}
