/**
 * QQ 审批按钮（内联键盘 + 交互回调）。
 *
 * 对齐 Telegram 渠道的 host-bash 审批交互模式：
 * 审批请求以按钮卡片下发（approve once/session/persistent + reject），
 * 按钮点击以 INTERACTION_CREATE 事件回来，token 校验后走
 * SharedRuntimeCommandService 的审批接口，结果以普通文本回执。
 */
import { randomUUID } from "node:crypto";
import type { HostBashApprovalPrompt } from "$lib/server/hostBash/types.js";
import type { GatewayInteractionEvent } from "#qqbot/src/gateway.js";
import type { InlineKeyboard } from "#qqbot/src/outbound.js";

export const QQ_APPROVAL_BUTTON_PREFIX = "hta:";

/** QQ button_data 长度上限（平台限制 32 字节） */
const BUTTON_DATA_MAX_LENGTH = 32;

export interface QqApprovalSendTarget {
  mode: "c2c" | "group";
  id: string;
}

/** 审批命令服务的结构化依赖（SharedRuntimeCommandService 的子集） */
export interface QqApprovalCommandService {
  approveHostTool(
    input: { chatId: string; scopeId: string; text: string; target: QqApprovalSendTarget },
    approvalId?: string,
    scope?: "once" | "persistent"
  ): Promise<{ ok: boolean; message: string }>;
  approveHostToolForSession(
    input: { chatId: string; scopeId: string; text: string; target: QqApprovalSendTarget },
    approvalId?: string
  ): Promise<{ ok: boolean; message: string }>;
  rejectHostTool(
    input: { chatId: string; scopeId: string; text: string; target: QqApprovalSendTarget },
    approvalId?: string
  ): Promise<{ ok: boolean; message: string }>;
}

export interface QqApprovalDeps {
  commandService: QqApprovalCommandService;
  sendText: (target: QqApprovalSendTarget, text: string) => Promise<void>;
  /** 交互回执（QQ 要求点击后 5 秒内 ACK） */
  acknowledge: (interactionId: string, code: 0 | 1 | 2 | 3 | 4 | 5) => Promise<void>;
  isChatAllowed: (chatId: string) => boolean;
}

interface RegisteredAction {
  scopeId: string;
  requestId: string;
  action: "approve" | "approve_once" | "approve_session" | "approve_persistent" | "reject";
}

function newButtonToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

export class QqApprovalInteractions {
  private readonly actions = new Map<string, RegisteredAction>();

  constructor(private readonly deps: QqApprovalDeps) {}

  /** 注册一个审批动作，返回可直接放进 button_data 的完整数据（`hta:<token>`） */
  registerAction(
    scopeId: string,
    requestId: string,
    action: RegisteredAction["action"]
  ): string {
    const token = newButtonToken();
    this.actions.set(token, { scopeId, requestId, action });
    const data = `${QQ_APPROVAL_BUTTON_PREFIX}${token}`;
    if (data.length > BUTTON_DATA_MAX_LENGTH) {
      // token 定长（28 字符），这里只是防御未来改动
      throw new Error(`approval button data exceeds QQ limit: ${data.length}`);
    }
    return data;
  }

  /** 审批按钮卡片的键盘布局：批准选项一行 + 拒绝单独一行 */
  buildKeyboard(scopeId: string, prompt: HostBashApprovalPrompt): InlineKeyboard {
    const rows: Array<{ buttons: InlineKeyboard["content"]["rows"][number]["buttons"] }> = [];
    const approveOptions = prompt.options.filter((option) => option.id !== "reject");
    if (approveOptions.length > 0) {
      rows.push({
        buttons: approveOptions.map((option) => ({
          id: `approve-${option.id}`,
          render_data: {
            label: option.label,
            visited_label: "已处理",
            style: 1,
          },
          action: {
            type: 2,
            permission: { type: 2 },
            data: this.registerAction(scopeId, prompt.requestId, option.id),
            click_limit: 1,
          },
        })),
      });
    }
    const rejectOption = prompt.options.find((option) => option.id === "reject");
    if (rejectOption) {
      rows.push({
        buttons: [
          {
            id: "reject",
            render_data: {
              label: rejectOption.label,
              visited_label: "已拒绝",
              style: 0,
            },
            action: {
              type: 2,
              permission: { type: 2 },
              data: this.registerAction(scopeId, prompt.requestId, "reject"),
              click_limit: 1,
            },
          },
        ],
      });
    }
    return { content: { rows } };
  }

  /** 按钮卡片正文 */
  buildCardText(prompt: HostBashApprovalPrompt): string {
    return [prompt.title, "", prompt.body, "", "点击按钮处理，或回复 /approve、/reject 指令。"].join("\n");
  }

  /** 处理 INTERACTION_CREATE 事件（已由网关适配为 GatewayInteractionEvent） */
  async handleInteraction(event: GatewayInteractionEvent): Promise<void> {
    const chatId = event.groupOpenid ?? event.userOpenid ?? "";
    if (!chatId) return;

    if (!this.deps.isChatAllowed(chatId)) {
      await this.deps.acknowledge(event.id, 4).catch(() => undefined);
      return;
    }

    const data = event.buttonData ?? "";
    if (!data.startsWith(QQ_APPROVAL_BUTTON_PREFIX)) {
      await this.deps.acknowledge(event.id, 1).catch(() => undefined);
      return;
    }

    const token = data.slice(QQ_APPROVAL_BUTTON_PREFIX.length);
    const registered = this.actions.get(token);
    if (!registered || registered.scopeId !== chatId) {
      await this.deps.acknowledge(event.id, 1).catch(() => undefined);
      const target = this.toTarget(event);
      await this.deps
        .sendText(target, "该审批请求已失效或不在当前会话，请用 /approve、/reject 指令处理。")
        .catch(() => undefined);
      return;
    }

    this.actions.delete(token);
    await this.deps.acknowledge(event.id, 0).catch(() => undefined);

    const target = this.toTarget(event);
    const input = { chatId, scopeId: chatId, text: "", target };
    const result =
      registered.action === "approve" || registered.action === "approve_once"
        ? await this.deps.commandService.approveHostTool(input, registered.requestId, "once")
        : registered.action === "approve_persistent"
          ? await this.deps.commandService.approveHostTool(input, registered.requestId, "persistent")
          : registered.action === "approve_session"
            ? await this.deps.commandService.approveHostToolForSession(input, registered.requestId)
            : await this.deps.commandService.rejectHostTool(input, registered.requestId);

    await this.deps.sendText(target, result.message).catch(() => undefined);
  }

  private toTarget(event: GatewayInteractionEvent): QqApprovalSendTarget {
    return event.groupOpenid
      ? { mode: "group", id: event.groupOpenid }
      : { mode: "c2c", id: event.userOpenid ?? "" };
  }
}
