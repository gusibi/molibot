import { translator, type Locale } from "../i18n";
import type { CommandHostAdapter } from "./commandHost";

export type SettingsDestination =
  | "general"
  | "models"
  | "providers"
  | "agents"
  | "mcp"
  | "skills"
  | "memory"
  | "channels"
  | "plugins"
  | "webSearch"
  | "imageGenerate"
  | "videoGenerate"
  | "ttsGenerate"
  | "profiles"
  | "usage"
  | "runHistory"
  | "logs"
  | "trace"
  | "sandbox"
  | "hostBash"
  | "diagnostics"
  | "runtimeEnv";

export type CommandId =
  | "app.open-chat"
  | "app.open-settings"
  | "app.open-web"
  | "app.quit"
  | "chat.new"
  | "chat.search"
  | "service.restart"
  | "diagnostics.open"
  | "workspace.automations"
  | "workspace.skills"
  | "workspace.agents"
  | `settings.${SettingsDestination}`;

export type CommandScope = "application" | "chat" | "workspace" | "settings" | "service";
export type CommandWorkspace = "chat" | "automations" | "skills" | "agents" | "project";

export type CommandContext = {
  locale: Locale;
  runtime: "browser" | "desktop";
  workspace: CommandWorkspace;
  service: {
    restartAvailable: boolean;
    webAvailable: boolean;
  };
};

export type CommandSnapshot = {
  id: CommandId;
  label: string;
  keywords: string[];
  shortcut?: string;
  scope: CommandScope;
  recommendedRank: number;
  enabled: boolean;
  disabledReason?: string;
};

export type CommandExecution =
  | { id: CommandId; status: "executed" }
  | { id: CommandId; status: "disabled"; reason: string }
  | { id: CommandId; status: "failed" }
  | { id: string; status: "unknown" };

type CommandDefinition = {
  id: CommandId;
  label: (locale: Locale) => string;
  keywords: string[];
  shortcut?: string;
  scope: CommandScope;
  recommendedRank?: (context: CommandContext) => number;
  availability?: (context: CommandContext) => { enabled: boolean; disabledReason?: string };
};

export const settingsDestinations: SettingsDestination[] = [
  "general", "models", "providers", "agents", "mcp", "skills", "memory", "channels", "plugins",
  "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate", "profiles", "usage", "runHistory",
  "logs", "trace", "sandbox", "hostBash", "diagnostics", "runtimeEnv"
];

export function commandIdForSettings(destination: SettingsDestination): `settings.${SettingsDestination}` {
  return `settings.${destination}`;
}

function sectionLabel(destination: SettingsDestination, locale: Locale): string {
  const copy = translator(locale);
  switch (destination) {
    case "models": return copy.models;
    case "providers": return copy.providers;
    case "agents": return copy.agents;
    case "mcp": return copy.mcp;
    case "skills": return copy.skills;
    case "memory": return copy.memory;
    case "channels": return copy.channels;
    case "plugins": return copy.plugins;
    case "webSearch": return copy.webSearch;
    case "imageGenerate": return copy.imageGenerate;
    case "videoGenerate": return copy.videoGenerate;
    case "ttsGenerate": return copy.ttsGenerate;
    case "profiles": return copy.profiles;
    case "usage": return copy.usage;
    case "runHistory": return copy.runHistory;
    case "logs": return copy.logs;
    case "trace": return copy.trace;
    case "sandbox": return copy.sandbox;
    case "hostBash": return copy.hostBash;
    case "diagnostics": return copy.diagnostics;
    case "runtimeEnv": return copy.runtimeEnv;
    default: return copy.general;
  }
}

const restartUnavailable = (locale: Locale): string => locale === "zh-CN"
  ? "当前没有可重启的桌面托管服务。"
  : "The desktop-managed service is not available to restart.";

const desktopOnly = (locale: Locale): string => locale === "zh-CN"
  ? "此操作仅在桌面应用中可用。"
  : "This action is available only in the desktop app.";

const webUnavailable = (locale: Locale): string => locale === "zh-CN"
  ? "当前没有可打开的服务地址。"
  : "There is no service address to open.";

const desktopAvailability = (context: CommandContext): { enabled: boolean; disabledReason?: string } => context.runtime === "desktop"
  ? { enabled: true }
  : { enabled: false, disabledReason: desktopOnly(context.locale) };

const webAvailability = (context: CommandContext): { enabled: boolean; disabledReason?: string } => {
  const desktop = desktopAvailability(context);
  if (!desktop.enabled) return desktop;
  return context.service.webAvailable
    ? { enabled: true }
    : { enabled: false, disabledReason: webUnavailable(context.locale) };
};

const managedServiceAvailability = (context: CommandContext): { enabled: boolean; disabledReason?: string } => {
  const desktop = desktopAvailability(context);
  if (!desktop.enabled) return desktop;
  return context.service.restartAvailable
    ? { enabled: true }
    : { enabled: false, disabledReason: restartUnavailable(context.locale) };
};

const recommendedRank = (context: CommandContext, command: CommandId): number => {
  if (command === "chat.new" && context.workspace === "chat") return 0;
  if (command === "workspace.automations" && context.workspace === "automations") return 0;
  if (command === "workspace.skills" && context.workspace === "skills") return 0;
  if (command === "workspace.agents" && context.workspace === "agents") return 0;
  if (command === "chat.search" && context.workspace === "chat") return 1;
  if (command.startsWith("workspace.")) return 2;
  if (command === "app.open-settings") return 3;
  return 4;
};

const definitions: CommandDefinition[] = [
  {
    id: "app.open-chat",
    label: (locale) => locale === "zh-CN" ? "打开 Molibot" : "Open Molibot",
    keywords: ["open", "show", "molibot"],
    scope: "application",
    availability: desktopAvailability
  },
  {
    id: "app.open-settings",
    label: (locale) => translator(locale).openSettings,
    keywords: ["preferences", "settings"],
    shortcut: "Cmd+,",
    scope: "application"
  },
  {
    id: "app.open-web",
    label: (locale) => locale === "zh-CN" ? "打开 Web" : "Open Web",
    keywords: ["browser", "web"],
    scope: "application",
    availability: webAvailability
  },
  {
    id: "app.quit",
    label: (locale) => locale === "zh-CN" ? "退出 Molibot" : "Quit Molibot",
    keywords: ["quit", "exit"],
    shortcut: "Cmd+Q",
    scope: "application",
    availability: desktopAvailability
  },
  {
    id: "chat.new",
    label: (locale) => translator(locale).newChat,
    keywords: ["new", "conversation", "chat"],
    shortcut: "Cmd+N",
    scope: "chat"
  },
  {
    id: "chat.search",
    label: (locale) => translator(locale).searchConversations,
    keywords: ["find", "search", "conversation"],
    shortcut: "Cmd+F",
    scope: "chat"
  },
  {
    id: "service.restart",
    label: (locale) => translator(locale).restartService,
    keywords: ["restart", "service", "server"],
    scope: "service",
    availability: managedServiceAvailability
  },
  {
    id: "diagnostics.open",
    label: (locale) => translator(locale).diagnostics,
    keywords: ["diagnostics", "logs", "troubleshooting"],
    scope: "application",
    availability: desktopAvailability
  },
  {
    id: "workspace.automations",
    label: (locale) => translator(locale).tasks,
    keywords: ["automation", "tasks", "schedule"],
    scope: "workspace"
  },
  {
    id: "workspace.skills",
    label: (locale) => translator(locale).skills,
    keywords: ["skills", "tools"],
    scope: "workspace"
  },
  {
    id: "workspace.agents",
    label: (locale) => translator(locale).agents,
    keywords: ["agents", "studio"],
    scope: "workspace"
  },
  ...settingsDestinations.map((destination): CommandDefinition => ({
    id: commandIdForSettings(destination),
    label: (locale) => sectionLabel(destination, locale),
    keywords: ["settings", "preferences", destination],
    scope: "settings"
  }))
];

export class CommandSystem {
  constructor(private readonly host: CommandHostAdapter) {}

  snapshot(context: CommandContext): CommandSnapshot[] {
    return definitions.map((definition) => {
      const availability = definition.availability?.(context) ?? { enabled: true };
      return {
        id: definition.id,
        label: definition.label(context.locale),
        keywords: definition.keywords,
        shortcut: definition.shortcut,
        scope: definition.scope,
        recommendedRank: definition.recommendedRank?.(context) ?? recommendedRank(context, definition.id),
        enabled: availability.enabled,
        disabledReason: availability.disabledReason
      };
    });
  }

  async execute(id: string, context: CommandContext): Promise<CommandExecution> {
    const command = this.snapshot(context).find((entry) => entry.id === id);
    if (!command) return { id, status: "unknown" };
    if (!command.enabled) return { id: command.id, status: "disabled", reason: command.disabledReason ?? "Unavailable" };
    try {
      await this.host.execute(command.id);
      return { id: command.id, status: "executed" };
    } catch {
      return { id: command.id, status: "failed" };
    }
  }
}

export { CallbackCommandHostAdapter, MemoryCommandHostAdapter } from "./commandHost";
