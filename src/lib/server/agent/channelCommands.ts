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
  cancelAcpRun?: (scopeId: string) => Promise<boolean>;
  maybeHandleAcpCommand?: (scopeId: string, cmd: string, rawArg: string, target: TTarget) => Promise<boolean>;
  sendText: (target: TTarget, text: string) => Promise<void>;
  onSessionMutation?: (scopeId: string) => void | Promise<void>;
  getQueueSize?: (scopeId: string) => number;
  getStatusExtras?: (scopeId: string, target: TTarget) => string[];
  helpLines?: readonly string[];
}

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
      if (result.aborted) {
        await this.options.sendText(input.target, "Stopping...");
      } else {
        const cancelledAcp = await this.options.cancelAcpRun?.(input.scopeId);
        await this.options.sendText(input.target, cancelledAcp ? "ACP cancellation requested." : "Nothing running.");
      }
      return true;
    }

    if (await this.options.maybeHandleAcpCommand?.(input.scopeId, cmd, rawArg, input.target)) {
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
          `Mode: ${switched.settings.providerMode}`,
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
    const activeOption = options.find((option) => option.key === activeKey);
    const lines = [
      `Route: ${route}`,
      `Provider mode: ${settings.providerMode}`,
      `Current active model: ${activeOption ? activeOption.label : "(not found in current options)"}`,
      `Current active key: ${activeKey || "(empty)"}`,
      `Configured model options: ${options.length}`,
      ""
    ];

    if (options.length === 0) {
      lines.push("(no configured models)");
    } else {
      for (let i = 0; i < options.length; i += 1) {
        const option = options[i];
        const marker = option.key === activeKey ? " (active)" : "";
        lines.push(`${i + 1}. ${option.label}${marker}`);
        lines.push(`   - key: ${option.key}`);
      }
    }

    lines.push("");
    lines.push(`Switch ${route} model:`);
    lines.push(`/models ${route} <index>`);
    lines.push(`/models ${route} <key>`);
    if (route === "text") {
      lines.push("");
      lines.push("Quick text switch:");
      lines.push("/models <index>");
      lines.push("/models <key>");
    }
    return lines.join("\n");
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

    const lines = [
      `Bot: ${this.options.instanceId}`,
      `Scope: ${scopeId}`,
      `Session: ${sessionId}`,
      `Status: ${this.options.isRunning(scopeId) ? "running" : "idle"}`,
      this.options.getQueueSize ? `Queued jobs: ${this.options.getQueueSize(scopeId)}` : null,
      `Session messages: ${this.formatNumber(sessionStatus.messageCount)}`,
      `Current context≈ ${this.formatNumber(sessionStatus.estimatedContextTokens)} tokens`,
      `Session runs: ${this.formatNumber(sessionStatus.usage.runCount)}`,
      `Session token total: ${this.formatNumber(sessionStatus.usage.totalTokens)}`,
      `Session input/output: ${this.formatNumber(sessionStatus.usage.inputTokens)} / ${this.formatNumber(sessionStatus.usage.outputTokens)}`,
      sessionStatus.usage.cacheReadTokens > 0 || sessionStatus.usage.cacheWriteTokens > 0
        ? `Session cache read/write: ${this.formatNumber(sessionStatus.usage.cacheReadTokens)} / ${this.formatNumber(sessionStatus.usage.cacheWriteTokens)}`
        : null,
      `Compactions: ${this.formatNumber(sessionStatus.compactionCount)}`,
      sessionStatus.latestCompaction
        ? `Last compaction: ${sessionStatus.latestCompaction.reason} (${this.formatNumber(sessionStatus.latestCompaction.tokensBefore)} -> ${this.formatNumber(sessionStatus.latestCompaction.tokensAfter)} tokens, ${this.formatNumber(sessionStatus.latestCompaction.summarizedMessages)} messages)`
        : null,
      `Provider mode: ${settings.providerMode}`,
      `Loaded skills: ${skills.length}`,
      ...(this.options.getStatusExtras?.(scopeId, target) ?? []),
      "",
      "Thinking:",
      ...this.buildSessionThinkingSummary(scopeId, sessionId),
      "",
      "Models:",
      `Text: ${textRoute.label}`,
      `Text key: ${textRoute.key || "(empty)"}`,
      `Vision: ${visionRoute.label}`,
      `Vision key: ${visionRoute.key || "(empty)"}`,
      `STT: ${sttRoute.label}`,
      `STT key: ${sttRoute.key || "(empty)"}`,
      `TTS: ${ttsRoute.label}`,
      `TTS key: ${ttsRoute.key || "(empty)"}`
    ].filter((line): line is string => Boolean(line));

    return lines.join("\n");
  }

  private helpText(): string {
    return [
      "Available commands:",
      "/stop - stop current running task",
      "/new - create and switch to a new session",
      "/clear - clear context of current session",
      "/sessions - list sessions and current active session",
      "/sessions <index|sessionId> - switch active session",
      "/delete_sessions - list sessions and delete usage",
      "/delete_sessions <index|sessionId> - delete a session",
      "/status - show current bot/session/runtime status",
      "/state - alias of /status",
      "/thinking - show current session thinking setting",
      "/thinking <default|off|low|medium|high> - change thinking for current session only",
      "/models - show text route models and current active model",
      "/models <index|key> - switch text model",
      "/models <text|vision|stt|tts> - show models and current active model for that route",
      "/models <text|vision|stt|tts> <index|key> - switch route model",
      "/compact [instructions] - summarize older context of current session",
      ...(this.options.helpLines ?? []),
      "/login <provider> - start OAuth login",
      "/login <provider> <code-or-redirect-url> - finish OAuth login",
      "/logout <provider> - remove stored auth",
      "/skills - list currently loaded skills",
      "/help - show this help"
    ].join("\n");
  }
}
