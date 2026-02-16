import { config } from "../config.js";
import { AssistantService } from "../services/assistant.js";
import { RateLimiter } from "../services/rateLimiter.js";
import { SessionStore } from "../services/sessionStore.js";
import type { InboundMessage } from "../types/message.js";

export interface HandleResult {
  ok: boolean;
  response?: string;
  error?: string;
}

export class MessageRouter {
  private readonly limiter = new RateLimiter(config.rateLimitPerMinute);

  constructor(
    private readonly sessions: SessionStore,
    private readonly assistant: AssistantService
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
    this.sessions.appendMessage(conv.id, "user", trimmed);

    const history = this.sessions.listMessages(conv.id, 20);
    const answer = await this.assistant.reply(history, trimmed);
    this.sessions.appendMessage(conv.id, "assistant", answer);

    return { ok: true, response: answer };
  }
}
