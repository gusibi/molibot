import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import {
  getSystemPromptSources,
  type ProjectPromptContext
} from "$lib/server/agent/prompts/prompt.js";
import type { PromptChannel } from "$lib/server/agent/prompts/prompt-channel.js";

const PREVIEW_FILE_NAME = "SYSTEM_PROMPT.preview.md";

function metadataValue(value: string): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim() || "(none)";
}

function sourceList(paths: string[]): string {
  return paths.length > 0 ? paths.map(metadataValue).join(", ") : "(none)";
}

export function writeProjectSystemPromptPreview(input: {
  targetDir: string;
  runtimeWorkspaceDir: string;
  channel: PromptChannel;
  chatId: string;
  sessionId: string;
  settings: RuntimeSettings;
  project: ProjectPromptContext;
  prompt: string;
  generatedAt?: string;
}): string {
  const sources = getSystemPromptSources(input.runtimeWorkspaceDir, {
    channel: input.channel,
    settings: input.settings,
    project: input.project
  });
  const header = [
    "# Project System Prompt Preview",
    "",
    `- generated_at: ${metadataValue(input.generatedAt ?? new Date().toISOString())}`,
    "- scope: project",
    `- project_id: ${metadataValue(input.project.id)}`,
    `- project_name: ${metadataValue(input.project.name)}`,
    `- project_root: ${metadataValue(input.project.rootPath)}`,
    `- project_workspace_dir: ${metadataValue(input.targetDir)}`,
    `- runtime_workspace_dir: ${metadataValue(input.runtimeWorkspaceDir)}`,
    `- channel: ${metadataValue(input.channel)}`,
    `- chat_id: ${metadataValue(input.chatId)}`,
    `- session_id: ${metadataValue(input.sessionId)}`,
    "- final_prompt_after_hooks: true",
    `- global_sources: ${sourceList(sources.global)}`,
    `- agent_sources: ${sourceList(sources.agent)}`,
    `- bot_sources: ${sourceList(sources.bot)}`,
    `- identity_sources: ${sourceList(sources.identity)}`,
    `- project_context_sources: ${sourceList(sources.projectContext)}`,
    "",
    "---",
    ""
  ].join("\n");

  mkdirSync(input.targetDir, { recursive: true });
  const filePath = join(input.targetDir, PREVIEW_FILE_NAME);
  writeFileSync(filePath, `${header}${input.prompt.trim()}\n`, "utf8");
  return filePath;
}
