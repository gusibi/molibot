import path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { MomRuntimeStore } from "$lib/server/agent/store";
import { RunnerPool } from "$lib/server/agent/runner";
import { loadSkillsFromWorkspace } from "$lib/server/agent/skills";
import type { ChannelInboundMessage, FileAttachment } from "$lib/server/agent/types";
import { storagePaths } from "$lib/server/infra/db/storage";
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

interface ChatBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
}

interface ParsedWebChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
  profileId: string;
  files: File[];
}

interface WebRuntimeContext {
  store: MomRuntimeStore;
  pool: RunnerPool;
}

interface WebCommandResult {
  ok: true;
  response: string;
}

const webRuntimes = new Map<string, WebRuntimeContext>();

function inferMediaType(file: File): FileAttachment["mediaType"] {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
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
  lines.push(`/help`);
  lines.push(`profile: ${profileId}`);
  return lines.join("\n");
}

function buildSkillsText(profileId: string): string {
  const { store } = getWebRuntimeContext(profileId);
  const { skills, diagnostics } = loadSkillsFromWorkspace(store.getWorkspaceDir(), "web");
  const lines = [
    `Loaded skills: ${skills.length}`,
    ""
  ];
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description || "(no description)"}`);
    lines.push(`  ${skill.filePath}`);
  }
  if (skills.length === 0) {
    lines.push("No skills loaded.");
  }
  if (diagnostics.length > 0) {
    lines.push("");
    lines.push("Diagnostics:");
    for (const line of diagnostics) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

async function tryHandleWebCommand(message: string, profileId: string): Promise<WebCommandResult | null> {
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
        "/models <text|vision|stt|tts> - list a specific route",
        "/models <text|vision|stt|tts> <index|key> - switch that route",
        "/skills - list loaded skills",
        "/help - show this help"
      ].join("\n")
    };
  }

  if (cmd === "/skills") {
    return {
      ok: true,
      response: buildSkillsText(profileId)
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
      files
    };
  }

  const body = (await request.json()) as ChatBody;
  return {
    userId: sanitizeWebUserId(body.userId),
    message: normalizeText(String(body.message ?? "")),
    conversationId: String(body.conversationId ?? "").trim() || undefined,
    profileId: sanitizeWebProfileId(body.profileId),
    files: []
  };
}

function getWebRuntimeContext(profileId: string): WebRuntimeContext {
  const key = sanitizeWebProfileId(profileId);
  const existing = webRuntimes.get(key);
  if (existing) return existing;

  const runtime = getRuntime();
  const workspaceDir = path.join(storagePaths.webWorkspaceDir, "bots", key);
  const store = new MomRuntimeStore(workspaceDir);
  const pool = new RunnerPool(
    "web",
    store,
    runtime.getSettings,
    runtime.updateSettings,
    runtime.usageTracker,
    runtime.memory
  );
  const created = { store, pool };
  webRuntimes.set(key, created);
  return created;
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
    const command = await tryHandleWebCommand(parsed.message, parsed.profileId);
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
  runtime.sessions.appendMessage(conversation.id, "user", inboundText);

  const runner = pool.get(externalUserId, conversation.id);
  if (runner.isRunning()) {
    return json(
      { ok: false, error: "Already working. Please wait for current response to finish." },
      { status: 409 }
    );
  }

  let finalText = "";
  const threadNotes: string[] = [];

  const result = await runner.run({
    channel: "web",
    workspaceDir: store.getWorkspaceDir(),
    chatDir: store.getChatDir(externalUserId),
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
    respondInThread: async (text: string) => {
      if (typeof text === "string" && text.trim()) threadNotes.push(text.trim());
    },
    setTyping: async () => {},
    setWorking: async () => {},
    deleteMessage: async () => {},
    uploadFile: async () => {}
  });

  const assistantText =
    finalText.trim() ||
    threadNotes.at(-1) ||
    result.errorMessage ||
    "(empty response)";

  runtime.sessions.appendMessage(conversation.id, "assistant", assistantText);

  return json({
    ok: true,
    response: assistantText,
    conversationId: conversation.id,
    profileId: parsed.profileId,
    stopReason: result.stopReason,
    diagnostics: threadNotes
  });
};
