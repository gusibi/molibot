import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { ConversationActivityCollector } from "$lib/server/app/conversationActivity";
import { buildSubagentDiagnostic } from "$lib/server/agent/subagentProgress";
import {
  findSkillBySelector,
  formatSkillDetailText,
  formatSkillsDetailText,
  formatSkillsSummaryText,
  loadSkillsFromWorkspace
} from "$lib/server/agent/skills/skills";
import {
  listOAuthProviderIds,
  removeStoredAuth,
  resolveAuthFilePath,
  startOAuthLogin,
  submitOAuthLoginCode
} from "$lib/server/agent/identity/auth";
import type { ChannelInboundMessage, FileAttachment } from "$lib/server/agent/core/types";
import {
  buildModelOptions,
  currentModelKey,
  parseModelRoute,
  switchModelSelection,
  type ModelRoute
} from "$lib/server/settings/modelSwitch";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";
import { getWebRuntimeContext } from "$lib/server/web/runtimeContext";
import { sanitizeRuntimeThinkingLevel, type RuntimeThinkingLevel } from "$lib/server/settings";
import type { RunnerUiEvent } from "$lib/server/agent/core/types";
import type { ConversationAttachment } from "$lib/shared/types/message";
import { resolveWorkspaceId } from "$lib/server/workspaces/store";
import { executeHostBashApproval, rewriteApprovalToolResultInContext } from "$lib/server/agent/hostBashExec";
import { getHostBashStore } from "$lib/server/hostBash";
import { commandLocaleFromSettings, commandText, isChineseLocale } from "$lib/server/agent/commands/i18n";
import { saveWebResponseAttachment } from "$lib/server/web/attachments";
import { resolveProjectContext } from "$lib/server/projects/context";

interface ChatBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
  thinkingLevel?: string;
  projectId?: string;
}

interface ParsedWebChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  profileId: string;
  files: File[];
  thinkingLevel: RuntimeThinkingLevel;
  projectId?: string;
}

interface WebCommandResult {
  ok: true;
  response: string;
}

function webCommandText(english: string, chinese: string): string {
  return commandText(commandLocaleFromSettings(getRuntime().getSettings()), english, chinese);
}

function inferMediaType(file: File): FileAttachment["mediaType"] {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "file";
}

function isImageFile(file: File): boolean {
  return inferMediaType(file) === "image";
}

function normalizeText(input: string): string {
  const text = input.trim();
  if (text) return text;
  return "";
}

function buildModelsText(profileId: string, route: ModelRoute): string {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const options = buildModelOptions(settings, route);
  const activeKey = currentModelKey(settings, route);
  const zh = isChineseLocale(settings.locale);
  const lines = [
    zh ? `路由：${route}` : `Route: ${route}`,
    zh ? `提供方模式：${settings.providerMode}` : `Provider mode: ${settings.providerMode}`,
    zh ? `已配置模型选项：${options.length}` : `Configured model options: ${options.length}`,
    ""
  ];

  if (options.length === 0) {
    lines.push(zh ? "没有可用的模型选项。" : "No available model options.");
  } else {
    options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option.label}${option.key === activeKey ? (zh ? "（当前）" : " (active)") : ""}`);
      lines.push(`   key: ${option.key}`);
    });
  }

  lines.push("");
  lines.push(`/models ${route} <index>`);
  lines.push(`/models ${route} <key>`);
  if (route === "text") {
    lines.push("/models <index>");
    lines.push("/models <key>");
  }
  lines.push(`/skills`);
  lines.push(`/skills-detail`);
  lines.push(`/compact [instructions]`);
  lines.push(`/login <provider>`);
  lines.push(`/login <provider> <code-or-redirect-url>`);
  lines.push(`/logout <provider>`);
  lines.push(`/help`);
  lines.push(`profile: ${profileId}`);
  return lines.join("\n");
}

function buildSkillsText(profileId: string, rawArg = "", detailMode = false): string {
  const locale = commandLocaleFromSettings(getRuntime().getSettings());
  const { store } = getWebRuntimeContext(profileId);
  const { skills, diagnostics } = loadSkillsFromWorkspace(store.getWorkspaceDir(), "web");
  const selector = rawArg.trim();
  if (selector) {
    const skill = findSkillBySelector(skills, selector);
    if (!skill) {
      return [
        `Skill not found: ${selector}`,
        "",
        formatSkillsSummaryText(skills, diagnostics, {
          footerLines: [
            "Usage: /skills",
            "Usage: /skills <id>",
            "Usage: /skills-detail"
          ]
        })
      ].join("\n");
    }
      return formatSkillDetailText(skill, locale);
  }

  if (detailMode) {
    return formatSkillsDetailText(skills, diagnostics, { locale });
  }

  return formatSkillsSummaryText(skills, diagnostics, {
    footerLines: [
      webCommandText("Use /skills <id> for details.", "使用 /skills <id> 查看详情。"),
      webCommandText("Use /skills-detail for the full list.", "使用 /skills-detail 查看完整列表。")
    ],
    locale
  });
}

function buildLoginScope(profileId: string, externalUserId?: string): string {
  return `web:${profileId}:${externalUserId || "anonymous"}`;
}

async function handleWebHostToolsCommand(
  rawArg: string,
  profileId: string,
  conversationId: string | undefined,
  externalUserId: string | undefined
): Promise<WebCommandResult> {
  if (!externalUserId) {
    return { ok: true, response: "No active Web chat scope for Host Bash approvals." };
  }
  const { store } = getWebRuntimeContext(profileId);
  const hostBashStore = getHostBashStore();
  const [subcommand = "list", approvalId = ""] = rawArg.split(/\s+/).filter(Boolean);
  const scopeId = externalUserId;
  const sessionId = conversationId || store.getActiveSession(scopeId);

  if (subcommand === "list") {
    const pending = hostBashStore.listPending(scopeId, sessionId);
    const approved = hostBashStore.listWhitelist().filter((item) => item.enabled);
    return {
      ok: true,
      response: [
        `Pending Host Bash approvals: ${pending.length}`,
        ...pending.map((item) => `- ${item.id}: ${item.displayName} (${item.command})`),
        "",
        `Host Bash whitelist entries: ${approved.length}`,
        ...approved.map((item) => `- ${item.toolId}: ${item.displayName} (${item.command})`)
      ].join("\n").trim()
    };
  }

  if (subcommand === "reject") {
    const rejected = hostBashStore.reject(scopeId, approvalId || undefined, sessionId);
    return {
      ok: true,
      response: rejected
        ? `Rejected Host Bash approval ${rejected.id} (${rejected.displayName}).`
        : "No matching pending Host Bash approval found."
    };
  }

  if (subcommand !== "approve" && subcommand !== "approve-once" && subcommand !== "approve-session") {
    return {
      ok: true,
      response: [
        "Host Bash usage:",
        "/hosttools",
        "/hosttools approve <approvalId>",
        "/hosttools approve-once <approvalId>",
        "/hosttools approve-session <approvalId>",
        "/hosttools reject <approvalId>"
      ].join("\n")
    };
  }

  const approved = hostBashStore.approve(scopeId, approvalId || undefined, {
    scope: subcommand === "approve-session" ? "session" : subcommand === "approve-once" ? "once" : "persistent",
    sessionId
  });
  if (!approved) {
    return { ok: true, response: "No matching pending Host Bash approval found." };
  }
  if (subcommand === "approve-session") {
    store.setSessionHostApprovalMode(scopeId, sessionId, "session");
    store.appendRuntimeEvent(scopeId, {
      code: "SESSION_HOST_APPROVAL_ENABLED",
      level: "info",
      summary: "Enabled session-only sandbox fallback approval from Web chat.",
      details: {
        sessionId,
        requestId: approved.record.id,
        command: approved.record.command
      }
    }, sessionId);
  }

  const lines = [
    subcommand === "approve-session"
      ? `Approved for current session only: ${approved.record.displayName}`
      : `Approved Host Bash: ${approved.record.displayName}`,
    `Request ID: ${approved.record.id}`,
    `Command: ${approved.record.command}`
  ];
  if (subcommand === "approve-session") {
    lines.push(`Session: ${sessionId}`);
    lines.push("Future sandbox permission denials in this session will fall back to Host Bash automatically.");
  } else if (approved.approved) {
    lines.push("This command is now registered as a reusable Host Bash whitelist entry.");
  }

  if (approved.record.pendingAction) {
    try {
      const executed = await executeHostBashApproval({
        record: approved.record,
        approvedTool: approved.approved,
        cwd: store.getScratchDir(scopeId)
      });
      hostBashStore.markExecution(approved.record.id, "executed");
      lines.push("", "Approved and executed immediately.");

      try {
        const messages = store.loadContext(scopeId, sessionId);
        const rewritten = rewriteApprovalToolResultInContext(messages, approved.record.command, executed.rendered);

        if (rewritten) {
          store.saveContext(scopeId, messages, sessionId);
          const { pool } = getWebRuntimeContext(profileId);
          pool.reset(scopeId, sessionId);
          const runner = pool.get(scopeId, sessionId);

          const workspaceId = resolveWorkspaceId();
          const messageId = Date.now();
          const ts = `${Date.now() / 1000}`;

          void runner.run({
            channel: "web",
            workspaceDir: store.getWorkspaceDir(),
            chatDir: store.getChatDir(scopeId),
            message: {
              chatId: scopeId,
              workspaceId,
              chatType: "private",
              messageId,
              userId: scopeId,
              userName: scopeId,
              text: "",
              ts,
              attachments: [],
              imageContents: [],
              sessionId,
              isEvent: true
            },
            respond: async (text: string) => {
              if (text.trim()) {
                getRuntime().sessions.appendMessage(sessionId, "assistant", text);
              }
            },
            replaceMessage: async (text: string) => {
              if (text.trim()) {
                getRuntime().sessions.appendMessage(sessionId, "assistant", text);
              }
            },
            respondInThread: async (text: string) => {
              if (text.trim()) {
                getRuntime().sessions.appendMessage(sessionId, "assistant", text);
              }
            },
            setTyping: async () => {},
            setWorking: async () => {},
            deleteMessage: async () => {},
            uploadFile: async () => {}
          });
        }
      } catch (error) {
        console.error("[web:auto-resume]", "background rewrite or re-run failed", {
          scopeId,
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hostBashStore.markExecution(approved.record.id, "failed", message);
      lines.push("", `${subcommand === "approve-session" ? "Approved for this session" : "Approved"}, but automatic execution failed: ${message}`);
    }
  }

  return { ok: true, response: lines.join("\n") };
}

async function tryHandleWebCommand(
  message: string,
  profileId: string,
  conversationId?: string,
  externalUserId?: string
): Promise<WebCommandResult | null> {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || "";
  const rawArg = parts.slice(1).join(" ").trim();
  const runtime = getRuntime();

  if (cmd === "/help" || cmd === "/start") {
    const d = (english: string, chinese: string) => webCommandText(english, chinese);
    return {
      ok: true,
      response: [
        d("Available commands:", "可用命令："),
        `/models - ${d("list text model options and current active model", "查看文本模型选项和当前模型")}`,
        `/models <index|key> - ${d("switch text model", "切换文本模型")}`,
        `/models <text|vision|stt|tts|subagent> - ${d("list a specific route", "查看指定模型路由")}`,
        `/models <text|vision|stt|tts|subagent> <index|key> - ${d("switch that route", "切换指定模型路由")}`,
        `/skills - ${d("list loaded skill names and file paths", "查看已加载技能名称和文件路径")}`,
        `/skills <id> - ${d("show details for one loaded skill", "查看单个技能详情")}`,
        `/skills-detail - ${d("show full details for all loaded skills", "查看所有技能完整详情")}`,
        `/compact [instructions] - ${d("summarize older context in current conversation", "压缩当前会话的较早上下文")}`,
        `/hosttools - ${d("list pending Host Bash approvals", "查看待处理的 Host Bash 审批")}`,
        `/hosttools approve <approvalId> - ${d("approve, execute, and whitelist a pending Host Bash request", "批准、执行并将待处理的 Host Bash 请求加入白名单")}`,
        `/hosttools approve-once <approvalId> - ${d("approve and execute once without whitelisting", "仅批准并执行一次，不加入白名单")}`,
        `/hosttools approve-session <approvalId> - ${d("approve only for the current session", "仅为当前会话批准")}`,
        `/hosttools reject <approvalId> - ${d("reject a pending Host Bash request", "拒绝待处理的 Host Bash 请求")}`,
        `/help - ${d("show this help", "显示此帮助")}`
      ].join("\n")
    };
  }

  if (cmd === "/skills") {
    return {
      ok: true,
      response: buildSkillsText(profileId, rawArg, false)
    };
  }

  if (cmd === "/skills-detail") {
    return {
      ok: true,
      response: buildSkillsText(profileId, rawArg, true)
    };
  }

  if (cmd === "/models") {
    if (!rawArg) {
      return {
        ok: true,
        response: buildModelsText(profileId, "text")
      };
    }

    const [firstArg = "", secondArg = ""] = rawArg
      .split(/\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const maybeRoute = parseModelRoute(firstArg);
    const route: ModelRoute = maybeRoute ?? "text";
    const selector = maybeRoute ? secondArg : rawArg;
    if (!selector) {
      return {
        ok: true,
        response: buildModelsText(profileId, route)
      };
    }

    const result = switchModelSelection({
      settings: runtime.getSettings(),
      route,
      selector,
      updateSettings: runtime.updateSettings
    });
    if (!result) {
      return {
        ok: true,
        response: `${webCommandText("Invalid model selector:", "无效的模型选择器：")} ${selector}\n\n${buildModelsText(profileId, route)}`
      };
    }

    return {
      ok: true,
      response: [
        webCommandText(`Switched ${route} model to: ${result.selected.label}`, `已将 ${route} 模型切换为：${result.selected.label}`),
        webCommandText(`Mode: ${result.settings.providerMode}`, `模式：${result.settings.providerMode}`),
        webCommandText(`Use /models ${route} to inspect current options.`, `使用 /models ${route} 查看当前选项。`)
      ].join("\n")
    };
  }

  if (cmd === "/compact") {
    if (!conversationId || !externalUserId) {
      return {
        ok: true,
        response: webCommandText("No active conversation to compact. Start a chat first, then run /compact.", "没有可压缩的当前会话。请先开始聊天，再运行 /compact。")
      };
    }
    const { pool } = getWebRuntimeContext(profileId);
    const result = await pool.compact(externalUserId, conversationId, {
      reason: "manual",
      customInstructions: rawArg || undefined
    });
    return {
      ok: true,
      response: result.changed
        ? [
          webCommandText("Conversation context compacted.", "会话上下文已压缩。"),
          `before≈${result.beforeTokens} tokens`,
          `after≈${result.afterTokens} tokens`,
          `summarized_messages=${result.summarizedMessages}`,
          `kept_messages=${result.keptMessages}`
        ].join("\n")
        : webCommandText("Nothing to compact yet.", "当前没有需要压缩的内容。")
    };
  }

  if (cmd === "/login") {
    const [provider = "", ...rest] = rawArg.split(/\s+/).filter(Boolean);
    const codeOrUrl = rest.join(" ").trim();
    const scopeKey = buildLoginScope(profileId, externalUserId);
    if (!provider) {
      return {
        ok: true,
        response: [
          `Auth file: ${resolveAuthFilePath()}`,
          `OAuth providers: ${listOAuthProviderIds().join(", ")}`,
          "Usage:",
          "/login <provider>",
          "/login <provider> <code-or-redirect-url>"
        ].join("\n")
      };
    }

    if (codeOrUrl) {
      await submitOAuthLoginCode(scopeKey, provider, codeOrUrl);
      return {
        ok: true,
        response: `Login completed for '${provider}'. Credentials stored in ${resolveAuthFilePath()}.`
      };
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
    return { ok: true, response: lines.join("\n") };
  }

  if (cmd === "/logout") {
    if (!rawArg) {
      return {
        ok: true,
        response: "Usage: /logout <provider>"
      };
    }
    const removed = removeStoredAuth(rawArg.split(/\s+/)[0] || "");
    return {
      ok: true,
      response: removed
        ? `Removed stored auth for '${rawArg.split(/\s+/)[0]}'.`
        : `No stored auth found for '${rawArg.split(/\s+/)[0]}'.`
    };
  }

  if (cmd === "/hosttools" || cmd === "/host-tools") {
    return handleWebHostToolsCommand(rawArg, profileId, conversationId, externalUserId);
  }

  return null;
}

async function parseRequest(request: Request): Promise<ParsedWebChatRequest> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const userId = sanitizeWebUserId(String(form.get("userId") ?? ""));
    const message = normalizeText(String(form.get("message") ?? ""));
    const conversationRaw = String(form.get("conversationId") ?? "").trim();
    const profileId = sanitizeWebProfileId(String(form.get("profileId") ?? ""));
    const files = form
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    return {
      userId,
      message,
      conversationId: conversationRaw || undefined,
      profileId,
      files,
      thinkingLevel: sanitizeRuntimeThinkingLevel(String(form.get("thinkingLevel") ?? "")),
      projectId: String(form.get("projectId") ?? "").trim() || undefined
    };
  }

  const body = (await request.json()) as ChatBody;
  return {
    userId: sanitizeWebUserId(body.userId),
    message: normalizeText(String(body.message ?? "")),
    conversationId: String(body.conversationId ?? "").trim() || undefined,
    profileId: sanitizeWebProfileId(body.profileId),
    files: [],
    thinkingLevel: sanitizeRuntimeThinkingLevel(body.thinkingLevel),
    projectId: String(body.projectId ?? "").trim() || undefined
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let parsed: ParsedWebChatRequest;
  try {
    parsed = await parseRequest(request);
  } catch {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  if (!parsed.message && parsed.files.length === 0) {
    return json({ ok: false, error: "Empty message." }, { status: 400 });
  }

  if (parsed.files.length === 0) {
    const externalUserId = toWebExternalUserId(parsed.userId, parsed.profileId);
    const command = await tryHandleWebCommand(
      parsed.message,
      parsed.profileId,
      parsed.conversationId,
      externalUserId
    );
    if (command) {
      return json({
        ok: true,
        response: command.response,
        conversationId: parsed.conversationId,
        profileId: parsed.profileId,
        diagnostics: []
      });
    }
  }

  const runtime = getRuntime();
  const projectResult = resolveProjectContext(parsed.projectId);
  if (!projectResult.ok) return json({ ok: false, error: projectResult.error }, { status: projectResult.status });
  const project = projectResult.project;
  const workspaceId = resolveWorkspaceId();
  const externalUserId = toWebExternalUserId(parsed.userId, parsed.profileId);
  const conversation = runtime.sessions.getOrCreateConversation(
    "web",
    externalUserId,
    parsed.conversationId,
    { projectId: project?.id }
  );

  const { store, pool } = getWebRuntimeContext(parsed.profileId);
  const ts = `${Date.now() / 1000}`;
  const messageId = Date.now();
  const attachments: FileAttachment[] = [];
  const imageContents: ChannelInboundMessage["imageContents"] = [];

  for (const file of parsed.files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const mediaType = inferMediaType(file);
    const saved = store.saveAttachment(
      externalUserId,
      file.name || "upload.bin",
      ts,
      bytes,
      {
        mediaType,
        mimeType: file.type || undefined
      }
    );
    attachments.push(saved);
    if (isImageFile(file)) {
      imageContents.push({
        type: "image",
        mimeType: file.type || "image/jpeg",
        data: bytes.toString("base64")
      });
    }
  }

  const inboundText = parsed.message || (attachments.length > 0 ? "(attachment)" : "");
  const sessionAttachments: ConversationAttachment[] = attachments.map((attachment) => ({
    original: attachment.original,
    local: attachment.local,
    mediaType: attachment.mediaType,
    mimeType: attachment.mimeType,
    size: attachment.size
  }));
  const runner = pool.get(externalUserId, conversation.id);
  if (runner.isRunning()) {
    return json(
      { ok: false, error: "Already working. Please wait for current response to finish." },
      { status: 409 }
    );
  }
  runtime.sessions.appendMessage(conversation.id, "user", inboundText, {
    attachments: sessionAttachments
  });

  let finalText = "";
  const threadNotes: string[] = [];
  const runnerDiagnostics: string[] = [];
  const responseAttachments: ConversationAttachment[] = [];
  const activityCollector = new ConversationActivityCollector();

  const appendRunnerDiagnostic = (event: RunnerUiEvent): void => {
    if (event.type === "thinking_config") {
      runnerDiagnostics.push(
        [
          `thinking_requested=${event.requestedThinkingLevel}`,
          `thinking_effective=${event.effectiveThinkingLevel}`,
          `reasoning_supported=${String(event.reasoningSupported)}`,
          `provider=${event.provider}`,
          `model=${event.model}`
        ].join(", ")
      );
      return;
    }
    if (event.type === "payload") {
      runnerDiagnostics.push(
        [
          `payload_provider=${event.provider}`,
          `payload_model=${event.model}`,
          `payload_api=${event.api}`,
          event.summary
        ].join(", ")
      );
      return;
    }
    if (event.type === "tool_execution_start") {
      runnerDiagnostics.push(`tool_start=${event.displayName ?? event.toolName}, label=${event.label}`);
      return;
    }
    if (event.type === "tool_execution_end") {
      const summary = event.summary.replace(/\s+/g, " ").trim();
      const preview = summary.length > 160 ? `${summary.slice(0, 159)}…` : summary;
      runnerDiagnostics.push(
        [
          `tool_end=${event.displayName ?? event.toolName}`,
          `status=${event.isError ? "error" : "ok"}`,
          preview ? `summary=${preview}` : ""
        ].filter(Boolean).join(", ")
      );
      return;
    }
    if (event.type === "subagent_execution") {
      runnerDiagnostics.push(buildSubagentDiagnostic(event));
    }
  };

  const result = await runner.run({
    channel: "web",
    workspaceDir: store.getWorkspaceDir(),
    chatDir: store.getChatDir(externalUserId),
    thinkingLevelOverride: parsed.thinkingLevel,
    project: project ? {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      instructions: project.instructions,
      scratchDir: store.getScratchDir(externalUserId)
    } : undefined,
    message: {
      chatId: externalUserId,
      workspaceId,
      chatType: "private",
      messageId,
      userId: externalUserId,
      userName: parsed.userId,
      text: inboundText,
      ts,
      attachments,
      imageContents,
      sessionId: conversation.id
    },
    respond: async (text: string) => {
      if (typeof text === "string" && text.trim()) finalText = text;
    },
    replaceMessage: async (text: string) => {
      if (typeof text === "string") finalText = text;
    },
    beginContinuationResponse: async (partialText: string, notice: string) => {
      const finalized = [partialText.trim(), notice.trim()].filter(Boolean).join("\n\n");
      if (finalized) threadNotes.push(finalized);
      finalText = "";
    },
    respondInThread: async (text: string) => {
      if (typeof text === "string" && text.trim()) threadNotes.push(text.trim());
    },
    setTyping: async () => {},
    setWorking: async () => {},
    deleteMessage: async () => {},
    uploadFile: async (filePath, title) => {
      responseAttachments.push(saveWebResponseAttachment({
        store,
        externalUserId,
        filePath,
        title
      }));
    },
    onRunnerEvent: async (event) => {
      appendRunnerDiagnostic(event);
      activityCollector.record(event);
    }
  });

  const assistantText =
    finalText.trim() ||
    threadNotes.at(-1) ||
    result.errorMessage ||
    "(empty response)";

  if (result.stopReason !== "waiting_for_approval") {
    runtime.sessions.appendMessage(conversation.id, "assistant", assistantText, {
      attachments: responseAttachments,
      activities: activityCollector.snapshot()
    });
  }

  return json({
    ok: true,
    response: assistantText,
    conversationId: conversation.id,
    profileId: parsed.profileId,
    stopReason: result.stopReason,
    diagnostics: [...runnerDiagnostics, ...threadNotes]
  });
};
