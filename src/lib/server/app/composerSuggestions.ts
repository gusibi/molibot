import type { DesktopComposerSuggestion, DesktopSkillItem } from "$lib/shared/desktop";

interface CommandDefinition {
  name: string;
  description: { en: string; zh: string };
  aliases?: string[];
  argumentHint?: string;
  submitOnSelect?: boolean;
}

// This is the presentation registry for commands accepted by the Web command
// handler. Execution remains in the handler; /help and Desktop suggestions both
// consume this metadata so the visible inventory has one owner.
export const WEB_COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  { name: "help", description: { en: "Show available commands", zh: "查看可用命令" }, submitOnSelect: true },
  { name: "models", description: { en: "View or switch text models", zh: "查看或切换文本模型" }, argumentHint: "[route] [model]" },
  { name: "skills", description: { en: "List loaded Skills", zh: "查看已加载的 Skill" }, argumentHint: "[skill]", submitOnSelect: true },
  { name: "skills-detail", description: { en: "Show complete Skill details", zh: "查看全部 Skill 详情" }, submitOnSelect: true },
  { name: "compact", description: { en: "Compact older conversation context", zh: "压缩较早的对话上下文" }, argumentHint: "[instructions]" },
  { name: "hosttools", description: { en: "Review Host Bash approvals", zh: "查看 Host Bash 审批" }, aliases: ["host-tools"], argumentHint: "[action] [id]", submitOnSelect: true }
] as const;

export function buildComposerSuggestions(
  skills: DesktopSkillItem[],
  locale: "en" | "zh"
): DesktopComposerSuggestion[] {
  const commands = WEB_COMMAND_DEFINITIONS.map((command) => ({
    id: `command:${command.name}`,
    kind: "command" as const,
    label: `/${command.name}`,
    insertText: `/${command.name}${command.argumentHint ? " " : ""}`,
    description: command.description[locale],
    aliases: [command.name, ...(command.aliases ?? [])],
    argumentHint: command.argumentHint,
    submitOnSelect: command.submitOnSelect === true && !command.argumentHint
  }));
  const enabledSkills = skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      id: `skill:${skill.id}`,
      kind: "skill" as const,
      label: `/${skill.name}`,
      insertText: `/${skill.name} `,
      description: skill.description,
      aliases: [skill.name],
      submitOnSelect: false,
      scope: skill.scope
    }));
  return [...commands, ...enabledSkills];
}

export function classifyComposerInvocation(
  content: string,
  suggestions: Pick<DesktopComposerSuggestion, "kind" | "label">[]
): { kind: "command" | "skill"; token: string } | null {
  const token = String(content ?? "").trim().match(/^\/[a-z0-9][a-z0-9:_-]*/i)?.[0]?.toLowerCase();
  if (!token) return null;
  const match = suggestions.find((item) => item.label.toLowerCase() === token);
  return match ? { kind: match.kind, token } : null;
}
