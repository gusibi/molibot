import { getModels } from "@mariozechner/pi-ai";
import type { RuntimeSettings, RuntimeThinkingLevel } from "../settings/index.js";
import { RUNTIME_THINKING_LEVELS } from "../settings/index.js";
import {
  buildModelOptions,
  currentModelKey,
  parseModelRoute,
  resolveModelSelection,
  switchModelSelection,
  type ModelRoute
} from "../settings/modelSwitch.js";
import { listOAuthProviderIds, removeStoredAuth, resolveAuthFilePath, startOAuthLogin, submitOAuthLoginCode } from "./auth.js";
import { momLog } from "./log.js";
import { loadSkillsFromWorkspace } from "./skills.js";
import type { RunnerPool } from "./runner.js";
import type { MomRuntimeStore } from "./store.js";
import { resolveThinkingLevel } from "../providers/customThinking.js";
import { resolveGlobalSkillsDirFromWorkspacePath } from "./workspace.js";

export interface SharedRuntimeCommandContext<TTarget> {
  chatId: string;
  scopeId: string;
  text: string;
  target: TTarget;
}

export interface SharedRuntimeCommandOptions<TTarget> {
  channel: string;
  instanceId: string;
  workspaceDir: string;
  authScopePrefix: string;
  store: MomRuntimeStore;
  runners: RunnerPool;
  getSettings: () => RuntimeSettings;
  updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  getAuthScopeKey?: (input: SharedRuntimeCommandContext<TTarget>) => string;
  isRunning: (scopeId: string) => boolean;
  stopRun: (scopeId: string) => { aborted: boolean };
  steerRun?: (scopeId: string, text: string) => { queued: boolean };
  followUpRun?: (scopeId: string, text: string) => { queued: boolean };
  cancelAcpRun?: (scopeId: string) => Promise<boolean>;
  maybeHandleAcpCommand?: (scopeId: string, cmd: string, rawArg: string, target: TTarget) => Promise<boolean>;
  sendText: (target: TTarget, text: string) => Promise<void>;
  onSessionMutation?: (scopeId: string) => void | Promise<void>;
  getQueueSize?: (scopeId: string) => number;
  listQueue?: (scopeId: string) => Promise<Array<{ id: number; status: string; preview: string; createdAt: string }>>;
  deleteQueued?: (scopeId: string, id: number) => Promise<"deleted" | "running" | "not_found">;
  getQueuedPreview?: (
    scopeId: string,
    id: number
  ) => Promise<{ status: "pending" | "running" | "not_found"; preview?: string }>;
  cancelQueuedPending?: (scopeId: string) => Promise<number>;
  enqueueFront?: (input: SharedRuntimeCommandContext<TTarget>, text: string) => Promise<number | null>;
  getStatusExtras?: (scopeId: string, target: TTarget) => string[];
  helpLines?: readonly string[];
}

type FixedCommandRenderMode = "plain" | "two_column_markdown_table";
type FixedCommandName = "status" | "help";

interface CommandTableRow {
  label: string;
  value: string;
}

interface CommandTableSection {
  title?: string;
  rows: CommandTableRow[];
}

interface ModelTableDisplayRow {
  indexLabel: string;
  provider: string;
  model: string;
}

const TWO_COLUMN_TABLE_CHANNELS = new Set(["feishu", "qq", "weixin"]);
const FIXED_COMMAND_RENDER_MODE: Record<FixedCommandName, FixedCommandRenderMode> = {
  status: "two_column_markdown_table",
  help: "two_column_markdown_table"
};

export class SharedRuntimeCommandService<TTarget> {
  private readonly thinkingLevels = new Set<string>(RUNTIME_THINKING_LEVELS);

  constructor(private readonly options: SharedRuntimeCommandOptions<TTarget>) {}

  async handle(input: SharedRuntimeCommandContext<TTarget>): Promise<boolean> {
    const text = String(input.text ?? "").trim();
    if (!text.startsWith("/")) return false;

    const parts = text.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || "";
    const rawArg = parts.slice(1).join(" ").trim();

    if (cmd === "/stop") {
      const result = this.options.stopRun(input.scopeId);
      const cancelledQueued = (await this.options.cancelQueuedPending?.(input.scopeId)) ?? 0;
      if (result.aborted) {
        await this.options.sendText(
          input.target,
          cancelledQueued > 0
            ? `Stopping... Cleared ${cancelledQueued} queued task(s).`
            : "Stopping..."
        );
      } else {
        const cancelledAcp = await this.options.cancelAcpRun?.(input.scopeId);
        if (cancelledAcp) {
          await this.options.sendText(input.target, "ACP cancellation requested.");
        } else if (cancelledQueued > 0) {
          await this.options.sendText(input.target, `No active task. Cleared ${cancelledQueued} queued task(s).`);
        } else {
          await this.options.sendText(input.target, "Nothing running.");
        }
      }
      return true;
    }

    if (cmd === "/steer") {
      const queuedHandled = await this.tryHandleQueuedLiveCommand("steer", input, rawArg);
      if (queuedHandled) return true;
      if (!this.options.steerRun) {
        await this.options.sendText(input.target, "Live steer is unavailable in current runtime.");
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(input.target, "Usage: /steer <text>");
        return true;
      }
      const result = this.options.steerRun(input.scopeId, rawArg);
      await this.options.sendText(
        input.target,
        result.queued
          ? "Queued steering correction into current task."
          : "Nothing running. Send a normal message instead."
      );
      return true;
    }

    if (cmd === "/followup" || cmd === "/follow_up") {
      const queuedHandled = await this.tryHandleQueuedLiveCommand("followup", input, rawArg);
      if (queuedHandled) return true;
      if (!this.options.followUpRun) {
        await this.options.sendText(input.target, "Live follow-up is unavailable in current runtime.");
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(input.target, "Usage: /followup <text>");
        return true;
      }
      const result = this.options.followUpRun(input.scopeId, rawArg);
      await this.options.sendText(
        input.target,
        result.queued
          ? "Queued follow-up after current task."
          : "Nothing running. Send a normal message instead."
      );
      return true;
    }

    if (await this.options.maybeHandleAcpCommand?.(input.scopeId, cmd, rawArg, input.target)) {
      return true;
    }

    if (cmd === "/queue") {
      const [subcommand = "list", ...rest] = rawArg.split(/\s+/).filter(Boolean);
      const queueArg = rest.join(" ").trim();

      if (!this.options.listQueue) {
        await this.options.sendText(input.target, "Queue management is unavailable in current runtime.");
        return true;
      }

      if (!rawArg || subcommand === "list") {
        await this.options.sendText(input.target, await this.queueText(input.scopeId));
        return true;
      }

      if (subcommand === "front") {
        if (!this.options.enqueueFront) {
          await this.options.sendText(input.target, "Queue front insertion is unavailable in current runtime.");
          return true;
        }
        if (!queueArg) {
          await this.options.sendText(input.target, "Usage: /queue front <text>");
          return true;
        }
        const queueId = await this.options.enqueueFront(input, queueArg);
        await this.options.sendText(
          input.target,
          queueId ? `Inserted at front of queue. Queue ID: ${queueId}` : "Failed to insert queued task."
        );
        return true;
      }

      if (subcommand === "delete") {
        if (!this.options.deleteQueued) {
          await this.options.sendText(input.target, "Queue deletion is unavailable in current runtime.");
          return true;
        }
        const id = Number.parseInt(queueArg, 10);
        if (!Number.isFinite(id) || id <= 0) {
          await this.options.sendText(input.target, "Usage: /queue delete <queueId>");
          return true;
        }
        const result = await this.options.deleteQueued(input.scopeId, id);
        await this.options.sendText(
          input.target,
          result === "deleted"
            ? `Deleted queued task ${id}.`
            : result === "running"
              ? `Task ${id} is currently running. Use /stop to stop the current task first.`
              : `Queue item ${id} was not found.`
        );
        return true;
      }

      await this.options.sendText(
        input.target,
        [
          "Queue usage:",
          "/queue",
          "/queue front <text>",
          "/queue delete <queueId>"
        ].join("\n")
      );
      return true;
    }

    if (cmd === "/new") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, "Already working. Send /stop first, then /new.");
        return true;
      }
      const sessionId = this.options.store.createSession(input.scopeId);
      this.options.runners.reset(input.scopeId, sessionId);
      await this.options.sendText(input.target, `Created and switched to new session: ${sessionId}`);
      await this.options.onSessionMutation?.(input.scopeId);
      momLog(this.options.channel, "session_new", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        sessionId,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/clear") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, "Already working. Send /stop first, then /clear.");
        return true;
      }
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      this.options.store.clearSessionContext(input.scopeId, sessionId);
      this.options.runners.reset(input.scopeId, sessionId);
      await this.options.sendText(input.target, `Cleared context for session: ${sessionId}`);
      await this.options.onSessionMutation?.(input.scopeId);
      momLog(this.options.channel, "session_clear", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        sessionId,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/sessions") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, "Already working. Send /stop first, then switch sessions.");
        return true;
      }
      if (rawArg) {
        const picked = this.resolveSessionSelection(input.scopeId, rawArg);
        if (!picked) {
          await this.options.sendText(input.target, "Invalid session selector. Use /sessions to list available sessions.");
          return true;
        }
        this.options.store.setActiveSession(input.scopeId, picked);
        await this.options.sendText(input.target, `Switched to session: ${picked}`);
        await this.options.onSessionMutation?.(input.scopeId);
        momLog(this.options.channel, "session_switch", {
          chatId: input.chatId,
          scopeId: input.scopeId,
          sessionId: picked,
          selector: rawArg,
          instanceId: this.options.instanceId
        });
        return true;
      }
      await this.options.sendText(input.target, this.formatSessionsOverview(input.scopeId));
      return true;
    }

    if (cmd === "/delete_sessions") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, "Already working. Send /stop first, then delete sessions.");
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(
          input.target,
          `${this.formatSessionsOverview(input.scopeId)}\n\nDelete usage: /delete_sessions <index|sessionId>`
        );
        return true;
      }
      const picked = this.resolveSessionSelection(input.scopeId, rawArg);
      if (!picked) {
        await this.options.sendText(input.target, "Invalid session selector. Use /delete_sessions to list available sessions.");
        return true;
      }
      try {
        const result = this.options.store.deleteSession(input.scopeId, picked);
        this.options.runners.reset(input.scopeId, result.deleted);
        await this.options.onSessionMutation?.(input.scopeId);
        await this.options.sendText(
          input.target,
          `Deleted session: ${result.deleted}\nCurrent session: ${result.active}\nRemaining: ${result.remaining.length}`
        );
        momLog(this.options.channel, "session_deleted", {
          chatId: input.chatId,
          scopeId: input.scopeId,
          deleted: result.deleted,
          active: result.active,
          remaining: result.remaining.length,
          instanceId: this.options.instanceId
        });
      } catch (error) {
        await this.options.sendText(input.target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/models") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, "Already working. Send /stop first, then switch models.");
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(input.target, this.modelsText("text"));
        return true;
      }
      if (!this.options.updateSettings) {
        await this.options.sendText(input.target, "Model switching is unavailable in current runtime.");
        return true;
      }
      const [firstArg = "", secondArg = ""] = rawArg
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const maybeRoute = parseModelRoute(firstArg);
      const route: ModelRoute = maybeRoute ?? "text";
      const selector = maybeRoute ? secondArg : rawArg;
      const settings = this.options.getSettings();
      const options = buildModelOptions(settings, route);
      if (!selector) {
        await this.options.sendText(input.target, this.modelsText(route));
        return true;
      }
      const selected = resolveModelSelection(selector, options);
      if (!selected) {
        await this.options.sendText(input.target, `Invalid model selector: ${selector}\n\n${this.modelsText(route)}`);
        return true;
      }
      const switched = switchModelSelection({
        settings,
        route,
        selector,
        updateSettings: this.options.updateSettings
      });
      if (!switched) {
        await this.options.sendText(input.target, `Invalid model selector: ${selector}\n\n${this.modelsText(route)}`);
        return true;
      }
      await this.options.sendText(
        input.target,
        [
          `Switched ${route} model to: ${switched.selected.label}`,
          "Runtime will auto-use built-in or custom transport based on the selected model.",
          `Use /models ${route} to check current active ${route} model.`
        ].join("\n")
      );
      momLog(this.options.channel, "model_switched_via_command", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        route,
        selector,
        selectedKey: switched.selected.key,
        providerMode: switched.settings.providerMode,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/compact") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, "Already working. Send /stop first, then /compact.");
        return true;
      }
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      try {
        const result = await this.options.runners.compact(input.scopeId, sessionId, {
          reason: "manual",
          customInstructions: rawArg || undefined
        });
        await this.options.sendText(
          input.target,
          result.changed
            ? [
                "Conversation context compacted.",
                `before≈${result.beforeTokens} tokens`,
                `after≈${result.afterTokens} tokens`,
                `summarized_messages=${result.summarizedMessages}`,
                `kept_messages=${result.keptMessages}`
              ].join("\n")
            : "Nothing to compact yet."
        );
      } catch (error) {
        await this.options.sendText(input.target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/login") {
      const [provider = "", ...rest] = rawArg.split(/\s+/).filter(Boolean);
      const codeOrUrl = rest.join(" ").trim();
      const scopeKey = this.options.getAuthScopeKey?.(input) ?? `${this.options.authScopePrefix}:${input.scopeId}`;
      if (!provider) {
        await this.options.sendText(
          input.target,
          [
            `Auth file: ${resolveAuthFilePath()}`,
            `OAuth providers: ${listOAuthProviderIds().join(", ")}`,
            "Usage:",
            "/login <provider>",
            "/login <provider> <code-or-redirect-url>"
          ].join("\n")
        );
        return true;
      }

      try {
        if (codeOrUrl) {
          await submitOAuthLoginCode(scopeKey, provider, codeOrUrl);
          await this.options.sendText(
            input.target,
            `Login completed for '${provider}'. Credentials stored in ${resolveAuthFilePath()}.`
          );
          return true;
        }

        const pending = await startOAuthLogin(scopeKey, provider, {});
        const lines = [
          `Login started for '${provider}'.`,
          `Auth file: ${resolveAuthFilePath()}`
        ];
        if (pending.authUrl) lines.push(`Open: ${pending.authUrl}`);
        if (pending.instructions) lines.push(pending.instructions);
        if (pending.promptMessage) lines.push(pending.promptMessage);
        lines.push(`Finish with: /login ${provider} <code-or-redirect-url>`);
        await this.options.sendText(input.target, lines.join("\n"));
      } catch (error) {
        await this.options.sendText(input.target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/logout") {
      const provider = rawArg.split(/\s+/)[0] || "";
      if (!provider) {
        await this.options.sendText(input.target, "Usage: /logout <provider>");
        return true;
      }
      const removed = removeStoredAuth(provider);
      await this.options.sendText(
        input.target,
        removed ? `Removed stored auth for '${provider}'.` : `No stored auth found for '${provider}'.`
      );
      return true;
    }

    if (cmd === "/skills") {
      await this.options.sendText(input.target, this.skillsText(input.scopeId));
      return true;
    }

    if (cmd === "/status" || cmd === "/state") {
      await this.options.sendText(input.target, this.statusText(input.scopeId, input.target));
      return true;
    }

    if (cmd === "/thinking") {
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      const normalized = rawArg.split(/\s+/)[0]?.trim().toLowerCase() ?? "";

      if (!normalized) {
        await this.options.sendText(input.target, this.thinkingText(input.scopeId));
        return true;
      }

      let nextOverride: RuntimeThinkingLevel | null;
      if (normalized === "default" || normalized === "reset" || normalized === "global") {
        nextOverride = null;
      } else if (this.thinkingLevels.has(normalized)) {
        nextOverride = normalized as RuntimeThinkingLevel;
      } else {
        await this.options.sendText(input.target, `Invalid thinking level: ${normalized}\n\n${this.thinkingText(input.scopeId)}`);
        return true;
      }

      const applied = this.options.store.setSessionThinkingLevelOverride(input.scopeId, sessionId, nextOverride);
      const lines = [
        applied == null ? "Session thinking reset to global default." : `Session thinking set to: ${applied}`,
        `Session: ${sessionId}`,
        ...this.buildSessionThinkingSummary(input.scopeId, sessionId)
      ];
      if (this.options.isRunning(input.scopeId)) {
        lines.push("");
        lines.push("Note: this change applies to the next request, not the one already running.");
      }
      await this.options.sendText(input.target, lines.join("\n"));
      momLog(this.options.channel, "session_thinking_override_updated", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        sessionId,
        thinkingLevelOverride: applied,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/help" || cmd === "/start") {
      await this.options.sendText(input.target, this.helpText());
      return true;
    }

    return false;
  }

  private resolveSessionSelection(scopeId: string, selector: string): string | null {
    const sessions = this.options.store.listSessions(scopeId);
    const raw = selector.trim();
    if (!raw) return null;

    const asIndex = Number.parseInt(raw, 10);
    if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= sessions.length) {
      return sessions[asIndex - 1] ?? null;
    }

    return sessions.includes(raw) ? raw : null;
  }

  private formatSessionsOverview(scopeId: string): string {
    const sessions = this.options.store.listSessions(scopeId);
    const active = this.options.store.getActiveSession(scopeId);
    const lines = [
      `Current session: ${active}`,
      `Total sessions: ${sessions.length}`,
      "",
      "Sessions:"
    ];
    for (let i = 0; i < sessions.length; i += 1) {
      const id = sessions[i];
      lines.push(`${i + 1}. ${id}${id === active ? " (current)" : ""}`);
    }
    lines.push("");
    lines.push("Switch: /sessions <index|sessionId>");
    lines.push("Delete: /delete_sessions <index|sessionId>");
    return lines.join("\n");
  }

  private modelsText(route: ModelRoute): string {
    const settings = this.options.getSettings();
    const options = buildModelOptions(settings, route);
    const activeKey = currentModelKey(settings, route);
    const title = route === "text" ? "当前模型列表" : `当前 ${route} 模型列表`;
    const lines = [`${title}（共${options.length}个）：`, ""];

    if (options.length === 0) {
      lines.push("(no configured models)");
    } else {
      lines.push("| 编号 | 供应商 | 模型 |");
      lines.push("|------|--------|------|");
      for (let i = 0; i < options.length; i += 1) {
        const option = options[i];
        const row = this.modelTableDisplayRow(option.label, i + 1, option.key === activeKey);
        lines.push(`| ${row.indexLabel} | ${row.provider} | ${row.model} |`);
      }
    }

    lines.push("");
    lines.push(`切换 ${route} 模型：`);
    lines.push(`/models ${route} <编号>`);
    lines.push(`/models ${route} <key>`);
    if (route === "text") {
      lines.push("");
      lines.push("快捷切换：");
      lines.push("/models <编号>");
      lines.push("/models <key>");
    }
    return lines.join("\n");
  }

  private modelTableDisplayRow(label: string, index: number, isActive: boolean): ModelTableDisplayRow {
    const normalized = label
      .replace(/^\[PI\]\s*/, "[Built-in] ")
      .replace(/^\[Custom\]\s*/, "");
    const delimiter = " / ";
    const splitAt = normalized.indexOf(delimiter);
    const provider = splitAt >= 0 ? normalized.slice(0, splitAt).trim() : normalized.trim();
    const model = splitAt >= 0 ? normalized.slice(splitAt + delimiter.length).trim() : "";

    return {
      indexLabel: isActive ? `${index} ⭐ 当前活跃中` : String(index),
      provider,
      model
    };
  }

  private skillsText(scopeId: string): string {
    const { skills, diagnostics } = loadSkillsFromWorkspace(this.options.workspaceDir, scopeId, {
      disabledSkillPaths: this.options.getSettings().disabledSkillPaths
    });
    const globalSkillsDir = resolveGlobalSkillsDirFromWorkspacePath(this.options.workspaceDir);
    const botSkillsDir = `${this.options.workspaceDir}/skills`;
    const chatSkillsDir = `${this.options.workspaceDir}/${scopeId}/skills`;
    const scopeLabel: Record<string, string> = {
      chat: "chat",
      global: "global",
      bot: "bot"
    };
    const lines = [
      `Workspace: ${this.options.workspaceDir}`,
      `Global skills dir: ${globalSkillsDir}`,
      `Bot skills dir: ${botSkillsDir}`,
      `Chat skills dir: ${chatSkillsDir}`,
      `Loaded skills: ${skills.length}`,
      ""
    ];

    if (skills.length === 0) {
      lines.push("(no skills loaded)");
    } else {
      for (let i = 0; i < skills.length; i += 1) {
        const skill = skills[i];
        lines.push(`${i + 1}. ${skill.name}`);
        lines.push(`   - scope: ${scopeLabel[skill.scope] ?? skill.scope}`);
        lines.push(`   - description: ${skill.description}`);
        if (skill.aliases.length > 0) {
          lines.push(`   - aliases: ${skill.aliases.join(", ")}`);
        }
        lines.push(`   - file: ${skill.filePath}`);
      }
    }

    if (diagnostics.length > 0) {
      lines.push("");
      lines.push("Diagnostics:");
      for (const row of diagnostics) {
        lines.push(`- ${row}`);
      }
    }

    return lines.join("\n");
  }

  private parseConfiguredModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
    const raw = key.trim();
    if (!raw) return null;
    const [mode, provider, ...rest] = raw.split("|");
    if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
    const model = rest.join("|").trim();
    if (!model) return null;
    return { mode, provider: provider.trim(), model };
  }

  private resolveTextRouteThinkingSupport(settings: RuntimeSettings): boolean {
    const parsed = this.parseConfiguredModelKey(currentModelKey(settings, "text"));
    if (!parsed) return false;

    if (parsed.mode === "custom") {
      return settings.customProviders.find((provider) => provider.id === parsed.provider)?.supportsThinking === true;
    }

    try {
      const model = getModels(parsed.provider as any).find((row) => row.id === parsed.model);
      return Boolean(model?.reasoning);
    } catch {
      return false;
    }
  }

  private buildSessionThinkingSummary(scopeId: string, sessionId?: string): string[] {
    const settings = this.options.getSettings();
    const activeSessionId = sessionId ?? this.options.store.getActiveSession(scopeId);
    const sessionOverride = this.options.store.getSessionThinkingLevelOverride(scopeId, activeSessionId);
    const requested = sessionOverride ?? settings.defaultThinkingLevel;
    const reasoningSupported = this.resolveTextRouteThinkingSupport(settings);
    const effective = resolveThinkingLevel({ defaultThinkingLevel: requested }, reasoningSupported);

    return [
      `Global default: ${settings.defaultThinkingLevel}`,
      `Session override: ${sessionOverride ?? "default"}`,
      `Next request target: ${requested}`,
      `Current text model supports thinking: ${reasoningSupported ? "yes" : "no"}`,
      `Effective next request: ${effective}`
    ];
  }

  private thinkingText(scopeId: string): string {
    const sessionId = this.options.store.getActiveSession(scopeId);
    return [
      `Session: ${sessionId}`,
      ...this.buildSessionThinkingSummary(scopeId, sessionId),
      "",
      "Set for current session:",
      "/thinking off",
      "/thinking low",
      "/thinking medium",
      "/thinking high",
      "",
      "Reset to global default:",
      "/thinking default"
    ].join("\n");
  }

  private resolveRouteSummary(settings: RuntimeSettings, route: ModelRoute): { label: string; key: string } {
    const key = currentModelKey(settings, route);
    const option = buildModelOptions(settings, route).find((row) => row.key === key);
    return {
      key,
      label: option?.label ?? "(not found in current options)"
    };
  }

  private formatNumber(value: number): string {
    return Math.max(0, Number(value) || 0).toLocaleString();
  }

  private shouldUseMarkdownTable(command: FixedCommandName): boolean {
    return (
      FIXED_COMMAND_RENDER_MODE[command] === "two_column_markdown_table" &&
      TWO_COLUMN_TABLE_CHANNELS.has(this.options.channel)
    );
  }

  private escapeMarkdownTableCell(value: string): string {
    return String(value ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, "<br>");
  }

  private renderTwoColumnSectionsAsMarkdown(sections: CommandTableSection[]): string {
    return sections
      .filter((section) => section.rows.length > 0)
      .map((section) => {
        const lines: string[] = [];
        if (section.title) lines.push(`**${section.title}**`);
        lines.push("| Item | Value |");
        lines.push("| --- | --- |");
        for (const row of section.rows) {
          lines.push(`| ${this.escapeMarkdownTableCell(row.label)} | ${this.escapeMarkdownTableCell(row.value)} |`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  }

  private statusText(scopeId: string, target: TTarget): string {
    const settings = this.options.getSettings();
    const sessionId = this.options.store.getActiveSession(scopeId);
    const sessionStatus = this.options.store.getSessionStatusSnapshot(scopeId, sessionId);
    const textRoute = this.resolveRouteSummary(settings, "text");
    const visionRoute = this.resolveRouteSummary(settings, "vision");
    const sttRoute = this.resolveRouteSummary(settings, "stt");
    const ttsRoute = this.resolveRouteSummary(settings, "tts");
    const { skills } = loadSkillsFromWorkspace(this.options.workspaceDir, scopeId, {
      disabledSkillPaths: settings.disabledSkillPaths
    });

    const overviewRows: CommandTableRow[] = [
      { label: "Bot", value: this.options.instanceId },
      { label: "Scope", value: scopeId },
      { label: "Session", value: sessionId },
      { label: "Status", value: this.options.isRunning(scopeId) ? "running" : "idle" },
      ...(this.options.getQueueSize ? [{ label: "Queued jobs", value: String(this.options.getQueueSize(scopeId)) }] : []),
      { label: "Session messages", value: this.formatNumber(sessionStatus.messageCount) },
      { label: "Current context≈", value: `${this.formatNumber(sessionStatus.estimatedContextTokens)} tokens` },
      { label: "Session runs", value: this.formatNumber(sessionStatus.usage.runCount) },
      { label: "Session token total", value: this.formatNumber(sessionStatus.usage.totalTokens) },
      {
        label: "Session input/output",
        value: `${this.formatNumber(sessionStatus.usage.inputTokens)} / ${this.formatNumber(sessionStatus.usage.outputTokens)}`
      },
      ...(
        sessionStatus.usage.cacheReadTokens > 0 || sessionStatus.usage.cacheWriteTokens > 0
          ? [{
              label: "Session cache read/write",
              value: `${this.formatNumber(sessionStatus.usage.cacheReadTokens)} / ${this.formatNumber(sessionStatus.usage.cacheWriteTokens)}`
            }]
          : []
      ),
      { label: "Compactions", value: this.formatNumber(sessionStatus.compactionCount) },
      ...(
        sessionStatus.latestCompaction
          ? [{
              label: "Last compaction",
              value: `${sessionStatus.latestCompaction.reason} (${this.formatNumber(sessionStatus.latestCompaction.tokensBefore)} -> ${this.formatNumber(sessionStatus.latestCompaction.tokensAfter)} tokens, ${this.formatNumber(sessionStatus.latestCompaction.summarizedMessages)} messages)`
            }]
          : []
      ),
      { label: "Provider mode", value: settings.providerMode },
      { label: "Loaded skills", value: String(skills.length) },
      ...(this.options.getStatusExtras?.(scopeId, target) ?? []).map((line) => {
        const separator = line.indexOf(":");
        if (separator < 0) return { label: "Extra", value: line };
        return {
          label: line.slice(0, separator).trim(),
          value: line.slice(separator + 1).trim()
        };
      })
    ];
    const thinkingRows = this.buildSessionThinkingSummary(scopeId, sessionId).map((line) => {
      const separator = line.indexOf(":");
      return {
        label: line.slice(0, separator).trim(),
        value: line.slice(separator + 1).trim()
      };
    });
    const modelRows: CommandTableRow[] = [
      { label: "Text", value: textRoute.label },
      { label: "Text key", value: textRoute.key || "(empty)" },
      { label: "Vision", value: visionRoute.label },
      { label: "Vision key", value: visionRoute.key || "(empty)" },
      { label: "STT", value: sttRoute.label },
      { label: "STT key", value: sttRoute.key || "(empty)" },
      { label: "TTS", value: ttsRoute.label },
      { label: "TTS key", value: ttsRoute.key || "(empty)" }
    ];

    if (this.shouldUseMarkdownTable("status")) {
      return this.renderTwoColumnSectionsAsMarkdown([
        { title: "Status", rows: overviewRows },
        { title: "Thinking", rows: thinkingRows },
        { title: "Models", rows: modelRows }
      ]);
    }

    return [
      ...overviewRows.map((row) => `${row.label}: ${row.value}`),
      "",
      "Thinking:",
      ...thinkingRows.map((row) => `${row.label}: ${row.value}`),
      "",
      "Models:",
      ...modelRows.map((row) => `${row.label}: ${row.value}`)
    ].join("\n");
  }

  private helpText(): string {
    const commandRows: CommandTableRow[] = [
      { label: "/stop", value: "stop current running task" },
      { label: "/steer <text|queueId>", value: "inject a live correction into the current running task" },
      { label: "/followup <text|queueId>", value: "run a follow-up turn after the current task finishes" },
      { label: "/queue", value: "list current running and queued tasks" },
      { label: "/queue front <text>", value: "insert a text task at the front of queue" },
      { label: "/queue delete <queueId>", value: "delete a pending queued task by id" },
      { label: "/new", value: "create and switch to a new session" },
      { label: "/clear", value: "clear context of current session" },
      { label: "/sessions", value: "list sessions and current active session" },
      { label: "/sessions <index|sessionId>", value: "switch active session" },
      { label: "/delete_sessions", value: "list sessions and delete usage" },
      { label: "/delete_sessions <index|sessionId>", value: "delete a session" },
      { label: "/status", value: "show current bot/session/runtime status" },
      { label: "/state", value: "alias of /status" },
      { label: "/thinking", value: "show current session thinking setting" },
      { label: "/thinking <default|off|low|medium|high>", value: "change thinking for current session only" },
      { label: "/models", value: "show text route models and current active model" },
      { label: "/models <index|key>", value: "switch text model" },
      { label: "/models <text|vision|stt|tts>", value: "show models and current active model for that route" },
      { label: "/models <text|vision|stt|tts> <index|key>", value: "switch route model" },
      { label: "/compact [instructions]", value: "summarize older context of current session" },
      ...(this.options.helpLines ?? []).map((line) => {
        const separator = line.indexOf(" - ");
        if (separator < 0) return { label: line, value: "" };
        return {
          label: line.slice(0, separator).trim(),
          value: line.slice(separator + 3).trim()
        };
      }),
      { label: "/login <provider>", value: "start OAuth login" },
      { label: "/login <provider> <code-or-redirect-url>", value: "finish OAuth login" },
      { label: "/logout <provider>", value: "remove stored auth" },
      { label: "/skills", value: "list currently loaded skills" },
      { label: "/help", value: "show this help" }
    ];

    if (this.shouldUseMarkdownTable("help")) {
      return this.renderTwoColumnSectionsAsMarkdown([{ title: "Available commands", rows: commandRows }]);
    }

    return ["Available commands:", ...commandRows.map((row) => `${row.label} - ${row.value}`)].join("\n");
  }

  private async queueText(scopeId: string): Promise<string> {
    const rows = await this.options.listQueue?.(scopeId);
    if (!rows || rows.length === 0) {
      return "Queue is empty.";
    }
    const tableRows: CommandTableRow[] = rows.map((row) => ({
      label: `#${row.id} ${row.status}`,
      value: row.preview || "(no preview)"
    }));

    if (this.shouldUseMarkdownTable("help")) {
      return this.renderTwoColumnSectionsAsMarkdown([{ title: "Queue", rows: tableRows }]);
    }

    return ["Queue:", ...rows.map((row) => `#${row.id} [${row.status}] ${row.preview || "(no preview)"}`)].join("\n");
  }

  private async tryHandleQueuedLiveCommand(
    mode: "steer" | "followup",
    input: SharedRuntimeCommandContext<TTarget>,
    rawArg: string
  ): Promise<boolean> {
    if (!/^\d+$/.test(rawArg)) return false;
    if (!this.options.getQueuedPreview || !this.options.deleteQueued) return false;

    const id = Number.parseInt(rawArg, 10);
    if (!Number.isFinite(id) || id <= 0) return false;

    const queued = await this.options.getQueuedPreview(input.scopeId, id);
    if (queued.status === "not_found") {
      await this.options.sendText(input.target, `Queue item ${id} was not found.`);
      return true;
    }
    if (queued.status === "running") {
      await this.options.sendText(
        input.target,
        `Task ${id} is currently running. Use /${mode} <text> to correct the active task directly.`
      );
      return true;
    }

    const preview = String(queued.preview ?? "").trim();
    if (!preview) {
      await this.options.sendText(
        input.target,
        `Queue item ${id} has no text preview. Use /${mode} <text> instead.`
      );
      return true;
    }

    const liveResult = mode === "steer"
      ? this.options.steerRun?.(input.scopeId, preview)
      : this.options.followUpRun?.(input.scopeId, preview);
    if (!liveResult) return false;
    if (!liveResult.queued) {
      await this.options.sendText(
        input.target,
        `Nothing running. Queue item ${id} stays queued.`
      );
      return true;
    }

    const deleted = await this.options.deleteQueued(input.scopeId, id);
    if (deleted !== "deleted") {
      await this.options.sendText(
        input.target,
        `Injected queued task ${id}, but failed to remove it from queue. Use /queue delete ${id} if it still appears.`
      );
      return true;
    }

    await this.options.sendText(
      input.target,
      mode === "steer"
        ? `Injected queued task ${id} into current task.`
        : `Queued task ${id} will now run as live follow-up after the current task.`
    );
    return true;
  }
}
