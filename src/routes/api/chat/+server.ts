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
  resolveWebDurableBotId,
  toWebExternalUserId
} from "$lib/server/web/identity";
import {
  getWebRuntimeContext,
  getRuntimeContextForConversation,
  resolveRunnerChatId,
  resolveRuntimeContext
} from "$lib/server/web/runtimeContext";
import { sanitizeOptionalRuntimeThinkingLevel, type RuntimeThinkingLevel } from "$lib/server/settings";
import type { RunnerUiEvent } from "$lib/server/agent/core/types";
import type { ConversationAttachment, ConversationPlan } from "$lib/shared/types/message";
import { classifyTurnRetention } from "$lib/server/sessions/retentionPolicy";
import { resolveWorkspaceId } from "$lib/server/workspaces/store";
import { executeHostBashApproval, rewriteApprovalToolResultInContext } from "$lib/server/agent/hostBashExec";
import {
  retryApprovalAutoResume,
  APPROVAL_AUTO_RESUME_RETRY_DELAY_MS,
  APPROVAL_AUTO_RESUME_RETRY_MAX_ATTEMPTS
} from "$lib/server/channels/shared/approvalAutoResume";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { resumeSuspendedBrokerApproval } from "$lib/server/channels/shared/brokerApprovalResume.js";
import { imageContentFromSavedAttachment } from "$lib/server/channels/shared/attachmentImageContents.js";
import type { ApprovalScope } from "$lib/server/approval/approvalTypes.js";
import { getHostBashStore } from "$lib/server/hostBash";
import { commandLocaleFromSettings, commandText, isChineseLocale } from "$lib/server/agent/commands/i18n";
import { resolveWebInboundFileMeta, saveWebResponseAttachment } from "$lib/server/web/attachments";
import {
  buildRunnerProjectContext,
  getConversationProject,
  resolveProjectContext
} from "$lib/server/projects/context";
import { resolveSessionWorkingDir } from "$lib/server/agent/core/runner";
import { getProjectStore } from "$lib/server/projects/store";
import { WEB_COMMAND_DEFINITIONS } from "$lib/server/app/composerSuggestions";
import { getMiniAppHost } from "$lib/server/miniapps/registry";
import { formatMiniAppList } from "$lib/server/miniapps/invocation";
import {
  activateDurableExecution,
  formatDurableActivationAcknowledgement,
  parseDurableRequestMode,
  type DurableRequestMode
} from "$lib/server/agent/durable/activation.js";
import { DurableExecutionQuotaError } from "$lib/server/agent/durable/types.js";
import { tryAutoSummarizeConversationTitleAsync } from "$lib/server/sessions/titleSummarizer.js";

interface ChatBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
  thinkingLevel?: string;
  projectId?: string;
  modelKey?: string;
  durableMode?: string;
}

interface ParsedWebChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  profileId: string;
  files: File[];
  thinkingLevel?: RuntimeThinkingLevel;
  projectId?: string;
  modelKey?: string;
  durableMode?: DurableRequestMode;
}

interface WebCommandResult {
  ok: true;
  response: string;
  /**
   * Outcome of an approval resolution, so a caller with a UI (Desktop's
   * approval card) can surface a failed host command instead of silently
   * dropping `response` and looking like the click did nothing.
   */
  approval?: {
    status: "executed" | "failed" | "rejected" | "approved" | "not_found";
    error?: string;
  };
}

function webCommandText(english: string, chinese: string): string {
  return commandText(commandLocaleFromSettings(getRuntime().getSettings()), english, chinese);
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
  lines.push(`/help`);
  lines.push(`profile: ${profileId}`);
  return lines.join("\n");
}

function buildSkillsText(profileId: string, rawArg = "", detailMode = false, projectId?: string): string {
  const locale = commandLocaleFromSettings(getRuntime().getSettings());
  const project = projectId ? getProjectStore().get(projectId) : null;
  const { store } = projectId ? resolveRuntimeContext({ profileId, projectId }) : getWebRuntimeContext(profileId);
  const { skills, diagnostics } = loadSkillsFromWorkspace(store.getWorkspaceDir(), "web", {
    disabledSkillPaths: getRuntime().getSettings().disabledSkillPaths,
    projectRoot: project?.rootPath
  });
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

export async function _handleWebHostToolsCommand(
  rawArg: string,
  profileId: string,
  conversationId: string | undefined,
  externalUserId: string | undefined
): Promise<WebCommandResult> {
  if (!externalUserId) {
    return { ok: true, response: "No active Web chat scope for Host Bash approvals." };
  }
  const { store, pool } = getRuntimeContextForConversation(profileId, conversationId);
  const hostBashStore = getHostBashStore();
  const [subcommand = "list", approvalId = ""] = rawArg.split(/\s+/).filter(Boolean);
  const scopeId = resolveRunnerChatId(conversationId, externalUserId);
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
    if (rejected) {
      return {
        ok: true,
        response: `Rejected Host Bash approval ${rejected.id} (${rejected.displayName}).`,
        approval: { status: "rejected" }
      };
    }
    // Try ApprovalBroker requests
    const broker = getApprovalBroker();
    const pending = broker.listPendingRequests().filter((r) => r.sessionId === sessionId);
    const target = approvalId ? pending.find((r) => r.id === approvalId) : (pending.length === 1 ? pending[0] : undefined);
    if (target) {
      const resolved = broker.resolveRequest({ requestId: target.id, status: "rejected" });
      if (resolved.request) {
        void resumeSuspendedBrokerApproval({
          scopeId,
          sessionId,
          requestId: target.id,
          status: "rejected",
          toolName: target.action.toolName || target.capability,
          store,
          pool,
          channel: "web"
        });
        return {
          ok: true,
          response: `Rejected tool request ${target.id} (${target.action.toolName || target.capability}).`,
          approval: { status: "rejected" }
        };
      }
    }
    return {
      ok: true,
      response: "No matching pending approval found.",
      approval: { status: "not_found" }
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
    // Check ApprovalBroker requests (MCP, extensions, etc.)
    const broker = getApprovalBroker();
    const pending = broker.listPendingRequests().filter((r) => r.sessionId === sessionId);
    const target = approvalId ? pending.find((r) => r.id === approvalId) : (pending.length === 1 ? pending[0] : undefined);
    if (target) {
      const selectedScope: ApprovalScope = subcommand === "approve-session"
        ? "session"
        : subcommand === "approve-once"
          ? "once"
          : "persistent";
      const resolved = broker.resolveRequest({
        requestId: target.id,
        status: "approved",
        selectedScope
      });
      if (resolved.request) {
        void resumeSuspendedBrokerApproval({
          scopeId,
          sessionId,
          requestId: target.id,
          status: "approved",
          toolName: target.action.toolName || target.capability,
          store,
          pool,
          channel: "web"
        });
        return {
          ok: true,
          response: [
            `Approved tool request: ${target.action.toolName || target.capability}`,
            `Request ID: ${target.id}`,
            `Scope: ${selectedScope}`,
            "The suspended run is resuming now."
          ].join("\n"),
          approval: { status: "approved" }
        };
      }
    }

    return {
      ok: true,
      response: "No matching pending Host Bash approval found.",
      approval: { status: "not_found" }
    };
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
    // The approved command must run where the agent's own turn was running: for
    // a project conversation that is the project root, not the chat scratch dir.
    // Getting this wrong made `git push` fail with "not a git repository" while
    // the UI showed nothing at all.
    const project = getConversationProject(getRuntime().sessions, sessionId);
    const scratchDir = store.getScratchDir(scopeId);
    const cwd = resolveSessionWorkingDir(buildRunnerProjectContext(project, scratchDir), scratchDir);

    /**
     * Splice the real command output back into the suspended tool result and
     * resume the run. Runs for failures too — an agent told nothing at all just
     * repeats "still waiting for your approval" forever.
     */
    const resumeWithToolResult = (rendered: string): void => {
      try {
        const messages = store.loadContext(scopeId, sessionId);
        const rewritten = rewriteApprovalToolResultInContext(messages, approved.record.command, rendered);

        if (rewritten) {
          store.saveContext(scopeId, messages, sessionId);
          pool.reset(scopeId, sessionId);

          const workspaceId = resolveWorkspaceId();
          const messageId = Date.now();
          const ts = `${Date.now() / 1000}`;

          // The approving turn may still hold the session lock; retry until it
          // releases instead of letting the conflict reject unhandled (which
          // crashes the sidecar process).
          void retryApprovalAutoResume({
            run: async () => {
              await pool.get(scopeId, sessionId).run({
                channel: "web",
                workspaceDir: store.getWorkspaceDir(),
                chatDir: store.getChatDir(scopeId),
                // Without this the resumed turn loses the project entirely and
                // continues in the scratch dir under the global system prompt.
                project: buildRunnerProjectContext(project, scratchDir),
                modelKeyOverride: project?.modelKey,
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
            },
            maxAttempts: APPROVAL_AUTO_RESUME_RETRY_MAX_ATTEMPTS,
            delayMs: APPROVAL_AUTO_RESUME_RETRY_DELAY_MS,
            onWarn: (warningCode, meta) => {
              if (warningCode === "approval_auto_resume_retrying" && meta.attempt !== 1 && meta.attempt % 60 !== 0) {
                return;
              }
              console.warn("[web:auto-resume]", warningCode, { scopeId, sessionId, ...meta });
            },
            onRetryExhausted: () => {
              getRuntime().sessions.appendMessage(
                sessionId,
                "assistant",
                webCommandText(
                  "Command executed, but the session is still busy. Send any message to continue the task.",
                  "命令已执行，但当前会话仍处于忙碌状态。发送任意消息可继续刚才的任务。"
                )
              );
            }
          });
        }
      } catch (error) {
        console.error("[web:auto-resume]", "background rewrite or re-run failed", {
          scopeId,
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    try {
      const executed = await executeHostBashApproval({
        record: approved.record,
        approvedTool: approved.approved,
        cwd
      });
      hostBashStore.markExecution(approved.record.id, "executed");
      lines.push("", "Approved and executed immediately.");
      resumeWithToolResult(executed.rendered);
      return { ok: true, response: lines.join("\n"), approval: { status: "executed" } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hostBashStore.markExecution(approved.record.id, "failed", message);
      lines.push("", `${subcommand === "approve-session" ? "Approved for this session" : "Approved"}, but automatic execution failed: ${message}`);
      // Hand the failure to the agent as the tool's real result so it can react
      // (retry differently, or tell the user) instead of staying suspended.
      resumeWithToolResult(`Command failed after approval (cwd: ${cwd}):\n\n${message}`);
      return { ok: true, response: lines.join("\n"), approval: { status: "failed", error: message } };
    }
  }

  return { ok: true, response: lines.join("\n"), approval: { status: "approved" } };
}

async function tryHandleWebCommand(
  message: string,
  profileId: string,
  conversationId?: string,
  externalUserId?: string,
  projectId?: string
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
        ...WEB_COMMAND_DEFINITIONS.map((definition) => {
          const usage = `/${definition.name}${definition.argumentHint ? ` ${definition.argumentHint}` : ""}`;
          return `${usage} - ${d(definition.description.en, definition.description.zh)}`;
        })
      ].join("\n")
    };
  }

  // Aliases mirror `WEB_COMMAND_DEFINITIONS` (the composer offers /miniapps
  // with /mini-apps and /apps) and the channel dispatcher in channelCommands.ts.
  if (cmd === "/miniapps" || cmd === "/mini-apps" || cmd === "/apps") {
    return {
      ok: true,
      response: formatMiniAppList(getMiniAppHost().listCatalog(), isChineseLocale(runtime.getSettings().locale))
    };
  }

  if (cmd === "/skills") {
    return {
      ok: true,
      response: buildSkillsText(profileId, rawArg, false, projectId)
    };
  }

  if (cmd === "/skills-detail") {
    return {
      ok: true,
      response: buildSkillsText(profileId, rawArg, true, projectId)
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
    const { pool } = getRuntimeContextForConversation(profileId, conversationId);
    const result = await pool.compact(resolveRunnerChatId(conversationId, externalUserId), conversationId, {
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

  if (cmd === "/hosttools" || cmd === "/host-tools") {
    return _handleWebHostToolsCommand(rawArg, profileId, conversationId, externalUserId);
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
      thinkingLevel: sanitizeOptionalRuntimeThinkingLevel(form.get("thinkingLevel")),
      projectId: String(form.get("projectId") ?? "").trim() || undefined,
      modelKey: String(form.get("modelKey") ?? "").trim() || undefined,
      durableMode: parseDurableRequestMode(form.get("durableMode"))
    };
  }

  const body = (await request.json()) as ChatBody;
  return {
    userId: sanitizeWebUserId(body.userId),
    message: normalizeText(String(body.message ?? "")),
    conversationId: String(body.conversationId ?? "").trim() || undefined,
    profileId: sanitizeWebProfileId(body.profileId),
    files: [],
    thinkingLevel: sanitizeOptionalRuntimeThinkingLevel(body.thinkingLevel),
    projectId: String(body.projectId ?? "").trim() || undefined,
    modelKey: String(body.modelKey ?? "").trim() || undefined,
    durableMode: parseDurableRequestMode(body.durableMode)
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
      externalUserId,
      parsed.projectId
    );
    if (command) {
      const runtime = getRuntime();
      const projectResult = resolveProjectContext(parsed.projectId);
      if (!projectResult.ok) return json({ ok: false, error: projectResult.error }, { status: projectResult.status });
      const conversation = runtime.sessions.getOrCreateConversation(
        "web",
        externalUserId,
        parsed.conversationId,
        { projectId: projectResult.project?.id }
      );
      runtime.sessions.appendMessage(conversation.id, "user", parsed.message);
      runtime.sessions.appendMessage(conversation.id, "assistant", command.response);
      return json({
        ok: true,
        response: command.response,
        conversationId: conversation.id,
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

  const { store, pool } = resolveRuntimeContext({ profileId: parsed.profileId, projectId: project?.id });
  // Project conversations may originate on a channel bot (e.g. Feishu); keying
  // the runner by the conversation's own externalUserId reopens that exact
  // agent context instead of forking a Web-keyed copy.
  const runnerChatId = project ? conversation.externalUserId : externalUserId;
  const ts = `${Date.now() / 1000}`;
  const messageId = Date.now();
  const attachments: FileAttachment[] = [];
  const imageContents: ChannelInboundMessage["imageContents"] = [];

  for (const file of parsed.files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const saved = store.saveAttachment(
      runnerChatId,
      file.name || "upload.bin",
      ts,
      bytes,
      resolveWebInboundFileMeta(file)
    );
    attachments.push(saved);
    const imageContent = imageContentFromSavedAttachment(saved, bytes);
    if (imageContent) imageContents.push(imageContent);
  }

  const inboundText = parsed.message || (attachments.length > 0 ? "(attachment)" : "");
  const turnRetention = classifyTurnRetention(inboundText);
  const sessionAttachments: ConversationAttachment[] = attachments.map((attachment) => ({
    original: attachment.original,
    local: attachment.local,
    mediaType: attachment.mediaType,
    mimeType: attachment.mimeType,
    size: attachment.size
  }));
  const runner = pool.get(runnerChatId, conversation.id);
  if (runner.isRunning()) {
    return json(
      { ok: false, error: "Already working. Please wait for current response to finish." },
      { status: 409 }
    );
  }
  const shouldSummarizeTitle = !runtime.sessions
    .listMessages(conversation.id)
    .some((message) => message.role === "user");
  runtime.sessions.appendMessage(conversation.id, "user", inboundText, {
    attachments: sessionAttachments,
    contextBacked: true,
    retention: turnRetention
  });

  if (shouldSummarizeTitle) {
    void tryAutoSummarizeConversationTitleAsync({
      conversationId: conversation.id,
      channel: "web",
      externalUserId,
      firstUserMessage: inboundText
    });
  }

  const durableBotId = resolveWebDurableBotId(parsed.profileId, runtime.channelManagers);
  let durable;
  try {
    durable = activateDurableExecution({
      message: inboundText,
      mode: parsed.durableMode,
      ownerId: "owner",
      botId: durableBotId,
      sourceChannel: "web",
      sourceChatId: runnerChatId,
      sourceUiSessionId: conversation.id,
      sourceProjectId: project?.id
    });
  } catch (error) {
    if (error instanceof DurableExecutionQuotaError) {
      return json({ ok: false, error: "Unfinished durable-execution quota reached. Finish or cancel an existing task before starting another automatic task." }, { status: 429 });
    }
    throw error;
  }
  if (durable) {
    const response = formatDurableActivationAcknowledgement(
      durable.item,
      isChineseLocale(runtime.getSettings().locale)
    );
    return json({
      ok: true,
      response,
      conversationId: conversation.id,
      profileId: parsed.profileId,
      stopReason: "stop",
      durableExecution: durable.item,
      diagnostics: [`activation=${durable.decision.activationPath}`, `reason=${durable.decision.reason}`]
    });
  }

  let finalText = "";
  const threadNotes: string[] = [];
  const runnerDiagnostics: string[] = [];
  let responseModel = "";
  const responseAttachments: ConversationAttachment[] = [];
  const activityCollector = new ConversationActivityCollector();
  let planProposal: ConversationPlan | undefined;

  const appendRunnerDiagnostic = (event: RunnerUiEvent): void => {
    if (event.type === "thinking_config") {
      responseModel = [event.provider, event.model].filter(Boolean).join("/");
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
      if (!responseModel) responseModel = [event.provider, event.model].filter(Boolean).join("/");
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
    if (event.type === "durable_preflight") {
      runnerDiagnostics.push(`durable_preflight=tier:${event.sideEffectClass}, mode=${event.mode}, index=${event.preflightIndex}, reason=${event.reason}`);
      return;
    }
    if (event.type === "subagent_execution") {
      runnerDiagnostics.push(buildSubagentDiagnostic(event));
    }
  };

  const result = await runner.run({
    channel: "web",
    workspaceDir: store.getWorkspaceDir(),
    chatDir: store.getChatDir(runnerChatId),
    thinkingLevelOverride: parsed.thinkingLevel,
    modelKeyOverride: parsed.modelKey ?? project?.modelKey,
    project: buildRunnerProjectContext(project, store.getScratchDir(runnerChatId)),
    message: {
      chatId: runnerChatId,
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
        externalUserId: runnerChatId,
        filePath,
        title
      }));
    },
    onRunnerEvent: async (event) => {
      appendRunnerDiagnostic(event);
      if (event.type === "plan_proposal") planProposal = event.plan;
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
      activities: activityCollector.finalSnapshot(),
      plan: planProposal,
      model: responseModel || undefined,
      contextBacked: true,
      sourceEntryId: result.assistantSourceEntryId,
      retention: turnRetention
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
