import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildSubagentDiagnostic } from "$lib/server/agent/subagentProgress";
import {
  findSkillBySelector,
  formatSkillDetailText,
  formatSkillsDetailText,
  formatSkillsSummaryText,
  loadSkillsFromWorkspace
} from "$lib/server/agent/skills";
import {
  listOAuthProviderIds,
  removeStoredAuth,
  resolveAuthFilePath,
  startOAuthLogin,
  submitOAuthLoginCode
} from "$lib/server/agent/auth";
import type { ChannelInboundMessage, FileAttachment } from "$lib/server/agent/types";
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
import type { RunnerUiEvent } from "$lib/server/agent/types";
import type { ConversationAttachment } from "$lib/shared/types/message";
import { executeHostBashApproval, hasVisibleHostBashOutput } from "$lib/server/agent/hostBashExec";
import { getHostBashStore } from "$lib/server/hostBash";

interface ChatBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
  thinkingLevel?: string;
}

interface ParsedWebChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  profileId: string;
  files: File[];
  thinkingLevel: RuntimeThinkingLevel;
}

interface WebCommandResult {
  ok: true;
  response: string;
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
  const lines = [
    `Route: ${route}`,
    `Provider mode: ${settings.providerMode}`,
    `Configured model options: ${options.length}`,
    ""
  ];

  if (options.length === 0) {
    lines.push("No available model options.");
  } else {
    options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option.label}${option.key === activeKey ? " (active)" : ""}`);
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
    return formatSkillDetailText(skill);
  }

  if (detailMode) {
    return formatSkillsDetailText(skills, diagnostics);
  }

  return formatSkillsSummaryText(skills, diagnostics, {
    footerLines: [
      "Use /skills <id> for details.",
      "Use /skills-detail for the full list."
    ]
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
    const pending = hostBashStore.listPending(scopeId);
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
    const rejected = hostBashStore.reject(scopeId, approvalId || undefined);
    return {
      ok: true,
      response: rejected
        ? `Rejected Host Bash approval ${rejected.id} (${rejected.displayName}).`
        : "No matching pending Host Bash approval found."
    };
  }

  if (subcommand !== "approve" && subcommand !== "approve-session") {
    return {
      ok: true,
      response: [
        "Host Bash usage:",
        "/hosttools",
        "/hosttools approve <approvalId>",
        "/hosttools approve-session <approvalId>",
        "/hosttools reject <approvalId>"
      ].join("\n")
    };
  }

  const approved = hostBashStore.approve(scopeId, approvalId || undefined, {
    persistWhitelist: subcommand !== "approve-session"
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
      if (hasVisibleHostBashOutput(executed.rendered)) {
        lines.push("", executed.rendered);
      }
      lines.push("", "Approved and executed immediately.");
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
    return {
      ok: true,
      response: [
        "Available commands:",
        "/models - list text model options and current active model",
        "/models <index|key> - switch text model",
        "/models <text|vision|stt|tts|subagent> - list a specific route",
        "/models <text|vision|stt|tts|subagent> <index|key> - switch that route",
        "/skills - list loaded skill names and file paths",
        "/skills <id> - show details for one loaded skill",
        "/skills-detail - show full details for all loaded skills",
        "/compact [instructions] - summarize older context in current conversation",
        "/login <provider> - start OAuth login and receive the auth URL",
        "/login <provider> <code-or-redirect-url> - finish OAuth login",
        "/logout <provider> - remove stored auth from auth.json",
        "/hosttools - list pending Host Bash approvals",
        "/hosttools approve <approvalId> - approve and execute a pending Host Bash request",
        "/hosttools approve-session <approvalId> - approve only for the current session",
        "/hosttools reject <approvalId> - reject a pending Host Bash request",
        "/help - show this help"
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
        response: `Invalid model selector: ${selector}\n\n${buildModelsText(profileId, route)}`
      };
    }

    return {
      ok: true,
      response: [
        `Switched ${route} model to: ${result.selected.label}`,
        `Mode: ${result.settings.providerMode}`,
        `Use /models ${route} to inspect current options.`
      ].join("\n")
    };
  }

  if (cmd === "/compact") {
    if (!conversationId || !externalUserId) {
      return {
        ok: true,
        response: "No active conversation to compact. Start a chat first, then run /compact."
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
          "Conversation context compacted.",
          `before≈${result.beforeTokens} tokens`,
          `after≈${result.afterTokens} tokens`,
          `summarized_messages=${result.summarizedMessages}`,
          `kept_messages=${result.keptMessages}`
        ].join("\n")
        : "Nothing to compact yet."
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
      thinkingLevel: sanitizeRuntimeThinkingLevel(String(form.get("thinkingLevel") ?? ""))
    };
  }

  const body = (await request.json()) as ChatBody;
  return {
    userId: sanitizeWebUserId(body.userId),
    message: normalizeText(String(body.message ?? "")),
    conversationId: String(body.conversationId ?? "").trim() || undefined,
    profileId: sanitizeWebProfileId(body.profileId),
    files: [],
    thinkingLevel: sanitizeRuntimeThinkingLevel(body.thinkingLevel)
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
  const externalUserId = toWebExternalUserId(parsed.userId, parsed.profileId);
  const conversation = runtime.sessions.getOrCreateConversation(
    "web",
    externalUserId,
    parsed.conversationId
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
    message: {
      chatId: externalUserId,
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
    uploadFile: async () => {},
    onRunnerEvent: async (event) => {
      appendRunnerDiagnostic(event);
    }
  });

  const assistantText =
    finalText.trim() ||
    threadNotes.at(-1) ||
    result.errorMessage ||
    "(empty response)";

  if (result.stopReason !== "waiting_for_approval") {
    runtime.sessions.appendMessage(conversation.id, "assistant", assistantText);
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
