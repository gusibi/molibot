import { config } from "../config.js";
import type { MemoryGateway } from "../memory/gateway.js";
import type { MemoryAddInput } from "../memory/types.js";
import { AssistantService } from "../services/assistant.js";
import { RateLimiter } from "../services/rateLimiter.js";
import { SessionStore } from "../services/sessionStore.js";
import type { InboundMessage } from "../types/message.js";

export interface HandleResult {
  ok: boolean;
  response?: string;
  error?: string;
}

function inferManualMemory(input: string): MemoryAddInput | null {
  const lower = input.toLowerCase();
  if (!input.trim()) return null;
  if (["记住", "记一下", "remember", "my name is", "i prefer", "call me"].some((hint) => lower.includes(hint))) {
    return {
      content: input,
      tags: ["manual", "user", "long_term"],
      layer: "long_term"
    };
  }
  if (["今天", "today", "for now", "当前"].some((hint) => lower.includes(hint))) {
    return {
      content: input,
      tags: ["manual", "user", "daily"],
      layer: "daily"
    };
  }
  return null;
}

export class MessageRouter {
  private readonly limiter = new RateLimiter(config.rateLimitPerMinute);

  constructor(
    private readonly sessions: SessionStore,
    private readonly assistant: AssistantService,
    private readonly memory: MemoryGateway
  ) {}

  async handle(input: InboundMessage): Promise<HandleResult> {
    const trimmed = input.content.trim();
    if (!trimmed) {
      return { ok: false, error: "Empty message." };
    }

    if (trimmed.length > config.maxMessageChars) {
      return { ok: false, error: `Message too long (>${config.maxMessageChars} chars).` };
    }

    const key = `${input.channel}:${input.externalUserId}`;
    if (!this.limiter.allow(key)) {
      return { ok: false, error: "Rate limit exceeded. Try again in a minute." };
    }

    const conv = this.sessions.getOrCreateConversation(
      input.channel,
      input.externalUserId,
      input.conversationId
    );
    const scope = { channel: input.channel, externalUserId: input.externalUserId };
    this.sessions.appendMessage(conv.id, "user", trimmed);

    const manualMemory = inferManualMemory(trimmed);
    if (manualMemory) {
      await this.memory.add(scope, {
        ...manualMemory,
        sourceSessionId: conv.id
      });
    }
    await this.memory.flush(scope);

    const history = this.sessions.listMessages(conv.id, 20);
    const memoryContext = await this.memory.buildPromptContext(
      scope,
      trimmed,
      5
    );
    const answer = await this.assistant.reply(history, trimmed, memoryContext);
    this.sessions.appendMessage(conv.id, "assistant", answer);

    return { ok: true, response: answer };
  }
}
