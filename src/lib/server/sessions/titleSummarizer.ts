import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { getRuntime } from "$lib/server/app/runtime.js";
import { resolveApiKeyForModel, resolveModelSelection } from "$lib/server/agent/routing/modelRouting.js";
import { streamWithPiRuntime } from "$lib/server/providers/piRuntime.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { currentModelKey } from "$lib/server/settings/modelSwitch.js";
import { isChineseLocale } from "$lib/server/agent/commands/i18n.js";

const DEFAULT_SESSION_TITLE = "New Session";
const TITLE_MAX_LENGTH_ZH = 15;
const TITLE_MAX_LENGTH_EN = 50;
const TITLE_SUMMARIZE_TIMEOUT_MS = 8000;

type StreamFn = typeof streamWithPiRuntime;

export interface SummarizeTitleOptions {
  signal?: AbortSignal;
  /** Override the shared pi runtime stream; used by tests. */
  streamFn?: StreamFn;
  /** Custom API key resolver function for testing */
  resolveApiKeyFn?: (model: Model<any>, settings: RuntimeSettings) => Promise<string | undefined>;
}

/**
 * Summarizes the first user message into a short title using LLM.
 * Uses `streamWithPiRuntime` (same as compaction/vision) to support
 * both pi built-in and custom providers.
 * Respects the system configured locale (Chinese or English) in system prompt.
 */
export async function summarizeSessionTitleWithLlm(
  userText: string,
  settings: RuntimeSettings,
  options?: SummarizeTitleOptions
): Promise<string | null> {
  const cleanInput = userText.replace(/\s+/g, " ").trim();
  if (!cleanInput) {
    console.warn("[title-summarizer] empty input, skipping");
    return null;
  }

  // Ignore command messages (e.g. /status)
  if (cleanInput.startsWith("/")) {
    console.warn("[title-summarizer] slash command, skipping");
    return null;
  }

  const effectiveKey = currentModelKey(settings, "text");
  if (!effectiveKey) {
    console.warn("[title-summarizer] no effective model key, skipping");
    return null;
  }

  const selection = resolveModelSelection(
    {
      ...settings,
      modelRouting: {
        ...settings.modelRouting,
        textModelKey: settings.modelRouting?.textModelKey || effectiveKey
      }
    },
    "text"
  );
  console.warn(`[title-summarizer] resolved model: ${selection.source}/${selection.providerId}/${selection.modelId}`);

  const keyResolver = options?.resolveApiKeyFn ?? resolveApiKeyForModel;
  const apiKey = await keyResolver(selection.model, settings);
  if (!apiKey) {
    console.warn("[title-summarizer] no API key resolved, skipping");
    return null;
  }

  const isZh = isChineseLocale(settings.locale);
  const systemPrompt = isZh
    ? "你是一个会话标题总结助手。你的任务是用中文将用户提问提炼为简短精炼的一句话标题。"
    : "You are a session title summarizer. Your task is to extract a concise single-line title in English for the provided text.";

  const prompt = isZh
    ? `请总结以下内容的主题作为标题，必须使用中文输出，控制在${TITLE_MAX_LENGTH_ZH}个字以内，不要包含任何标点符号、前缀说明或引号，直接输出标题：\n\n${cleanInput}`
    : `Summarize the topic of the following text in a concise single-line title. Output MUST be in English, strictly under 8 words, with no quotation marks or punctuation. Output the title text ONLY:\n\n${cleanInput}`;

  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    tools: []
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TITLE_SUMMARIZE_TIMEOUT_MS);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const isReasoningModel = Boolean(selection.model.reasoning);
    const streamOptions: Record<string, unknown> = {
      maxTokens: isReasoningModel ? 500 : 120,
      apiKey,
      signal
    };
    if (isReasoningModel) {
      streamOptions.reasoning = "low";
    }

    const streamer = options?.streamFn ?? streamWithPiRuntime;
    const stream = await streamer(
      selection.model,
      context as never,
      streamOptions as never
    );

    // Same pattern as compaction: wait for the settled assistant message.
    const message = await (stream as unknown as { result: () => Promise<AssistantMessage & { errorMessage?: string }> }).result();
    clearTimeout(timeoutId);

    console.warn(`[title-summarizer] LLM response stopReason=${message?.stopReason}, errorMessage=${(message as { errorMessage?: string })?.errorMessage ?? "none"}`);

    if (message?.stopReason === "aborted" || message?.stopReason === "error") {
      console.warn(`[title-summarizer] LLM returned error/aborted stopReason:`, JSON.stringify(message));
      return null;
    }

    const text = (Array.isArray(message?.content) ? message.content : [])
      .filter((part): part is { type: "text"; text: string } =>
        Boolean(part) && (part as { type?: unknown }).type === "text"
      )
      .map((part) => part.text)
      .join("")
      .trim();

    console.warn(`[title-summarizer] raw LLM output: "${text}"`);

    if (!text) return null;

    let cleanTitle = text
      .replace(/^["'「『【（(]+|["'」』】）)]+$/g, "")
      .replace(/^(标题|主题|总结|Title|Subject)[：:\s]*/i, "")
      .replace(/[\r\n]+/g, " ")
      .replace(/[。！？!?.\s]+$/g, "")
      .trim();

    if (!cleanTitle) return null;

    const maxLength = isZh ? TITLE_MAX_LENGTH_ZH : TITLE_MAX_LENGTH_EN;
    if (cleanTitle.length > maxLength) {
      cleanTitle = cleanTitle.slice(0, maxLength).trim();
    }
    console.warn(`[title-summarizer] final title: "${cleanTitle}"`);
    return cleanTitle;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[title-summarizer] LLM call failed:`, err);
    return null;
  }
}

/**
 * True when a conversation still carries the default (or raw snippet) title,
 * i.e. auto-summarization has not succeeded yet. Used as the send-time gate:
 * a failed first attempt (LLM timeout, missing key) must retry on later turns
 * instead of leaving the session titled "New Session" forever, while a title
 * the user (or a previous successful summary) set is never overwritten.
 */
export function hasDefaultConversationTitle(title: string | undefined | null): boolean {
  const current = String(title ?? "").trim();
  return !current || current === DEFAULT_SESSION_TITLE;
}

/**
 * Triggers background AI title summarization for a conversation if it is still using the default title or raw snippet title.
 */
export async function tryAutoSummarizeConversationTitleAsync(params: {
  conversationId: string;
  channel?: "web";
  externalUserId: string;
  firstUserMessage: string;
  onTitleUpdated?: (newTitle: string) => void;
  options?: SummarizeTitleOptions;
}): Promise<string | null> {
  try {
    const { sessions, getSettings } = getRuntime();
    const channel = params.channel ?? "web";
    const conversation = sessions.getConversationById(params.conversationId, channel, params.externalUserId);
    if (!conversation) {
      console.warn(`[title-summarizer] conversation not found: ${params.conversationId} (channel=${channel}, externalUserId=${params.externalUserId})`);
      return null;
    }

    // Only auto-summarize if title is currently default or matches early user-message truncation/full snippet.
    // This is also the retry gate: a failed earlier attempt leaves the default
    // title in place, so a later turn tries again — once a real title exists,
    // this skips without calling the LLM.
    const currentTitle = conversation.title;
    const cleanMsg = params.firstUserMessage.replace(/\s+/g, " ").trim();
    const isDefaultTitle = hasDefaultConversationTitle(currentTitle);
    const isTruncatedSnippet = currentTitle === cleanMsg.slice(0, 40) ||
                               currentTitle === `${cleanMsg.slice(0, 40)}...` ||
                               currentTitle === cleanMsg;

    console.log(`[title-summarizer] state check: conversationId=${params.conversationId}, currentTitle="${currentTitle}", cleanMsg="${cleanMsg}", isDefault=${isDefaultTitle}, isTruncated=${isTruncatedSnippet}`);

    if (!isDefaultTitle && !isTruncatedSnippet) {
      console.log(`[title-summarizer] skipping: title was already manually modified or customized by user ("${currentTitle}")`);
      return null;
    }

    console.log(`[title-summarizer] starting LLM summarization for conversationId=${params.conversationId}...`);
    const generatedTitle = await summarizeSessionTitleWithLlm(
      params.firstUserMessage,
      getSettings(),
      params.options
    );

    console.log(`[title-summarizer] LLM summary result: generatedTitle="${generatedTitle}"`);

    if (generatedTitle) {
      const updated = sessions.renameConversation(
        params.conversationId,
        channel,
        params.externalUserId,
        generatedTitle
      );
      console.log(`[title-summarizer] renameConversation result: ${updated ? `SUCCESS -> "${updated.title}"` : "FAILED"}`);
      if (updated && params.onTitleUpdated) {
        console.log(`[title-summarizer] notifying onTitleUpdated listener: "${generatedTitle}"`);
        params.onTitleUpdated(generatedTitle);
      }
      return generatedTitle;
    } else {
      console.warn(`[title-summarizer] LLM did not generate a valid title for conversationId=${params.conversationId}`);
    }
  } catch (err) {
    console.error("[title-summarizer] unexpected error during title summarization:", err);
  }

  return null;
}
