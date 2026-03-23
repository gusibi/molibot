import { buildAcpHelpText, buildStructuredAcpTaskPrompt } from "../../acp/prompt.js";
import { AcpService, formatAcpProjects, formatAcpSessionSummary, formatAcpSessions, formatAcpTargets } from "../../acp/service.js";

export const ACP_CONTROL_HELP_LINES = [
  "/acp help - show ACP coding control commands",
  "/approve <requestId> <optionId> - approve ACP permission",
  "/deny <requestId> - reject ACP permission"
] as const;

export type SharedAcpPromptKind = "task" | "remote";

interface SharedAcpPromptRequest {
  kind: SharedAcpPromptKind;
  prompt: string;
  startText: string;
}

interface SharedAcpCommandOptions {
  acp: AcpService;
  chatId: string;
  cmd: string;
  rawArg: string;
  sendText: (text: string) => Promise<void>;
  runPrompt: (request: SharedAcpPromptRequest) => Promise<void>;
}

interface SharedAcpApprovalOptions {
  acp: AcpService;
  chatId: string;
  cmd: string;
  rawArg: string;
  sendText: (text: string) => Promise<void>;
}

interface BasicChannelAcpTemplateAdapter<TContext> {
  acp: AcpService;
  sendText: (chatId: string, context: TContext, text: string) => Promise<void>;
  runPrompt: (chatId: string, context: TContext, request: SharedAcpPromptRequest) => Promise<void>;
}

export function isAcpControlCommandText(text: string): boolean {
  const lowered = String(text ?? "").trim().toLowerCase();
  return lowered.startsWith("/acp") || lowered.startsWith("/approve") || lowered.startsWith("/deny");
}

export async function restoreAcpStatus(acp: AcpService, chatId: string) {
  try {
    await acp.restoreSession(chatId);
    return acp.getStatus(chatId);
  } catch {
    return null;
  }
}

export async function handleSharedAcpCommand({
  acp,
  chatId,
  cmd,
  rawArg,
  sendText,
  runPrompt
}: SharedAcpCommandOptions): Promise<boolean> {
  if (cmd !== "/acp") return false;

  const [subcommand = "help", ...rest] = rawArg.split(/\s+/).filter(Boolean);

  try {
    switch (subcommand.toLowerCase()) {
      case "help":
        await sendText(buildAcpHelpText());
        return true;
      case "targets":
        await sendText(formatAcpTargets(acp.listTargets()));
        return true;
      case "projects":
        await sendText(formatAcpProjects(acp.listProjects()));
        return true;
      case "sessions":
        await sendText(formatAcpSessions(await acp.listSessions(chatId)));
        return true;
      case "add-project": {
        const projectId = rest[0] ?? "";
        const projectPath = rest.slice(1).join(" ").trim();
        if (!projectId || !projectPath) {
          await sendText("Usage: /acp add-project <id> <absolute-path>");
          return true;
        }
        const project = acp.upsertProject(projectId, projectPath);
        await sendText(`Saved ACP project ${project.id} -> ${project.path}`);
        return true;
      }
      case "remove-project": {
        const projectId = rest[0] ?? "";
        if (!projectId) {
          await sendText("Usage: /acp remove-project <id>");
          return true;
        }
        const removed = acp.removeProject(projectId);
        await sendText(removed ? `Removed ACP project ${projectId}.` : `Project not found: ${projectId}`);
        return true;
      }
      case "new": {
        const [targetId = "", projectId = "", modeRaw = ""] = rest;
        if (!targetId || !projectId) {
          await sendText("Usage: /acp new <targetId> <projectId> [manual|auto-safe|auto-all]");
          return true;
        }
        const mode = modeRaw === "manual" || modeRaw === "auto-safe" || modeRaw === "auto-all" ? modeRaw : undefined;
        await sendText(formatAcpSessionSummary(await acp.openSession(chatId, targetId, projectId, mode)));
        return true;
      }
      case "status":
        await acp.restoreSession(chatId);
        await sendText(formatAcpSessionSummary(acp.getStatus(chatId)));
        return true;
      case "mode": {
        const modeRaw = rest[0] ?? "";
        if (modeRaw !== "manual" && modeRaw !== "auto-safe" && modeRaw !== "auto-all") {
          await sendText("Usage: /acp mode <manual|auto-safe|auto-all>");
          return true;
        }
        await acp.restoreSession(chatId);
        await sendText(formatAcpSessionSummary(acp.setApprovalMode(chatId, modeRaw)));
        return true;
      }
      case "remote": {
        const remoteRaw = rawArg.replace(/^remote(?:\s+|$)/i, "").trim();
        await acp.restoreSession(chatId);
        if (!remoteRaw) {
          await sendText(`Usage: /acp remote <command> [args]\n\n${formatAcpSessionSummary(acp.getStatus(chatId))}`);
          return true;
        }
        const resolved = acp.resolveRemoteCommand(chatId, remoteRaw);
        await runPrompt({
          kind: "remote",
          prompt: resolved.prompt,
          startText: `ACP remote command started\n${resolved.displayCommand}`
        });
        return true;
      }
      case "task": {
        const prompt = rawArg.replace(/^task(?:\s+|$)/i, "").trim();
        if (!prompt) {
          await sendText("Usage: /acp task <instructions>");
          return true;
        }
        await acp.restoreSession(chatId);
        await runPrompt({
          kind: "task",
          prompt: buildStructuredAcpTaskPrompt(prompt),
          startText: `ACP task started\n${prompt}`
        });
        return true;
      }
      case "cancel":
      case "stop": {
        await acp.restoreSession(chatId);
        const cancelled = await acp.cancelRun(chatId);
        await sendText(cancelled ? "ACP cancellation requested." : "No ACP task is running.");
        return true;
      }
      case "close": {
        const closed = await acp.closeSession(chatId);
        await sendText(closed ? "ACP session closed." : "No active ACP session.");
        return true;
      }
      default:
        await sendText(buildAcpHelpText());
        return true;
    }
  } catch (error) {
    await sendText(error instanceof Error ? error.message : String(error));
    return true;
  }
}

export async function handleSharedAcpApprovalCommand({
  acp,
  chatId,
  cmd,
  rawArg,
  sendText
}: SharedAcpApprovalOptions): Promise<boolean> {
  if (cmd === "/approve") {
    const [requestId = "", optionId = ""] = rawArg.split(/\s+/).filter(Boolean);
    if (!requestId || !optionId) {
      await sendText("Usage: /approve <requestId> <optionId>");
      return true;
    }
    try {
      await sendText(await acp.approve(chatId, requestId, optionId));
    } catch (error) {
      await sendText(error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (cmd === "/deny") {
    const requestId = rawArg.split(/\s+/).filter(Boolean)[0] ?? "";
    if (!requestId) {
      await sendText("Usage: /deny <requestId>");
      return true;
    }
    try {
      await sendText(await acp.deny(chatId, requestId));
    } catch (error) {
      await sendText(error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  return false;
}

export class BasicChannelAcpTemplate<TContext> {
  constructor(private readonly adapter: BasicChannelAcpTemplateAdapter<TContext>) {}

  helpLines(): readonly string[] {
    return ACP_CONTROL_HELP_LINES;
  }

  async maybeProxy(chatId: string, text: string, context: TContext): Promise<boolean> {
    const trimmed = String(text ?? "").trim();
    if (!trimmed || isAcpControlCommandText(trimmed)) return false;
    const status = await restoreAcpStatus(this.adapter.acp, chatId);
    if (!status) return false;
    await this.adapter.runPrompt(chatId, context, {
      kind: "task",
      prompt: trimmed,
      startText: `ACP proxy started\n${trimmed}`
    });
    return true;
  }

  async maybeHandleCommand(chatId: string, cmd: string, rawArg: string, context: TContext): Promise<boolean> {
    const handledAcp = await handleSharedAcpCommand({
      acp: this.adapter.acp,
      chatId,
      cmd,
      rawArg,
      sendText: async (text) => {
        await this.adapter.sendText(chatId, context, text);
      },
      runPrompt: async (request) => {
        await this.adapter.runPrompt(chatId, context, request);
      }
    });
    if (handledAcp) return true;

    return await handleSharedAcpApprovalCommand({
      acp: this.adapter.acp,
      chatId,
      cmd,
      rawArg,
      sendText: async (text) => {
        await this.adapter.sendText(chatId, context, text);
      }
    });
  }
}
