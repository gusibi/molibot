import { randomBytes } from "node:crypto";
import type { SharedRuntimeCommandService } from "$lib/server/agent/commands/channelCommands.js";
import type {
  InteractionAction,
  InteractionButton,
  InteractionContext,
  InteractionInputConsumeResult,
  InteractionInputKind,
  InteractionInputPrompt,
  InteractionOutcome,
  InteractionStateBinding,
  InteractionSurface,
  InteractionView
} from "$lib/server/agent/interactions/types.js";

interface TokenRecord<TTarget> {
  action: InteractionAction;
  context: InteractionContext<TTarget>;
  binding: InteractionStateBinding;
  expiresAt: number;
  oneShot: boolean;
  inFlight?: Promise<InteractionOutcome>;
  completed?: InteractionOutcome;
}

interface PendingInput<TTarget> {
  id: string;
  kind: InteractionInputKind;
  context: InteractionContext<TTarget>;
  binding: InteractionStateBinding;
  skillName?: string;
  promptMessageId?: string;
  expiresAt: number;
  expired?: boolean;
  inFlight?: Promise<InteractionInputConsumeResult>;
  completed?: InteractionInputConsumeResult;
}

export interface SharedInteractionServiceOptions<TTarget> {
  channel: string;
  instanceId: string;
  commands: SharedRuntimeCommandService<TTarget>;
  ttlMs?: number;
  maxTokens?: number;
}

const PAGE_SIZE = 6;

function sameNumberSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

export class SharedInteractionService<TTarget> {
  private readonly ttlMs: number;
  private readonly maxTokens: number;
  private readonly tokens = new Map<string, TokenRecord<TTarget>>();
  private readonly inputs = new Map<string, PendingInput<TTarget>>();

  constructor(private readonly options: SharedInteractionServiceOptions<TTarget>) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.maxTokens = options.maxTokens ?? 512;
  }

  commandSurface(text: string): InteractionSurface | null {
    const [rawCommand = "", ...rest] = String(text ?? "").trim().split(/\s+/);
    const command = rawCommand.toLowerCase().split("@")[0];
    if (rest.length > 0) return null;
    if (command === "/menu" || command === "/start") return "menu";
    if (command === "/models") return "models";
    if (command === "/sessions") return "sessions";
    if (command === "/project" || command === "/projects") return "projects";
    if (command === "/thinking") return "thinking";
    if (command === "/skills") return "skills";
    if (command === "/queue") return "queue";
    if (command === "/status" || command === "/state") return "status";
    return null;
  }

  queuedControlView(context: InteractionContext<TTarget>, queueId: number): InteractionView {
    const binding = this.state(context.scopeId);
    return {
      surface: "queue",
      title: this.options.commands.interactionText("Message queued", "消息已排队"),
      body: this.options.commands.interactionText(
        `Queued as #${queueId}. You can stop the current run or inject this exact queued message into it.`,
        `这条消息已排队为 #${queueId}。你可以停止当前任务，或把这条排队消息插入当前任务。`
      ),
      actions: [
        this.button(context, this.options.commands.interactionText("Stop", "停止"), { type: "queued.stop", queueId }, "danger", { binding }),
        this.button(context, this.options.commands.interactionText("Steer", "插入"), { type: "queued.steer", queueId }, "primary", { binding }),
        this.button(context, this.options.commands.interactionText("Queue", "队列"), { type: "queue.open" }, "default", { oneShot: false })
      ]
    };
  }

  async open(surface: InteractionSurface, context: InteractionContext<TTarget>, page = 0): Promise<InteractionView> {
    this.cleanup();
    switch (surface) {
      case "menu":
        return this.menuView(context);
      case "models":
        return this.modelsView(context, page);
      case "sessions":
        return this.sessionsView(context, page);
      case "projects":
        return this.projectsView(context, page);
      case "thinking":
        return this.thinkingView(context);
      case "skills":
        return this.skillsView(context, page);
      case "queue":
        return this.queueView(context, page);
      case "status":
        return this.statusView(context);
    }
  }

  private token(): string {
    return randomBytes(15).toString("base64url");
  }

  private state(scopeId: string): InteractionStateBinding {
    return this.options.commands.getInteractionState(scopeId);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [token, row] of this.tokens) {
      if (row.expiresAt <= now) this.tokens.delete(token);
    }
    for (const [id, row] of this.inputs) {
      if (row.expiresAt > now) continue;
      // Keep a bound prompt as a short-lived tombstone so an explicit reply to
      // an expired prompt is rejected instead of falling through as a normal
      // Agent message. The tombstone is removed after one extra TTL window.
      if (row.promptMessageId && row.expiresAt + this.ttlMs > now) {
        row.expired = true;
        continue;
      }
      this.inputs.delete(id);
    }
    while (this.tokens.size > this.maxTokens) {
      const oldest = this.tokens.keys().next().value;
      if (!oldest) break;
      this.tokens.delete(oldest);
    }
    while (this.inputs.size > this.maxTokens) {
      const oldest = this.inputs.keys().next().value;
      if (!oldest) break;
      this.inputs.delete(oldest);
    }
  }

  private register(
    context: InteractionContext<TTarget>,
    action: InteractionAction,
    options: { oneShot?: boolean; binding?: InteractionStateBinding } = {}
  ): string {
    this.cleanup();
    const token = this.token();
    this.tokens.set(token, {
      action,
      context: { ...context },
      binding: options.binding ?? this.state(context.scopeId),
      expiresAt: Date.now() + this.ttlMs,
      oneShot: options.oneShot ?? !this.isNavigationAction(action)
    });
    return token;
  }

  private isNavigationAction(action: InteractionAction): boolean {
    return action.type.endsWith(".open");
  }

  private button(
    context: InteractionContext<TTarget>,
    label: string,
    action: InteractionAction,
    style: InteractionButton["style"] = "default",
    options?: { oneShot?: boolean; binding?: InteractionStateBinding }
  ): InteractionButton {
    return { label, style, token: this.register(context, action, options) };
  }

  private staleView(message: string, context: InteractionContext<TTarget>): InteractionView {
    return {
      surface: "result",
      title: this.options.commands.interactionText("Interaction expired", "操作已失效"),
      body: message,
      actions: [this.button(context, this.options.commands.interactionText("Open menu", "返回菜单"), { type: "menu.open" }, "primary", { oneShot: false })]
    };
  }

  private bindingMatches(expected: InteractionStateBinding, actual: InteractionStateBinding): boolean {
    return expected.sessionId === actual.sessionId
      && expected.projectId === actual.projectId
      && expected.runId === actual.runId;
  }

  resolveTokenContext(token: string, actorId: string): InteractionContext<TTarget> | null {
    this.cleanup();
    const record = this.tokens.get(String(token ?? ""));
    if (!record || record.expiresAt <= Date.now() || record.context.actorId !== actorId) return null;
    return { ...record.context };
  }

  tokenIsOneShot(token: string, actorId: string): boolean | null {
    this.cleanup();
    const record = this.tokens.get(String(token ?? ""));
    if (!record || record.expiresAt <= Date.now() || record.context.actorId !== actorId) return null;
    return record.oneShot;
  }

  async handleToken(
    token: string,
    actual: { actorId: string; chatId?: string; scopeId?: string; target?: TTarget }
  ): Promise<InteractionOutcome> {
    this.cleanup();
    const record = this.tokens.get(String(token ?? ""));
    if (!record) {
      return { kind: "notice", message: this.options.commands.interactionText("This button is no longer available. Open the menu again.", "这个按钮已失效，请重新打开菜单。") };
    }

    const context: InteractionContext<TTarget> = {
      ...record.context,
      target: actual.target ?? record.context.target
    };
    if (record.context.actorId !== actual.actorId) {
      return { kind: "notice", message: this.options.commands.interactionText("This panel belongs to another user. Open your own /menu.", "这个面板属于其他用户，请自行打开 /menu。") };
    }
    if (actual.chatId && record.context.chatId !== actual.chatId) {
      return { kind: "notice", message: this.options.commands.interactionText("This action belongs to another chat.", "这个操作属于其他聊天。") };
    }
    if (actual.scopeId && record.context.scopeId !== actual.scopeId) {
      return { kind: "notice", message: this.options.commands.interactionText("This action belongs to another topic or thread.", "这个操作属于其他话题或线程。") };
    }

    if (!this.isNavigationAction(record.action) && !this.bindingMatches(record.binding, this.state(record.context.scopeId))) {
      if (record.oneShot) this.tokens.delete(token);
      return {
        kind: "view",
        view: this.staleView(
          this.options.commands.interactionText("The session, Project, or running task changed. Refresh before trying again.", "会话、Project 或运行任务已经变化，请刷新后重试。"),
          context
        )
      };
    }

    if (record.completed) return record.completed;
    if (record.inFlight) return record.inFlight;

    const execute = this.execute(record.action, context, record.binding);
    if (!record.oneShot) return execute;

    record.inFlight = execute;
    try {
      const outcome = await execute;
      record.completed = outcome;
      return outcome;
    } finally {
      record.inFlight = undefined;
      this.tokens.delete(token);
    }
  }

  private async execute(
    action: InteractionAction,
    context: InteractionContext<TTarget>,
    binding: InteractionStateBinding
  ): Promise<InteractionOutcome> {
    switch (action.type) {
      case "menu.open": return { kind: "view", view: await this.menuView(context) };
      case "help.open":
        return {
          kind: "view",
          view: {
            surface: "result",
            title: this.options.commands.interactionText("Help", "帮助"),
            body: this.options.commands.interactionHelpText(),
            actions: [
              this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
            ]
          }
        };
      case "models.open": return { kind: "view", view: await this.modelsView(context, action.page ?? 0) };
      case "sessions.open": return { kind: "view", view: await this.sessionsView(context, action.page ?? 0) };
      case "projects.open": return { kind: "view", view: await this.projectsView(context, action.page ?? 0) };
      case "thinking.open": return { kind: "view", view: await this.thinkingView(context) };
      case "skills.open": return { kind: "view", view: await this.skillsView(context, action.page ?? 0) };
      case "queue.open": return { kind: "view", view: await this.queueView(context, action.page ?? 0) };
      case "status.open": return { kind: "view", view: await this.statusView(context) };
      case "model.select": {
        const result = this.options.commands.selectInteractionModel(context, action.key);
        if (!result.ok) return { kind: "notice", message: result.message, view: await this.modelsView(context, 0) };
        return { kind: "notice", message: result.message, view: await this.modelsView(context, 0) };
      }
      case "model.reset": {
        const result = this.options.commands.resetInteractionModel(context);
        return { kind: "notice", message: result.message, view: await this.modelsView(context, 0) };
      }
      case "session.new": {
        const result = await this.options.commands.createInteractionSession(context);
        return { kind: "notice", message: result.message, view: await this.sessionsView(context, 0) };
      }
      case "session.compact": {
        const result = await this.options.commands.compactInteractionSession(context);
        return { kind: "notice", message: result.message, view: await this.statusView(context) };
      }
      case "session.switch": {
        const result = await this.options.commands.switchInteractionSession(context, action.id);
        return { kind: "notice", message: result.message, view: await this.sessionsView(context, 0) };
      }
      case "session.delete": {
        const state = this.options.commands.getInteractionSessions(context.scopeId);
        const target = state.items.find((item) => item.id === action.id && item.deletable);
        if (!target) return { kind: "notice", message: this.options.commands.interactionText("This session can no longer be deleted.", "这个会话已无法删除。"), view: await this.sessionsView(context, 0) };
        return {
          kind: "view",
          view: {
            surface: "confirm",
            title: this.options.commands.interactionText("Delete session?", "删除会话？"),
            body: this.options.commands.interactionText(`Delete ${target.title || target.id}? This cannot be undone.`, `确定删除「${target.title || target.id}」吗？此操作不可撤销。`),
            actions: [
              this.button(context, this.options.commands.interactionText("Delete", "删除"), { type: "session.delete.confirm", id: action.id }, "danger", { binding }),
              this.button(context, this.options.commands.interactionText("Back", "返回"), { type: "sessions.open" }, "default", { oneShot: false })
            ]
          }
        };
      }
      case "session.delete.confirm": {
        const result = await this.options.commands.deleteInteractionSession(context, action.id);
        return { kind: "notice", message: result.message, view: await this.sessionsView(context, 0) };
      }
      case "project.select": {
        const result = this.options.commands.selectInteractionProject(context, action.id);
        return { kind: "notice", message: result.message, view: await this.projectsView(context, 0) };
      }
      case "project.exit": {
        const result = this.options.commands.selectInteractionProject(context, null);
        return { kind: "notice", message: result.message, view: await this.projectsView(context, 0) };
      }
      case "thinking.select": {
        const result = this.options.commands.selectInteractionThinking(context, action.level);
        return { kind: "notice", message: result.message, view: await this.thinkingView(context) };
      }
      case "skill.open":
        return { kind: "view", view: await this.skillDetailView(context, action.name) };
      case "skill.run":
        return { kind: "input", input: this.beginInput(context, "skill.run", { skillName: action.name }) };
      case "queue.cancel": {
        const result = await this.options.commands.cancelInteractionQueueItem(context, action.id);
        return { kind: "notice", message: result.message, view: await this.queueView(context, 0) };
      }
      case "queue.retry": {
        const result = await this.options.commands.retryInteractionQueueItem(context, action.id);
        return { kind: "notice", message: result.message, view: await this.queueView(context, 0) };
      }
      case "queue.clear": {
        const queue = await this.options.commands.getInteractionQueue(context.scopeId);
        const ids = queue.filter((row) => row.status === "pending").map((row) => row.id);
        if (ids.length === 0) return { kind: "notice", message: this.options.commands.interactionText("There are no pending tasks to clear.", "当前没有待清空的排队任务。"), view: await this.queueView(context, 0) };
        return {
          kind: "view",
          view: {
            surface: "confirm",
            title: this.options.commands.interactionText("Clear pending tasks?", "清空待执行任务？"),
            body: this.options.commands.interactionText(`This will remove ${ids.length} pending task(s). The current run will continue.`, `将清除 ${ids.length} 个待执行任务；当前正在运行的任务不会停止。`),
            actions: [
              this.button(context, this.options.commands.interactionText("Clear", "清空"), { type: "queue.clear.confirm", ids }, "danger", { binding }),
              this.button(context, this.options.commands.interactionText("Back", "返回"), { type: "queue.open" }, "default", { oneShot: false })
            ]
          }
        };
      }
      case "queue.clear.confirm": {
        const queue = await this.options.commands.getInteractionQueue(context.scopeId);
        const nowIds = queue.filter((row) => row.status === "pending").map((row) => row.id);
        if (!sameNumberSet(action.ids, nowIds)) {
          return { kind: "view", view: this.staleView(this.options.commands.interactionText("The pending queue changed. Review it and confirm again.", "待执行队列已经变化，请重新查看并确认。"), context) };
        }
        const result = await this.options.commands.clearInteractionQueue(context);
        return { kind: "notice", message: result.message, view: await this.queueView(context, 0) };
      }
      case "queue.front":
        return { kind: "input", input: this.beginInput(context, "queue.front") };
      case "queued.stop":
        // A queued notice proves pending work exists. Stop therefore enters the
        // same confirmation flow as Status/Menu so the user sees that /stop
        // will clear the entire pending queue, not only this one item.
        return this.execute({ type: "run.stop" }, context, binding);
      case "queued.steer": {
        const result = await this.options.commands.handleQueuedControlAction(context.scopeId, action.queueId, "steer");
        return { kind: "notice", message: result.message, view: await this.queueView(context, 0) };
      }
      case "run.stop": {
        if (!binding.runId) return { kind: "notice", message: this.options.commands.interactionText("There is no stable running task to stop.", "当前没有可确认身份的运行任务。"), view: await this.statusView(context) };
        const queue = await this.options.commands.getInteractionQueue(context.scopeId);
        const queueIds = queue.filter((row) => row.status === "pending").map((row) => row.id);
        if (queueIds.length === 0) {
          const result = await this.options.commands.stopInteractionRun(context, binding.runId, []);
          return { kind: "notice", message: result.message, view: await this.statusView(context) };
        }
        return {
          kind: "view",
          view: {
            surface: "confirm",
            title: this.options.commands.interactionText("Stop current task?", "停止当前任务？"),
            body: this.options.commands.interactionText(
              `Stopping also clears ${queueIds.length} pending task(s), matching /stop behavior.`,
              `停止当前任务还会清除 ${queueIds.length} 个待执行任务，与 /stop 的现有行为一致。`
            ),
            actions: [
              this.button(context, this.options.commands.interactionText("Stop and clear", "停止并清空"), { type: "run.stop.confirm", runId: binding.runId, queueIds }, "danger", { binding }),
              this.button(context, this.options.commands.interactionText("Back", "返回"), { type: "status.open" }, "default", { oneShot: false })
            ]
          }
        };
      }
      case "run.stop.confirm": {
        const current = this.state(context.scopeId);
        const queue = await this.options.commands.getInteractionQueue(context.scopeId);
        const nowIds = queue.filter((row) => row.status === "pending").map((row) => row.id);
        if (current.runId !== action.runId || !sameNumberSet(nowIds, action.queueIds)) {
          return { kind: "view", view: this.staleView(this.options.commands.interactionText("The running task or pending queue changed. Review status and confirm again.", "运行任务或待执行队列已经变化，请重新查看状态并确认。"), context) };
        }
        const result = await this.options.commands.stopInteractionRun(context, action.runId, action.queueIds);
        return { kind: "notice", message: result.message, view: await this.statusView(context) };
      }
      case "run.steer":
        return { kind: "input", input: this.beginInput(context, "run.steer") };
      case "run.followup":
        return { kind: "input", input: this.beginInput(context, "run.followup") };
      case "input.cancel": {
        const input = this.inputs.get(action.requestId);
        if (input && input.context.actorId === context.actorId && input.context.scopeId === context.scopeId) {
          this.inputs.delete(action.requestId);
        }
        const message = this.options.commands.interactionText("Input cancelled.", "已取消输入。");
        return {
          kind: "view",
          view: {
            surface: "result",
            title: this.options.commands.interactionText("Input cancelled", "输入已取消"),
            body: message
          }
        };
      }
    }
  }

  private async menuView(context: InteractionContext<TTarget>): Promise<InteractionView> {
    const state = this.options.commands.getInteractionStatus(context.scopeId);
    const conversationActions: InteractionButton[] = [
      this.button(context, this.options.commands.interactionText("New session", "新建会话"), { type: "session.new" }, "primary"),
      this.button(context, this.options.commands.interactionText("Sessions", "会话"), { type: "sessions.open" }, "default", { oneShot: false })
    ];
    if (state.runId) {
      conversationActions.push(this.button(context, this.options.commands.interactionText("Stop", "停止"), { type: "run.stop" }, "danger"));
    }
    return {
      surface: "menu",
      title: "MoliBot",
      body: this.options.commands.interactionText("Choose an action. Slash commands remain available as shortcuts.", "选择要执行的操作。Slash Command 仍可作为快捷入口使用。"),
      sections: [
        {
          title: this.options.commands.interactionText("Conversation", "对话"),
          actions: conversationActions
        },
        {
          title: "Agent",
          actions: [
            this.button(context, this.options.commands.interactionText("Model", "模型"), { type: "models.open" }, "default", { oneShot: false }),
            this.button(context, this.options.commands.interactionText("Thinking", "思考"), { type: "thinking.open" }, "default", { oneShot: false }),
            this.button(context, this.options.commands.interactionText("Skills", "技能"), { type: "skills.open" }, "default", { oneShot: false })
          ]
        },
        {
          title: this.options.commands.interactionText("Workspace", "工作区"),
          actions: [
            this.button(context, "Project", { type: "projects.open" }, "default", { oneShot: false })
          ]
        },
        {
          title: this.options.commands.interactionText("Runtime", "运行"),
          actions: [
            this.button(context, this.options.commands.interactionText("Status", "状态"), { type: "status.open" }, "default", { oneShot: false }),
            this.button(context, this.options.commands.interactionText("Queue", "队列"), { type: "queue.open" }, "default", { oneShot: false }),
            this.button(context, this.options.commands.interactionText("Help", "帮助"), { type: "help.open" }, "default", { oneShot: false })
          ]
        }
      ]
    };
  }

  private async modelsView(context: InteractionContext<TTarget>, page: number): Promise<InteractionView> {
    const state = this.options.commands.getInteractionModels();
    const totalPages = Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const items = state.items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    return {
      surface: "models",
      title: this.options.commands.interactionText("Model", "模型"),
      body: this.options.commands.interactionText(
        `Current: ${state.activeKey || "none"} · scope: ${state.source === "agent" ? `agent ${state.agentId}` : "global"}`,
        `当前：${state.activeKey || "无"} · 作用域：${state.source === "agent" ? `agent ${state.agentId}` : "全局"}`
      ),
      sections: [{
        rows: items.map((item) => ({
          id: item.key,
          label: item.label,
          selected: item.selected,
          actions: item.selected ? [] : [this.button(context, this.options.commands.interactionText("Select", "选择"), { type: "model.select", key: item.key }, "primary")]
        }))
      }],
      actions: [
        ...(safePage > 0 ? [this.button(context, "‹", { type: "models.open", page: safePage - 1 }, "default", { oneShot: false })] : []),
        ...(safePage + 1 < totalPages ? [this.button(context, "›", { type: "models.open", page: safePage + 1 }, "default", { oneShot: false })] : []),
        ...(state.canReset ? [this.button(context, this.options.commands.interactionText("Follow global", "恢复跟随全局"), { type: "model.reset" })] : []),
        this.button(context, this.options.commands.interactionText("Refresh", "刷新"), { type: "models.open", page: safePage }, "default", { oneShot: false }),
        this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
      ],
      note: this.options.commands.interactionText("Model changes follow the existing bot/agent scope and take effect on the next request.", "模型切换沿用现有 Bot/Agent 作用域，并从下一次请求生效。")
    };
  }

  private async sessionsView(context: InteractionContext<TTarget>, page: number): Promise<InteractionView> {
    const state = this.options.commands.getInteractionSessions(context.scopeId);
    const totalPages = Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const items = state.items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    return {
      surface: "sessions",
      title: this.options.commands.interactionText("Sessions", "会话"),
      body: state.mode === "project"
        ? this.options.commands.interactionText(`Project: ${state.projectName ?? state.projectId}`, `Project：${state.projectName ?? state.projectId}`)
        : this.options.commands.interactionText(`Current session: ${state.activeId ?? "none"}`, `当前会话：${state.activeId ?? "无"}`),
      sections: [{
        rows: items.map((item) => ({
          id: item.id,
          label: item.title || item.id,
          detail: item.id,
          selected: item.selected,
          actions: [
            ...(!item.selected ? [this.button(context, this.options.commands.interactionText("Switch", "切换"), { type: "session.switch", id: item.id }, "primary")] : []),
            ...(item.deletable ? [this.button(context, this.options.commands.interactionText("Delete", "删除"), { type: "session.delete", id: item.id }, "danger")] : [])
          ]
        }))
      }],
      actions: [
        this.button(context, this.options.commands.interactionText("New session", "新建会话"), { type: "session.new" }, "primary"),
        ...(safePage > 0 ? [this.button(context, "‹", { type: "sessions.open", page: safePage - 1 }, "default", { oneShot: false })] : []),
        ...(safePage + 1 < totalPages ? [this.button(context, "›", { type: "sessions.open", page: safePage + 1 }, "default", { oneShot: false })] : []),
        this.button(context, this.options.commands.interactionText("Refresh", "刷新"), { type: "sessions.open", page: safePage }, "default", { oneShot: false }),
        this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
      ],
      note: state.mode === "project"
        ? this.options.commands.interactionText("Project sessions can be switched here; deletion remains managed from Desktop.", "项目会话可在这里切换；删除仍由 Desktop 管理。")
        : undefined
    };
  }

  private async projectsView(context: InteractionContext<TTarget>, page: number): Promise<InteractionView> {
    const state = this.options.commands.getInteractionProjects(context.scopeId);
    const totalPages = Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const items = state.items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    return {
      surface: "projects",
      title: "Project",
      body: state.active ? this.options.commands.interactionText(`Current: ${state.active.name}`, `当前：${state.active.name}`) : this.options.commands.interactionText("Current mode: Chat", "当前模式：普通聊天"),
      sections: [{
        rows: items.map((item) => ({
          id: item.id,
          label: item.name,
          selected: item.selected,
          actions: item.selected ? [] : [this.button(context, this.options.commands.interactionText("Select", "选择"), { type: "project.select", id: item.id }, "primary")]
        }))
      }],
      actions: [
        ...(state.active ? [this.button(context, this.options.commands.interactionText("Exit Project", "退出 Project"), { type: "project.exit" }, "danger")] : []),
        ...(safePage > 0 ? [this.button(context, "‹", { type: "projects.open", page: safePage - 1 }, "default", { oneShot: false })] : []),
        ...(safePage + 1 < totalPages ? [this.button(context, "›", { type: "projects.open", page: safePage + 1 }, "default", { oneShot: false })] : []),
        this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
      ]
    };
  }

  private async thinkingView(context: InteractionContext<TTarget>): Promise<InteractionView> {
    const state = this.options.commands.getInteractionThinking(context.scopeId);
    return {
      surface: "thinking",
      title: this.options.commands.interactionText("Thinking", "思考级别"),
      body: this.options.commands.interactionText(
        `Override: ${state.override ?? "default"} · effective next request: ${state.effective}`,
        `覆盖值：${state.override ?? "default"} · 下次请求实际生效：${state.effective}`
      ),
      actions: [
        ...state.supported.map((level) => this.button(
          context,
          `${level}${state.override === level ? " ✓" : ""}`,
          { type: "thinking.select", level },
          state.override === level ? "primary" : "default"
        )),
        this.button(context, this.options.commands.interactionText("Default", "恢复默认"), { type: "thinking.select", level: null }),
        this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
      ],
      note: this.options.commands.interactionText("Changes apply to the next request, not one already running.", "更改从下一次请求开始生效，不影响已经运行中的请求。")
    };
  }

  private async skillsView(context: InteractionContext<TTarget>, page: number): Promise<InteractionView> {
    const skills = this.options.commands.getInteractionSkills(context.scopeId);
    const totalPages = Math.max(1, Math.ceil(skills.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const items = skills.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    return {
      surface: "skills",
      title: this.options.commands.interactionText("Skills", "技能"),
      sections: [{
        rows: items.map((skill) => ({
          id: skill.name,
          label: skill.name,
          detail: skill.description,
          actions: [this.button(context, this.options.commands.interactionText("Details", "详情"), { type: "skill.open", name: skill.name }, "primary")]
        }))
      }],
      actions: [
        ...(safePage > 0 ? [this.button(context, "‹", { type: "skills.open", page: safePage - 1 }, "default", { oneShot: false })] : []),
        ...(safePage + 1 < totalPages ? [this.button(context, "›", { type: "skills.open", page: safePage + 1 }, "default", { oneShot: false })] : []),
        this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
      ]
    };
  }

  private async skillDetailView(context: InteractionContext<TTarget>, name: string): Promise<InteractionView> {
    const skill = this.options.commands.getInteractionSkills(context.scopeId).find((item) => item.name === name);
    if (!skill) return this.staleView(this.options.commands.interactionText("This skill is no longer available.", "这个技能已不可用。"), context);
    return {
      surface: "skills",
      title: skill.name,
      body: skill.description,
      sections: [{
        rows: [
          { label: this.options.commands.interactionText("Scope", "作用域"), detail: skill.scope },
          ...(skill.aliases.length ? [{ label: this.options.commands.interactionText("Aliases", "别名"), detail: skill.aliases.join(", ") }] : [])
        ]
      }],
      actions: [
        this.button(context, this.options.commands.interactionText("Use this skill", "使用此技能"), { type: "skill.run", name: skill.name }, "primary"),
        this.button(context, this.options.commands.interactionText("Back", "返回"), { type: "skills.open" }, "default", { oneShot: false })
      ]
    };
  }

  private async queueView(context: InteractionContext<TTarget>, page: number): Promise<InteractionView> {
    const queue = await this.options.commands.getInteractionQueue(context.scopeId);
    const totalPages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const items = queue.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    return {
      surface: "queue",
      title: this.options.commands.interactionText("Queue", "队列"),
      sections: [{
        rows: items.map((item) => ({
          id: String(item.id),
          label: `#${item.id} · ${item.status}`,
          detail: item.preview,
          actions: [
            ...(item.status === "pending" ? [this.button(context, this.options.commands.interactionText("Cancel", "取消"), { type: "queue.cancel", id: item.id }, "danger")] : []),
            ...(item.status === "recovery_required" ? [this.button(context, this.options.commands.interactionText("Retry", "重试"), { type: "queue.retry", id: item.id }, "primary")] : [])
          ]
        }))
      }],
      actions: [
        this.button(context, this.options.commands.interactionText("Add to front", "插到队首"), { type: "queue.front" }, "primary"),
        ...(queue.some((item) => item.status === "pending") ? [this.button(context, this.options.commands.interactionText("Clear pending", "清空待执行"), { type: "queue.clear" }, "danger")] : []),
        ...(safePage > 0 ? [this.button(context, "‹", { type: "queue.open", page: safePage - 1 }, "default", { oneShot: false })] : []),
        ...(safePage + 1 < totalPages ? [this.button(context, "›", { type: "queue.open", page: safePage + 1 }, "default", { oneShot: false })] : []),
        this.button(context, this.options.commands.interactionText("Refresh", "刷新"), { type: "queue.open", page: safePage }, "default", { oneShot: false }),
        this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
      ],
      note: queue.some((item) => item.status === "recovery_required")
        ? this.options.commands.interactionText("Retrying a recovery item may repeat side effects completed before interruption.", "重试恢复任务可能重复中断前已经完成的副作用。")
        : undefined
    };
  }

  private async statusView(context: InteractionContext<TTarget>): Promise<InteractionView> {
    const state = this.options.commands.getInteractionStatus(context.scopeId);
    const actions: InteractionButton[] = [
      this.button(context, this.options.commands.interactionText("Sessions", "会话"), { type: "sessions.open" }, "default", { oneShot: false }),
      this.button(context, this.options.commands.interactionText("Model", "模型"), { type: "models.open" }, "default", { oneShot: false }),
      this.button(context, this.options.commands.interactionText("Thinking", "思考"), { type: "thinking.open" }, "default", { oneShot: false }),
      this.button(context, this.options.commands.interactionText("Queue", "队列"), { type: "queue.open" }, "default", { oneShot: false })
    ];
    if (state.runId) {
      actions.unshift(
        this.button(context, this.options.commands.interactionText("Stop", "停止"), { type: "run.stop" }, "danger"),
        this.button(context, this.options.commands.interactionText("Steer", "调整方向"), { type: "run.steer", runId: state.runId }, "primary"),
        this.button(context, this.options.commands.interactionText("Follow-up", "完成后继续"), { type: "run.followup", runId: state.runId }, "default")
      );
    }
    return {
      surface: "status",
      title: this.options.commands.interactionText("Status", "状态"),
      sections: [{
        rows: [
          { label: this.options.commands.interactionText("Session", "会话"), detail: state.sessionId },
          { label: "Project", detail: state.projectName ?? state.projectId ?? this.options.commands.interactionText("Chat", "普通聊天") },
          { label: this.options.commands.interactionText("Model", "模型"), detail: state.modelKey || "-" },
          { label: this.options.commands.interactionText("Thinking", "思考"), detail: state.thinkingEffective },
          { label: this.options.commands.interactionText("Queue", "队列"), detail: String(state.queueSize) },
          { label: this.options.commands.interactionText("Runtime", "运行状态"), detail: state.running ? this.options.commands.interactionText("running", "运行中") : this.options.commands.interactionText("idle", "空闲") },
          ...(state.contextTokens !== null && state.contextWindow !== null
            ? [{
                label: this.options.commands.interactionText("Context", "上下文"),
                detail: `${state.contextTokens.toLocaleString()} / ${state.contextWindow.toLocaleString()}${state.compactionThreshold ? ` · threshold ${state.compactionThreshold.toLocaleString()}` : ""}`
              }]
            : [])
        ]
      }],
      actions: [
        ...(state.compactRecommended
          ? [
              this.button(context, this.options.commands.interactionText("Compact", "压缩上下文"), { type: "session.compact" }, "primary"),
              this.button(context, this.options.commands.interactionText("New session", "新建会话"), { type: "session.new" })
            ]
          : []),
        ...actions,
        this.button(context, this.options.commands.interactionText("Refresh", "刷新"), { type: "status.open" }, "default", { oneShot: false }),
        this.button(context, this.options.commands.interactionText("Menu", "菜单"), { type: "menu.open" }, "default", { oneShot: false })
      ]
    };
  }

  private beginInput(
    context: InteractionContext<TTarget>,
    kind: InteractionInputKind,
    extra: { skillName?: string } = {}
  ): InteractionInputPrompt {
    const id = this.token();
    const expiresAt = Date.now() + this.ttlMs;
    const input: PendingInput<TTarget> = {
      id,
      kind,
      context,
      binding: this.state(context.scopeId),
      skillName: extra.skillName,
      expiresAt
    };
    this.inputs.set(id, input);
    const cancelToken = this.register(context, { type: "input.cancel", requestId: id }, { binding: input.binding });
    const copy = kind === "run.steer"
      ? {
          title: this.options.commands.interactionText("Adjust current task", "调整当前任务"),
          body: this.options.commands.interactionText("Reply to this prompt with the steering instruction.", "请明确回复这条提示，输入要注入当前任务的调整内容。")
        }
      : kind === "run.followup"
        ? {
            title: this.options.commands.interactionText("Continue after current task", "完成后继续"),
            body: this.options.commands.interactionText("Reply to this prompt with the follow-up task.", "请明确回复这条提示，输入当前任务完成后要继续执行的内容。")
          }
        : kind === "queue.front"
          ? {
              title: this.options.commands.interactionText("Add task to front", "插入队首"),
              body: this.options.commands.interactionText("Reply to this prompt with the new task. Existing queue items are not reordered.", "请明确回复这条提示，输入要新增到队首的任务；现有任务不会被重新排序。")
            }
          : {
              title: this.options.commands.interactionText(`Use skill: ${extra.skillName ?? ""}`, `使用技能：${extra.skillName ?? ""}`),
              body: this.options.commands.interactionText("Reply to this prompt with the task for this skill.", "请明确回复这条提示，输入希望该技能完成的任务。")
            };
    return { requestId: id, kind, title: copy.title, body: copy.body, cancelToken, expiresAt };
  }

  bindInputPrompt(requestId: string, messageId: string | number): boolean {
    const input = this.inputs.get(requestId);
    if (!input || input.expiresAt <= Date.now()) return false;
    input.promptMessageId = String(messageId);
    return true;
  }

  async consumeInputReply(
    context: InteractionContext<TTarget>,
    replyToMessageId: string | number | null | undefined,
    text: string
  ): Promise<InteractionInputConsumeResult> {
    this.cleanup();
    const replyId = String(replyToMessageId ?? "").trim();
    if (!replyId) return { handled: false };
    const input = Array.from(this.inputs.values()).find((row) =>
      row.promptMessageId === replyId
      && row.context.actorId === context.actorId
      && row.context.chatId === context.chatId
      && row.context.scopeId === context.scopeId
    );
    if (!input) return { handled: false };

    if (input.expired || input.expiresAt <= Date.now()) {
      this.inputs.delete(input.id);
      return {
        handled: true,
        terminal: true,
        message: this.options.commands.interactionText("This input request expired. Open the action again.", "这次输入请求已过期，请重新发起操作。")
      };
    }

    const normalized = String(text ?? "").trim();
    if (!normalized) {
      return {
        handled: true,
        terminal: false,
        message: this.options.commands.interactionText("Input cannot be empty. Reply to the same prompt again.", "输入不能为空，请重新回复同一条提示。")
      };
    }
    if (!this.bindingMatches(input.binding, this.state(context.scopeId))) {
      this.inputs.delete(input.id);
      return {
        handled: true,
        terminal: true,
        message: this.options.commands.interactionText("The target session, Project, or run changed. This input request expired.", "目标会话、Project 或运行任务已经变化，这次输入请求已失效。")
      };
    }
    if (input.completed) {
      return {
        handled: true,
        terminal: true,
        message: this.options.commands.interactionText("This input was already submitted.", "这次输入已经提交过了。")
      };
    }
    if (input.inFlight) {
      await input.inFlight;
      return {
        handled: true,
        terminal: true,
        message: this.options.commands.interactionText("This input is already being processed.", "这次输入已经在处理中。")
      };
    }

    const pending = this.executeInput(input, context, normalized);
    input.inFlight = pending;
    try {
      const result = await pending;
      input.completed = result;
      // Keep the completed prompt as an idempotency tombstone. A duplicate
      // platform delivery must never fall through as a fresh Agent message.
      input.expiresAt = Date.now() + this.ttlMs;
      return result;
    } finally {
      input.inFlight = undefined;
    }
  }

  private async executeInput(
    input: PendingInput<TTarget>,
    context: InteractionContext<TTarget>,
    text: string
  ): Promise<InteractionInputConsumeResult> {
    if (input.kind === "run.steer") {
      if (!input.binding.runId) return { handled: true, terminal: true, message: this.options.commands.interactionText("The running task already ended.", "当前运行任务已经结束。") };
      const result = this.options.commands.steerInteractionRun(context, input.binding.runId, text);
      return { handled: true, terminal: true, message: result.message };
    }
    if (input.kind === "run.followup") {
      if (!input.binding.runId) return { handled: true, message: this.options.commands.interactionText("The running task already ended.", "当前运行任务已经结束。") };
      const result = this.options.commands.followUpInteractionRun(context, input.binding.runId, text);
      return { handled: true, terminal: true, message: result.message };
    }
    if (input.kind === "queue.front") {
      const result = await this.options.commands.enqueueInteractionFront(context, text);
      return { handled: true, terminal: true, message: result.message };
    }
    const skill = this.options.commands.getInteractionSkills(context.scopeId).find((row) => row.name === input.skillName);
    if (!skill) return { handled: true, terminal: true, message: this.options.commands.interactionText("This skill is no longer available.", "这个技能已不可用。") };
    const selector = skill.aliases[0] || skill.name;
    return {
      handled: true,
      terminal: true,
      message: this.options.commands.interactionText(
        `Skill task accepted: ${skill.name}.`,
        `技能任务已接收：${skill.name}。`
      ),
      agentText: `/${selector} ${text}`
    };
  }
}
