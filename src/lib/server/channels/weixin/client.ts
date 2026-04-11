import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { getConfig as vendorGetConfig, getUpdates as vendorGetUpdates, sendMessage as vendorSendMessage, sendTyping as vendorSendTyping } from "#weixin-agent-sdk/src/api/api.js";
import {
  DEFAULT_BASE_URL,
  clearWeixinAccount,
  listWeixinAccountIds,
  loadWeixinAccount,
  normalizeAccountId,
  registerWeixinAccountId,
  resolveWeixinAccount,
  saveWeixinAccount
} from "#weixin-agent-sdk/src/auth/accounts.js";
import { startWeixinLoginWithQr, waitForWeixinLogin } from "#weixin-agent-sdk/src/auth/login-qr.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
  type MessageItem,
  type WeixinMessage  
} from "#weixin-agent-sdk/src/api/types.js";

type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;

interface Credentials {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
}

export interface WeixinBotOptions {
  baseUrl?: string;
  onError?: (error: unknown) => void;
}

export interface IncomingMessage {
  userId: string;
  text: string;
  type: "text" | "image" | "voice" | "file" | "video";
  raw: WeixinMessage;
  _contextToken: string;
  timestamp: Date;
}

export class WeixinBot {
  private baseUrl: string;
  private readonly onErrorCallback?: (error: unknown) => void;
  private readonly handlers: MessageHandler[] = [];
  private readonly contextTokens = new Map<string, string>();
  private credentials?: Credentials;
  private currentAccountId = "";
  private cursor = "";
  private stopped = false;
  private currentPollController: AbortController | null = null;
  private runPromise: Promise<void> | null = null;

  constructor(options: WeixinBotOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.onErrorCallback = options.onError;
  }

  async login(options: { force?: boolean } = {}): Promise<Credentials> {
    const previousToken = this.credentials?.token;
    if (!options.force) {
      const stored = this.loadStoredCredentials();
      if (stored) {
        this.credentials = stored;
        this.baseUrl = stored.baseUrl;
        this.currentAccountId = normalizeAccountId(stored.accountId);
        return stored;
      }
    }

    for (;;) {
      const startResult = await startWeixinLoginWithQr({
        apiBaseUrl: this.baseUrl,
        force: true
      });
      if (!startResult.qrcodeUrl) {
        throw new Error(startResult.message || "Failed to start Weixin QR login");
      }

      this.log("在微信中打开以下链接完成登录:");
      process.stderr.write(`${startResult.qrcodeUrl}\n`);

      const waitResult = await waitForWeixinLogin({
        sessionKey: startResult.sessionKey,
        apiBaseUrl: this.baseUrl,
        timeoutMs: 480_000
      });
      if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId || !waitResult.userId) {
        if (/过期|超时|expired/i.test(waitResult.message || "")) {
          this.log("QR code expired. Requesting a new one...");
          continue;
        }
        throw new Error(waitResult.message || "Weixin QR login failed");
      }

      const accountId = normalizeAccountId(waitResult.accountId);
      saveWeixinAccount(accountId, {
        token: waitResult.botToken,
        baseUrl: waitResult.baseUrl ?? this.baseUrl,
        userId: waitResult.userId
      });
      registerWeixinAccountId(accountId);
      const credentials: Credentials = {
        token: waitResult.botToken,
        baseUrl: waitResult.baseUrl ?? this.baseUrl,
        accountId,
        userId: waitResult.userId
      };

      this.credentials = credentials;
      this.baseUrl = credentials.baseUrl;
      this.currentAccountId = accountId;

      if (previousToken && previousToken !== credentials.token) {
        this.cursor = "";
        this.contextTokens.clear();
      }

      this.log(`Logged in as ${credentials.userId}`);
      return credentials;
    }
  }

  onMessage(handler: MessageHandler): this {
    this.handlers.push(handler);
    return this;
  }

  on(event: "message", handler: MessageHandler): this {
    if (event !== "message") {
      throw new Error(`Unsupported event: ${event}`);
    }
    return this.onMessage(handler);
  }

  async reply(message: IncomingMessage, text: string): Promise<void> {
    this.contextTokens.set(message.userId, message._contextToken);
    await this.sendText(message.userId, text, message._contextToken);
    this.stopTyping(message.userId).catch(() => {});
  }

  async sendTyping(userId: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) {
      throw new Error(`No cached context token for user ${userId}. Reply to an incoming message first.`);
    }

    const credentials = await this.ensureCredentials();
    const config = await vendorGetConfig({
      baseUrl: this.baseUrl,
      token: credentials.token,
      ilinkUserId: userId,
      contextToken,
      timeoutMs: 15_000
    });
    if (!config.typing_ticket) {
      this.log("sendTyping: no typing_ticket returned by getconfig");
      return;
    }

    await vendorSendTyping({
      baseUrl: this.baseUrl,
      token: credentials.token,
      timeoutMs: 15_000,
      body: {
        ilink_user_id: userId,
        typing_ticket: config.typing_ticket,
        status: 1
      }
    });
  }

  async stopTyping(userId: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) return;

    const credentials = await this.ensureCredentials();
    const config = await vendorGetConfig({
      baseUrl: this.baseUrl,
      token: credentials.token,
      ilinkUserId: userId,
      contextToken,
      timeoutMs: 15_000
    });
    if (!config.typing_ticket) return;

    await vendorSendTyping({
      baseUrl: this.baseUrl,
      token: credentials.token,
      timeoutMs: 15_000,
      body: {
        ilink_user_id: userId,
        typing_ticket: config.typing_ticket,
        status: 2
      }
    });
  }

  async send(userId: string, text: string): Promise<void> {
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) {
      throw new Error(`No cached context token for user ${userId}. Reply to an incoming message first.`);
    }

    await this.sendText(userId, text, contextToken);
  }

  async run(): Promise<void> {
    if (this.runPromise) return this.runPromise;

    this.stopped = false;
    this.runPromise = this.runLoop();

    try {
      await this.runPromise;
    } finally {
      this.runPromise = null;
      this.currentPollController = null;
    }
  }

  stop(): void {
    this.stopped = true;
    this.currentPollController?.abort();
  }

  private async runLoop(): Promise<void> {
    await this.ensureCredentials();
    this.log("Long-poll loop started.");
    let retryDelayMs = 1_000;

    while (!this.stopped) {
      try {
        const credentials = await this.ensureCredentials();
        this.currentPollController = new AbortController();
        const updates = await vendorGetUpdates({
          baseUrl: this.baseUrl,
          token: credentials.token,
          get_updates_buf: this.cursor,
          timeoutMs: 40_000,
          abortSignal: this.currentPollController.signal
        });

        this.currentPollController = null;
        const pollErrorCode = resolvePollErrorCode(updates);
        if (pollErrorCode !== 0) {
          if (pollErrorCode === -14) {
            this.log("Session expired. Waiting for a fresh QR login...");
            if (this.currentAccountId) {
              clearWeixinAccount(this.currentAccountId);
            }
            this.credentials = undefined;
            this.cursor = "";
            this.contextTokens.clear();

            try {
              await this.login({ force: true });
              retryDelayMs = 1_000;
              continue;
            } catch (loginError) {
              this.reportError(loginError);
              await delay(retryDelayMs);
              retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
              continue;
            }
          }
          throw new Error(`weixin_getupdates_failed:${pollErrorCode}:${updates.errmsg ?? ""}`);
        }
        this.cursor = updates.get_updates_buf || this.cursor;
        retryDelayMs = 1_000;

        for (const raw of updates.msgs ?? []) {
          this.rememberContext(raw);
          const incoming = this.toIncomingMessage(raw);
          if (!incoming) continue;
          await this.dispatchMessage(incoming);
        }
      } catch (error) {
        this.currentPollController = null;

        if (this.stopped && isAbortError(error)) {
          break;
        }

        this.reportError(error);

        await delay(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
      }
    }

    this.log("Long-poll loop stopped.");
  }

  private async ensureCredentials(): Promise<Credentials> {
    if (this.credentials) return this.credentials;
    const stored = this.loadStoredCredentials();
    if (stored) {
      this.credentials = stored;
      this.baseUrl = stored.baseUrl;
      this.currentAccountId = normalizeAccountId(stored.accountId);
      return stored;
    }

    return this.login();
  }

  private async sendText(userId: string, text: string, contextToken: string): Promise<void> {
    if (text.length === 0) {
      throw new Error("Message text cannot be empty.");
    }

    const credentials = await this.ensureCredentials();
    const chunks = chunkText(text, 2_000);
    for (const chunk of chunks) {
      await vendorSendMessage({
        baseUrl: this.baseUrl,
        token: credentials.token,
        timeoutMs: 15_000,
        body: {
          msg: buildTextMessage(userId, contextToken, chunk, randomUUID(), MessageState.FINISH)
        }
      });
    }
  }

  private async dispatchMessage(message: IncomingMessage): Promise<void> {
    if (this.handlers.length === 0) return;

    const results = await Promise.allSettled(this.handlers.map(async (handler) => handler(message)));
    for (const result of results) {
      if (result.status === "rejected") {
        this.reportError(result.reason);
      }
    }
  }

  private rememberContext(message: WeixinMessage): void {
    const userId = message.message_type === MessageType.USER ? message.from_user_id : message.to_user_id;
    if (userId && message.context_token) {
      this.contextTokens.set(userId, message.context_token);
    }
  }

  private toIncomingMessage(message: WeixinMessage): IncomingMessage | null {
    if (message.message_type !== MessageType.USER) return null;
    const itemList = message.item_list ?? [];

    return {
      userId: message.from_user_id ?? "",
      text: extractText(itemList),
      type: detectType(itemList),
      raw: message,
      _contextToken: message.context_token ?? "",
      timestamp: new Date(message.create_time_ms ?? Date.now())
    };
  }

  private reportError(error: unknown): void {
    this.log(error instanceof Error ? error.message : String(error));
    this.onErrorCallback?.(error);
  }

  private log(message: string): void {
    process.stderr.write(`[weixin-agent-sdk] ${message}\n`);
  }

  private loadStoredCredentials(): Credentials | undefined {
    const accountId = this.currentAccountId || listWeixinAccountIds()[0];
    if (!accountId) return undefined;
    const resolved = resolveWeixinAccount(accountId);
    if (!resolved.token) return undefined;
    const profile = loadWeixinAccount(accountId);
    return {
      token: resolved.token,
      baseUrl: resolved.baseUrl,
      accountId,
      userId: profile?.userId || accountId
    };
  }
}

function detectType(items: MessageItem[]): IncomingMessage["type"] {
  const first = items[0];

  switch (first?.type) {
    case MessageItemType.IMAGE:
      return "image";
    case MessageItemType.VOICE:
      return "voice";
    case MessageItemType.FILE:
      return "file";
    case MessageItemType.VIDEO:
      return "video";
    default:
      return "text";
  }
}

function extractText(items: MessageItem[]): string {
  const parts = items.map((item) => {
    switch (item.type) {
      case MessageItemType.TEXT:
        return item.text_item?.text ?? "";
      case MessageItemType.IMAGE:
        return item.image_item?.url ?? "[image]";
      case MessageItemType.VOICE:
        return item.voice_item?.text ?? "[voice]";
      case MessageItemType.FILE:
        return item.file_item?.file_name ?? "[file]";
      case MessageItemType.VIDEO:
        return "[video]";
      default:
        return "";
    }
  }).filter(Boolean);

  return parts.join("\n");
}

function chunkText(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];

  for (let index = 0; index < chars.length; index += limit) {
    chunks.push(chars.slice(index, index + limit).join(""));
  }

  return chunks.length > 0 ? chunks : [""];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function resolvePollErrorCode(payload: { ret?: number; errcode?: number }): number {
  if (typeof payload.errcode === "number") return payload.errcode;
  if (typeof payload.ret === "number") return payload.ret;
  return 0;
}

function buildTextMessage(
  userId: string,
  contextToken: string,
  text: string,
  clientId: string,
  messageState: number
): {
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  item_list: Array<{ type: number; text_item: { text: string } }>;
} {
  return {
    from_user_id: "",
    to_user_id: userId,
    client_id: clientId,
    message_type: MessageType.BOT,
    message_state: messageState,
    context_token: contextToken,
    item_list: [
      {
        type: MessageItemType.TEXT,
        text_item: { text }
      }
    ]
  };
}
