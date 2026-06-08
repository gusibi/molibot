import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface RegistryData {
  botMessages: Array<{ messageId: string; chatId: string; threadId?: string; at: number }>;
  botThreads: Array<{ chatId: string; threadId: string; at: number }>;
}

export interface FeishuThreadMatch {
  allowed: boolean;
  reason?: "thread_known" | "parent_bot_message";
}

const DEFAULT_MAX_BOT_MESSAGES = 2000;
const DEFAULT_MAX_BOT_THREADS = 1000;

function uniqueKey(chatId: string, threadId: string): string {
  return `${chatId}\u0000${threadId}`;
}

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

function readRegistryFile(filePath: string): RegistryData {
  if (!existsSync(filePath)) {
    return { botMessages: [], botThreads: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RegistryData>;
    return {
      botMessages: Array.isArray(parsed.botMessages) ? parsed.botMessages : [],
      botThreads: Array.isArray(parsed.botThreads) ? parsed.botThreads : []
    };
  } catch {
    return { botMessages: [], botThreads: [] };
  }
}

export class FeishuThreadRegistry {
  private data: RegistryData;

  constructor(
    private readonly workspaceDir: string,
    private readonly options: { maxBotMessages?: number; maxBotThreads?: number } = {}
  ) {
    this.data = readRegistryFile(this.filePath);
  }

  private get maxBotMessages(): number {
    return this.options.maxBotMessages ?? DEFAULT_MAX_BOT_MESSAGES;
  }

  private get maxBotThreads(): number {
    return this.options.maxBotThreads ?? DEFAULT_MAX_BOT_THREADS;
  }

  private get filePath(): string {
    return join(this.workspaceDir, "feishu-thread-registry.json");
  }

  recordBotMessage(input: { messageId?: string | null; chatId: string; threadId?: string | null }): void {
    const messageId = normalizeId(input.messageId);
    const chatId = normalizeId(input.chatId);
    const threadId = normalizeId(input.threadId);
    if (!messageId || !chatId) return;

    this.data.botMessages = this.data.botMessages.filter((entry) => entry.messageId !== messageId);
    this.data.botMessages.push({ messageId, chatId, threadId: threadId || undefined, at: Date.now() });
    if (threadId) this.recordBotThread({ chatId, threadId });
    this.prune();
    this.write();
  }

  recordBotThread(input: { chatId: string; threadId?: string | null }): void {
    const chatId = normalizeId(input.chatId);
    const threadId = normalizeId(input.threadId);
    if (!chatId || !threadId) return;

    const key = uniqueKey(chatId, threadId);
    this.data.botThreads = this.data.botThreads.filter((entry) => uniqueKey(entry.chatId, entry.threadId) !== key);
    this.data.botThreads.push({ chatId, threadId, at: Date.now() });
    this.prune();
    this.write();
  }

  match(input: { chatId: string; threadId?: string | null; parentMessageId?: string | null }): FeishuThreadMatch {
    const chatId = normalizeId(input.chatId);
    const threadId = normalizeId(input.threadId);
    const parentMessageId = normalizeId(input.parentMessageId);

    if (chatId && threadId) {
      const key = uniqueKey(chatId, threadId);
      if (this.data.botThreads.some((entry) => uniqueKey(entry.chatId, entry.threadId) === key)) {
        return { allowed: true, reason: "thread_known" };
      }
    }

    if (parentMessageId) {
      const parent = this.data.botMessages.find((entry) => entry.messageId === parentMessageId);
      if (parent && (!chatId || parent.chatId === chatId)) {
        if (threadId) this.recordBotThread({ chatId: parent.chatId, threadId });
        return { allowed: true, reason: "parent_bot_message" };
      }
    }

    return { allowed: false };
  }

  private prune(): void {
    this.data.botMessages = this.data.botMessages
      .filter((entry) => normalizeId(entry.messageId) && normalizeId(entry.chatId))
      .sort((a, b) => a.at - b.at)
      .slice(-this.maxBotMessages);
    this.data.botThreads = this.data.botThreads
      .filter((entry) => normalizeId(entry.chatId) && normalizeId(entry.threadId))
      .sort((a, b) => a.at - b.at)
      .slice(-this.maxBotThreads);
  }

  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }
}
