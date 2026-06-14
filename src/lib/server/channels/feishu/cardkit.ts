import type * as lark from "@larksuiteoapi/node-sdk";
import {
  markdownToFeishuMarkdown,
  parseFeishuRichTextSegments,
  type FeishuRichTextSegment
} from "$lib/server/channels/feishu/formatting.js";

export const FEISHU_STREAMING_ELEMENT_ID = "streaming_content";
const FEISHU_TOOL_PANEL_LIMIT = 12;

type StopReason = "stop" | "aborted" | "error" | "waiting_for_approval";

export interface FeishuToolProgressEntry {
  toolName: string;
  displayName?: string;
  label: string;
  status: "running" | "success" | "error";
  summary?: string;
}

interface BuildStreamingCardOptions {
  title: string;
  answerText: string;
  tools: FeishuToolProgressEntry[];
  detailsText?: string;
  isWorking: boolean;
}

interface BuildFinalCardOptions {
  title: string;
  answerText: string;
  tools: FeishuToolProgressEntry[];
  detailsText?: string;
  stopReason: StopReason;
  elapsedMs: number;
}

interface CardKitResponse<TData = Record<string, unknown>> {
  code?: number;
  msg?: string;
  data?: TData;
}

function assertCardKitOk(response: CardKitResponse, api: string): void {
  if (response.code && response.code !== 0) {
    throw new Error(`${api} failed: ${response.code} ${response.msg ?? ""}`.trim());
  }
}

function compactText(text: string, max = 120): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function toolStatusLabel(status: FeishuToolProgressEntry["status"]): string {
  if (status === "running") return "Running";
  if (status === "error") return "Failed";
  return "Done";
}

function buildToolPanel(tools: FeishuToolProgressEntry[]): Record<string, unknown> {
  const visible = tools.slice(-FEISHU_TOOL_PANEL_LIMIT);
  const hidden = tools.length - visible.length;
  const lines = [
    hidden > 0 ? `... ${hidden} earlier tool call(s)` : "",
    ...visible.map((tool) => {
      const name = tool.displayName || tool.toolName || tool.label || "tool";
      const summary = compactText(tool.summary || (tool.label !== name ? tool.label : ""), 90);
      const prefix = `[${toolStatusLabel(tool.status)}] ${name}`;
      return summary ? `${prefix}: ${summary}` : prefix;
    })
  ].filter(Boolean);

  return {
    tag: "collapsible_panel",
    expanded: tools.some((tool) => tool.status === "running"),
    header: {
      title: {
        tag: "plain_text",
        content: `Tool calls · ${tools.length}`,
        i18n_content: {
          zh_cn: `工具调用 · ${tools.length}`,
          en_us: `Tool calls · ${tools.length}`
        }
      }
    },
    elements: [
      {
        tag: "markdown",
        content: lines.length > 0 ? markdownToFeishuMarkdown(lines.join("\n")) : "No tool calls yet."
      }
    ]
  };
}

function buildDetailsPanel(detailsText: string | undefined): Record<string, unknown> | null {
  const details = compactText(detailsText ?? "", 1800);
  if (!details) return null;
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: { title: { tag: "plain_text", content: "运行详情" } },
    elements: [{ tag: "markdown", content: markdownToFeishuMarkdown(details) }]
  };
}

function buildTableElement(segment: Extract<FeishuRichTextSegment, { type: "table" }>): Record<string, unknown> {
  const columnKeys = segment.columns.map((_, index) => `col_${index + 1}`);
  return {
    tag: "table",
    columns: segment.columns.map((name, index) => ({
      name: columnKeys[index],
      display_name: markdownToFeishuMarkdown(name || " "),
      data_type: "lark_md",
      width: "auto"
    })),
    rows: segment.rows.map((row) =>
      Object.fromEntries(
        columnKeys.map((key, index) => [key, markdownToFeishuMarkdown(row[index] || " ")])
      )
    )
  };
}

function splitMarkdownBlocks(content: string): string[] {
  const lines = String(content ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let buffer: string[] = [];
  let insideCodeFence = false;

  const flush = (): void => {
    const value = buffer.join("\n").trim();
    if (value) blocks.push(value);
    buffer = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      insideCodeFence = !insideCodeFence;
      buffer.push(line);
      continue;
    }
    if (!insideCodeFence && /^#{1,6}\s+/.test(line)) {
      flush();
      blocks.push(line.trim());
      continue;
    }
    buffer.push(line);
  }

  flush();
  return blocks;
}

function buildMarkdownElements(content: string): Record<string, unknown>[] {
  const blocks = splitMarkdownBlocks(content);
  return (blocks.length > 0 ? blocks : [" "]).map((block) => ({
    tag: "markdown",
    content: markdownToFeishuMarkdown(block),
    text_align: "left",
    text_size: "normal_v2"
  }));
}

function buildAnswerElements(answerText: string): Record<string, unknown>[] {
  const segments = parseFeishuRichTextSegments(answerText || "_No response._");
  const elements: Record<string, unknown>[] = [];
  for (const segment of segments.length > 0 ? segments : [{ type: "markdown" as const, content: "_No response._" }]) {
    if (segment.type === "table") {
      elements.push(buildTableElement(segment));
      continue;
    }
    elements.push(...buildMarkdownElements(segment.content));
  }
  return elements.length > 0 ? elements : buildMarkdownElements("_No response._");
}

function buildSummaryContent(options: { isWorking?: boolean; stopReason?: StopReason; elapsedMs?: number }): string {
  if (options.isWorking) return "生成中...";
  if (options.stopReason === "error") return `出错 · ${formatElapsed(options.elapsedMs ?? 0)}`;
  if (options.stopReason === "aborted") return `已停止 · ${formatElapsed(options.elapsedMs ?? 0)}`;
  if (options.stopReason === "waiting_for_approval") return `等待审批 · ${formatElapsed(options.elapsedMs ?? 0)}`;
  return `已完成 · ${formatElapsed(options.elapsedMs ?? 0)}`;
}

export function buildFeishuStreamingCard(options: BuildStreamingCardOptions): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [];
  if (options.tools.length > 0) {
    elements.push(buildToolPanel(options.tools));
  }
  elements.push({
    tag: "markdown",
    content: markdownToFeishuMarkdown(options.answerText || " "),
    text_align: "left",
    text_size: "normal_v2",
    element_id: FEISHU_STREAMING_ELEMENT_ID
  });
  const details = buildDetailsPanel(options.detailsText);
  if (details) elements.push(details);
  return {
    schema: "2.0",
    config: {
      streaming_mode: true,
      wide_screen_mode: true,
      update_multi: true,
      summary: { content: buildSummaryContent({ isWorking: options.isWorking }) }
    },
    header: {
      template: "indigo",
      title: { tag: "plain_text", content: options.title }
    },
    body: { elements }
  };
}

export function buildFeishuFinalCard(options: BuildFinalCardOptions): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [];
  if (options.tools.length > 0) elements.push(buildToolPanel(options.tools));
  elements.push(...buildAnswerElements(options.answerText));
  const details = buildDetailsPanel(options.detailsText);
  if (details) elements.push(details);
  elements.push({
    tag: "markdown",
    text_size: "notation",
    content: buildSummaryContent({ stopReason: options.stopReason, elapsedMs: options.elapsedMs })
  });
  return {
    schema: "2.0",
    config: {
      streaming_mode: false,
      wide_screen_mode: true,
      update_multi: true,
      summary: { content: buildSummaryContent({ stopReason: options.stopReason, elapsedMs: options.elapsedMs }) }
    },
    header: {
      template: options.stopReason === "error" ? "red" : options.stopReason === "aborted" ? "orange" : "green",
      title: { tag: "plain_text", content: options.title }
    },
    body: { elements }
  };
}

export async function createFeishuCardEntity(client: lark.Client, card: Record<string, unknown>): Promise<string> {
  const response = await client.cardkit.v1.card.create({
    data: { type: "card_json", data: JSON.stringify(card) }
  }) as CardKitResponse<{ card_id?: string }>;
  assertCardKitOk(response, "card.create");
  const cardId = response.data?.card_id;
  if (!cardId) throw new Error("card.create failed: empty card_id");
  return cardId;
}

export async function sendFeishuCardById(
  client: lark.Client,
  chatId: string,
  cardId: string,
  options: { replyToMessageId?: string | null; replyInThread?: boolean } = {}
): Promise<{ message_id: string }> {
  const content = JSON.stringify({ type: "card", data: { card_id: cardId } });
  if (options.replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: options.replyToMessageId },
      data: {
        msg_type: "interactive",
        content,
        reply_in_thread: options.replyInThread
      }
    });
    return { message_id: response.data?.message_id || "" };
  }
  const response = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content
    }
  });
  return { message_id: response.data?.message_id || "" };
}

export async function streamFeishuCardContent(
  client: lark.Client,
  cardId: string,
  elementId: string,
  content: string,
  sequence: number
): Promise<void> {
  const response = await client.cardkit.v1.cardElement.content({
    path: { card_id: cardId, element_id: elementId },
    data: { content: markdownToFeishuMarkdown(content), sequence }
  }) as CardKitResponse;
  assertCardKitOk(response, "cardElement.content");
}

export async function updateFeishuCardEntity(
  client: lark.Client,
  cardId: string,
  card: Record<string, unknown>,
  sequence: number
): Promise<void> {
  const response = await client.cardkit.v1.card.update({
    path: { card_id: cardId },
    data: { card: { type: "card_json", data: JSON.stringify(card) }, sequence }
  }) as CardKitResponse;
  assertCardKitOk(response, "card.update");
}

export async function setFeishuCardStreamingMode(
  client: lark.Client,
  cardId: string,
  streamingMode: boolean,
  sequence: number
): Promise<void> {
  const response = await client.cardkit.v1.card.settings({
    path: { card_id: cardId },
    data: { settings: JSON.stringify({ streaming_mode: streamingMode }), sequence }
  }) as CardKitResponse;
  assertCardKitOk(response, "card.settings");
}
