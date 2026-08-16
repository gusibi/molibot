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
    console.warn("[title-summarizer] calling LLM...");
    const streamer = options?.streamFn ?? streamWithPiRuntime;
    const stream = await streamer(
      selection.model,
      context as never,
      { maxTokens: 35, apiKey, signal, reasoning: "off" } as never
    );

    // Same pattern as compaction: wait for the settled assistant message.
    const message = await (stream as unknown as { result: () => Promise<AssistantMessage> }).result();
    clearTimeout(timeoutId);

    console.warn(`[title-summarizer] LLM response stopReason=${message?.stopReason}`);

    if (message?.stopReason === "aborted" || message?.stopReason === "error") {
      console.warn("[title-summarizer] LLM returned error/aborted stopReason");
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
    const currentSettings = getSettings();
    const channel = params.channel ?? "web";

    const conversation = sessions.getConversationById(params.conversationId, channel, params.externalUserId);
    if (!conversation) {
      console.warn(`[title-summarizer] conversation not found: ${params.conversationId}`);
      return null;
    }

    // Only auto-summarize if title is currently default or matches early user-message truncation
    const currentTitle = conversation.title;
    const cleanMsg = params.firstUserMessage.replace(/\s+/g, " ").trim();
    const isDefaultTitle = !currentTitle || currentTitle === DEFAULT_SESSION_TITLE;
    const isTruncatedSnippet = currentTitle === cleanMsg.slice(0, 40) ||
                               currentTitle === `${cleanMsg.slice(0, 40)}...`;

    console.warn(`[title-summarizer] currentTitle="${currentTitle}" isDefault=${isDefaultTitle} isTruncated=${isTruncatedSnippet}`);

    if (!isDefaultTitle && !isTruncatedSnippet) {
      console.warn("[title-summarizer] title already set by user, skipping");
      return null;
    }

    const generatedTitle = await summarizeSessionTitleWithLlm(
      params.firstUserMessage,
      currentSettings,
      params.options
    );

    console.warn(`[title-summarizer] generatedTitle="${generatedTitle}"`);

    if (generatedTitle) {
      const updated = sessions.renameConversation(
        params.conversationId,
        channel,
        params.externalUserId,
        generatedTitle
      );
      console.warn(`[title-summarizer] rename result: ${updated ? "success" : "failed"}`);
      if (updated && params.onTitleUpdated) {
        params.onTitleUpdated(generatedTitle);
      }
      return generatedTitle;
    }
  } catch (err) {
    console.warn("[title-summarizer] background error:", err);
  }

  return null;
}
