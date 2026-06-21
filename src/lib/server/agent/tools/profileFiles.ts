import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  AGENT_PROFILE_FILES,
  BOT_PROFILE_FILES,
  getAgentDir,
  getAgentForBot,
  normalizeEditableBody,
  writeProfileFiles
} from "$lib/server/agent/prompts/profiles.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { resolveDataRootFromWorkspacePath } from "$lib/server/agent/session/workspace.js";

const PROFILE_FILE_NAMES = BOT_PROFILE_FILES;
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

function readEditableBody(filePath: string): string {
  if (!existsSync(filePath)) return "";
  return normalizeEditableBody(readFileSync(filePath, "utf8"));
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
  const posix = normalized.replace(/\\/g, "/");
  const marker = "/bots/";
  const index = posix.indexOf(marker);
  if (index < 0) {
    throw new Error(`Workspace is not a bot runtime path: ${workspaceDir}`);
  }
  // Truncate to /bots/<botId> so deeper paths (e.g. a chat dir) still resolve the bot root.
  const afterMarker = index + marker.length;
  const nextSlash = posix.indexOf("/", afterMarker);
  return nextSlash < 0 ? normalized : normalized.slice(0, nextSlash);
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
  // The agent scope only carries AGENT_PROFILE_FILES; other files (USER.md, TOOLS.md)
  // fall back straight to global, matching the prompt assembly in prompt.ts.
  const agentHasFile = (AGENT_PROFILE_FILES as readonly string[]).includes(parentFile);
  const agentFilePath = agentId && agentHasFile ? join(getAgentDir(agentId), parentFile) : null;
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
      "Manage bot profile markdown files (BOT/SOUL/USER/TOOLS/IDENTITY/SONG). Runtime layering: agent/global AGENTS.md and bot BOT.md render together in the upper operator-directives block, with AGENTS.md first and BOT.md stacking on top; SOUL/IDENTITY/SONG use bot > agent > global precedence; USER/TOOLS fall back to global only. BOT.md bootstrap can copy AGENTS.md as a starting point. BOOTSTRAP.md is global-only and not managed here.",
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
